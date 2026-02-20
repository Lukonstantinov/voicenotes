import AVFoundation
import Foundation
import os.log

// MARK: - Constants

private let kYinThreshold: Float     = 0.12
private let kConfidenceEnter: Float  = 0.85
private let kConfidenceExit: Float   = 0.75
private let kRmsSilenceDbDefault: Float = -40.0
private let kMinFrequency: Float     = 75.0
private let kMaxFrequency: Float     = 2000.0
private let kMedianWindow: Int       = 3
private let kOctaveSuppressMax: Int  = 3
private let kAnalysisSize: Int       = 2048
private let kCaptureSize: Int        = 1024

private let kNoteNames = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
private let kLog = OSLog(subsystem: "com.dev.musicianscratchpad", category: "AudioCapture")

// MARK: - Shared state

private struct PitchState {
  var frequency: Float  = 0
  var noteName:  String = ""
  var octave:    Int    = 0
  var fullName:  String = ""
  var cents:     Int    = 0
  var confidence: Float = 0
  var timestamp: Double = 0
  var isValid:   Bool   = false
}

// MARK: - Module

@objc(AudioPitch)
class AudioCaptureModule: NSObject {

  // Audio infrastructure
  private var audioEngine: AVAudioEngine?
  private var isRunning = false

  // Pre-allocated DSP buffers (never alloc on audio thread)
  private var ringBuffer    = [Float](repeating: 0, count: kAnalysisSize)
  private var analysisWin   = [Float](repeating: 0, count: kAnalysisSize)
  private var yinDiff       = [Float](repeating: 0, count: kAnalysisSize / 2)
  private var yinCMND       = [Float](repeating: 0, count: kAnalysisSize / 2)
  private var medianBuf     = [Float](repeating: 0, count: kMedianWindow)

  private var ringWritePos  = 0
  private var samplesInRing = 0
  private var medianIdx     = 0
  private var medianCount   = 0

  // Sensitivity / silence gate threshold (dBFS). Written from JS thread, read on audio thread.
  // arm64 guarantees 32-bit aligned store/load atomicity, so no lock needed for this scalar config.
  private var rmsSilenceDb: Float = kRmsSilenceDbDefault

  // Signal-conditioning state
  private var isShowingPitch   = false
  private var prevFrequency: Float = 0
  private var octaveHoldCount  = 0

  // Atomic state (guarded by stateLock)
  private var stateLock   = pthread_mutex_t()
  private var latestState = PitchState()
  private var sampleRate: Float = 48000

  // MARK: Init / deinit

  override init() {
    super.init()
    pthread_mutex_init(&stateLock, nil)
  }

  deinit {
    stopCapture()
    pthread_mutex_destroy(&stateLock)
  }

  @objc static func requiresMainQueueSetup() -> Bool { return false }

  // MARK: - JS-facing API

  @objc func startListening() {
    guard !isRunning else { return }
    setupAudioSession()
    startCapture()
  }

  @objc func stopListening() {
    stopCapture()
    clearState()
  }

  /// Sets the RMS silence gate threshold (dBFS). Lower values = more sensitive.
  /// Safe to call at any time; takes effect on the next audio buffer.
  @objc func setSensitivity(_ db: Float) {
    rmsSilenceDb = db
  }

  // MARK: - File roadmap analysis

  /// Analyse an audio file in fixed-duration segments and return a note roadmap.
  /// Runs on a background queue; resolves/rejects on main queue.
  @objc func analyzeFileRoadmap(
    _ uri: String,
    segmentSec: Double,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { return }

      // ── 1. Build URL ────────────────────────────────────────────────────────
      let url: URL
      if uri.hasPrefix("file://") {
        guard let u = URL(string: uri) else {
          reject("INVALID_URI", "Cannot parse URI: \(uri)", nil); return
        }
        url = u
      } else {
        url = URL(fileURLWithPath: uri)
      }

      // ── 2. Open file ────────────────────────────────────────────────────────
      let file: AVAudioFile
      do { file = try AVAudioFile(forReading: url) } catch {
        reject("OPEN_FAILED", error.localizedDescription, error as NSError); return
      }

      let fileSR    = file.fileFormat.sampleRate
      let maxFrames = min(file.length, Int64(fileSR * 300)) // 5-min cap
      let spSeg     = max(Int(fileSR * segmentSec), kAnalysisSize) // min 1 YIN window

      // ── 3. Decode buffer: mono float32 ─────────────────────────────────────
      guard
        let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                sampleRate: fileSR, channels: 1, interleaved: false),
        let buf = AVAudioPCMBuffer(pcmFormat: fmt,
                                   frameCapacity: AVAudioFrameCount(kCaptureSize))
      else {
        reject("BUFFER_ALLOC", "Cannot allocate decode buffer", nil); return
      }

      // ── 4. Local DSP state (isolated from live-capture buffers) ─────────────
      var ring = [Float](repeating: 0, count: kAnalysisSize)
      var win  = [Float](repeating: 0, count: kAnalysisSize)
      var yd   = [Float](repeating: 0, count: kAnalysisSize / 2)
      var yc   = [Float](repeating: 0, count: kAnalysisSize / 2)
      var rp   = 0; var sIR = 0

      // ── 5. Vote accumulators ────────────────────────────────────────────────
      var segVote    = [Float](repeating: 0, count: 128)
      var globalVote = [Float](repeating: 0, count: 128)
      var segSamples = 0
      var segStart   = 0.0
      var totalRead: Int64 = 0
      var segments   = [[String: Any]]()

      // ── YIN on current win[] → (midi, confidence) or nil ───────────────────
      func runYIN() -> (Int, Float)? {
        let half = kAnalysisSize / 2
        for tau in 1..<half {
          var d: Float = 0
          for j in 0..<half { let x = win[j] - win[j + tau]; d += x * x }
          yd[tau] = d
        }
        yc[0] = 1; var rs: Float = 0
        for tau in 1..<half {
          rs += yd[tau]
          yc[tau] = rs > 0 ? yd[tau] * Float(tau) / rs : 1
        }
        var tauEst = -1
        for tau in 2..<half - 1 {
          if yc[tau] < kYinThreshold {
            var t = tau
            while t + 1 < half - 1, yc[t + 1] < yc[t] { t += 1 }
            tauEst = t; break
          }
        }
        guard tauEst > 0 else { return nil }
        let pv = max(1, tauEst - 1); let nx = min(half - 2, tauEst + 1)
        let dn = 2 * (yc[pv] - 2 * yc[tauEst] + yc[nx])
        let rf: Float = abs(dn) > 1e-8
          ? Float(tauEst) + (yc[pv] - yc[nx]) / dn
          : Float(tauEst)
        let freq = Float(fileSR) / rf
        guard freq >= kMinFrequency, freq <= kMaxFrequency else { return nil }
        let conf = max(0, min(1, 1 - yc[tauEst]))
        guard conf >= kConfidenceEnter else { return nil }
        let midi = max(0, min(127, Int((12 * log2(Double(freq) / 440) + 69).rounded())))
        return (midi, conf)
      }

      // ── Feed n samples into ring, run analysis when full ───────────────────
      func feedSamples(_ ch: UnsafePointer<Float>, _ n: Int) {
        for i in 0..<n {
          ring[rp] = ch[i]
          rp = (rp + 1) & (kAnalysisSize - 1)
        }
        sIR = min(sIR + n, kAnalysisSize)
        guard sIR >= kAnalysisSize else { return }
        for i in 0..<kAnalysisSize { win[i] = ring[(rp + i) & (kAnalysisSize - 1)] }
        var sq: Float = 0; for v in win { sq += v * v }
        guard (sq > 0 ? 20 * log10f(sqrtf(sq / Float(kAnalysisSize))) : -200) >= self.rmsSilenceDb
        else { return }
        if let (midi, conf) = runYIN() { segVote[midi] += conf }
      }

      // ── Finalize segment, reset for next ───────────────────────────────────
      func flushSegment() {
        let segEnd = segStart + Double(segSamples) / fileSR
        let total  = segVote.reduce(0, +)
        if total > 0 {
          let midi = segVote.indices.max(by: { segVote[$0] < segVote[$1] })!
          let conf = segVote[midi] / total
          let freq = Float(440.0 * pow(2.0, Double(midi - 69) / 12.0))
          if let note = self.frequencyToNote(freq) {
            segments.append([
              "startSec": segStart,   "endSec": segEnd,
              "noteName": note.noteName, "octave": note.octave,
              "fullName": note.fullName, "confidence": Double(conf), "hasNote": true,
            ])
            for i in 0..<128 { globalVote[i] += segVote[i] }
          } else {
            segments.append(["startSec": segStart, "endSec": segEnd,
              "noteName": "", "octave": 0, "fullName": "", "confidence": 0.0, "hasNote": false])
          }
        } else {
          segments.append(["startSec": segStart, "endSec": segEnd,
            "noteName": "", "octave": 0, "fullName": "", "confidence": 0.0, "hasNote": false])
        }
        segStart   += Double(segSamples) / fileSR
        segSamples  = 0
        for i in 0..<128 { segVote[i] = 0 }
      }

      // ── 6. Main decode + analysis loop ─────────────────────────────────────
      file.framePosition = 0
      while totalRead < maxFrames {
        buf.frameLength = 0
        do { try file.read(into: buf, frameCount: AVAudioFrameCount(kCaptureSize)) } catch { break }
        let n = Int(buf.frameLength); if n == 0 { break }
        guard let ch = buf.floatChannelData?[0] else { break }

        var i = 0
        while i < n, totalRead < maxFrames {
          let take = min(n - i, spSeg - segSamples)
          feedSamples(ch + i, take)
          segSamples += take; totalRead += Int64(take); i += take
          if segSamples >= spSeg { flushSegment() }
        }
      }
      if segSamples > 0 { flushSegment() }

      // ── 7. Dominant note across whole file ─────────────────────────────────
      let gTotal = globalVote.reduce(0, +)
      var dominantNote = ""
      if gTotal > 0 {
        let best = globalVote.indices.max(by: { globalVote[$0] < globalVote[$1] })!
        let freq = Float(440.0 * pow(2.0, Double(best - 69) / 12.0))
        if let note = self.frequencyToNote(freq) { dominantNote = note.fullName }
      }

      DispatchQueue.main.async {
        resolve([
          "segments":      segments,
          "dominantNote":  dominantNote,
          "totalDuration": Double(totalRead) / fileSR,
        ] as NSDictionary)
      }
    }
  }

  /// Called on the JS thread — must return synchronously.
  @objc func getLatestPitch() -> Any? {
    var state: PitchState
    pthread_mutex_lock(&stateLock)
    state = latestState
    pthread_mutex_unlock(&stateLock)

    guard state.isValid else { return nil }

    // Stale-data guard: > 200 ms old → return nil
    let nowMs = Date().timeIntervalSince1970 * 1000
    guard nowMs - state.timestamp <= 200 else { return nil }

    return [
      "frequency":  state.frequency,
      "noteName":   state.noteName,
      "octave":     state.octave,
      "fullName":   state.fullName,
      "cents":      state.cents,
      "confidence": state.confidence,
      "timestamp":  state.timestamp,
    ] as NSDictionary
  }

  // MARK: - Audio session

  private func setupAudioSession() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playAndRecord,
                              mode: .measurement,
                              options: [.defaultToSpeaker])
      try session.setActive(true)
      sampleRate = Float(session.sampleRate)
    } catch {
      os_log("AVAudioSession setup failed: %{public}@",
             log: kLog, type: .error, error.localizedDescription)
    }
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: nil)
  }

  @objc private func handleInterruption(_ note: Notification) {
    guard
      let info = note.userInfo,
      let typeVal = info[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: typeVal)
    else { return }

    if type == .began {
      stopCapture()
      clearState()
    } else if type == .ended,
      let optVal = info[AVAudioSessionInterruptionOptionKey] as? UInt,
      AVAudioSession.InterruptionOptions(rawValue: optVal).contains(.shouldResume) {
      startCapture()
    }
  }

  // MARK: - Capture lifecycle

  private func startCapture() {
    let engine = AVAudioEngine()
    audioEngine  = engine
    let input    = engine.inputNode
    let fmt      = input.outputFormat(forBus: 0)
    sampleRate   = Float(fmt.sampleRate)

    resetDSP()

    input.installTap(onBus: 0,
                     bufferSize: AVAudioFrameCount(kCaptureSize),
                     format: fmt) { [weak self] buffer, _ in
      self?.processBuffer(buffer)
    }

    do {
      try engine.start()
      isRunning = true
      os_log("Capture started at %.0f Hz", log: kLog, type: .info, Double(sampleRate))
    } catch {
      os_log("Engine start failed: %{public}@",
             log: kLog, type: .error, error.localizedDescription)
      audioEngine = nil
    }
  }

  private func stopCapture() {
    guard isRunning else { return }
    audioEngine?.inputNode.removeTap(onBus: 0)
    audioEngine?.stop()
    audioEngine = nil
    isRunning   = false
    NotificationCenter.default.removeObserver(
      self, name: AVAudioSession.interruptionNotification, object: nil)
  }

  private func resetDSP() {
    for i in 0..<kAnalysisSize   { ringBuffer[i]  = 0; analysisWin[i] = 0 }
    for i in 0..<kAnalysisSize/2 { yinDiff[i]     = 0; yinCMND[i]    = 0 }
    for i in 0..<kMedianWindow   { medianBuf[i]   = 0 }
    ringWritePos     = 0
    samplesInRing    = 0
    medianIdx        = 0
    medianCount      = 0
    isShowingPitch   = false
    prevFrequency    = 0
    octaveHoldCount  = 0
  }

  // MARK: - Audio processing  (audio thread — NO alloc, NO ObjC dispatch, NO logging)

  private func processBuffer(_ buffer: AVAudioPCMBuffer) {
    guard let ch = buffer.floatChannelData?[0] else { return }
    let n = Int(buffer.frameLength)

    // Fill ring buffer
    for i in 0..<n {
      ringBuffer[ringWritePos] = ch[i]
      ringWritePos = (ringWritePos + 1) & (kAnalysisSize - 1) // power-of-2 wrap
    }
    samplesInRing = min(samplesInRing + n, kAnalysisSize)
    guard samplesInRing >= kAnalysisSize else { return }

    // Unroll ring buffer into contiguous analysis window
    for i in 0..<kAnalysisSize {
      analysisWin[i] = ringBuffer[(ringWritePos + i) & (kAnalysisSize - 1)]
    }

    // [1] RMS silence gate
    var sumSq: Float = 0
    for i in 0..<kAnalysisSize { sumSq += analysisWin[i] * analysisWin[i] }
    let rms   = sqrtf(sumSq / Float(kAnalysisSize))
    let rmsDb = rms > 0 ? 20 * log10f(rms) : -200
    guard rmsDb >= rmsSilenceDb else { clearState(); return }

    // [2] YIN
    guard let (rawFreq, confidence) = yin() else { clearState(); return }

    // [3] Confidence hysteresis
    if isShowingPitch {
      guard confidence >= kConfidenceExit  else { clearState(); return }
    } else {
      guard confidence >= kConfidenceEnter else { return }
    }

    // [4] Octave jump suppression
    var freq = rawFreq
    if prevFrequency > 0 {
      let ratio = freq / prevFrequency
      if (ratio > 1.85 && ratio < 2.15) || (ratio > 0.46 && ratio < 0.54) {
        if octaveHoldCount < kOctaveSuppressMax {
          freq = prevFrequency
          octaveHoldCount += 1
        } else {
          octaveHoldCount = 0
        }
      } else {
        octaveHoldCount = 0
      }
    }
    prevFrequency = freq

    // [5] 3-frame median filter
    medianBuf[medianIdx] = freq
    medianIdx   = (medianIdx + 1) % kMedianWindow
    medianCount = min(medianCount + 1, kMedianWindow)

    // Sort the live window (max 3 elements — no heap alloc needed)
    var a = medianBuf[0], b = medianBuf[1], c = medianBuf[2]
    if medianCount == 1 {
      // single sample, use as-is
    } else if medianCount == 2 {
      freq = (a + b) / 2  // average until window is full
    } else {
      if a > b { swap(&a, &b) }
      if b > c { swap(&b, &c) }
      if a > b { swap(&a, &b) }
      freq = b  // median
    }

    guard let note = frequencyToNote(freq) else { return }

    // [6] Write atomic state
    isShowingPitch = true
    let tsMs = Date().timeIntervalSince1970 * 1000

    pthread_mutex_lock(&stateLock)
    latestState = PitchState(
      frequency:  freq,
      noteName:   note.noteName,
      octave:     note.octave,
      fullName:   note.fullName,
      cents:      note.cents,
      confidence: confidence,
      timestamp:  tsMs,
      isValid:    true)
    pthread_mutex_unlock(&stateLock)
  }

  private func clearState() {
    isShowingPitch = false
    pthread_mutex_lock(&stateLock)
    latestState = PitchState()
    pthread_mutex_unlock(&stateLock)
  }

  // MARK: - YIN  (operates on analysisWin, writes to yinDiff / yinCMND)

  private func yin() -> (Float, Float)? {
    let halfN = kAnalysisSize / 2

    // Step 1 — difference function
    for tau in 1..<halfN {
      var diff: Float = 0
      for j in 0..<halfN {
        let d = analysisWin[j] - analysisWin[j + tau]
        diff += d * d
      }
      yinDiff[tau] = diff
    }

    // Step 2 — cumulative mean normalised difference
    yinCMND[0]  = 1.0
    var runSum: Float = 0
    for tau in 1..<halfN {
      runSum += yinDiff[tau]
      yinCMND[tau] = runSum > 0 ? yinDiff[tau] * Float(tau) / runSum : 1.0
    }

    // Step 3 — absolute threshold + local minimum
    var tauEst = -1
    for tau in 2..<halfN - 1 {
      if yinCMND[tau] < kYinThreshold {
        var t = tau
        while t + 1 < halfN - 1, yinCMND[t + 1] < yinCMND[t] { t += 1 }
        tauEst = t
        break
      }
    }
    guard tauEst > 0 else { return nil }

    // Step 4 — parabolic interpolation
    let prev = max(1, tauEst - 1)
    let next = min(halfN - 2, tauEst + 1)
    let denom = 2 * (yinCMND[prev] - 2 * yinCMND[tauEst] + yinCMND[next])
    let refined: Float
    if abs(denom) > 1e-8 {
      refined = Float(tauEst) + (yinCMND[prev] - yinCMND[next]) / denom
    } else {
      refined = Float(tauEst)
    }

    // Step 5 — frequency + confidence
    let frequency = sampleRate / refined
    guard frequency >= kMinFrequency, frequency <= kMaxFrequency else { return nil }
    let confidence = max(0, min(1, 1.0 - yinCMND[tauEst]))
    return (frequency, confidence)
  }

  // MARK: - Frequency → note

  private struct NoteInfo { let noteName: String; let octave: Int; let fullName: String; let cents: Int }

  private func frequencyToNote(_ freq: Float) -> NoteInfo? {
    guard freq > 20, freq <= 5000 else { return nil }
    let noteNum     = Double(12) * log2(Double(freq) / 440.0) + 69
    let midiNearest = Int(noteNum.rounded())
    let nearFreq    = 440.0 * pow(2.0, Double(midiNearest - 69) / 12.0)
    let cents       = Int((1200.0 * log2(Double(freq) / nearFreq)).rounded())
    let noteIdx     = ((midiNearest % 12) + 12) % 12
    let noteName    = kNoteNames[noteIdx]
    let octave      = midiNearest / 12 - 1
    return NoteInfo(noteName: noteName, octave: octave,
                    fullName: "\(noteName)\(octave)", cents: cents)
  }
}

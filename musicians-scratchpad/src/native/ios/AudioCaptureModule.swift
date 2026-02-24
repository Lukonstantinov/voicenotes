import AVFoundation
import Foundation
import os.log

// MARK: - Constants (compile-time defaults; runtime values live in the instance)

private let kYinThreshold: Float     = 0.12
private let kConfidenceEnter: Float  = 0.80
private let kConfidenceExit: Float   = 0.70
private let kRmsSilenceDb: Float     = -50.0
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

  // Signal-conditioning state
  private var isShowingPitch   = false
  private var prevFrequency: Float = 0
  private var octaveHoldCount  = 0

  // Runtime-tunable sensitivity (updated via setSensitivity, read on audio thread)
  private var dynSilenceDb: Float  = kRmsSilenceDb
  private var dynConfEnter: Float  = kConfidenceEnter
  private var dynConfExit: Float   = kConfidenceExit

  // Runtime-tunable A4 reference (updated via setA4Calibration, read on audio thread)
  private var dynA4: Double = 440.0

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

  /// Update the three runtime-tunable sensitivity constants.
  @objc func setSensitivity(_ silenceDb: Double,
                             confidenceEnter: Double,
                             confidenceExit: Double) {
    dynSilenceDb = Float(silenceDb)
    dynConfEnter = Float(confidenceEnter)
    dynConfExit  = Float(confidenceExit)
  }

  /// Update the A4 reference frequency used for note name / cents calculation.
  @objc func setA4Calibration(_ hz: Double) {
    dynA4 = hz
  }

  /// Offline pitch analysis of a local audio file.
  @objc func analyzeAudioFile(_ filePath: String,
                               resolve: @escaping RCTPromiseResolveBlock,
                               reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { return }

      let url = URL(fileURLWithPath: filePath)
      guard let audioFile = try? AVAudioFile(forReading: url) else {
        reject("FILE_OPEN_ERROR", "Cannot open audio file: \(filePath)", nil)
        return
      }

      let fileSampleRate = Float(audioFile.processingFormat.sampleRate)
      let channelCount   = Int(audioFile.processingFormat.channelCount)
      let totalFrames    = Int(audioFile.length)

      // Offline-only DSP buffers (not shared with live capture)
      var offRing   = [Float](repeating: 0, count: kAnalysisSize)
      var offWin    = [Float](repeating: 0, count: kAnalysisSize)
      var offDiff   = [Float](repeating: 0, count: kAnalysisSize / 2)
      var offCMND   = [Float](repeating: 0, count: kAnalysisSize / 2)
      var offMedian = [Float](repeating: 0, count: kMedianWindow)

      var ringWrite     = 0
      var samplesInRing = 0
      var medIdx        = 0
      var medCount      = 0
      var prevFreq: Float = 0
      var octHold       = 0
      var isShowingNote = false

      // Snapshot sensitivity at analysis start
      let silenceDb = self.dynSilenceDb
      let confEnter = self.dynConfEnter
      let confExit  = self.dynConfExit

      var frames: [[String: Any]] = []
      var processedSamples = 0

      guard let pcmBuf = AVAudioPCMBuffer(
        pcmFormat: audioFile.processingFormat,
        frameCapacity: AVAudioFrameCount(kCaptureSize)
      ) else {
        reject("BUFFER_ERROR", "Cannot allocate PCM buffer", nil)
        return
      }

      while processedSamples < totalFrames {
        pcmBuf.frameLength = 0
        do { try audioFile.read(into: pcmBuf) } catch { break }
        let framesRead = Int(pcmBuf.frameLength)
        guard framesRead > 0 else { break }

        // Mix to mono
        var mono = [Float](repeating: 0, count: framesRead)
        if let ch = pcmBuf.floatChannelData {
          for c in 0..<channelCount {
            for i in 0..<framesRead { mono[i] += ch[c][i] }
          }
          if channelCount > 1 {
            let inv = 1.0 / Float(channelCount)
            for i in 0..<framesRead { mono[i] *= inv }
          }
        }

        // Fill ring buffer
        for i in 0..<framesRead {
          offRing[ringWrite] = mono[i]
          ringWrite = (ringWrite + 1) & (kAnalysisSize - 1)
        }
        samplesInRing = min(samplesInRing + framesRead, kAnalysisSize)

        if samplesInRing >= kAnalysisSize {
          // Unroll ring into contiguous window
          for i in 0..<kAnalysisSize {
            offWin[i] = offRing[(ringWrite + i) & (kAnalysisSize - 1)]
          }

          // RMS silence gate
          var sumSq: Float = 0
          for i in 0..<kAnalysisSize { sumSq += offWin[i] * offWin[i] }
          let rms   = sqrtf(sumSq / Float(kAnalysisSize))
          let rmsDb = rms > 0 ? 20 * log10f(rms) : -200

          let tsMs = Double(processedSamples) / Double(fileSampleRate) * 1000.0

          if rmsDb >= silenceDb,
             let (rawFreq, confidence) = self.yinOffline(
               win: &offWin, diff: &offDiff, cmnd: &offCMND, sr: fileSampleRate) {

            // Confidence hysteresis
            let passes = isShowingNote ? confidence >= confExit
                                       : confidence >= confEnter
            if passes {
              // Octave jump suppression
              var freq = rawFreq
              if prevFreq > 0 {
                let ratio = freq / prevFreq
                if (ratio > 1.85 && ratio < 2.15) || (ratio > 0.46 && ratio < 0.54) {
                  if octHold < kOctaveSuppressMax { freq = prevFreq; octHold += 1 }
                  else { octHold = 0 }
                } else { octHold = 0 }
              }
              prevFreq = freq

              // 3-frame median filter
              offMedian[medIdx] = freq
              medIdx   = (medIdx + 1) % kMedianWindow
              medCount = min(medCount + 1, kMedianWindow)
              var medFreq = freq
              if medCount == 2 {
                medFreq = (offMedian[0] + offMedian[1]) / 2
              } else if medCount >= 3 {
                var a = offMedian[0], b = offMedian[1], c = offMedian[2]
                if a > b { swap(&a, &b) }; if b > c { swap(&b, &c) }; if a > b { swap(&a, &b) }
                medFreq = b
              }

              if let note = self.frequencyToNote(medFreq) {
                isShowingNote = true
                frames.append([
                  "noteName":    note.noteName,
                  "octave":      note.octave,
                  "frequency":   medFreq,
                  "cents":       note.cents,
                  "confidence":  confidence,
                  "timestampMs": tsMs,
                ])
              }
            } else {
              isShowingNote = false
              medCount = 0
            }
          } else {
            isShowingNote = false
            medCount = 0
          }
        }

        processedSamples += framesRead
      }

      resolve(frames)
    }
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

    // Snapshot sensitivity (written from JS thread; one-frame race is harmless)
    let silenceDb = dynSilenceDb
    let confEnter = dynConfEnter
    let confExit  = dynConfExit

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
    guard rmsDb >= silenceDb else { clearState(); return }

    // [2] YIN
    guard let (rawFreq, confidence) = yin() else { clearState(); return }

    // [3] Confidence hysteresis
    if isShowingPitch {
      guard confidence >= confExit  else { clearState(); return }
    } else {
      guard confidence >= confEnter else { return }
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

  // MARK: - Offline YIN (uses caller-provided buffers — thread-safe, no shared state)

  private func yinOffline(win: inout [Float],
                           diff: inout [Float],
                           cmnd: inout [Float],
                           sr: Float) -> (Float, Float)? {
    let halfN = kAnalysisSize / 2

    for tau in 1..<halfN {
      var d: Float = 0
      for j in 0..<halfN { let x = win[j] - win[j + tau]; d += x * x }
      diff[tau] = d
    }

    cmnd[0] = 1.0
    var runSum: Float = 0
    for tau in 1..<halfN {
      runSum += diff[tau]
      cmnd[tau] = runSum > 0 ? diff[tau] * Float(tau) / runSum : 1.0
    }

    var tauEst = -1
    for tau in 2..<halfN - 1 {
      if cmnd[tau] < kYinThreshold {
        var t = tau
        while t + 1 < halfN - 1, cmnd[t + 1] < cmnd[t] { t += 1 }
        tauEst = t; break
      }
    }
    guard tauEst > 0 else { return nil }

    let prev = max(1, tauEst - 1)
    let next = min(halfN - 2, tauEst + 1)
    let denom = 2 * (cmnd[prev] - 2 * cmnd[tauEst] + cmnd[next])
    let refined: Float = abs(denom) > 1e-8
      ? Float(tauEst) + (cmnd[prev] - cmnd[next]) / denom
      : Float(tauEst)

    let frequency = sr / refined
    guard frequency >= kMinFrequency, frequency <= kMaxFrequency else { return nil }
    let confidence = max(0, min(1, 1.0 - cmnd[tauEst]))
    return (frequency, confidence)
  }

  // MARK: - Frequency → note

  private struct NoteInfo { let noteName: String; let octave: Int; let fullName: String; let cents: Int }

  private func frequencyToNote(_ freq: Float) -> NoteInfo? {
    guard freq > 20, freq <= 5000 else { return nil }
    let a4          = dynA4
    let noteNum     = Double(12) * log2(Double(freq) / a4) + 69
    let midiNearest = Int(noteNum.rounded())
    let nearFreq    = a4 * pow(2.0, Double(midiNearest - 69) / 12.0)
    let cents       = Int((1200.0 * log2(Double(freq) / nearFreq)).rounded())
    let noteIdx     = ((midiNearest % 12) + 12) % 12
    let noteName    = kNoteNames[noteIdx]
    let octave      = midiNearest / 12 - 1
    return NoteInfo(noteName: noteName, octave: octave,
                    fullName: "\(noteName)\(octave)", cents: cents)
  }
}

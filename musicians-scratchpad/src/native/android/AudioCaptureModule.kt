package com.dev.musicianscratchpad

import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaRecorder
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.log2
import kotlin.math.pow
import kotlin.math.round
import kotlin.math.sqrt

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
private const val TAG                 = "AudioPitch"
private const val YIN_THRESHOLD       = 0.12f
private const val CONFIDENCE_ENTER    = 0.85f
private const val CONFIDENCE_EXIT     = 0.75f
private const val RMS_SILENCE_DB      = -40.0f
private const val MIN_FREQUENCY       = 75.0f
private const val MAX_FREQUENCY       = 2000.0f
private const val MEDIAN_WINDOW       = 3
private const val OCTAVE_SUPPRESS_MAX = 3
private const val ANALYSIS_SIZE       = 2048
private const val CAPTURE_SIZE        = 1024

private val NOTE_NAMES = arrayOf("C","C#","D","D#","E","F","F#","G","G#","A","A#","B")

// ─────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────
private data class PitchState(
    val frequency:  Float  = 0f,
    val noteName:   String = "",
    val octave:     Int    = 0,
    val fullName:   String = "",
    val cents:      Int    = 0,
    val confidence: Float  = 0f,
    val timestamp:  Double = 0.0,
    val isValid:    Boolean = false
)

// ─────────────────────────────────────────────────────────────
// Module
// ─────────────────────────────────────────────────────────────
@ReactModule(name = AudioCaptureModule.NAME)
class AudioCaptureModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "AudioPitch"
    }

    override fun getName() = NAME

    // Audio infrastructure
    private var audioRecord: AudioRecord? = null
    private val running       = AtomicBoolean(false)
    private var captureThread: Thread? = null
    private var sampleRate    = 48000

    // Pre-allocated DSP buffers
    private val ringBuffer    = FloatArray(ANALYSIS_SIZE)
    private val analysisWin   = FloatArray(ANALYSIS_SIZE)
    private val yinDiff       = FloatArray(ANALYSIS_SIZE / 2)
    private val yinCMND       = FloatArray(ANALYSIS_SIZE / 2)
    private val medianBuf     = FloatArray(MEDIAN_WINDOW)
    private val captureChunk  = FloatArray(CAPTURE_SIZE)

    private var ringWritePos  = 0
    private var samplesInRing = 0
    private var medianIdx     = 0
    private var medianCount   = 0

    // Signal-conditioning state
    private var isShowingPitch   = false
    private var prevFrequency    = 0f
    private var octaveHoldCount  = 0

    // Runtime-tunable sensitivity (updated via setSensitivity, read on capture thread)
    @Volatile private var dynSilenceDb  = RMS_SILENCE_DB
    @Volatile private var dynConfEnter  = CONFIDENCE_ENTER
    @Volatile private var dynConfExit   = CONFIDENCE_EXIT

    // Runtime-tunable A4 reference (updated via setA4Calibration, read on capture thread)
    @Volatile private var dynA4 = 440.0

    // Atomic state (guarded by stateLock)
    private val stateLock = Any()
    @Volatile private var latestState = PitchState()

    // Audio focus handling — pause on phone calls, resume after
    private val audioFocusListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                if (running.get()) stop()
            }
        }
    }

    // ─────────────────────────────────────────────────────────
    // JS API
    // ─────────────────────────────────────────────────────────

    @ReactMethod
    fun startListening() {
        if (running.get()) return
        requestAudioFocus()
        setupAndStart()
    }

    @ReactMethod
    fun stopListening() {
        stop()
        abandonAudioFocus()
    }

    /**
     * Synchronous getter — called on JS thread.
     * isBlockingSynchronousMethod = true makes it synchronous in the legacy bridge.
     * In TurboModule / New Architecture, non-Promise methods are automatically
     * synchronous via JSI (the annotation is advisory there).
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getLatestPitch(): WritableMap? {
        val state: PitchState
        synchronized(stateLock) { state = latestState }

        if (!state.isValid) return null

        // Stale-data guard: > 200 ms → null
        val nowMs = System.currentTimeMillis().toDouble()
        if (nowMs - state.timestamp > 200) return null

        return Arguments.createMap().apply {
            putDouble("frequency",  state.frequency.toDouble())
            putString("noteName",   state.noteName)
            putInt   ("octave",     state.octave)
            putString("fullName",   state.fullName)
            putInt   ("cents",      state.cents)
            putDouble("confidence", state.confidence.toDouble())
            putDouble("timestamp",  state.timestamp)
        }
    }

    /** Update the three runtime-tunable sensitivity constants. */
    @ReactMethod
    fun setSensitivity(silenceDb: Double, confidenceEnter: Double, confidenceExit: Double) {
        dynSilenceDb = silenceDb.toFloat()
        dynConfEnter = confidenceEnter.toFloat()
        dynConfExit  = confidenceExit.toFloat()
    }

    /** Update the A4 reference frequency used for note name / cents calculation. */
    @ReactMethod
    fun setA4Calibration(hz: Double) {
        dynA4 = hz
    }

    /** Offline pitch analysis of a local audio file. */
    @ReactMethod
    fun analyzeAudioFile(filePath: String, promise: Promise) {
        Thread {
            try {
                // ── 1. Demux with MediaExtractor ──────────────────────────
                val extractor = MediaExtractor()
                extractor.setDataSource(filePath)

                var trackIndex = -1
                var trackFormat: MediaFormat? = null
                for (i in 0 until extractor.trackCount) {
                    val fmt  = extractor.getTrackFormat(i)
                    val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
                    if (mime.startsWith("audio/")) { trackIndex = i; trackFormat = fmt; break }
                }
                if (trackIndex < 0 || trackFormat == null) {
                    extractor.release()
                    promise.reject("FILE_OPEN_ERROR", "No audio track found: $filePath")
                    return@Thread
                }
                extractor.selectTrack(trackIndex)

                val fileSampleRate = trackFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                val channelCount   = if (trackFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT))
                    trackFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 1
                val mime = trackFormat.getString(MediaFormat.KEY_MIME)!!

                // ── 2. Decode to PCM using MediaCodec ─────────────────────
                val codec = MediaCodec.createDecoderByType(mime)
                codec.configure(trackFormat, null, null, 0)
                codec.start()

                val allSamples  = ArrayList<Float>(1 shl 20) // pre-alloc ~4 M floats
                val bufInfo     = MediaCodec.BufferInfo()
                var sawInputEOS = false
                var sawOutputEOS = false
                var outputFormat: MediaFormat? = null

                while (!sawOutputEOS) {
                    if (!sawInputEOS) {
                        val inIdx = codec.dequeueInputBuffer(10_000L)
                        if (inIdx >= 0) {
                            val inBuf = codec.getInputBuffer(inIdx)!!
                            val n     = extractor.readSampleData(inBuf, 0)
                            if (n < 0) {
                                codec.queueInputBuffer(inIdx, 0, 0, 0L,
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                sawInputEOS = true
                            } else {
                                codec.queueInputBuffer(inIdx, 0, n, extractor.sampleTime, 0)
                                extractor.advance()
                            }
                        }
                    }

                    val outIdx = codec.dequeueOutputBuffer(bufInfo, 10_000L)
                    when {
                        outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED ->
                            outputFormat = codec.outputFormat
                        outIdx >= 0 -> {
                            val outBuf = codec.getOutputBuffer(outIdx)!!
                            val fmt    = outputFormat ?: codec.outputFormat
                            val pcmEnc = if (fmt.containsKey(MediaFormat.KEY_PCM_ENCODING))
                                fmt.getInteger(MediaFormat.KEY_PCM_ENCODING)
                            else AudioFormat.ENCODING_PCM_16BIT

                            if (pcmEnc == AudioFormat.ENCODING_PCM_FLOAT) {
                                val fb = outBuf.asFloatBuffer()
                                while (fb.hasRemaining()) allSamples.add(fb.get())
                            } else {
                                // PCM_16BIT — convert to [-1, 1] float
                                val sb = outBuf.asShortBuffer()
                                while (sb.hasRemaining())
                                    allSamples.add(sb.get().toFloat() / 32768f)
                            }
                            codec.releaseOutputBuffer(outIdx, false)
                            if (bufInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0)
                                sawOutputEOS = true
                        }
                    }
                }
                codec.stop(); codec.release(); extractor.release()

                // ── 3. Mix to mono ────────────────────────────────────────
                val monoSamples: FloatArray
                if (channelCount > 1) {
                    val monoSize = allSamples.size / channelCount
                    monoSamples  = FloatArray(monoSize)
                    val inv      = 1f / channelCount
                    for (i in 0 until monoSize) {
                        var sum = 0f
                        for (c in 0 until channelCount) sum += allSamples[i * channelCount + c]
                        monoSamples[i] = sum * inv
                    }
                } else {
                    monoSamples = allSamples.toFloatArray()
                }

                // ── 4. YIN offline analysis ───────────────────────────────
                val offRing   = FloatArray(ANALYSIS_SIZE)
                val offWin    = FloatArray(ANALYSIS_SIZE)
                val offDiff   = FloatArray(ANALYSIS_SIZE / 2)
                val offCMND   = FloatArray(ANALYSIS_SIZE / 2)
                val offMedian = FloatArray(MEDIAN_WINDOW)

                var ringWrite       = 0
                var samplesInRingOff = 0
                var medIdx          = 0
                var medCountOff     = 0
                var prevFreq        = 0f
                var octHold         = 0
                var isShowingNote   = false

                val frames = Arguments.createArray()
                var processed = 0

                while (processed < monoSamples.size) {
                    val end       = minOf(processed + CAPTURE_SIZE, monoSamples.size)
                    val chunkSize = end - processed
                    for (i in 0 until chunkSize) {
                        offRing[ringWrite] = monoSamples[processed + i]
                        ringWrite = (ringWrite + 1) and (ANALYSIS_SIZE - 1)
                    }
                    samplesInRingOff = minOf(samplesInRingOff + chunkSize, ANALYSIS_SIZE)
                    processed += chunkSize
                    if (samplesInRingOff < ANALYSIS_SIZE) continue

                    // Unroll ring buffer into contiguous window
                    for (i in 0 until ANALYSIS_SIZE)
                        offWin[i] = offRing[(ringWrite + i) and (ANALYSIS_SIZE - 1)]

                    // RMS silence gate
                    var sumSq = 0f
                    for (v in offWin) sumSq += v * v
                    val rms   = sqrt(sumSq / ANALYSIS_SIZE)
                    val rmsDb = if (rms > 0f) 20f * log10(rms) else -200f
                    val tsMs  = processed.toDouble() / fileSampleRate.toDouble() * 1000.0

                    if (rmsDb >= RMS_SILENCE_DB) {
                        val yr = yinOffline(offWin, offDiff, offCMND, fileSampleRate.toFloat())
                        if (yr != null) {
                            val (rawFreq, confidence) = yr
                            val passes = if (isShowingNote) confidence >= CONFIDENCE_EXIT
                                         else               confidence >= CONFIDENCE_ENTER
                            if (passes) {
                                var freq = rawFreq
                                if (prevFreq > 0f) {
                                    val ratio = freq / prevFreq
                                    if ((ratio > 1.85f && ratio < 2.15f) ||
                                        (ratio > 0.46f && ratio < 0.54f)) {
                                        if (octHold < OCTAVE_SUPPRESS_MAX) { freq = prevFreq; octHold++ }
                                        else octHold = 0
                                    } else octHold = 0
                                }
                                prevFreq = freq

                                offMedian[medIdx] = freq
                                medIdx      = (medIdx + 1) % MEDIAN_WINDOW
                                medCountOff = minOf(medCountOff + 1, MEDIAN_WINDOW)

                                val medFreq = when (medCountOff) {
                                    1    -> offMedian[0]
                                    2    -> (offMedian[0] + offMedian[1]) / 2f
                                    else -> offMedian.copyOf(MEDIAN_WINDOW).also { it.sort() }[1]
                                }

                                val note = frequencyToNote(medFreq)
                                if (note != null) {
                                    isShowingNote = true
                                    val frame = Arguments.createMap()
                                    frame.putString("noteName",    note.noteName)
                                    frame.putInt   ("octave",      note.octave)
                                    frame.putDouble("frequency",   medFreq.toDouble())
                                    frame.putInt   ("cents",       note.cents)
                                    frame.putDouble("confidence",  confidence.toDouble())
                                    frame.putDouble("timestampMs", tsMs)
                                    frames.pushMap(frame)
                                }
                            } else { isShowingNote = false; medCountOff = 0 }
                        } else { isShowingNote = false; medCountOff = 0 }
                    } else { isShowingNote = false; medCountOff = 0 }
                }

                promise.resolve(frames)
            } catch (e: Exception) {
                promise.reject("FILE_OPEN_ERROR",
                    "Cannot analyse audio file: $filePath. ${e.message}", e)
            }
        }.also { it.isDaemon = true }.start()
    }

    // ─────────────────────────────────────────────────────────
    // Audio capture
    // ─────────────────────────────────────────────────────────

    @Suppress("DEPRECATION")
    private fun requestAudioFocus() {
        val audioManager = reactContext.getSystemService(android.content.Context.AUDIO_SERVICE)
                as AudioManager
        audioManager.requestAudioFocus(
            audioFocusListener,
            AudioManager.STREAM_MUSIC,
            AudioManager.AUDIOFOCUS_GAIN
        )
    }

    @Suppress("DEPRECATION")
    private fun abandonAudioFocus() {
        val audioManager = reactContext.getSystemService(android.content.Context.AUDIO_SERVICE)
                as AudioManager
        audioManager.abandonAudioFocus(audioFocusListener)
    }

    private fun setupAndStart() {
        val audioManager = reactContext.getSystemService(android.content.Context.AUDIO_SERVICE)
                as AudioManager
        sampleRate = audioManager
            .getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)
            ?.toIntOrNull() ?: 48000

        val minBuf = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_FLOAT)

        val bufSize = maxOf(minBuf, CAPTURE_SIZE * 4)

        val ar = AudioRecord(
            MediaRecorder.AudioSource.UNPROCESSED,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_FLOAT,
            bufSize)

        if (ar.state != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "AudioRecord init failed, retrying with VOICE_RECOGNITION source")
            ar.release()
            val ar2 = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_FLOAT,
                bufSize)
            if (ar2.state != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "AudioRecord fallback also failed")
                ar2.release()
                return
            }
            audioRecord = ar2
        } else {
            audioRecord = ar
        }

        resetDSP()
        running.set(true)
        audioRecord!!.startRecording()

        captureThread = Thread({
            val buf = captureChunk
            while (running.get()) {
                val read = audioRecord?.read(buf, 0, CAPTURE_SIZE,
                    AudioRecord.READ_BLOCKING) ?: break
                if (read > 0) processChunk(buf, read)
            }
        }, "audio-capture").apply { isDaemon = true; start() }

        Log.d(TAG, "Capture started at $sampleRate Hz")
    }

    private fun stop() {
        running.set(false)
        captureThread?.join(500)
        captureThread = null
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
        clearState()
    }

    private fun resetDSP() {
        ringBuffer.fill(0f)
        analysisWin.fill(0f)
        yinDiff.fill(0f)
        yinCMND.fill(0f)
        medianBuf.fill(0f)
        ringWritePos     = 0
        samplesInRing    = 0
        medianIdx        = 0
        medianCount      = 0
        isShowingPitch   = false
        prevFrequency    = 0f
        octaveHoldCount  = 0
    }

    // ─────────────────────────────────────────────────────────
    // DSP  (capture thread — no alloc, no Android API calls)
    // ─────────────────────────────────────────────────────────

    private fun processChunk(buf: FloatArray, n: Int) {
        // Fill ring buffer
        for (i in 0 until n) {
            ringBuffer[ringWritePos] = buf[i]
            ringWritePos = (ringWritePos + 1) and (ANALYSIS_SIZE - 1)
        }
        samplesInRing = minOf(samplesInRing + n, ANALYSIS_SIZE)
        if (samplesInRing < ANALYSIS_SIZE) return

        // Unroll ring buffer into contiguous analysis window
        for (i in 0 until ANALYSIS_SIZE) {
            analysisWin[i] = ringBuffer[(ringWritePos + i) and (ANALYSIS_SIZE - 1)]
        }

        // Snapshot sensitivity (written from JS thread; one-frame race is harmless)
        val silenceDb = dynSilenceDb
        val confEnter = dynConfEnter
        val confExit  = dynConfExit

        // [1] RMS silence gate
        var sumSq = 0f
        for (v in analysisWin) sumSq += v * v
        val rms   = sqrt(sumSq / ANALYSIS_SIZE)
        val rmsDb = if (rms > 0f) 20f * log10(rms) else -200f
        if (rmsDb < silenceDb) { clearState(); return }

        // [2] YIN
        val yinResult = yin() ?: run { clearState(); return }
        val (rawFreq, confidence) = yinResult

        // [3] Confidence hysteresis
        if (isShowingPitch) {
            if (confidence < confExit)  { clearState(); return }
        } else {
            if (confidence < confEnter) return
        }

        // [4] Octave jump suppression
        var freq = rawFreq
        if (prevFrequency > 0f) {
            val ratio = freq / prevFrequency
            if ((ratio > 1.85f && ratio < 2.15f) || (ratio > 0.46f && ratio < 0.54f)) {
                if (octaveHoldCount < OCTAVE_SUPPRESS_MAX) {
                    freq = prevFrequency
                    octaveHoldCount++
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
        medianIdx   = (medianIdx + 1) % MEDIAN_WINDOW
        medianCount = minOf(medianCount + 1, MEDIAN_WINDOW)

        freq = when (medianCount) {
            1 -> medianBuf[0]
            2 -> (medianBuf[0] + medianBuf[1]) / 2f
            else -> {
                val sorted = medianBuf.copyOf(MEDIAN_WINDOW).also { it.sort() }
                sorted[1]  // median of 3
            }
        }

        val note = frequencyToNote(freq) ?: return

        // [6] Write atomic state
        isShowingPitch = true
        val tsMs = System.currentTimeMillis().toDouble()

        synchronized(stateLock) {
            latestState = PitchState(
                frequency  = freq,
                noteName   = note.noteName,
                octave     = note.octave,
                fullName   = note.fullName,
                cents      = note.cents,
                confidence = confidence,
                timestamp  = tsMs,
                isValid    = true)
        }
    }

    private fun clearState() {
        isShowingPitch = false
        synchronized(stateLock) { latestState = PitchState() }
    }

    // ─────────────────────────────────────────────────────────
    // Offline YIN (caller-supplied buffers — thread-safe)
    // ─────────────────────────────────────────────────────────

    private fun yinOffline(win: FloatArray, diff: FloatArray,
                            cmnd: FloatArray, sr: Float): Pair<Float, Float>? {
        val halfN = ANALYSIS_SIZE / 2
        for (tau in 1 until halfN) {
            var d = 0f
            for (j in 0 until halfN) { val x = win[j] - win[j + tau]; d += x * x }
            diff[tau] = d
        }
        cmnd[0] = 1f
        var runSum = 0f
        for (tau in 1 until halfN) {
            runSum += diff[tau]
            cmnd[tau] = if (runSum > 0f) diff[tau] * tau / runSum else 1f
        }
        var tauEst = -1
        for (tau in 2 until halfN - 1) {
            if (cmnd[tau] < YIN_THRESHOLD) {
                var t = tau
                while (t + 1 < halfN - 1 && cmnd[t + 1] < cmnd[t]) t++
                tauEst = t; break
            }
        }
        if (tauEst <= 0) return null
        val prev  = maxOf(1, tauEst - 1)
        val next  = minOf(halfN - 2, tauEst + 1)
        val denom = 2f * (cmnd[prev] - 2f * cmnd[tauEst] + cmnd[next])
        val refined = if (abs(denom) > 1e-8f)
            tauEst + (cmnd[prev] - cmnd[next]) / denom
        else tauEst.toFloat()
        val frequency = sr / refined
        if (frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) return null
        val confidence = maxOf(0f, minOf(1f, 1f - cmnd[tauEst]))
        return Pair(frequency, confidence)
    }

    // ─────────────────────────────────────────────────────────
    // YIN  (operates on analysisWin, writes to yinDiff / yinCMND)
    // ─────────────────────────────────────────────────────────

    private fun yin(): Pair<Float, Float>? {
        val halfN = ANALYSIS_SIZE / 2

        // Step 1 — difference function
        for (tau in 1 until halfN) {
            var diff = 0f
            for (j in 0 until halfN) {
                val d = analysisWin[j] - analysisWin[j + tau]
                diff += d * d
            }
            yinDiff[tau] = diff
        }

        // Step 2 — cumulative mean normalised difference
        yinCMND[0] = 1f
        var runSum = 0f
        for (tau in 1 until halfN) {
            runSum += yinDiff[tau]
            yinCMND[tau] = if (runSum > 0f) yinDiff[tau] * tau / runSum else 1f
        }

        // Step 3 — absolute threshold + local minimum
        var tauEst = -1
        for (tau in 2 until halfN - 1) {
            if (yinCMND[tau] < YIN_THRESHOLD) {
                var t = tau
                while (t + 1 < halfN - 1 && yinCMND[t + 1] < yinCMND[t]) t++
                tauEst = t
                break
            }
        }
        if (tauEst <= 0) return null

        // Step 4 — parabolic interpolation
        val prev  = maxOf(1, tauEst - 1)
        val next  = minOf(halfN - 2, tauEst + 1)
        val denom = 2f * (yinCMND[prev] - 2f * yinCMND[tauEst] + yinCMND[next])
        val refined = if (abs(denom) > 1e-8f) {
            tauEst + (yinCMND[prev] - yinCMND[next]) / denom
        } else {
            tauEst.toFloat()
        }

        // Step 5 — frequency + confidence
        val frequency = sampleRate / refined
        if (frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) return null
        val confidence = maxOf(0f, minOf(1f, 1f - yinCMND[tauEst]))
        return Pair(frequency, confidence)
    }

    // ─────────────────────────────────────────────────────────
    // Frequency → note
    // ─────────────────────────────────────────────────────────

    private data class NoteInfo(
        val noteName: String, val octave: Int, val fullName: String, val cents: Int)

    private fun frequencyToNote(freq: Float): NoteInfo? {
        if (freq <= 20f || freq > 5000f) return null
        val a4          = dynA4
        val noteNum     = 12.0 * log2(freq.toDouble() / a4) + 69.0
        val midiNearest = round(noteNum).toInt()
        val nearFreq    = a4 * 2.0.pow((midiNearest - 69).toDouble() / 12.0)
        val cents       = round(1200.0 * log2(freq.toDouble() / nearFreq)).toInt()
        val noteIdx     = ((midiNearest % 12) + 12) % 12
        val noteName    = NOTE_NAMES[noteIdx]
        val octave      = midiNearest / 12 - 1
        return NoteInfo(noteName, octave, "$noteName$octave", cents)
    }

    // ─────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        stop()
    }
}

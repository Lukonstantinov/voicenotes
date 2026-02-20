package com.dev.musicianscratchpad

import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import com.facebook.react.bridge.Arguments
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
    private val shortChunk    = ShortArray(CAPTURE_SIZE)   // used when PCM_FLOAT unavailable
    private var using16bit    = false

    private var ringWritePos  = 0
    private var samplesInRing = 0
    private var medianIdx     = 0
    private var medianCount   = 0

    // Signal-conditioning state
    private var isShowingPitch   = false
    private var prevFrequency    = 0f
    private var octaveHoldCount  = 0

    // Atomic state (guarded by stateLock)
    private val stateLock = Any()
    @Volatile private var latestState = PitchState()

    // ─────────────────────────────────────────────────────────
    // JS API
    // ─────────────────────────────────────────────────────────

    @ReactMethod
    fun startListening() {
        if (running.get()) return
        setupAndStart()
    }

    @ReactMethod
    fun stopListening() {
        stop()
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

    // ─────────────────────────────────────────────────────────
    // Audio capture
    // ─────────────────────────────────────────────────────────

    private fun setupAndStart() {
        val audioManager = reactContext.getSystemService(android.content.Context.AUDIO_SERVICE)
                as AudioManager
        sampleRate = audioManager
            .getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)
            ?.toIntOrNull() ?: 48000

        val minBufFloat = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_FLOAT)
        val bufSizeFloat = maxOf(minBufFloat, CAPTURE_SIZE * 4)

        // Attempt 1: UNPROCESSED + float
        val ar = AudioRecord(
            MediaRecorder.AudioSource.UNPROCESSED,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_FLOAT,
            bufSizeFloat)

        if (ar.state == AudioRecord.STATE_INITIALIZED) {
            audioRecord = ar
        } else {
            ar.release()
            Log.w(TAG, "UNPROCESSED+FLOAT failed, trying VOICE_RECOGNITION+FLOAT")

            // Attempt 2: VOICE_RECOGNITION + float
            val ar2 = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_FLOAT,
                bufSizeFloat)

            if (ar2.state == AudioRecord.STATE_INITIALIZED) {
                audioRecord = ar2
            } else {
                ar2.release()
                Log.w(TAG, "VOICE_RECOGNITION+FLOAT failed, falling back to 16-bit PCM")

                // Attempt 3: VOICE_RECOGNITION + 16-bit (universally supported)
                val minBuf16 = AudioRecord.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT)
                val ar3 = AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    maxOf(minBuf16, CAPTURE_SIZE * 2))

                if (ar3.state != AudioRecord.STATE_INITIALIZED) {
                    Log.e(TAG, "All AudioRecord init attempts failed")
                    ar3.release()
                    return
                }
                audioRecord = ar3
                using16bit = true
                Log.d(TAG, "Using 16-bit PCM fallback")
            }
        }

        resetDSP()
        running.set(true)
        audioRecord!!.startRecording()

        captureThread = Thread({
            if (using16bit) {
                val shortBuf = shortChunk
                val floatBuf = captureChunk
                while (running.get()) {
                    val read = audioRecord?.read(shortBuf, 0, CAPTURE_SIZE) ?: break
                    if (read > 0) {
                        for (i in 0 until read) floatBuf[i] = shortBuf[i] / 32768f
                        processChunk(floatBuf, read)
                    }
                }
            } else {
                val buf = captureChunk
                while (running.get()) {
                    val read = audioRecord?.read(buf, 0, CAPTURE_SIZE,
                        AudioRecord.READ_BLOCKING) ?: break
                    if (read > 0) processChunk(buf, read)
                }
            }
        }, "audio-capture").apply { isDaemon = true; start() }

        Log.d(TAG, "Capture started at $sampleRate Hz, 16-bit=$using16bit")
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
        using16bit       = false
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

        // [1] RMS silence gate
        var sumSq = 0f
        for (v in analysisWin) sumSq += v * v
        val rms   = sqrt(sumSq / ANALYSIS_SIZE)
        val rmsDb = if (rms > 0f) 20f * log10(rms) else -200f
        if (rmsDb < RMS_SILENCE_DB) { clearState(); return }

        // [2] YIN
        val yinResult = yin() ?: run { clearState(); return }
        val (rawFreq, confidence) = yinResult

        // [3] Confidence hysteresis
        if (isShowingPitch) {
            if (confidence < CONFIDENCE_EXIT)  { clearState(); return }
        } else {
            if (confidence < CONFIDENCE_ENTER) return
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
        val noteNum     = 12.0 * log2(freq.toDouble() / 440.0) + 69.0
        val midiNearest = round(noteNum).toInt()
        val nearFreq    = 440.0 * 2.0.pow((midiNearest - 69).toDouble() / 12.0)
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

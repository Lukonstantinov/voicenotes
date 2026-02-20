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
private const val RMS_SILENCE_DB_DEFAULT = -40.0f
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

    // Sensitivity / silence gate threshold (dBFS). @Volatile provides visibility across threads.
    @Volatile private var rmsSilenceDb = RMS_SILENCE_DB_DEFAULT

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

    /** Sets the RMS silence gate threshold (dBFS). Lower = more sensitive. Safe to call anytime. */
    @ReactMethod
    fun setSensitivity(db: Float) {
        rmsSilenceDb = db
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

        // [1] RMS silence gate
        var sumSq = 0f
        for (v in analysisWin) sumSq += v * v
        val rms   = sqrt(sumSq / ANALYSIS_SIZE)
        val rmsDb = if (rms > 0f) 20f * log10(rms) else -200f
        if (rmsDb < rmsSilenceDb) { clearState(); return }

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
    // File roadmap analysis
    // ─────────────────────────────────────────────────────────

    @ReactMethod
    fun analyzeFileRoadmap(uri: String, segmentSec: Double, promise: Promise) {
        Thread {
            try {
                val ctx        = reactContext.applicationContext
                val androidUri = android.net.Uri.parse(uri)

                // ── Find audio track ───────────────────────────────────────────
                val extractor = MediaExtractor()
                extractor.setDataSource(ctx, androidUri, null)

                var trackIdx: Int = -1
                var inputFmt: MediaFormat? = null
                for (i in 0 until extractor.trackCount) {
                    val fmt  = extractor.getTrackFormat(i)
                    val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
                    if (mime.startsWith("audio/")) { trackIdx = i; inputFmt = fmt; break }
                }
                if (trackIdx < 0 || inputFmt == null) {
                    extractor.release()
                    promise.reject("NO_AUDIO_TRACK", "No audio track found"); return@Thread
                }
                extractor.selectTrack(trackIdx)

                val mime   = inputFmt.getString(MediaFormat.KEY_MIME)!!
                val fileSR = inputFmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                val chanIn = inputFmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

                val maxSamples    = (fileSR * 300).toLong()   // 5-min cap
                val samplesPerSeg = maxOf((fileSR * segmentSec).toInt(), ANALYSIS_SIZE)

                // ── Setup codec ────────────────────────────────────────────────
                val codec = MediaCodec.createDecoderByType(mime)
                codec.configure(inputFmt, null, null, 0)
                codec.start()

                var outChannels = chanIn
                var pcmEncoding = AudioFormat.ENCODING_PCM_16BIT

                // ── Local DSP state ────────────────────────────────────────────
                val ring = FloatArray(ANALYSIS_SIZE)
                val win  = FloatArray(ANALYSIS_SIZE)
                val yd   = FloatArray(ANALYSIS_SIZE / 2)
                val yc   = FloatArray(ANALYSIS_SIZE / 2)
                var rp   = 0; var sIR = 0

                val segVote    = FloatArray(128)
                val globalVote = FloatArray(128)
                var segSamples = 0
                var segStart   = 0.0
                val segments   = mutableListOf<Map<String, Any>>()
                var totalRead  = 0L

                // ── YIN ────────────────────────────────────────────────────────
                fun runYIN(): Pair<Int, Float>? {
                    val half = ANALYSIS_SIZE / 2
                    for (tau in 1 until half) {
                        var d = 0f
                        for (j in 0 until half) { val x = win[j]-win[j+tau]; d += x*x }
                        yd[tau] = d
                    }
                    yc[0] = 1f; var rs = 0f
                    for (tau in 1 until half) {
                        rs += yd[tau]
                        yc[tau] = if (rs > 0f) yd[tau]*tau/rs else 1f
                    }
                    var tauEst = -1
                    for (tau in 2 until half-1) {
                        if (yc[tau] < YIN_THRESHOLD) {
                            var t = tau; while (t+1 < half-1 && yc[t+1] < yc[t]) t++
                            tauEst = t; break
                        }
                    }
                    if (tauEst <= 0) return null
                    val pv = maxOf(1, tauEst-1); val nx = minOf(half-2, tauEst+1)
                    val dn = 2f*(yc[pv]-2f*yc[tauEst]+yc[nx])
                    val rf = if (abs(dn) > 1e-8f) tauEst+(yc[pv]-yc[nx])/dn else tauEst.toFloat()
                    val freq = fileSR.toFloat()/rf
                    if (freq < MIN_FREQUENCY || freq > MAX_FREQUENCY) return null
                    val conf = maxOf(0f, minOf(1f, 1f-yc[tauEst]))
                    if (conf < CONFIDENCE_ENTER) return null
                    val midi = maxOf(0, minOf(127, round(12.0*log2(freq.toDouble()/440.0)+69.0).toInt()))
                    return Pair(midi, conf)
                }

                // ── Feed samples into ring + run analysis ──────────────────────
                fun feedSamples(samples: FloatArray, off: Int, n: Int) {
                    for (i in 0 until n) {
                        ring[rp] = samples[off+i]; rp = (rp+1) and (ANALYSIS_SIZE-1)
                    }
                    sIR = minOf(sIR+n, ANALYSIS_SIZE)
                    if (sIR < ANALYSIS_SIZE) return
                    for (i in 0 until ANALYSIS_SIZE) win[i] = ring[(rp+i) and (ANALYSIS_SIZE-1)]
                    var sq = 0f; for (v in win) sq += v*v
                    val rmsDb = if (sq > 0f) 20f*log10(sqrt(sq/ANALYSIS_SIZE)) else -200f
                    if (rmsDb < rmsSilenceDb) return
                    val res = runYIN() ?: return
                    segVote[res.first] += res.second
                }

                // ── Flush segment → append to results ─────────────────────────
                fun flushSegment() {
                    val segEnd = segStart + segSamples.toDouble()/fileSR
                    val total  = segVote.sum()
                    if (total > 0f) {
                        val midi = segVote.indices.maxByOrNull { segVote[it] }!!
                        val conf = segVote[midi]/total
                        val note = frequencyToNote((440.0*2.0.pow((midi-69).toDouble()/12.0)).toFloat())
                        if (note != null) {
                            segments.add(mapOf(
                                "startSec"   to segStart,         "endSec"     to segEnd,
                                "noteName"   to note.noteName,    "octave"     to note.octave,
                                "fullName"   to note.fullName,    "confidence" to conf.toDouble(),
                                "hasNote"    to true))
                            for (i in 0 until 128) globalVote[i] += segVote[i]
                        } else {
                            segments.add(mapOf("startSec" to segStart, "endSec" to segEnd,
                                "noteName" to "", "octave" to 0, "fullName" to "",
                                "confidence" to 0.0, "hasNote" to false))
                        }
                    } else {
                        segments.add(mapOf("startSec" to segStart, "endSec" to segEnd,
                            "noteName" to "", "octave" to 0, "fullName" to "",
                            "confidence" to 0.0, "hasNote" to false))
                    }
                    segStart   += segSamples.toDouble()/fileSR
                    segSamples  = 0
                    segVote.fill(0f)
                }

                // ── Decode + process loop ──────────────────────────────────────
                val TIMEOUT_US  = 5_000L
                var inputDone   = false
                var outputDone  = false

                while (!outputDone && totalRead < maxSamples) {
                    if (!inputDone) {
                        val inIdx = codec.dequeueInputBuffer(TIMEOUT_US)
                        if (inIdx >= 0) {
                            val inBuf = codec.getInputBuffer(inIdx)!!
                            val read  = extractor.readSampleData(inBuf, 0)
                            if (read < 0) {
                                codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else {
                                codec.queueInputBuffer(inIdx, 0, read, extractor.sampleTime, 0)
                                extractor.advance()
                            }
                        }
                    }
                    val info   = MediaCodec.BufferInfo()
                    val outIdx = codec.dequeueOutputBuffer(info, TIMEOUT_US)
                    when {
                        outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            val outFmt = codec.outputFormat
                            outChannels = outFmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                            pcmEncoding = if (outFmt.containsKey(MediaFormat.KEY_PCM_ENCODING))
                                outFmt.getInteger(MediaFormat.KEY_PCM_ENCODING)
                            else AudioFormat.ENCODING_PCM_16BIT
                        }
                        outIdx >= 0 -> {
                            val outBuf = codec.getOutputBuffer(outIdx)!!
                            outBuf.position(info.offset); outBuf.limit(info.offset + info.size)

                            // Convert to mono float32
                            val mono: FloatArray = if (pcmEncoding == AudioFormat.ENCODING_PCM_FLOAT) {
                                val fb  = outBuf.asFloatBuffer()
                                val raw = FloatArray(fb.remaining()) { fb.get() }
                                if (outChannels == 1) raw
                                else FloatArray(raw.size/outChannels) { i ->
                                    var s = 0f; for (c in 0 until outChannels) s += raw[i*outChannels+c]
                                    s/outChannels }
                            } else {
                                val sb  = outBuf.asShortBuffer()
                                val raw = ShortArray(sb.remaining()) { sb.get() }
                                if (outChannels == 1) FloatArray(raw.size) { raw[it]/32768f }
                                else FloatArray(raw.size/outChannels) { i ->
                                    var s = 0f; for (c in 0 until outChannels) s += raw[i*outChannels+c]/32768f
                                    s/outChannels }
                            }

                            var i = 0
                            while (i < mono.size && totalRead < maxSamples) {
                                val take = minOf(mono.size-i, samplesPerSeg-segSamples)
                                feedSamples(mono, i, take)
                                segSamples += take; totalRead += take; i += take
                                if (segSamples >= samplesPerSeg) flushSegment()
                            }
                            codec.releaseOutputBuffer(outIdx, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                        }
                    }
                }
                if (segSamples > 0) flushSegment()

                codec.stop(); codec.release(); extractor.release()

                // ── Dominant note ──────────────────────────────────────────────
                val gTotal = globalVote.sum()
                var dominantNote = ""
                if (gTotal > 0f) {
                    val best = globalVote.indices.maxByOrNull { globalVote[it] }!!
                    val freq = (440.0*2.0.pow((best-69).toDouble()/12.0)).toFloat()
                    frequencyToNote(freq)?.let { dominantNote = it.fullName }
                }

                // ── Build result ───────────────────────────────────────────────
                val segsArr = Arguments.createArray()
                for (seg in segments) {
                    Arguments.createMap().also { m ->
                        m.putDouble ("startSec",   seg["startSec"]   as Double)
                        m.putDouble ("endSec",     seg["endSec"]     as Double)
                        m.putString ("noteName",   seg["noteName"]   as String)
                        m.putInt    ("octave",     seg["octave"]     as Int)
                        m.putString ("fullName",   seg["fullName"]   as String)
                        m.putDouble ("confidence", seg["confidence"] as Double)
                        m.putBoolean("hasNote",    seg["hasNote"]    as Boolean)
                        segsArr.pushMap(m)
                    }
                }
                val result = Arguments.createMap().apply {
                    putArray ("segments",      segsArr)
                    putString("dominantNote",  dominantNote)
                    putDouble("totalDuration", totalRead.toDouble()/fileSR)
                }
                promise.resolve(result)

            } catch (e: Exception) {
                promise.reject("ANALYSIS_ERROR", e.message ?: "Unknown error", e)
            }
        }.apply { isDaemon = true; start() }
    }

    // ─────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        stop()
    }
}

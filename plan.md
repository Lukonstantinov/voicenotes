# Plan: Audio File Input — Root Note Extraction

## What this adds
A second mode alongside the live mic listener: pick an audio file, run the
same native YIN pipeline over the decoded PCM, and report the dominant
(root) note detected across the file.

---

## Architecture — nothing changes about the core rules

All PCM decoding and YIN analysis stay 100 % native.
The only thing that crosses the bridge is the final `FileAnalysisResult` struct
(same pattern as `PitchResult`).
No `expo-av`, no JS DSP, no raw PCM on the bridge.

Data flow:
```
User picks file (expo-document-picker → URI)
  → native analyzeFile(uri)
      → iOS: AVAudioFile decodes to PCM floats
      → Android: MediaExtractor + MediaCodec decodes to PCM floats
      → same YIN + confidence hysteresis (reuses pre-allocated DSP arrays)
      → confidence-weighted vote across all frames → root MIDI note
      → resolve Promise<FileAnalysisResult>
  → UI renders result
```

---

## New result type

```typescript
// src/bridge/types.ts  (new addition)
export interface FileAnalysisResult {
  rootNote:       string;  // "A4"
  rootNoteName:   string;  // "A"
  rootOctave:     number;  // 4
  rootFrequency:  number;  // Hz of the MIDI centre pitch
  confidence:     number;  // 0–1 (fraction of frames that agree)
  duration:       number;  // seconds of audio processed
  detectedFrames: number;  // valid pitch frames counted
}
```

---

## Files to create

| File | Purpose |
|---|---|
| `src/ui/components/FileAnalysisPanel.tsx` | File picker button + result card UI |

---

## Files to modify

| File | Change |
|---|---|
| `package.json` | Add `expo-document-picker` (~12.x for SDK 54) |
| `src/bridge/types.ts` | Add `FileAnalysisResult` interface |
| `src/bridge/NativeAudioPitch.ts` | Add `analyzeFile(uri: string): Promise<FileAnalysisResult>` to Spec |
| `src/native/ios/AudioCaptureModule.swift` | Add `analyzeFile` using `AVAudioFile` |
| `src/native/android/AudioCaptureModule.kt` | Add `analyzeFile` using `MediaExtractor + MediaCodec` |
| `src/ui/App.tsx` | Add mode toggle (Live / File) and render `FileAnalysisPanel` |

---

## Root-note algorithm (both platforms, identical logic)

```
Pre-allocate: float[128] voteWeight  (indexed by MIDI note 0–127)

For each 1024-sample PCM chunk from the file:
  1. Fill 2048-sample ring buffer (same as live mode)
  2. When ring buffer full:
       a. RMS gate  (< -40 dBFS → skip)
       b. YIN       → (frequency, confidence)
       c. If confidence ≥ CONFIDENCE_ENTER (0.85):
            midiNote = round( 12 * log2(freq / 440) + 69 )
            clamp midiNote to [0, 127]
            voteWeight[midiNote] += confidence   // weighted vote

After full file processed:
  rootMidi     = argmax(voteWeight)
  totalVotes   = sum(voteWeight)
  confidence   = voteWeight[rootMidi] / totalVotes
  rootFreq     = 440 × 2^((rootMidi - 69) / 12)
  noteName, octave from rootMidi (same frequencyToNote helper)
```

Cap processing at 60 seconds to avoid memory pressure on long files.
Reads in 1024-sample chunks — same pre-allocated arrays, no new heap alloc in the loop.

---

## iOS specifics

```swift
// AVAudioFile + AVAudioPCMBuffer (pre-allocated, reused per chunk)
let file = try AVAudioFile(forReading: url)
let format = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                           sampleRate: file.fileFormat.sampleRate,
                           channels: 1, interleaved: false)!
let readBuf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024)!
while file.framePosition < file.length {
  try file.read(into: readBuf, frameCount: 1024)
  // processChunkForFile(readBuf.floatChannelData![0], Int(readBuf.frameLength))
}
```

`analyzeFile` runs on a background queue (`DispatchQueue.global(qos: .userInitiated)`).
Resolves the RCTPromise on the main queue when done.

Supported formats: everything `AVAudioFile` can read (WAV, AIFF, CAF, M4A, MP3 via CoreAudio).

---

## Android specifics

```kotlin
// MediaExtractor selects the first audio track
// MediaCodec decodes to AudioFormat.ENCODING_PCM_FLOAT
// Chunks fed into the same processChunkForFile() loop
```

Runs on a new background thread (not the capture thread).
Resolves via `promise.resolve(map)` when done.

Supported formats: whatever MediaCodec on the device can decode (typically MP3, AAC/M4A, WAV, OGG, FLAC).

---

## UI changes in App.tsx

Add a simple two-button mode bar at the top:
`[ Microphone ]  [ File ]`

- **Microphone mode** (default): existing live pitch display
- **File mode**: shows `FileAnalysisPanel` with:
  - "Pick audio file" button → calls `expo-document-picker`
  - While analysing: spinner + "Analysing…"
  - Result card: large root note, frequency, confidence bar, seconds processed

---

## Dependency

`expo-document-picker ~12.0.7` — Expo SDK 54 compatible, not in the forbidden list.
Install via `npm install expo-document-picker`.
No native setup needed for a development build (Expo's autolinking handles it).

---

## Verification after implementation

```bash
npx tsc --noEmit          # Zero errors
npx jest --verbose        # All 9 tests still pass
# Android CI: ./gradlew assembleDebug succeeds
# Manual: pick a 440 Hz sine WAV → displays A4
```

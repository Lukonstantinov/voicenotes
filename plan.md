# Plan: Audio File Input — Root Note Extraction + Note Roadmap

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

---

# Plan: Note Roadmap (Timeline of Root Notes)

## What this adds
Instead of reporting only the single dominant root note for an uploaded file,
the Note Roadmap breaks the file into time segments and shows **how the key
centre changes over time** — a scrollable horizontal timeline where each
segment displays its detected root note, coloured by confidence.

This is useful for:
- Identifying chord progressions / key changes in a song
- Locating the "root" sections vs. transitional passages
- Seeing how your voice or instrument moves through a piece

---

## User flow

```
File mode selected
  → "Pick audio file" → user picks MP3/WAV/M4A
  → "Analysing…" spinner
  → Note Roadmap renders:
      [C4]  [G3]  [A3]  [E3]  [C4]  [C4]  …
       0s    4s    8s   12s   16s   20s
      (scroll right for full file)
  → Dominant root note summary shown above timeline
```

---

## Architecture (honours existing rules)

- All PCM decoding + YIN analysis: **fully native** (same pipeline as file root extraction)
- Bridge payload: array of `RoadmapSegment` structs — **no raw PCM crosses bridge**
- Result resolves via `Promise<RoadmapResult>` (same pattern as `analyzeFile`)

---

## New types

```typescript
// src/bridge/types.ts additions
export interface RoadmapSegment {
  startSec:   number;   // segment start time in seconds
  endSec:     number;   // segment end time in seconds
  noteName:   string;   // "C", "G#", etc.
  octave:     number;
  fullName:   string;   // "C4"
  confidence: number;   // 0–1 fraction of frames agreeing on this note
}

export interface RoadmapResult {
  segments:      RoadmapSegment[];  // one per time window
  dominantNote:  string;            // "C4" — highest cumulative confidence
  totalDuration: number;            // seconds
}
```

---

## Segmentation algorithm (native, both platforms)

```
segmentDurationSec = 4.0   // analyse in 4-second windows
overlapSec         = 0.0   // no overlap needed for roadmap view

For each 4-second chunk of the decoded PCM:
  1. Run same YIN loop used in analyzeFile (1024-sample sub-chunks)
  2. Accumulate per-MIDI confidence weights (float[128] voteWeight)
  3. After chunk done:
       segmentMidi    = argmax(voteWeight)
       totalVotes     = sum(voteWeight)
       confidence     = voteWeight[segmentMidi] / totalVotes
       Append RoadmapSegment to result array
  4. Reset voteWeight for next segment

After all segments:
  dominantNote = note with highest summed confidence across all segments
  Return RoadmapResult
```

Cap total processing at 5 minutes of audio. Segment size (4 s) is configurable
in native constants; future UI could expose it.

---

## New bridge method

```typescript
// NativeAudioPitch.ts Spec addition
analyzeFileRoadmap(uri: string): Promise<RoadmapResult>;
```

---

## UI: NoteRoadmap component

```
src/ui/components/NoteRoadmap.tsx
```

- Horizontal `ScrollView` with one cell per `RoadmapSegment`
- Each cell: large note name, time stamp below, opacity driven by `confidence`
- Color coding: green ≥ 0.7 confidence, orange 0.5–0.7, red < 0.5
- Tapping a cell scrubs to that timestamp (future: integrate with audio player)
- Above the scroll: dominant root note + total duration summary

---

## Files to create / modify

| File | Action |
|---|---|
| `src/ui/components/NoteRoadmap.tsx` | NEW — roadmap scroll view |
| `src/bridge/types.ts` | Add `RoadmapSegment`, `RoadmapResult` |
| `src/bridge/NativeAudioPitch.ts` | Add `analyzeFileRoadmap()` to Spec |
| `src/native/ios/AudioCaptureModule.swift` | Add `analyzeFileRoadmap` — segmented YIN over AVAudioFile |
| `src/native/android/AudioCaptureModule.kt` | Add `analyzeFileRoadmap` — segmented YIN over MediaExtractor |
| `src/ui/App.tsx` | Render roadmap below file result card |

---

## Open questions (to resolve before implementation)

1. **Segment duration**: 1 s default; user-adjustable in settings (1 s / 2 s / 4 s / 8 s). ✅ **RESOLVED**
2. **Silence segments**: Show previous note (hold) OR nothing — configurable in settings. ✅ **RESOLVED**
3. **Octave locking**: Default = pitch class only ("C"). Settings toggle for full note ("C4"). ✅ **RESOLVED**
4. **Audio playback scrubbing**: Implement. Tap segment → seek to that timestamp. ✅ **RESOLVED**
5. **Export**: Plain text always; PDF optionally via expo-print + expo-sharing. ✅ **RESOLVED**

## Decisions summary

| Setting | Default | Options |
|---|---|---|
| Segment duration | 1 s | 1 s / 2 s / 4 s / 8 s |
| Silence segments | Gap (—) | Gap / Hold (repeat prev note) |
| Note display | Pitch class ("C") | Note / Full ("C4") |
| Playback | On | Tap to seek |
| Export | Text + PDF | Share sheet |



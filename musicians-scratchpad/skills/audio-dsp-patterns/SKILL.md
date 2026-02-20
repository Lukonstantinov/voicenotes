# SKILL 2: AUDIO DSP PATTERNS

## Purpose
Exact algorithms, constants, and platform configs for pitch detection. Follow precisely — do not improvise DSP logic.

## Constants — Use These Exact Values

```
YIN_THRESHOLD        = 0.12
CONFIDENCE_ENTER     = 0.85
CONFIDENCE_EXIT      = 0.75
RMS_SILENCE_DB       = -40.0
MIN_FREQUENCY        = 75.0 Hz
MAX_FREQUENCY        = 2000.0 Hz
MEDIAN_WINDOW        = 3 frames
OCTAVE_SUPPRESS_MAX  = 3 frames
A4_REFERENCE         = 440.0 Hz
```

## YIN Algorithm (implement in native Swift/Kotlin/C++)

Input: float buffer of 2048 samples, sample rate fs

```
Step 1 — Difference function:
  For each lag τ from 1 to N/2:
    d[τ] = Σ (x[j] - x[j + τ])²  for j = 0 to N/2 - 1

Step 2 — Cumulative mean normalized difference:
  d'[0] = 1.0
  For τ from 1 to N/2:
    d'[τ] = d[τ] / ((1/τ) * Σ d[j] for j = 1 to τ)

Step 3 — Absolute threshold:
  Find smallest τ where d'[τ] < 0.12
  No τ found → return no-pitch

Step 4 — Parabolic interpolation:
  refined_τ = τ + (d'[τ-1] - d'[τ+1]) / (2 * (d'[τ-1] - 2*d'[τ] + d'[τ+1]))

Step 5 — Result:
  frequency = fs / refined_τ
  confidence = 1.0 - d'[τ]
```

Rules: pre-allocate d[] and d'[] at init. Use float32 not double. Clamp to [75, 2000] Hz.

## Buffer Strategy

Capture buffer: 1024 samples. Analysis window: 2048 (overlapping).

```
Audio delivers:  [---A---][---B---][---C---]  (1024 each)
Ring buffer:     [------A+B------]  → YIN → result
                          [------B+C------]  → YIN → result
```

1024 capture + 2048 analysis = ~23ms update rate with ~46ms frequency resolution.

### Sample Rate — ALWAYS Query

```swift
// iOS:
let sampleRate = AVAudioSession.sharedInstance().sampleRate

// Android:
val sr = audioManager.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toInt() ?: 48000
```

NEVER hardcode 44100.

## Signal Conditioning Pipeline — This Exact Order

```
Raw PCM (1024 new samples)
  │
  ├─ [1] RMS Silence Gate
  │     rms_db = 20 * log10(sqrt(mean(samples²)) / 32768)
  │     If < -40dB → return null
  │
  ├─ [2] YIN (on 2048 window) → {frequency, confidence} or null
  │
  ├─ [3] Confidence Hysteresis
  │     Showing pitch? If confidence < 0.75 → stop, return null
  │     Not showing? If confidence < 0.85 → return null
  │
  ├─ [4] Octave Jump Suppression
  │     ratio = new / previous
  │     If ~2.0 or ~0.5: hold previous for up to 3 frames
  │
  ├─ [5] 3-Frame Median Filter → smoothed frequency
  │
  └─ [6] Write to atomic shared state
```

## Frequency-to-Note Conversion

```typescript
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const A4 = 440.0;

export function frequencyToNote(frequency: number) {
  if (frequency <= 0 || frequency < 20 || frequency > 5000) return null;

  const noteNumber = 12 * Math.log2(frequency / A4) + 69;
  const nearestMidi = Math.round(noteNumber);
  const nearestFreq = A4 * Math.pow(2, (nearestMidi - 69) / 12);
  const cents = Math.round(1200 * Math.log2(frequency / nearestFreq));
  const noteName = NOTE_NAMES[((nearestMidi % 12) + 12) % 12];
  const octave = Math.floor(nearestMidi / 12) - 1;

  return { noteName, octave, cents, fullName: `${noteName}${octave}` };
}
```

### Unit Test Cases (implement ALL of these)

| Hz | Note | Octave | Cents | fullName |
|----|------|--------|-------|----------|
| 440.000 | A | 4 | 0 | A4 |
| 220.000 | A | 3 | 0 | A3 |
| 261.626 | C | 4 | 0 | C4 |
| 82.407 | E | 2 | 0 | E2 |
| 493.883 | B | 4 | 0 | B4 |
| 445.000 | A | 4 | ~20 | A4 |
| 130.813 | C | 3 | 0 | C3 |
| 0 | null | — | — | — |
| -100 | null | — | — | — |

## iOS Audio Session — Exactly This

```swift
let session = AVAudioSession.sharedInstance()
try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker])
try session.setActive(true)
```

Measurement mode disables system AGC and noise reduction. CRITICAL for pitch accuracy.

Handle interruptions: stop on began, resume on ended+shouldResume.

## Android Audio — Exactly This

```kotlin
val nativeSampleRate = audioManager
    .getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toInt() ?: 48000

// Oboe: direction=Input, performanceMode=LowLatency, sharingMode=Exclusive (fallback Shared),
//        sampleRate=nativeSampleRate, channelCount=1, format=Float, framesPerCallback=1024

// AudioRecord fallback: source=UNPROCESSED (or VOICE_RECOGNITION),
//        sampleRate=nativeSampleRate, mono, PCM_FLOAT
```

If Oboe won't build within 30 minutes, switch to AudioRecord. Document the choice.

# Musician's Scratchpad — Complete Claude Code Instructions

## YOU ARE THE SOLE DEVELOPER

The human will not write any code. You (Claude Code) are responsible for ALL implementation, debugging, testing, git operations, and deployment configuration. The human will provide feedback, test on physical devices, and make product decisions. Everything else is your job.

## FIRST TASK: Project Scaffolding

Before doing anything else, create the project directory structure and extract all skill files from this document. Run these steps:

```
1. Create a new directory: musicians-scratchpad
2. Create this file structure inside it:
   - CLAUDE.md (copy the BUILD SEQUENCE and ARCHITECTURE RULES sections)
   - README.md (generate from project overview)
   - docs/musicians_scratchpad_mvp_v2.txt (generate from the FULL SPEC section)
   - skills/app-system-engineering/SKILL.md (from SKILL 1 section below)
   - skills/audio-dsp-patterns/SKILL.md (from SKILL 2 section below)
   - skills/rn-native-debugging/SKILL.md (from SKILL 3 section below)
   - skills/project-conventions/SKILL.md (from SKILL 4 section below)
   - skills/build-validation/SKILL.md (from SKILL 5 section below)
3. Initialize git repo
4. Create initial commit
5. Then begin Phase 0 of the BUILD SEQUENCE
```

---

## PROJECT OVERVIEW

Real-time monophonic pitch detection mobile app. User hums or plays a single note into their phone mic → app instantly shows the note name (e.g. G#3), frequency (207.6 Hz), and how sharp or flat they are (±cents).

**Tech:** React Native (Expo dev build), TypeScript, custom native modules (Swift for iOS, Kotlin for Android), TurboModule/JSI bridge.

**Reference tuning:** A4 = 440Hz hardcoded for MVP.
**Minimum pitch:** ~80Hz (E2) — covers bass guitar and low male voice.
**Target latency:** < 80ms from sound to screen.

---

## BUILD SEQUENCE

Follow this order. Complete each phase before moving to the next. Run the verification checklist (see SKILL 5) at the end of every phase. Do NOT proceed if verification fails.

### Phase 0: Project Setup
1. Initialize Expo project with TypeScript template
2. Install dependencies (NO expo-av, NO pitchfinder, NO redux)
3. Enable New Architecture in build config (TurboModules + Fabric)
4. Run `npx expo prebuild --clean`
5. Configure iOS Info.plist: add NSMicrophoneUsageDescription
6. Configure Android AndroidManifest.xml: add RECORD_AUDIO permission
7. Initialize git repo, create initial commit
8. **Verify:** Project builds on iOS simulator showing default Expo screen

### Phase 1: Utility Layer (Pure TypeScript)
1. Create `src/utils/pitchUtils.ts` — frequencyToNote function
2. Create `src/utils/permissions.ts` — mic permission request + Settings deep link
3. Write unit tests for pitchUtils (see test vectors in SKILL 2)
4. **Verify:** All unit tests pass

### Phase 2: Native Audio Module — iOS
1. Create Swift native module: AudioCaptureModule
2. Configure AVAudioSession (category: playAndRecord, mode: measurement)
3. Implement AVAudioEngine with installTapOnBus (1024 buffer, query native sample rate)
4. Implement YIN pitch detection (native Swift or C++)
5. Implement signal conditioning pipeline (RMS gate → YIN → hysteresis → octave suppression → median filter)
6. Store result in atomic shared state struct
7. Expose TurboModule: startListening(), stopListening(), getLatestPitch()
8. **Verify:** iOS builds. Module accessible from JS. Hardcoded test returns data through bridge.

### Phase 3: Native Audio Module — Android
1. Create Kotlin native module: AudioCaptureModule
2. Query native sample rate from AudioManager
3. Implement Oboe audio capture (LowLatency, Exclusive with Shared fallback). If Oboe fights the Expo build system, switch to AudioRecord — don't spend more than 30 minutes on Oboe config.
4. Implement YIN + signal conditioning (same logic as iOS)
5. Store result in atomic shared state, expose same TurboModule interface
6. **Verify:** Android builds. Module accessible from JS.

### Phase 4: React UI
1. Create `src/hooks/usePitchPolling.ts` — requestAnimationFrame polling loop (30fps)
2. Create `src/ui/components/PitchDisplay.tsx` — large note name + octave
3. Create `src/ui/components/CentIndicator.tsx` — cent deviation display
4. Create `src/ui/components/ListenButton.tsx` — start/stop toggle
5. Create `src/ui/components/StatusBar.tsx` — app state display
6. Create `src/ui/App.tsx` — compose everything, handle permissions flow
7. **Verify:** App shows UI. Button triggers permission request.

### Phase 5: Integration & Polish
1. Test full pipeline: mic → native DSP → bridge → UI
2. Implement lifecycle management (stop on background, resume on foreground)
3. Implement error states (permission denied, no audio, interruptions)
4. Add 3-second silence hint ("Try humming or playing a note")
5. Verify null pitch clears display (no stale data)
6. **Verify:** Ask human to test on physical device.

### Phase 6: Final
1. Run all unit tests
2. Clean up console.logs and debug code
3. Update README with build instructions and known issues
4. Final git commit and push
5. **Verify:** Clean build on both platforms, all tests pass, git clean.

---

## ARCHITECTURE RULES (Non-Negotiable)

### The Five Laws
1. **Audio pipeline is FULLY NATIVE.** Capture + DSP on native threads. Only the pitch result struct crosses to JS via synchronous JSI getter.
2. **NO expo-av for audio.** Custom native modules using AVAudioEngine (iOS) and Oboe/AudioRecord (Android).
3. **Poll, don't push.** UI reads pitch via requestAnimationFrame at 30fps. No bridge event emitters.
4. **No stale UI.** Null pitch = clear display immediately. Never show ghost notes.
5. **Expo development build only.** Never assume Expo Go compatibility.

### Module Boundaries
```
src/
├── native/          # Layer 1: Native audio. NEVER imports React.
│   ├── ios/         # Swift
│   ├── android/     # Kotlin
│   └── cpp/         # Optional shared C++ DSP core
├── bridge/          # Layer 2: TurboModule spec. Thin. No logic.
├── ui/              # Layer 3: React components + hooks
│   ├── components/
│   └── hooks/
└── utils/           # Pure functions. Zero side effects.
```
No file imports from more than one layer. native/ never imports from ui/. bridge/ never imports from ui/. ui/ accesses native only through bridge/.

### Data Flow
```
Microphone → [Native Audio Thread: AVAudioEngine/Oboe] 
    → [Native DSP Thread: YIN + signal conditioning]
    → [Atomic Shared State: {freq, note, cents, confidence, timestamp}]
    → [JS Thread: polls via requestAnimationFrame at 30fps]
    → [React UI: PitchDisplay, CentIndicator, StatusBar]
```

---

## DECISION AUTHORITY

### Decisions YOU make (don't ask the human):
- Implementation details within the architecture rules
- Which npm packages to install (within the allowed/forbidden lists)
- File naming and organization (follow conventions)
- Bug fixes and error handling
- Git commit messages and branch management
- Build configuration and native file edits
- Test implementation

### Decisions the HUMAN makes (always ask):
- Product features beyond the MVP spec
- UI design preferences (colors, fonts, layout aesthetics)
- Which physical devices to test on
- Whether to proceed when a phase has known issues
- App name, bundle ID, display name
- GitHub repo visibility (public/private)
- Any deviation from this spec

---

## WHEN SOMETHING BREAKS

1. Read SKILL 3 (Debugging) below
2. Follow the diagnostic priority order (permissions → linking → threads → DSP → UI)
3. Use the isolated reproduction strategy if cause isn't obvious
4. Fix it, verify the fix, continue
5. If you cannot fix after 3 attempts: explain to the human what you tried, what you think the root cause is, and what options exist

---

## DO NOT
- Use expo-av, react-native-audio-recorder, or any JS-based audio capture
- Send raw PCM data across the bridge
- Use NativeEventEmitter for per-frame pitch updates
- Import pitchfinder or any JS-thread DSP library
- Hardcode 44100Hz sample rate (query device native rate)
- Display stale pitch data when confidence drops
- Ask the human to run terminal commands — do it yourself
- Ask the human to edit files — do it yourself
- Ask the human architectural questions answered in this document
- Commit directly to main (use feature branches)

---
---

# SKILL 1: APP SYSTEM ENGINEERING

---

## Purpose
You are the sole developer. This skill defines exactly how to structure the app, what patterns to use, and what decisions to make without asking the human.

## The Three Layers

### Layer 1: Native Audio Core (Swift / Kotlin / C++)
- Owns: microphone capture, audio session, DSP, signal conditioning
- Threads: dedicated native threads (audio thread + DSP thread)
- Rules:
  - ZERO heap allocation during active streaming — pre-allocate at init
  - Audio thread: no locks, no syscalls, no logging, no ObjC dispatch
  - DSP thread: try-lock only for shared state struct
  - Never call into JS — write to shared atomic state only

### Layer 2: TurboModule Bridge (JSI)
- Exposes exactly three functions:
  - `startListening(): void`
  - `stopListening(): void`
  - `getLatestPitch(): PitchResult | null`
- Rules:
  - `getLatestPitch()` is SYNCHRONOUS via JSI — no async, no bridge, no promises
  - Returns null when confidence below threshold OR data stale (> 200ms)
  - Thin read-only window into native state. No logic beyond reading.

### Layer 3: React UI (TypeScript / React)
- Owns: permissions, user interaction, display
- Rules:
  - Poll via requestAnimationFrame at 30fps max
  - Only update React state when timestamp changes
  - Clear display immediately when result is null
  - Never store audio data in JS memory

## PitchResult Interface

```typescript
interface PitchResult {
  frequency: number;      // Hz (e.g., 440.0)
  noteName: string;       // e.g., "A"
  octave: number;         // e.g., 4
  fullName: string;       // e.g., "A4"
  cents: number;          // -50 to +50
  confidence: number;     // 0.0 to 1.0 (higher = more confident)
  timestamp: number;      // native monotonic clock, ms
}
```

## The Polling Hook — Implement Exactly This Pattern

```typescript
// src/ui/hooks/usePitchPolling.ts
import { useState, useEffect, useRef } from 'react';
import AudioPitchModule from '../../bridge/NativeAudioPitchModule';
import type { PitchResult } from '../../bridge/types';

const FRAME_INTERVAL_MS = 33; // ~30fps

export function usePitchPolling(isListening: boolean): PitchResult | null {
  const [pitch, setPitch] = useState<PitchResult | null>(null);
  const lastTimestamp = useRef(0);

  useEffect(() => {
    if (!isListening) {
      setPitch(null);
      lastTimestamp.current = 0;
      return;
    }

    let rafId: number;
    let lastFrameTime = 0;

    const poll = (currentTime: number) => {
      if (currentTime - lastFrameTime >= FRAME_INTERVAL_MS) {
        lastFrameTime = currentTime;
        const result = AudioPitchModule.getLatestPitch();
        if (result && result.timestamp !== lastTimestamp.current) {
          lastTimestamp.current = result.timestamp;
          setPitch(result);
        } else if (!result) {
          setPitch(null);
          lastTimestamp.current = 0;
        }
      }
      rafId = requestAnimationFrame(poll);
    };

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [isListening]);

  return pitch;
}
```

## Lifecycle State Machine

| Event | Action |
|-------|--------|
| User taps Start | Request mic permission → start capture → start polling |
| User taps Stop | Stop polling → stop capture → clear display |
| App backgrounds | Stop everything. Store wasListening=true. |
| App foregrounds | If wasListening, resume. |
| Permission denied | Show error + Settings deep link |
| Silence > 3 seconds | Show hint: "Try humming or playing a note" |
| Audio interruption (iOS) | Native handles AVAudioSession interruption |

## Anti-Patterns — Stop If You Catch Yourself Doing These

| Doing this... | Do this instead |
|---|---|
| Installing expo-av | Write custom native module |
| NativeEventEmitter for pitch | Polling hook above |
| pitchfinder in JS | Native YIN |
| Redux/Zustand for pitch state | Polling hook IS the state management |
| setInterval for polling | requestAnimationFrame |
| Storing PCM in JS arrays | Keep all audio native-side |
| mutex.lock() on audio thread | try-lock or lock-free atomics |
| async getLatestPitch | Must be synchronous JSI |

---
---

# SKILL 2: AUDIO DSP PATTERNS

---

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

---
---

# SKILL 3: DEBUGGING

---

## Purpose
When something breaks, YOU diagnose and fix it. Do not ask the human to check logs. Follow these diagnostic trees.

## Priority Checklist — Check in This Order

```
1. BUILD FAILURE?         → See "Build" below
2. CRASH ON LAUNCH?       → See "Crash" below
3. NO AUDIO?              → See "Audio" below
4. WRONG NOTES?           → See "Pitch" below
5. UI FLICKER/LAG?        → See "UI" below
6. INTERMITTENT?          → See "Threads" below
```

## Build Failures

### "TurboModule not found"
```bash
# 1. New Arch enabled?
grep "RCT_NEW_ARCH_ENABLED" ios/Podfile
grep "newArchEnabled=true" android/gradle.properties

# 2. Spec file named correctly? Must be: Native<ModuleName>.ts

# 3. Nuclear rebuild:
rm -rf node_modules && npm install
cd ios && rm -rf Pods && pod install
cd android && ./gradlew clean
npx expo prebuild --clean
```

### Linker errors (iOS)
Check bridging header, framework search paths. AVAudioEngine needs no extra frameworks.

### Oboe / NDK errors (Android)
If fighting build system > 30 min → switch to AudioRecord.

## Crash on Launch
```bash
# 1. Comment out native module registration
# 2. Does app launch? If yes → native module init is broken
# 3. Add try-catch to native constructor, add logging
# iOS: Xcode console. Android: adb logcat *:E
```

## No Audio
```
1. Permission granted? Check Info.plist / AndroidManifest
2. Audio callback firing? Add counter, log every 100th call
3. iOS session active? setActive(true) called AFTER setCategory
4. Android stream state? Log after start, check for Error
5. Ring buffer receiving data? Log write pointer
```

## Wrong Pitch
```
Octave error (A3 instead of A4):
  → Lower YIN_THRESHOLD to 0.08
  → Check parabolic interpolation
  → Verify sample rate is correct (not 44100 when device is 48000)
  → Verify analysis window is 2048, not 1024

Works for voice but not guitar:
  → Lower RMS threshold to -50dBFS
  → Increase YIN_THRESHOLD to 0.15

Rapid jumping:
  → Check pipeline order: RMS → YIN → confidence → octave → median
  → Check hysteresis is implemented (not just simple threshold)
```

## UI Issues
```
Stale display:
  → Check null branch in polling hook: setPitch(null) must be called
  → Check timestamp freshness (> 200ms = stale = null)

Laggy feel:
  → 30fps cap working? Add frame skip logic
  → Wrap components in React.memo()
  → Pitch state consumed only by display components, not root
```

## Thread Safety (intermittent)
```
→ Shared state updated atomically? (entire struct, not field-by-field)
→ Ring buffer is SPSC? (one writer, one reader)
→ No ObjC dispatch on audio thread?
→ Enable Thread Sanitizer in Xcode for data race detection
```

## Isolation Test (Last Resort — 20 min)
```
Test 1: Native capture → save 1 sec audio → play back. Audio OK?
Test 2: Feed math 440Hz sine to YIN → must return 440±1Hz
Test 3: Hardcode getLatestPitch to return {440, "A", 4...} → UI shows A4?
Test 4: Mock alternating values → UI updates smoothly?
```

---
---

# SKILL 4: PROJECT CONVENTIONS

---

## Purpose
Follow these automatically. Never ask the human about commit messages, branch names, or style.

## Branches
```
main                           # Protected. Merge at phase completion only.
develop                        # Integration. Feature branches merge here.
feature/<scope>/<short-desc>
fix/<scope>/<short-desc>
chore/<scope>/<short-desc>
```

Scopes: `native-ios`, `native-android`, `native-cpp`, `bridge`, `ui`, `utils`, `config`, `all`

## Commits
```
<type>(<scope>): <imperative lowercase description, no period, max 72 chars>
```
Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`

Examples:
```
feat(native-cpp): implement YIN pitch detection with parabolic interpolation
feat(bridge): expose getLatestPitch via synchronous TurboModule
fix(native-android): query device native sample rate at init
chore(config): enable New Architecture and run expo prebuild
```

## Code Style
- TypeScript: strict mode, no `any`, functional components, named exports
- Swift: guard for early returns, os_log not print
- Kotlin: no coroutines in audio callback, Log.d("AudioPitch", ...)
- C++: C++17, no exceptions in audio path, float not double, pre-allocate

## Forbidden Dependencies
expo-av, pitchfinder, redux, mobx, zustand, react-native-audio-recorder-player

## Allowed Dependencies
expo (core), jest, typescript, react-native-reanimated (only if human requests animated UI)

---
---

# SKILL 5: BUILD VALIDATION

---

## Purpose
Run these checks at the end of EVERY phase. Do NOT proceed if any check fails.

## Phase 0 Checks
```bash
ls src/native/ios src/native/android src/bridge src/ui/components src/ui/hooks src/utils
npm ls --depth=0                                        # No errors
grep "RCT_NEW_ARCH_ENABLED" ios/Podfile                # Must exist
grep "newArchEnabled=true" android/gradle.properties    # Must be true
grep "NSMicrophoneUsageDescription" ios/*/Info.plist    # Must exist
grep "RECORD_AUDIO" android/app/src/main/AndroidManifest.xml  # Must exist
# Build iOS and Android — both must succeed
```

## Phase 1 Checks
```bash
ls src/utils/pitchUtils.ts src/utils/permissions.ts
npx jest --testPathPattern="pitchUtils" --verbose       # ALL pass
grep -r "import.*react" src/utils/                      # Must find NOTHING
```

## Phase 2 Checks
```bash
ls src/native/ios/AudioCaptureModule.swift
ls src/bridge/NativeAudioPitchModule.ts
# iOS build must succeed
# Bridge test: console.log(AudioPitchModule.getLatestPitch()) → shows null or test value
```

## Phase 3 Checks
```bash
ls src/native/android/AudioCaptureModule.kt
# Android build must succeed
# iOS build still succeeds (not broken by Android changes)
```

## Phase 4 Checks
```bash
ls src/ui/App.tsx src/ui/components/PitchDisplay.tsx src/ui/hooks/usePitchPolling.ts
npx tsc --noEmit                                        # Zero errors
grep -r "import.*native" src/ui/                        # Must find NOTHING
npx jest --verbose                                      # Zero failures
```

## Phase 5 Checks
```
Ask human to test on physical device:
1. Does it launch?
2. Does mic permission appear on tap?
3. Does display update when humming?
4. Does display clear on silence?
5. Does it survive background/foreground?
```

## Phase 6 Checks
```bash
npx jest --verbose                                      # All pass
npx tsc --noEmit                                        # Clean
grep -rn "console.log" src/ | wc -l                     # Minimal
# Both platforms build
git status                                              # Clean
```

## Rule: Never proceed to next phase if current phase fails verification.

---
---

# FULL MVP SPECIFICATION (Reference)

---

This app detects monophonic pitch in real time. Architecture: fully native audio pipeline (AVAudioEngine iOS, Oboe/AudioRecord Android), YIN algorithm for pitch detection, signal conditioning (RMS silence gate at -40dBFS, confidence hysteresis enter 0.85 / exit 0.75, octave jump suppression for 3 frames, 3-frame median filter), atomic shared state, JS polls via requestAnimationFrame at 30fps, React UI displays note name + frequency + cent deviation.

Buffer: 1024 capture, 2048 overlapping analysis. Sample rate: query device native (never hardcode). Target latency: < 80ms. A4 = 440Hz. Equal temperament 12-TET. Sharps only for MVP.

UI: Start/Stop button, large note display, frequency in Hz, cent indicator (±50), confidence gate (show "---" when low), status bar, 3-second silence hint. Permission denied → error + Settings link. Background → stop everything. Foreground → resume if was active.

Constraints: monophonic only, local only, no recording, no playback, no MIDI export, no cloud, no custom tuning. Expo dev build (not Expo Go). New Architecture (TurboModules + Fabric) from day 1.

Known limitations: octave errors on breathy vocals, Android latency varies (50-250ms by device), bass below E2 unreliable, noise may cause false positives. These are physics constraints, not bugs.

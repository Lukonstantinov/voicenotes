# Musician's Scratchpad — Session State

> Keep this file updated at the end of every Claude Code session.
> It is the primary source of truth for what's done and what's next.

Last updated: 2026-02-20

---

## Completed Phases

### Phase 0 — Project Setup ✓
- Expo 54 + React Native 0.81.5 + TypeScript, New Architecture enabled (TurboModules + Fabric)
- `npx expo prebuild` run; `android/` and `ios/` native scaffolding committed
- iOS `NSMicrophoneUsageDescription` in Info.plist
- Android `RECORD_AUDIO` permission in AndroidManifest.xml
- GitHub Actions workflow: `.github/workflows/build-android.yml` → produces downloadable debug APK on every push

### Phase 1 — Utility Layer ✓
- `src/utils/pitchUtils.ts` — `frequencyToNote(freq)` converts Hz → `{noteName, octave, cents, fullName}`
- `src/utils/permissions.ts` — mic permission request + Settings deep-link helper
- 9 unit tests in `src/utils/__tests__/pitchUtils.test.ts`, all passing (`npm test`)
- Test vectors: A4=440 Hz, A3=220 Hz, C4=261.626 Hz, E2=82.407 Hz, B4=493.883 Hz, C3=130.813 Hz, 445 Hz (+20¢), 0 Hz → null, −100 Hz → null

### Phase 2 — iOS Native Audio Module ✓
- `src/native/ios/AudioCaptureModule.swift` — registered as `@objc(AudioPitch)`
- `src/native/ios/AudioCaptureModuleBridge.mm` — Obj-C bridge header
- AVAudioSession: category `.playAndRecord`, mode `.measurement`
- AVAudioEngine tap: 1024-frame capture buffer, queries native sample rate (never hardcoded)
- Full YIN pitch detection + signal conditioning pipeline in Swift (see constants below)
- Interruption handling via `AVAudioSession.interruptionNotification`
- Atomic state guarded by `pthread_mutex_t`; 200 ms stale-data guard

### Phase 3 — Android Native Audio Module ✓
- `src/native/android/AudioCaptureModule.kt` — `@ReactModule(name = "AudioPitch")`
- `src/native/android/AudioCapturePackage.kt` — package registration
- AudioRecord with `UNPROCESSED` source (falls back to `VOICE_RECOGNITION` if needed)
- Sample rate queried from `AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE`
- Dedicated daemon capture thread; atomic state via `@Volatile` + `synchronized` block
- 200 ms stale-data guard; `isBlockingSynchronousMethod = true` on `getLatestPitch()`
- Android debug APK bundles JS (Metro not required at runtime) — fixed in PR #3

### Phase 4 — React UI ✓
- `src/bridge/NativeAudioPitch.ts` — TurboModule codegen spec (`Spec` + `TurboModuleRegistry.getEnforcing`)
- `src/bridge/NativeAudioPitchModule.ts` — re-export shim for UI layer
- `src/bridge/types.ts` — shared `PitchResult` type
- `src/ui/hooks/usePitchPolling.ts` — `requestAnimationFrame` polling at ~30 fps (33 ms interval); clears on stop
- `src/ui/components/PitchDisplay.tsx` — large note name (120 px) + octave subscript; shows `—` when null
- `src/ui/components/CentIndicator.tsx` — horizontal track with moving needle; green ≤ ±5¢, orange otherwise; shows `flat` / `sharp` labels and numeric value
- `src/ui/components/ListenButton.tsx` — circular toggle button, white→red on active
- `src/ui/components/AppStatusBar.tsx` — idle / requesting / listening / denied / error states + 3-second silence hint
- `src/ui/App.tsx` — composes all components; handles permission flow, AppState lifecycle (background/foreground), silence hint timer

---

## Signal Conditioning Constants (same on both platforms)

| Constant | Value |
|---|---|
| YIN_THRESHOLD | 0.12 |
| CONFIDENCE_ENTER | 0.85 |
| CONFIDENCE_EXIT | 0.75 |
| RMS_SILENCE_DB | −40 dBFS |
| MIN_FREQUENCY | 75 Hz |
| MAX_FREQUENCY | 2000 Hz |
| MEDIAN_WINDOW | 3 frames |
| OCTAVE_SUPPRESS_MAX | 3 frames |
| CAPTURE_SIZE | 1024 samples |
| ANALYSIS_SIZE | 2048 samples |

---

## What's Next

### Phase 5 — Integration & Polish (NOT STARTED)
- [ ] Test full pipeline on physical iOS device (mic → DSP → bridge → UI)
- [ ] Test full pipeline on physical Android device
- [ ] Verify lifecycle: stop on background, auto-resume on foreground
- [ ] Verify error states render correctly (permission denied path)
- [ ] Verify null pitch clears display with no stale data
- [ ] Verify 3-second silence hint appears correctly

### Phase 6 — Final (NOT STARTED)
- [ ] Run all unit tests one final time
- [ ] Remove debug `console.log` / `os_log` / `Log.d` calls used only during development
- [ ] Final git commit and push

---

## Known Limitations (Physics, Not Bugs)

- Octave errors on breathy vocals
- Android latency varies 50–250 ms by device
- Bass below E2 (~82 Hz) may be unreliable
- Noise may cause false positives at low confidence

---

## Repository Layout

```
musicians-scratchpad/
├── android/                    # Generated native Android project
├── ios/                        # Generated native iOS project
├── src/
│   ├── bridge/
│   │   ├── NativeAudioPitch.ts         # TurboModule codegen spec
│   │   ├── NativeAudioPitchModule.ts   # Re-export for UI layer
│   │   └── types.ts                    # PitchResult interface
│   ├── native/
│   │   ├── ios/
│   │   │   ├── AudioCaptureModule.swift
│   │   │   └── AudioCaptureModuleBridge.mm
│   │   └── android/
│   │       ├── AudioCaptureModule.kt
│   │       └── AudioCapturePackage.kt
│   ├── ui/
│   │   ├── App.tsx
│   │   ├── hooks/
│   │   │   └── usePitchPolling.ts
│   │   └── components/
│   │       ├── PitchDisplay.tsx
│   │       ├── CentIndicator.tsx
│   │       ├── ListenButton.tsx
│   │       └── AppStatusBar.tsx
│   └── utils/
│       ├── pitchUtils.ts
│       ├── permissions.ts
│       └── __tests__/
│           └── pitchUtils.test.ts
├── .github/workflows/
│   └── build-android.yml       # CI: debug APK on every push
├── docs/
│   └── musicians_scratchpad_mvp_v2.txt  # Full MVP spec
├── CLAUDE.md                   # Build sequence + architecture rules
├── SESSION_STATE.md            # THIS FILE — update each session
└── package.json
```

---

## Git History Summary

| Commit / PR | What |
|---|---|
| Initial commit | Repo created, base files uploaded |
| PR #1 (`claude/implement-claude-md-r7gzH`) | Phase 0 + Phase 1 scaffold; GitHub Actions CI |
| PR #2 (`claude/continue-implementation-Z0dCt`) | Phases 2–4 (native modules + React UI) |
| PR #3 (`claude/fix-install-error-jLDeI`) | Android: bundle JS into debug APK |

---

## Key Decisions Made

- **No expo-av** — custom native modules only (architecture rule)
- **Poll, don't push** — `requestAnimationFrame` at 30fps; no `NativeEventEmitter`
- **Synchronous JSI** — `getLatestPitch()` returns synchronously (no Promise overhead)
- **AudioRecord over Oboe** — Oboe integration conflicts with Expo build system; AudioRecord with `UNPROCESSED` source used instead
- **Sample rate queried** — never hardcoded; iOS reads from `AVAudioSession`, Android from `AudioManager`
- **Pre-allocated DSP buffers** — no heap allocation on the audio thread
- **Stale data guard** — results older than 200 ms return `null` to prevent ghost notes

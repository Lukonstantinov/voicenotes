# Musician's Scratchpad — Claude Code Instructions

## BUILD SEQUENCE

Follow this order. Complete each phase before moving to the next. Run the verification checklist (see skills/build-validation/SKILL.md) at the end of every phase. Do NOT proceed if verification fails.

### Phase 0: Project Setup
1. Initialize Expo project with TypeScript template
2. Install dependencies (NO expo-av, NO pitchfinder, NO redux)
3. Enable New Architecture in build config (TurboModules + Fabric)
4. Run `npx expo prebuild --clean`
5. Configure iOS Info.plist: add NSMicrophoneUsageDescription
6. Configure Android AndroidManifest.xml: add RECORD_AUDIO permission
7. Initialize git repo, create initial commit
8. Commit `android/` and `ios/` generated source (without Pods/build) so CI can build without re-running prebuild
9. **Verify:** Project builds on iOS simulator showing default Expo screen. GitHub Actions workflow `.github/workflows/build-android.yml` is present and triggers on push.

### Phase 1: Utility Layer (Pure TypeScript)
1. Create `src/utils/pitchUtils.ts` — frequencyToNote function
2. Create `src/utils/permissions.ts` — mic permission request + Settings deep link
3. Write unit tests for pitchUtils (see test vectors in skills/audio-dsp-patterns/SKILL.md)
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
6. **Verify:** Android builds. Module accessible from JS. GitHub Actions APK build completes and artifact is downloadable from the Actions tab.

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
5. **Verify:** Clean build on both platforms, all tests pass, git clean. GitHub Actions APK artifact downloads and installs on a physical Android device.

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

# Implementation Plan: Voicenotes Improvement Plan

## Codebase Audit — What's Already Done

Before implementing, it's critical to note that the codebase has **already completed**
many items from the improvement plan. Here's the full gap analysis:

### Already Implemented (skip these)

| Plan Item | Status | Evidence |
|-----------|--------|----------|
| 1.1 YIN algorithm | DONE | `AudioCaptureModule.swift:470-519` — full YIN with parabolic interpolation, CMND, threshold detection. Android Kotlin module has matching implementation. |
| 1.2 Noise gate | DONE | `AudioCaptureModule.swift:390-395` — RMS silence gate at -50dB default. Configurable via `setSensitivity()` with low/medium/high presets in SettingsScreen. |
| 1.3 Buffer latency | DONE | `kAnalysisSize=2048`, `kCaptureSize=1024`. Queries device native sample rate (not hardcoded 44100). |
| 2.1 Decouple audio from React | DONE | `usePitchPolling.ts` — `requestAnimationFrame` at ~30fps, synchronous JSI poll via `getLatestPitch()`. No event emitters, no setState flood. |
| 3.2 Note name overlay | DONE | `TunerScreen.tsx:172-176` — 120px note name + octave number, prominent display. |
| 3.4 Recording & sessions | DONE | `useSessionRecorder.ts`, `SessionListScreen.tsx`, `SessionReviewScreen.tsx`, `PianoRollTimeline.tsx`, `sessionStorage.ts`, `sessionAnalysis.ts`. Import audio files via native `analyzeAudioFile`. |
| 4.1 Project structure | DONE | Clean layered architecture: `native/ → bridge/ → ui/ → utils/`. Follows CLAUDE.md module boundaries. |
| 4.3 TypeScript strict | DONE | `tsconfig.json` has `"strict": true`. |
| 4.4 Native error handling | DONE | Promise reject patterns in Swift/Kotlin. UI error states for permission denied, analysis failure. |
| 5.2 Mic permission UX | DONE | Android rationale dialog, `NEVER_ASK_AGAIN` → `openSettings()`, 3-second silence hint, denied state handling. |

### Remaining Work (7 items)

| Plan Item | Priority | Complexity |
|-----------|----------|------------|
| 2.2 React Native Skia graph | HIGH | Large — new dependency, rewrite PianoRollTimeline |
| 3.1 HOLD button | HIGH | Small — UI-only, pause pitch buffer updates |
| 3.3 Per-note color coding | MEDIUM | Medium — theme colors + graph integration |
| 3.5 A4 calibration setting | MEDIUM | Medium — Settings UI + pipe value to native modules |
| 4.2 Zustand state management | LOW | Large — refactor all useState to stores |
| 5.1 Dark mode | MEDIUM | Medium — theme system + all style updates |
| 5.3 CI/CD GitHub Actions | LOW | Medium — workflow files |

---

## Conflicts with CLAUDE.md Architecture Rules

The improvement plan suggests some approaches that **conflict** with the project's
architecture rules in `musicians-scratchpad/CLAUDE.md`. These must be resolved:

1. **expo-av for recording** — Plan item 3.4 suggests `expo-av`. CLAUDE.md explicitly
   says "NO expo-av for audio." The app already handles sessions by recording pitch
   data natively, not audio waveforms. **Resolution: Skip — already solved differently.**

2. **NativeEventEmitter for pitch** — Plan item 2.1 code sample uses `addListener`.
   CLAUDE.md says "Poll, don't push" and forbids NativeEventEmitter for per-frame
   updates. **Resolution: Already correct — app uses requestAnimationFrame polling.**

3. **react-native-pitchy / pitchfinder.js** — Plan suggests JS-based pitch libraries.
   CLAUDE.md says "NO JS-thread DSP." **Resolution: Skip — native YIN already done.**

4. **Zustand** — Not explicitly forbidden, but adds a dependency where the current
   pattern (useState + props) works. **Recommendation: Defer — low ROI for current
   app complexity.**

---

## Implementation Steps (Ordered by Priority)

### Step 1: HOLD Button (Plan 3.1)

**Files to modify:**
- `src/ui/screens/TunerScreen.tsx` — add hold state + button
- `src/ui/hooks/usePitchPolling.ts` — accept `isHeld` param to freeze updates

**Changes:**
1. Add `isHeld` state to TunerScreen
2. Modify `usePitchPolling` to accept a `paused` boolean — when true, stop updating
   the pitch value but keep the last-known value displayed
3. Add a HOLD/RESUME toggle button in the UI, positioned top-right
4. Style: high-contrast, always visible, does not overlap other controls

**Rationale:** Simplest change, high user value, no new dependencies.

---

### Step 2: A4 Calibration Setting (Plan 3.5)

**Files to modify:**
- `src/utils/settingsStorage.ts` — add `getA4Calibration()` / `setA4Calibration()`
- `src/ui/screens/SettingsScreen.tsx` — add A4 slider (430–450 Hz)
- `src/utils/pitchUtils.ts` — accept A4 parameter instead of hardcoded 440
- `src/bridge/NativeAudioPitch.ts` — add `setA4Calibration(hz: number)` to TurboModule spec
- `src/native/ios/AudioCaptureModule.swift` — use dynamic A4 in `frequencyToNote()`
- `src/native/android/AudioCaptureModule.kt` — same
- `src/utils/__tests__/pitchUtils.test.ts` — update tests for parameterized A4

**Changes:**
1. Add AsyncStorage-backed A4 setting (default 440)
2. Add slider to SettingsScreen under mic sensitivity section
3. Expose `setA4Calibration()` on the TurboModule interface
4. Native modules read a dynamic A4 value (like `dynSilenceDb` pattern) instead of
   hardcoded 440.0
5. TypeScript `frequencyToNote()` takes optional `a4` param

---

### Step 3: Per-Note Color Coding (Plan 3.3)

**Files to create/modify:**
- `src/utils/noteColors.ts` — new file with `NOTE_COLORS` map and `getNoteColor()` helper
- `src/ui/screens/TunerScreen.tsx` — color the note name based on current pitch
- `src/ui/components/PianoRollTimeline.tsx` — color note blocks by note name

**Changes:**
1. Create color map for all 12 chromatic notes (from plan)
2. Apply color to the large note display in TunerScreen
3. Apply colors to PianoRollTimeline note bars
4. Colors should work in both light and dark themes (prepare for Step 5)

---

### Step 4: Dark Mode Support (Plan 5.1)

**Files to create/modify:**
- `src/ui/theme/colors.ts` — new file, semantic color tokens for light/dark
- `src/ui/theme/ThemeContext.tsx` — new file, React context for theme
- `src/ui/App.tsx` — wrap in ThemeProvider, use `useColorScheme()`
- ALL screen and component files — replace hardcoded colors with theme tokens

**Changes:**
1. Create theme system with semantic tokens (background, surface, text, primary, etc.)
2. Default to dark mode (music apps are used in dark environments)
3. Create ThemeContext with `useTheme()` hook
4. Migrate all StyleSheet colors to theme-aware values
5. StatusBar style adapts to theme
6. Note colors (Step 3) have light/dark variants

**Affected files (full list):**
- `src/ui/App.tsx`
- `src/ui/screens/TunerScreen.tsx`
- `src/ui/screens/RecordingScreen.tsx`
- `src/ui/screens/SessionListScreen.tsx`
- `src/ui/screens/SessionReviewScreen.tsx`
- `src/ui/screens/SettingsScreen.tsx`
- `src/ui/components/PitchDisplay.tsx`
- `src/ui/components/CentIndicator.tsx`
- `src/ui/components/ListenButton.tsx`
- `src/ui/components/AppStatusBar.tsx`
- `src/ui/components/PianoRollTimeline.tsx`
- `src/ui/navigation/AppNavigator.tsx`

---

### Step 5: React Native Skia Graph (Plan 2.2)

**Files to create/modify:**
- `package.json` — add `@shopify/react-native-skia` dependency
- `src/ui/components/PianoRollTimeline.tsx` — rewrite using Skia Canvas + Path
- `src/ui/components/PitchGraph.tsx` — new component for real-time pitch line graph

**Changes:**
1. Install `@shopify/react-native-skia` via `npx expo install`
2. Run `npx expo prebuild --clean` to regenerate native projects
3. Create a real-time pitch line graph component using Skia Canvas
   - Uses `useSharedValue` from react-native-reanimated for the pitch buffer
   - Renders on UI thread via Skia, zero JS overhead
   - Note color coding integrated (from Step 3)
4. Rewrite PianoRollTimeline to use Skia for GPU-accelerated rendering
5. Verify iOS and Android builds still succeed

**Risk:** Skia adds ~2MB to bundle and requires native rebuild. If it causes build
issues with the current Expo 54 + New Architecture setup, fall back to the current
React Native view-based implementation (which is already functional).

---

### Step 6: CI/CD GitHub Actions (Plan 5.3)

**Files to create:**
- `.github/workflows/ci.yml` — lint, typecheck, test
- `.github/workflows/build-android.yml` — EAS build for Android preview

**Changes:**
1. CI workflow (triggers on push to all branches):
   - `npx tsc --noEmit` (type check)
   - `npx jest --coverage` (run tests)
2. Android build workflow (triggers on push to main):
   - `eas build --platform android --profile preview --non-interactive`
   - Upload APK artifact

---

### Step 7: Android-Specific Polish (Plan 5.4)

**Files to modify:**
- `app.json` or `android/app/src/main/AndroidManifest.xml` — `windowSoftInputMode`
- `src/native/android/AudioCaptureModule.kt` — audio focus handling

**Changes:**
1. Set `windowSoftInputMode = "adjustResize"` in app.json android config
2. Handle `AUDIO_FOCUS_LOSS` — pause pitch detection on phone calls
3. Verify 48000Hz sample rate works on test devices (already queries native rate)
4. Minimum API level: verify set to 26+ for `ENCODING_PCM_FLOAT`

---

## Deferred Items (Not Recommended Now)

### Zustand State Management (Plan 4.2)
**Recommendation: Defer.** The app's current state management with `useState` +
`useCallback` + `AsyncStorage` is adequate for its complexity. Zustand would be
worthwhile if/when the app grows to 10+ screens with shared state, but right now
it would be churn without clear benefit.

### react-native-live-pitch-detection (Plan suggestion)
**Recommendation: Skip.** The custom native YIN implementation already provides
this functionality with full control over the signal conditioning pipeline.

### expo-av for audio recording (Plan 3.4 stack suggestion)
**Recommendation: Skip.** Violates CLAUDE.md architecture rules. Session recording
is already implemented differently (pitch data recording, not audio waveform recording).

---

## Suggested Implementation Order

```
Step 1: HOLD button           ← small, high impact
Step 2: A4 calibration        ← medium, enables musicians with non-440 tuning
Step 3: Per-note colors       ← medium, visual improvement
Step 4: Dark mode             ← medium, essential for music app
Step 5: Skia graph            ← large, performance improvement (optional if current perf is OK)
Step 6: CI/CD                 ← medium, project health
Step 7: Android polish        ← small-medium, pre-publish
```

# Musician's Scratchpad

Real-time monophonic pitch detection app (React Native / Expo dev build).

## Project root
All source lives in `musicians-scratchpad/`.

## Instructions
- Full build sequence, architecture rules, and DO NOTs: `musicians-scratchpad/CLAUDE.md`
- Skill reference files: `musicians-scratchpad/skills/`
  - `app-system-engineering/` — layer structure, polling hook, lifecycle
  - `audio-dsp-patterns/` — YIN algorithm, DSP constants, test vectors
  - `rn-native-debugging/` — diagnostic trees, isolation tests
  - `project-conventions/` — branch/commit format, code style
  - `build-validation/` — phase-end verification checklists

## Current status
- Phase 0 ✓ (Expo + New Architecture + prebuild + permissions)
- Phase 1 ✓ (pitchUtils.ts + permissions.ts + 9 unit tests passing)
- Phase 2 ✓ (iOS native audio module: Swift + AVAudioEngine + YIN + TurboModule)
- Phase 3 ✓ (Android native audio module: Kotlin + AudioRecord + YIN + TurboModule)
- Phase 4 ✓ (React UI: PitchDisplay, CentIndicator, ListenButton, AppStatusBar, usePitchPolling)
- Phase 5 next: integration testing on physical device + lifecycle/error verification
- Phase 6 pending: final cleanup and release commit

See `musicians-scratchpad/SESSION_STATE.md` for full detail on what's done and what's next.

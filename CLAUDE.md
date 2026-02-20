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
- Phase 2 ✓ (iOS native audio module — AVAudioEngine + YIN + signal conditioning + TurboModule)
- Phase 3 ✓ (Android native audio module — AudioRecord + YIN + signal conditioning + TurboModule)
- Phase 4 ✓ (React UI — PitchDisplay, CentIndicator, ListenButton, AppStatusBar, usePitchPolling)
- Phase 5 ✓ (lifecycle management, error states, interruption handling, 3s silence hint, null-pitch clear)
- Phase 6 ✓ (9/9 unit tests pass, tsc clean, no console.logs, git clean)

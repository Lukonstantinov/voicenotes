# SKILL 5: BUILD VALIDATION

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

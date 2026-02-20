# SKILL 3: RN NATIVE DEBUGGING

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

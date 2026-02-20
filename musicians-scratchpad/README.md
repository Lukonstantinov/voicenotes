# Musician's Scratchpad

Real-time monophonic pitch detection mobile app. User hums or plays a single note into their phone mic → app instantly shows the note name (e.g. G#3), frequency (207.6 Hz), and how sharp or flat they are (±cents).

## Tech Stack

- **Framework:** React Native (Expo dev build), TypeScript
- **Native modules:** Custom (Swift for iOS, Kotlin for Android)
- **Bridge:** TurboModule/JSI (New Architecture)
- **DSP:** YIN pitch detection algorithm, fully native

## Key Specs

- **Reference tuning:** A4 = 440Hz
- **Minimum pitch:** ~80Hz (E2) — covers bass guitar and low male voice
- **Target latency:** < 80ms from sound to screen
- **Equal temperament:** 12-TET, sharps only

## Architecture

Audio pipeline is fully native. Only the pitch result struct crosses to JS via synchronous JSI getter. UI polls at 30fps via requestAnimationFrame.

```
Microphone → [Native Audio Thread] → [Native DSP Thread]
    → [Atomic Shared State] → [JS Poll @ 30fps] → [React UI]
```

## Getting Started

> This app requires an Expo development build. It is NOT compatible with Expo Go.

### Prerequisites

- Node.js 18+
- Expo CLI
- Xcode 15+ (for iOS)
- Android Studio + NDK (for Android)

### Build

```bash
npm install
npx expo prebuild --clean
# iOS
npx expo run:ios
# Android
npx expo run:android
```

## Known Limitations

- Octave errors on breathy vocals (physics constraint)
- Android latency varies 50–250ms by device
- Bass below E2 (~82Hz) may be unreliable
- Noise may cause false positives at low confidence

## Project Structure

```
src/
├── native/       # AVAudioEngine (iOS) + Oboe/AudioRecord (Android)
├── bridge/       # TurboModule spec
├── ui/           # React components + polling hook
└── utils/        # Pure TS utilities (pitchUtils, permissions)
```

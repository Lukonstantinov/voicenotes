# SKILL 4: PROJECT CONVENTIONS

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

# SKILL 1: APP SYSTEM ENGINEERING

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

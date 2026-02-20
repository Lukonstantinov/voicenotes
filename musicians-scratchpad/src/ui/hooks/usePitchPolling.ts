import { useState, useEffect, useRef } from 'react';
import AudioPitchModule from '../../bridge/NativeAudioPitchModule';
import type { PitchResult } from '../../bridge/types';

const FRAME_INTERVAL_MS = 33; // ~30 fps

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
    let active = true;

    const poll = async (currentTime: number) => {
      if (!active) return;
      if (currentTime - lastFrameTime >= FRAME_INTERVAL_MS) {
        lastFrameTime = currentTime;
        try {
          const result = await AudioPitchModule.getLatestPitch();
          if (!active) return;
          if (result && result.timestamp !== lastTimestamp.current) {
            lastTimestamp.current = result.timestamp;
            setPitch(result);
          } else if (!result) {
            setPitch(null);
            lastTimestamp.current = 0;
          }
        } catch (_) {
          // ignore transient native errors
        }
      }
      if (active) {
        rafId = requestAnimationFrame(poll);
      }
    };

    rafId = requestAnimationFrame(poll);
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
    };
  }, [isListening]);

  return pitch;
}

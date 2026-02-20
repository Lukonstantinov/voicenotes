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

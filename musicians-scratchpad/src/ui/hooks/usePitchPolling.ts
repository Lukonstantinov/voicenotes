import { useState, useEffect } from 'react';
import { NativeEventEmitter, NativeModules } from 'react-native';
import type { PitchResult } from '../../bridge/types';

// Native pushes 'pitchUpdate' events at ~30 fps while listening.
// null payload means silence / pitch lost.
const emitter = new NativeEventEmitter(NativeModules.AudioPitch);

export function usePitchPolling(isListening: boolean): PitchResult | null {
  const [pitch, setPitch] = useState<PitchResult | null>(null);

  useEffect(() => {
    if (!isListening) {
      setPitch(null);
      return;
    }

    const sub = emitter.addListener('pitchUpdate', (data: PitchResult | null) => {
      setPitch(data ?? null);
    });

    return () => sub.remove();
  }, [isListening]);

  return pitch;
}

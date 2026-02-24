import { useState, useRef, useCallback, useEffect } from 'react';
import AudioPitchModule from '../../bridge/NativeAudioPitchModule';
import type { PitchResult } from '../../bridge/types';
import type { RecordedNote } from '../../utils/sessionTypes';
import { createNoteMerger, type NoteMerger } from '../../utils/noteMerger';

const POLL_INTERVAL_MS = 33; // ~30 fps, matches usePitchPolling

export interface SessionRecorderState {
  isRecording: boolean;
  elapsedMs: number;
  notes: RecordedNote[];
  currentPitch: PitchResult | null;
}

export function useSessionRecorder() {
  const [state, setState] = useState<SessionRecorderState>({
    isRecording: false,
    elapsedMs: 0,
    notes: [],
    currentPitch: null,
  });

  const mergerRef = useRef<NoteMerger | null>(null);
  const startTimeRef = useRef(0);
  const lastTimestampRef = useRef(0);

  // Polling loop
  useEffect(() => {
    if (!state.isRecording) return;

    let rafId: number;
    let lastFrameTime = 0;

    const poll = (currentTime: number) => {
      if (currentTime - lastFrameTime >= POLL_INTERVAL_MS) {
        lastFrameTime = currentTime;
        const elapsed = Date.now() - startTimeRef.current;
        const result = AudioPitchModule.getLatestPitch();

        if (result && result.timestamp !== lastTimestampRef.current) {
          lastTimestampRef.current = result.timestamp;
          mergerRef.current?.push(result, elapsed);
          setState((prev) => ({
            ...prev,
            elapsedMs: elapsed,
            notes: mergerRef.current?.getNotes() ?? prev.notes,
            currentPitch: result,
          }));
        } else {
          mergerRef.current?.push(null, elapsed);
          setState((prev) => ({
            ...prev,
            elapsedMs: elapsed,
            currentPitch: result?.timestamp === lastTimestampRef.current ? prev.currentPitch : null,
          }));
        }
      }
      rafId = requestAnimationFrame(poll);
    };

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [state.isRecording]);

  const startRecording = useCallback(() => {
    mergerRef.current = createNoteMerger();
    startTimeRef.current = Date.now();
    lastTimestampRef.current = 0;
    AudioPitchModule.startListening();
    setState({
      isRecording: true,
      elapsedMs: 0,
      notes: [],
      currentPitch: null,
    });
  }, []);

  const stopRecording = useCallback((): {
    notes: RecordedNote[];
    durationMs: number;
  } => {
    AudioPitchModule.stopListening();
    mergerRef.current?.flush();
    const notes = mergerRef.current?.getNotes() ?? [];
    const durationMs = Date.now() - startTimeRef.current;
    setState((prev) => ({
      ...prev,
      isRecording: false,
      notes,
      currentPitch: null,
    }));
    return { notes, durationMs };
  }, []);

  return {
    ...state,
    startRecording,
    stopRecording,
  };
}

import type { PitchResult } from '../bridge/types';
import type { RecordedNote } from './sessionTypes';
import { uid } from './uid';

/** Minimum gap (ms) of silence before we close an open note. */
const SILENCE_GAP_MS = 150;

/** Minimum note duration (ms) to keep — shorter notes are noise. */
const MIN_NOTE_DURATION_MS = 50;

interface OpenNote {
  noteName: string;
  octave: number;
  freqSum: number;
  centsSum: number;
  confSum: number;
  sampleCount: number;
  startMs: number;
  lastSeenMs: number;
}

/**
 * Stateful note merger. Feed it raw PitchResult polls (with session-relative
 * timestamps) and it accumulates RecordedNote events.
 *
 * Usage:
 *   const merger = createNoteMerger();
 *   merger.push(pitchResult, elapsedMs);   // on each poll
 *   merger.push(null, elapsedMs);           // when no pitch detected
 *   merger.flush();                         // when recording stops
 *   const notes = merger.getNotes();
 */
export function createNoteMerger() {
  const notes: RecordedNote[] = [];
  let open: OpenNote | null = null;

  function closeOpenNote(): void {
    if (!open) return;
    const duration = open.lastSeenMs - open.startMs;
    if (duration >= MIN_NOTE_DURATION_MS) {
      notes.push({
        id: uid(),
        noteName: open.noteName,
        octave: open.octave,
        frequency: Math.round((open.freqSum / open.sampleCount) * 100) / 100,
        cents: Math.round(open.centsSum / open.sampleCount),
        confidence: Math.round((open.confSum / open.sampleCount) * 100) / 100,
        startMs: open.startMs,
        endMs: open.lastSeenMs,
      });
    }
    open = null;
  }

  function push(pitch: PitchResult | null, elapsedMs: number): void {
    if (!pitch) {
      // No pitch: if there's an open note and silence gap exceeded, close it
      if (open && elapsedMs - open.lastSeenMs >= SILENCE_GAP_MS) {
        closeOpenNote();
      }
      return;
    }

    const { noteName, octave, frequency, cents, confidence } = pitch;

    if (open) {
      // Same note continues
      if (open.noteName === noteName && open.octave === octave) {
        open.freqSum += frequency;
        open.centsSum += cents;
        open.confSum += confidence;
        open.sampleCount += 1;
        open.lastSeenMs = elapsedMs;
        return;
      }

      // Different note detected — check if silence gap elapsed
      if (elapsedMs - open.lastSeenMs >= SILENCE_GAP_MS) {
        closeOpenNote();
      } else {
        // Immediate note change — close the old note at its last seen time
        closeOpenNote();
      }
    }

    // Start a new open note
    open = {
      noteName,
      octave,
      freqSum: frequency,
      centsSum: cents,
      confSum: confidence,
      sampleCount: 1,
      startMs: elapsedMs,
      lastSeenMs: elapsedMs,
    };
  }

  function flush(): void {
    closeOpenNote();
  }

  function getNotes(): RecordedNote[] {
    return [...notes];
  }

  function getOpenNote(): OpenNote | null {
    return open;
  }

  return { push, flush, getNotes, getOpenNote };
}

export type NoteMerger = ReturnType<typeof createNoteMerger>;

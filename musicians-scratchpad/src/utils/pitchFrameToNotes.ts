/**
 * Converts raw pitch frames returned by AudioCaptureModule.analyzeAudioFile
 * into merged RecordedNote events, using the same note-merging rules as live recording.
 */
import type { RecordedNote } from './sessionTypes';
import type { RawPitchFrame } from '../bridge/NativeAudioPitch';
import { uid } from './uid';

/** Max gap between two frames of the same note before they're split into separate notes. */
const SILENCE_GAP_MS = 150;
/** Notes shorter than this are discarded as noise. */
const MIN_DURATION_MS = 50;

export function pitchFramesToNotes(frames: RawPitchFrame[]): RecordedNote[] {
  const notes: RecordedNote[] = [];
  if (frames.length === 0) return notes;

  let currentNote: Partial<RecordedNote> | null = null;
  let sumFreq = 0, sumCents = 0, sumConf = 0, count = 0;
  let lastTs = 0;

  const flushCurrent = () => {
    if (!currentNote) return;
    const dur = (currentNote.endMs ?? 0) - (currentNote.startMs ?? 0);
    if (dur >= MIN_DURATION_MS) {
      notes.push({
        ...currentNote,
        frequency:  sumFreq  / count,
        cents:      Math.round(sumCents / count),
        confidence: sumConf  / count,
      } as RecordedNote);
    }
    currentNote = null;
  };

  for (const frame of frames) {
    const gap = frame.timestampMs - lastTs;
    const isContinuation =
      currentNote !== null &&
      currentNote.noteName === frame.noteName &&
      currentNote.octave   === frame.octave   &&
      gap < SILENCE_GAP_MS;

    if (isContinuation) {
      sumFreq  += frame.frequency;
      sumCents += frame.cents;
      sumConf  += frame.confidence;
      count++;
      currentNote!.endMs = frame.timestampMs;
    } else {
      flushCurrent();
      currentNote = {
        id:       uid(),
        noteName: frame.noteName,
        octave:   frame.octave,
        startMs:  frame.timestampMs,
        endMs:    frame.timestampMs,
      };
      sumFreq  = frame.frequency;
      sumCents = frame.cents;
      sumConf  = frame.confidence;
      count    = 1;
    }

    lastTs = frame.timestampMs;
  }

  flushCurrent();
  return notes;
}

import type { RecordedNote, CorrectedNote } from './sessionTypes';
import { uid } from './uid';

// ── Scale definitions ───────────────────────────────────────────────────────

/** Semitone offsets for major scale: W W H W W W H */
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

/** Semitone offsets for natural minor scale: W H W W H W W */
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

const NOTE_TO_SEMITONE: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
  'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
};

const SEMITONE_TO_NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Parse a key string like "C major", "A minor", "Bb major" into
 * a set of semitone values (0–11) that belong to the scale.
 */
function parseKeyToScale(key: string): Set<number> {
  const parts = key.trim().split(/\s+/);
  const root = parts[0] ?? 'C';
  const quality = (parts[1] ?? 'major').toLowerCase();

  const rootSemitone = NOTE_TO_SEMITONE[root] ?? 0;
  const intervals = quality === 'minor' ? MINOR_INTERVALS : MAJOR_INTERVALS;

  return new Set(intervals.map((i) => (rootSemitone + i) % 12));
}

/**
 * Given a semitone (0–11), find the nearest semitone in the scale.
 * If equidistant, prefer the one below (flat direction).
 */
function nearestScaleDegree(semitone: number, scale: Set<number>): number {
  if (scale.has(semitone)) return semitone;

  for (let offset = 1; offset <= 6; offset++) {
    const below = ((semitone - offset) % 12 + 12) % 12;
    const above = (semitone + offset) % 12;
    if (scale.has(below)) return below;
    if (scale.has(above)) return above;
  }

  return semitone; // fallback (shouldn't happen for 7-note scales)
}

// ── BPM detection ───────────────────────────────────────────────────────────

/**
 * Estimate BPM from note onset times using autocorrelation on inter-onset
 * intervals. Returns null if fewer than 4 notes.
 */
export function detectBPM(notes: RecordedNote[]): number | null {
  if (notes.length < 4) return null;

  const onsets = notes.map((n) => n.startMs);
  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    intervals.push(onsets[i] - onsets[i - 1]);
  }

  // Look for the most common interval in the range of 200ms–2000ms (30–300 BPM)
  const MIN_MS = 200;
  const MAX_MS = 2000;
  const BUCKET_MS = 20;
  const bucketCount = Math.ceil((MAX_MS - MIN_MS) / BUCKET_MS);
  const buckets = new Array(bucketCount).fill(0);

  for (const interval of intervals) {
    if (interval >= MIN_MS && interval <= MAX_MS) {
      const idx = Math.floor((interval - MIN_MS) / BUCKET_MS);
      buckets[idx] += 1;
    }
    // Also check half and double intervals (subdivisions / compound beats)
    const half = interval / 2;
    if (half >= MIN_MS && half <= MAX_MS) {
      const idx = Math.floor((half - MIN_MS) / BUCKET_MS);
      buckets[idx] += 0.5;
    }
    const dbl = interval * 2;
    if (dbl >= MIN_MS && dbl <= MAX_MS) {
      const idx = Math.floor((dbl - MIN_MS) / BUCKET_MS);
      buckets[idx] += 0.5;
    }
  }

  let bestIdx = 0;
  let bestVal = 0;
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i] > bestVal) {
      bestVal = buckets[i];
      bestIdx = i;
    }
  }

  if (bestVal < 2) return null; // not enough evidence

  const bestMs = MIN_MS + bestIdx * BUCKET_MS + BUCKET_MS / 2;
  const bpm = Math.round(60000 / bestMs);

  return Math.max(20, Math.min(300, bpm));
}

// ── Quantization ────────────────────────────────────────────────────────────

/** Duration of one 16th note at the given BPM, in ms. */
function sixteenthMs(bpm: number): number {
  return 60000 / bpm / 4;
}

/** Snap a time value to the nearest grid position. */
function snapToGrid(ms: number, gridMs: number): number {
  return Math.round(ms / gridMs) * gridMs;
}

// ── Main analysis function ──────────────────────────────────────────────────

/**
 * Analyze a session's notes: quantize to a BPM grid and pitch-correct to a key.
 * Non-destructive — returns a new array of CorrectedNotes.
 */
export function analyzeSession(
  notes: RecordedNote[],
  bpm: number,
  key: string,
): CorrectedNote[] {
  const gridMs = sixteenthMs(bpm);
  const minDurationMs = gridMs / 2; // 32nd note = noise threshold
  const scale = parseKeyToScale(key);

  const corrected: CorrectedNote[] = [];

  for (const note of notes) {
    // 1. Quantize timing
    const snappedStart = snapToGrid(note.startMs, gridMs);
    let snappedEnd = snapToGrid(note.endMs, gridMs);
    // Ensure minimum duration of one grid unit
    if (snappedEnd - snappedStart < gridMs) {
      snappedEnd = snappedStart + gridMs;
    }

    const wasQuantized =
      snappedStart !== note.startMs || snappedEnd !== note.endMs;

    // 2. Pitch correction
    const currentSemitone = NOTE_TO_SEMITONE[note.noteName] ?? 0;
    const correctedSemitone = nearestScaleDegree(currentSemitone, scale);
    const correctedNoteName = SEMITONE_TO_NOTE[correctedSemitone];
    const wasPitchCorrected = correctedNoteName !== note.noteName;

    // Adjust octave if pitch correction wraps around
    let correctedOctave = note.octave;
    if (wasPitchCorrected) {
      const diff = correctedSemitone - currentSemitone;
      // If we corrected upward past B→C, increment octave
      if (diff < -6) correctedOctave += 1;
      // If we corrected downward past C→B, decrement octave
      if (diff > 6) correctedOctave -= 1;
    }

    // Skip notes that are too short even after quantization
    if (snappedEnd - snappedStart < minDurationMs) continue;

    corrected.push({
      id: uid(),
      noteName: correctedNoteName,
      octave: correctedOctave,
      frequency: note.frequency,
      cents: wasPitchCorrected ? 0 : note.cents,
      confidence: note.confidence,
      startMs: snappedStart,
      endMs: snappedEnd,
      originalNoteName: note.noteName,
      originalOctave: note.octave,
      originalStartMs: note.startMs,
      originalEndMs: note.endMs,
      wasQuantized,
      wasPitchCorrected,
    });
  }

  return corrected;
}

/** A single sustained note event, merged from consecutive raw pitch polls. */
export interface RecordedNote {
  id: string;
  noteName: string;       // English chromatic: "C", "C#", "D", ...
  octave: number;
  frequency: number;      // average Hz during this note
  cents: number;          // average cent deviation
  confidence: number;     // average confidence
  startMs: number;        // ms from session start
  endMs: number;          // ms from session start
}

/** A corrected version of a RecordedNote after quantization / pitch correction. */
export interface CorrectedNote extends RecordedNote {
  originalNoteName: string;
  originalOctave: number;
  originalStartMs: number;
  originalEndMs: number;
  wasQuantized: boolean;
  wasPitchCorrected: boolean;
}

/** A recorded session containing raw and (optionally) corrected notes. */
export interface Session {
  id: string;
  name: string;
  createdAt: number;          // epoch ms
  durationMs: number;
  notes: RecordedNote[];
  correctedNotes: CorrectedNote[] | null;
  bpm: number | null;         // detected or user-set BPM
  key: string | null;         // user-set musical key, e.g. "C major"
}

/** Summary used in session lists (without full note data). */
export interface SessionSummary {
  id: string;
  name: string;
  createdAt: number;
  durationMs: number;
  noteCount: number;
}

/** A notation system mapping English note names to display names. */
export interface NotationPreset {
  id: string;
  name: string;
  isBuiltIn: boolean;
  /** Maps each of the 12 chromatic note names to a display name. */
  noteMap: Record<string, string>;
}

export interface PitchResult {
  frequency: number;   // Hz, e.g. 440.0
  noteName: string;    // e.g. "A"
  octave: number;      // e.g. 4
  fullName: string;    // e.g. "A4"
  cents: number;       // -50 to +50
  confidence: number;  // 0.0 to 1.0
  timestamp: number;   // ms (native monotonic clock)
}

// One time-window in a note roadmap
export interface RoadmapSegment {
  startSec:   number;   // window start (seconds from file start)
  endSec:     number;   // window end
  noteName:   string;   // e.g. "C" — empty string when hasNote is false
  octave:     number;   // e.g. 4   — 0 when hasNote is false
  fullName:   string;   // e.g. "C4" — empty string when hasNote is false
  confidence: number;   // 0–1, fraction of frames agreeing on this note
  hasNote:    boolean;  // false = silent / no confident pitch detected
}

export interface RoadmapResult {
  segments:      RoadmapSegment[];
  dominantNote:  string;  // "C4" — highest confidence note across whole file
  totalDuration: number;  // seconds of audio actually processed
}

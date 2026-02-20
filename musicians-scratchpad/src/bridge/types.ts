export interface PitchResult {
  frequency: number;   // Hz, e.g. 440.0
  noteName: string;    // e.g. "A"
  octave: number;      // e.g. 4
  fullName: string;    // e.g. "A4"
  cents: number;       // -50 to +50
  confidence: number;  // 0.0 to 1.0
  timestamp: number;   // ms (native monotonic clock)
}

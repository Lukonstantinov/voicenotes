import { analyzeSession, detectBPM } from '../sessionAnalysis';
import type { RecordedNote } from '../sessionTypes';

function makeNote(
  noteName: string,
  octave: number,
  startMs: number,
  endMs: number,
): RecordedNote {
  return {
    id: `note-${startMs}`,
    noteName,
    octave,
    frequency: 440,
    cents: 0,
    confidence: 0.95,
    startMs,
    endMs,
  };
}

describe('analyzeSession', () => {
  describe('quantization', () => {
    it('snaps note start and end to the 16th-note grid', () => {
      // At 120 BPM, a 16th note = 125ms
      const notes = [makeNote('C', 4, 10, 260)];
      const result = analyzeSession(notes, 120, 'C major');

      expect(result).toHaveLength(1);
      expect(result[0].startMs).toBe(0);   // 10 → 0 (nearest grid)
      expect(result[0].endMs).toBe(250);   // 260 → 250
      expect(result[0].wasQuantized).toBe(true);
    });

    it('ensures minimum duration of one grid unit', () => {
      // Note is very short: 10ms
      const notes = [makeNote('C', 4, 100, 110)];
      const result = analyzeSession(notes, 120, 'C major');

      expect(result).toHaveLength(1);
      // Both snap to 125; then endMs gets extended to startMs + gridMs
      expect(result[0].endMs - result[0].startMs).toBeGreaterThanOrEqual(125);
    });

    it('does not mark as quantized when already on grid', () => {
      // 120 BPM → grid = 125ms. Note at 0→250 is already on grid.
      const notes = [makeNote('C', 4, 0, 250)];
      const result = analyzeSession(notes, 120, 'C major');

      expect(result[0].wasQuantized).toBe(false);
    });
  });

  describe('pitch correction', () => {
    it('corrects C# to C in C major', () => {
      const notes = [makeNote('C#', 4, 0, 500)];
      const result = analyzeSession(notes, 120, 'C major');

      expect(result[0].noteName).toBe('C');
      expect(result[0].wasPitchCorrected).toBe(true);
      expect(result[0].originalNoteName).toBe('C#');
    });

    it('corrects D# to D in C major (closer to D than E)', () => {
      const notes = [makeNote('D#', 4, 0, 500)];
      const result = analyzeSession(notes, 120, 'C major');

      // D# (semitone 3) is between D (2) and E (4) — both are 1 semitone away.
      // nearestScaleDegree prefers below, so D.
      expect(result[0].noteName).toBe('D');
      expect(result[0].wasPitchCorrected).toBe(true);
    });

    it('leaves diatonic notes unchanged in C major', () => {
      const cMajor = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
      for (const noteName of cMajor) {
        const notes = [makeNote(noteName, 4, 0, 500)];
        const result = analyzeSession(notes, 120, 'C major');
        expect(result[0].noteName).toBe(noteName);
        expect(result[0].wasPitchCorrected).toBe(false);
      }
    });

    it('corrects to A minor scale', () => {
      // A minor: A B C D E F G
      // G# is not in A minor, nearest is G (below) or A (above), both 1 away → prefer below
      const notes = [makeNote('G#', 4, 0, 500)];
      const result = analyzeSession(notes, 120, 'A minor');
      expect(result[0].noteName).toBe('G');
      expect(result[0].wasPitchCorrected).toBe(true);
    });

    it('preserves original fields', () => {
      const notes = [makeNote('C#', 4, 10, 260)];
      const result = analyzeSession(notes, 120, 'C major');

      expect(result[0].originalNoteName).toBe('C#');
      expect(result[0].originalStartMs).toBe(10);
      expect(result[0].originalEndMs).toBe(260);
    });
  });
});

describe('detectBPM', () => {
  it('returns null for fewer than 4 notes', () => {
    const notes = [
      makeNote('C', 4, 0, 500),
      makeNote('D', 4, 500, 1000),
    ];
    expect(detectBPM(notes)).toBeNull();
  });

  it('detects 120 BPM from evenly spaced notes', () => {
    // 120 BPM = 500ms per beat
    const notes = Array.from({ length: 8 }, (_, i) =>
      makeNote('C', 4, i * 500, i * 500 + 400),
    );
    const bpm = detectBPM(notes);
    expect(bpm).not.toBeNull();
    // Should be close to 120, allow ±10 for bucket rounding
    expect(bpm!).toBeGreaterThanOrEqual(110);
    expect(bpm!).toBeLessThanOrEqual(130);
  });

  it('detects 60 BPM from evenly spaced notes', () => {
    // 60 BPM = 1000ms per beat
    const notes = Array.from({ length: 6 }, (_, i) =>
      makeNote('A', 4, i * 1000, i * 1000 + 800),
    );
    const bpm = detectBPM(notes);
    expect(bpm).not.toBeNull();
    expect(bpm!).toBeGreaterThanOrEqual(55);
    expect(bpm!).toBeLessThanOrEqual(65);
  });
});

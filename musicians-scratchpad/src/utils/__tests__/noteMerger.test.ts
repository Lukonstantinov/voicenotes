import { createNoteMerger } from '../noteMerger';
import type { PitchResult } from '../../bridge/types';

function makePitch(
  noteName: string,
  octave: number,
  overrides: Partial<PitchResult> = {},
): PitchResult {
  return {
    frequency: 440,
    noteName,
    octave,
    fullName: `${noteName}${octave}`,
    cents: 0,
    confidence: 0.95,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('createNoteMerger', () => {
  it('merges consecutive same-note polls into one RecordedNote', () => {
    const merger = createNoteMerger();
    const pitch = makePitch('A', 4);

    merger.push(pitch, 0);
    merger.push(pitch, 33);
    merger.push(pitch, 66);
    merger.push(pitch, 100);
    merger.flush();

    const notes = merger.getNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].noteName).toBe('A');
    expect(notes[0].octave).toBe(4);
    expect(notes[0].startMs).toBe(0);
    expect(notes[0].endMs).toBe(100);
  });

  it('creates separate notes when the pitch changes', () => {
    const merger = createNoteMerger();

    merger.push(makePitch('A', 4), 0);
    merger.push(makePitch('A', 4), 33);
    merger.push(makePitch('A', 4), 66);
    merger.push(makePitch('B', 4), 100);
    merger.push(makePitch('B', 4), 133);
    merger.push(makePitch('B', 4), 166);
    merger.flush();

    const notes = merger.getNotes();
    expect(notes).toHaveLength(2);
    expect(notes[0].noteName).toBe('A');
    expect(notes[0].startMs).toBe(0);
    expect(notes[0].endMs).toBe(66);
    expect(notes[1].noteName).toBe('B');
    expect(notes[1].startMs).toBe(100);
    expect(notes[1].endMs).toBe(166);
  });

  it('closes a note after silence gap', () => {
    const merger = createNoteMerger();

    merger.push(makePitch('C', 4), 0);
    merger.push(makePitch('C', 4), 33);
    merger.push(makePitch('C', 4), 66);
    // Silence for 200ms
    merger.push(null, 100);
    merger.push(null, 200);
    merger.push(null, 300);
    // New note after silence
    merger.push(makePitch('D', 4), 400);
    merger.push(makePitch('D', 4), 433);
    merger.push(makePitch('D', 4), 466);
    merger.flush();

    const notes = merger.getNotes();
    expect(notes).toHaveLength(2);
    expect(notes[0].noteName).toBe('C');
    expect(notes[1].noteName).toBe('D');
  });

  it('discards very short notes (noise)', () => {
    const merger = createNoteMerger();

    // A note lasting only 30ms (below the 50ms minimum)
    merger.push(makePitch('E', 3), 0);
    merger.push(makePitch('E', 3), 30);
    // Different note
    merger.push(makePitch('F', 3), 31);
    merger.push(makePitch('F', 3), 130);
    merger.flush();

    const notes = merger.getNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].noteName).toBe('F');
  });

  it('averages frequency, cents, and confidence', () => {
    const merger = createNoteMerger();

    merger.push(makePitch('A', 4, { frequency: 438, cents: -8, confidence: 0.9 }), 0);
    merger.push(makePitch('A', 4, { frequency: 440, cents: 0, confidence: 1.0 }), 50);
    merger.push(makePitch('A', 4, { frequency: 442, cents: 8, confidence: 0.8 }), 100);
    merger.flush();

    const notes = merger.getNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].frequency).toBe(440);
    expect(notes[0].cents).toBe(0);
    expect(notes[0].confidence).toBe(0.9);
  });

  it('returns empty array when no pitch data is pushed', () => {
    const merger = createNoteMerger();
    merger.push(null, 0);
    merger.push(null, 100);
    merger.flush();
    expect(merger.getNotes()).toHaveLength(0);
  });

  it('handles octave change as a different note', () => {
    const merger = createNoteMerger();

    merger.push(makePitch('A', 4), 0);
    merger.push(makePitch('A', 4), 66);
    merger.push(makePitch('A', 3), 100);
    merger.push(makePitch('A', 3), 200);
    merger.flush();

    const notes = merger.getNotes();
    expect(notes).toHaveLength(2);
    expect(notes[0].octave).toBe(4);
    expect(notes[1].octave).toBe(3);
  });
});

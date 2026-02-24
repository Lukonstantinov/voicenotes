import { frequencyToNote } from '../pitchUtils';

describe('frequencyToNote', () => {
  it('returns A4 for 440.000 Hz', () => {
    const result = frequencyToNote(440.0);
    expect(result).not.toBeNull();
    expect(result!.noteName).toBe('A');
    expect(result!.octave).toBe(4);
    expect(result!.cents).toBe(0);
    expect(result!.fullName).toBe('A4');
  });

  it('returns A3 for 220.000 Hz', () => {
    const result = frequencyToNote(220.0);
    expect(result).not.toBeNull();
    expect(result!.noteName).toBe('A');
    expect(result!.octave).toBe(3);
    expect(result!.cents).toBe(0);
    expect(result!.fullName).toBe('A3');
  });

  it('returns C4 for 261.626 Hz', () => {
    const result = frequencyToNote(261.626);
    expect(result).not.toBeNull();
    expect(result!.noteName).toBe('C');
    expect(result!.octave).toBe(4);
    expect(result!.cents).toBe(0);
    expect(result!.fullName).toBe('C4');
  });

  it('returns E2 for 82.407 Hz', () => {
    const result = frequencyToNote(82.407);
    expect(result).not.toBeNull();
    expect(result!.noteName).toBe('E');
    expect(result!.octave).toBe(2);
    expect(result!.cents).toBe(0);
    expect(result!.fullName).toBe('E2');
  });

  it('returns B4 for 493.883 Hz', () => {
    const result = frequencyToNote(493.883);
    expect(result).not.toBeNull();
    expect(result!.noteName).toBe('B');
    expect(result!.octave).toBe(4);
    expect(result!.cents).toBe(0);
    expect(result!.fullName).toBe('B4');
  });

  it('returns A4 with ~20 cents for 445.000 Hz', () => {
    const result = frequencyToNote(445.0);
    expect(result).not.toBeNull();
    expect(result!.noteName).toBe('A');
    expect(result!.octave).toBe(4);
    expect(result!.cents).toBeGreaterThanOrEqual(19);
    expect(result!.cents).toBeLessThanOrEqual(21);
    expect(result!.fullName).toBe('A4');
  });

  it('returns C3 for 130.813 Hz', () => {
    const result = frequencyToNote(130.813);
    expect(result).not.toBeNull();
    expect(result!.noteName).toBe('C');
    expect(result!.octave).toBe(3);
    expect(result!.cents).toBe(0);
    expect(result!.fullName).toBe('C3');
  });

  it('returns null for 0 Hz', () => {
    expect(frequencyToNote(0)).toBeNull();
  });

  it('returns null for negative frequency (-100 Hz)', () => {
    expect(frequencyToNote(-100)).toBeNull();
  });

  it('returns A4 at 0 cents when a4=442 and freq=442', () => {
    const result = frequencyToNote(442, 442);
    expect(result).not.toBeNull();
    expect(result!.noteName).toBe('A');
    expect(result!.octave).toBe(4);
    expect(result!.cents).toBe(0);
  });

  it('shows negative cents for 440 Hz when a4=442', () => {
    const result = frequencyToNote(440, 442);
    expect(result).not.toBeNull();
    expect(result!.noteName).toBe('A');
    expect(result!.octave).toBe(4);
    expect(result!.cents).toBeLessThan(0);
  });

  it('uses default a4=440 when not specified', () => {
    const withDefault = frequencyToNote(440);
    const withExplicit = frequencyToNote(440, 440);
    expect(withDefault).toEqual(withExplicit);
  });
});

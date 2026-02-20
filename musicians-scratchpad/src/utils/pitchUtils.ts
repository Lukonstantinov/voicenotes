const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const A4 = 440.0;

export interface NoteResult {
  noteName: string;
  octave: number;
  cents: number;
  fullName: string;
}

export function frequencyToNote(frequency: number): NoteResult | null {
  if (frequency <= 0 || frequency < 20 || frequency > 5000) return null;

  const noteNumber = 12 * Math.log2(frequency / A4) + 69;
  const nearestMidi = Math.round(noteNumber);
  const nearestFreq = A4 * Math.pow(2, (nearestMidi - 69) / 12);
  const cents = Math.round(1200 * Math.log2(frequency / nearestFreq)) || 0;
  const noteName = NOTE_NAMES[((nearestMidi % 12) + 12) % 12];
  const octave = Math.floor(nearestMidi / 12) - 1;

  return { noteName, octave, cents, fullName: `${noteName}${octave}` };
}

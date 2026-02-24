/** 12-colour palette keyed by chromatic note name. */
export const NOTE_COLORS: Record<string, string> = {
  'C':  '#e74c3c',
  'C#': '#e67e22',
  'D':  '#f1c40f',
  'D#': '#2ecc71',
  'E':  '#1abc9c',
  'F':  '#3498db',
  'F#': '#2980b9',
  'G':  '#9b59b6',
  'G#': '#8e44ad',
  'A':  '#e84393',
  'A#': '#fd79a8',
  'B':  '#636e72',
};

/** Get the color for a note name, with a fallback for unknown notes. */
export function getNoteColor(noteName: string): string {
  return NOTE_COLORS[noteName] ?? '#999';
}

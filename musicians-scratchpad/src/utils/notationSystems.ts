import type { NotationPreset } from './sessionTypes';

/** The 12 chromatic note names in English (canonical key set). */
export const CHROMATIC_NOTES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

// ── Built-in presets ────────────────────────────────────────────────────────

export const ENGLISH_PRESET: NotationPreset = {
  id: 'english',
  name: 'English',
  isBuiltIn: true,
  noteMap: {
    'C': 'C', 'C#': 'C#', 'D': 'D', 'D#': 'D#', 'E': 'E', 'F': 'F',
    'F#': 'F#', 'G': 'G', 'G#': 'G#', 'A': 'A', 'A#': 'A#', 'B': 'B',
  },
};

export const SOLFEGE_PRESET: NotationPreset = {
  id: 'solfege',
  name: 'Solfège',
  isBuiltIn: true,
  noteMap: {
    'C': 'Do', 'C#': 'Do#', 'D': 'Re', 'D#': 'Re#', 'E': 'Mi', 'F': 'Fa',
    'F#': 'Fa#', 'G': 'Sol', 'G#': 'Sol#', 'A': 'La', 'A#': 'La#', 'B': 'Si',
  },
};

export const GERMAN_PRESET: NotationPreset = {
  id: 'german',
  name: 'German',
  isBuiltIn: true,
  noteMap: {
    'C': 'C', 'C#': 'Cis', 'D': 'D', 'D#': 'Dis', 'E': 'E', 'F': 'F',
    'F#': 'Fis', 'G': 'G', 'G#': 'Gis', 'A': 'A', 'A#': 'Ais', 'B': 'H',
  },
};

export const BUILT_IN_PRESETS: NotationPreset[] = [
  ENGLISH_PRESET,
  SOLFEGE_PRESET,
  GERMAN_PRESET,
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Translate an English note name using a notation preset. */
export function translateNote(noteName: string, preset: NotationPreset): string {
  return preset.noteMap[noteName] ?? noteName;
}

/** Create a blank custom preset with English names as defaults. */
export function createBlankCustomPreset(id: string, name: string): NotationPreset {
  return {
    id,
    name,
    isBuiltIn: false,
    noteMap: { ...ENGLISH_PRESET.noteMap },
  };
}

/** Validate that a noteMap has all 12 chromatic entries and no empty values. */
export function isValidNoteMap(noteMap: Record<string, string>): boolean {
  return CHROMATIC_NOTES.every(
    (note) => typeof noteMap[note] === 'string' && noteMap[note].trim().length > 0,
  );
}

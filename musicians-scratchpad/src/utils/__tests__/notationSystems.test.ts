import {
  translateNote,
  isValidNoteMap,
  createBlankCustomPreset,
  ENGLISH_PRESET,
  SOLFEGE_PRESET,
  GERMAN_PRESET,
  CHROMATIC_NOTES,
} from '../notationSystems';

describe('translateNote', () => {
  it('returns the same name for English preset', () => {
    expect(translateNote('A', ENGLISH_PRESET)).toBe('A');
    expect(translateNote('C#', ENGLISH_PRESET)).toBe('C#');
  });

  it('translates to solfege', () => {
    expect(translateNote('C', SOLFEGE_PRESET)).toBe('Do');
    expect(translateNote('D', SOLFEGE_PRESET)).toBe('Re');
    expect(translateNote('E', SOLFEGE_PRESET)).toBe('Mi');
    expect(translateNote('F', SOLFEGE_PRESET)).toBe('Fa');
    expect(translateNote('G', SOLFEGE_PRESET)).toBe('Sol');
    expect(translateNote('A', SOLFEGE_PRESET)).toBe('La');
    expect(translateNote('B', SOLFEGE_PRESET)).toBe('Si');
    expect(translateNote('F#', SOLFEGE_PRESET)).toBe('Fa#');
  });

  it('translates to German notation', () => {
    expect(translateNote('B', GERMAN_PRESET)).toBe('H');
    expect(translateNote('A#', GERMAN_PRESET)).toBe('Ais');
    expect(translateNote('F#', GERMAN_PRESET)).toBe('Fis');
  });

  it('returns the original name if not found in preset', () => {
    expect(translateNote('Cb', ENGLISH_PRESET)).toBe('Cb');
  });
});

describe('isValidNoteMap', () => {
  it('returns true for all built-in presets', () => {
    expect(isValidNoteMap(ENGLISH_PRESET.noteMap)).toBe(true);
    expect(isValidNoteMap(SOLFEGE_PRESET.noteMap)).toBe(true);
    expect(isValidNoteMap(GERMAN_PRESET.noteMap)).toBe(true);
  });

  it('returns false if a note is missing', () => {
    const incomplete = { ...ENGLISH_PRESET.noteMap };
    delete (incomplete as Record<string, string>)['C'];
    expect(isValidNoteMap(incomplete)).toBe(false);
  });

  it('returns false if a note value is empty', () => {
    const empty = { ...ENGLISH_PRESET.noteMap, 'C': '  ' };
    expect(isValidNoteMap(empty)).toBe(false);
  });
});

describe('createBlankCustomPreset', () => {
  it('creates a preset with English defaults', () => {
    const preset = createBlankCustomPreset('test', 'Test');
    expect(preset.id).toBe('test');
    expect(preset.name).toBe('Test');
    expect(preset.isBuiltIn).toBe(false);
    for (const note of CHROMATIC_NOTES) {
      expect(preset.noteMap[note]).toBe(note);
    }
  });
});

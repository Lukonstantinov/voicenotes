import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotationPreset } from './sessionTypes';
import { BUILT_IN_PRESETS, ENGLISH_PRESET } from './notationSystems';

const ACTIVE_PRESET_KEY   = 'settings_active_notation';
const CUSTOM_PRESETS_KEY  = 'settings_custom_presets';
const MIC_SENSITIVITY_KEY = 'settings_mic_sensitivity';

// ── Mic Sensitivity ────────────────────────────────────────────────────────

export type SensitivityLevel = 'low' | 'medium' | 'high';

export interface SensitivityConfig {
  silenceDb: number;
  confidenceEnter: number;
  confidenceExit: number;
  label: string;
  description: string;
}

export const SENSITIVITY_CONFIGS: Record<SensitivityLevel, SensitivityConfig> = {
  low: {
    silenceDb: -38, confidenceEnter: 0.88, confidenceExit: 0.78,
    label: 'Low',
    description: 'Precise — ignores quiet sounds, fewer false detections',
  },
  medium: {
    silenceDb: -50, confidenceEnter: 0.80, confidenceExit: 0.70,
    label: 'Medium',
    description: 'Balanced — recommended for most environments',
  },
  high: {
    silenceDb: -60, confidenceEnter: 0.72, confidenceExit: 0.62,
    label: 'High',
    description: 'Sensitive — picks up very quiet or distant sounds',
  },
};

export async function getMicSensitivity(): Promise<SensitivityLevel> {
  const val = await AsyncStorage.getItem(MIC_SENSITIVITY_KEY);
  return (val as SensitivityLevel) ?? 'medium';
}

export async function setMicSensitivity(level: SensitivityLevel): Promise<void> {
  await AsyncStorage.setItem(MIC_SENSITIVITY_KEY, level);
}

/** Get the active notation preset (defaults to English). */
export async function getActivePreset(): Promise<NotationPreset> {
  const id = await AsyncStorage.getItem(ACTIVE_PRESET_KEY);
  if (!id) return ENGLISH_PRESET;

  const builtIn = BUILT_IN_PRESETS.find((p) => p.id === id);
  if (builtIn) return builtIn;

  const customs = await getCustomPresets();
  return customs.find((p) => p.id === id) ?? ENGLISH_PRESET;
}

/** Set the active notation preset by ID. */
export async function setActivePreset(id: string): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_PRESET_KEY, id);
}

/** Get all custom (user-created) notation presets. */
export async function getCustomPresets(): Promise<NotationPreset[]> {
  const raw = await AsyncStorage.getItem(CUSTOM_PRESETS_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as NotationPreset[];
}

/** Save a custom notation preset (insert or update). */
export async function saveCustomPreset(preset: NotationPreset): Promise<void> {
  const customs = await getCustomPresets();
  const idx = customs.findIndex((p) => p.id === preset.id);
  if (idx >= 0) {
    customs[idx] = preset;
  } else {
    customs.push(preset);
  }
  await AsyncStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(customs));
}

/** Delete a custom notation preset. */
export async function deleteCustomPreset(id: string): Promise<void> {
  const customs = await getCustomPresets();
  const filtered = customs.filter((p) => p.id !== id);
  await AsyncStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(filtered));

  // If the deleted preset was active, reset to English
  const activeId = await AsyncStorage.getItem(ACTIVE_PRESET_KEY);
  if (activeId === id) {
    await setActivePreset(ENGLISH_PRESET.id);
  }
}

/** Get all available presets (built-in + custom). */
export async function getAllPresets(): Promise<NotationPreset[]> {
  const customs = await getCustomPresets();
  return [...BUILT_IN_PRESETS, ...customs];
}

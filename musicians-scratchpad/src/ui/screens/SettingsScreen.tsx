import React, { useState, useCallback, useEffect } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NotationPreset } from '../../utils/sessionTypes';
import {
  CHROMATIC_NOTES,
  BUILT_IN_PRESETS,
  isValidNoteMap,
  createBlankCustomPreset,
} from '../../utils/notationSystems';
import {
  getAllPresets,
  getActivePreset,
  setActivePreset,
  saveCustomPreset,
  deleteCustomPreset,
  getMicSensitivity,
  setMicSensitivity,
  getA4Calibration,
  setA4Calibration as saveA4Calibration,
  SENSITIVITY_CONFIGS,
  A4_DEFAULT,
  A4_MIN,
  A4_MAX,
} from '../../utils/settingsStorage';
import type { SensitivityLevel } from '../../utils/settingsStorage';
import AudioPitchModule from '../../bridge/NativeAudioPitchModule';
import { uid } from '../../utils/uid';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  onBack: () => void;
}

export function SettingsScreen({ onBack }: Props) {
  const { colors } = useTheme();
  const [presets, setPresets] = useState<NotationPreset[]>(BUILT_IN_PRESETS);
  const [activeId, setActiveId] = useState('english');
  const [editingPreset, setEditingPreset] = useState<NotationPreset | null>(null);
  const [sensitivity, setSensitivity] = useState<SensitivityLevel>('medium');
  const [a4Hz, setA4Hz] = useState(A4_DEFAULT);

  const refresh = useCallback(async () => {
    const all = await getAllPresets();
    setPresets(all);
    const active = await getActivePreset();
    setActiveId(active.id);
  }, []);

  useEffect(() => {
    refresh();
    getMicSensitivity().then(setSensitivity);
    getA4Calibration().then(setA4Hz);
  }, [refresh]);

  const handleSensitivity = useCallback(async (level: SensitivityLevel) => {
    setSensitivity(level);
    await setMicSensitivity(level);
    const cfg = SENSITIVITY_CONFIGS[level];
    AudioPitchModule.setSensitivity(cfg.silenceDb, cfg.confidenceEnter, cfg.confidenceExit);
  }, []);

  const handleA4Change = useCallback(async (hz: number) => {
    const clamped = Math.round(Math.max(A4_MIN, Math.min(A4_MAX, hz)));
    setA4Hz(clamped);
    await saveA4Calibration(clamped);
    AudioPitchModule.setA4Calibration(clamped);
  }, []);

  const handleSelect = useCallback(async (id: string) => {
    await setActivePreset(id);
    setActiveId(id);
  }, []);

  const handleCreateCustom = useCallback(() => {
    const newId = `custom_${uid()}`;
    const preset = createBlankCustomPreset(newId, 'My Notation');
    setEditingPreset(preset);
  }, []);

  const handleEditCustom = useCallback((preset: NotationPreset) => {
    setEditingPreset({ ...preset, noteMap: { ...preset.noteMap } });
  }, []);

  const handleDeleteCustom = useCallback((id: string, name: string) => {
    Alert.alert('Delete Preset', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteCustomPreset(id);
          refresh();
        },
      },
    ]);
  }, [refresh]);

  const handleSaveEdit = useCallback(async () => {
    if (!editingPreset) return;
    if (!isValidNoteMap(editingPreset.noteMap)) {
      Alert.alert('Invalid', 'All 12 note names must be filled in.');
      return;
    }
    await saveCustomPreset(editingPreset);
    setEditingPreset(null);
    refresh();
  }, [editingPreset, refresh]);

  const updateEditNote = useCallback((chromaticNote: string, value: string) => {
    setEditingPreset((prev) => {
      if (!prev) return prev;
      return { ...prev, noteMap: { ...prev.noteMap, [chromaticNote]: value } };
    });
  }, []);

  const updateEditName = useCallback((name: string) => {
    setEditingPreset((prev) => prev ? { ...prev, name } : prev);
  }, []);

  // ── Editor mode ────────────────────────────────────────────────────────────
  if (editingPreset) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setEditingPreset(null)}>
            <Text style={[styles.cancelText, { color: colors.accentDanger }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Edit Notation</Text>
          <TouchableOpacity onPress={handleSaveEdit}>
            <Text style={[styles.saveText, { color: colors.accentSuccess }]}>Save</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.nameRow}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Name:</Text>
          <TextInput
            style={[styles.nameInput, { borderColor: colors.border, color: colors.text }]}
            value={editingPreset.name}
            onChangeText={updateEditName}
            placeholder="Preset name"
            placeholderTextColor={colors.textPlaceholder}
          />
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {CHROMATIC_NOTES.map((note) => (
            <View key={note} style={[styles.noteEditRow, { borderBottomColor: colors.borderLight }]}>
              <Text style={[styles.noteOriginal, { color: colors.textMuted }]}>{note}</Text>
              <TextInput
                style={[styles.noteInput, { borderColor: colors.border, color: colors.text }]}
                value={editingPreset.noteMap[note]}
                onChangeText={(v) => updateEditNote(note, v)}
                placeholder={note}
                placeholderTextColor={colors.textPlaceholder}
              />
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Preset list mode ──────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={[styles.backText, { color: colors.accent }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Notation Settings</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Mic Sensitivity</Text>
        <View style={styles.sensitivityRow}>
          {(['low', 'medium', 'high'] as SensitivityLevel[]).map((level) => {
            const cfg = SENSITIVITY_CONFIGS[level];
            const active = sensitivity === level;
            return (
              <TouchableOpacity
                key={level}
                style={[
                  styles.sensitivityBtn,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                  active && { borderColor: colors.text, backgroundColor: colors.text },
                ]}
                onPress={() => handleSensitivity(level)}
              >
                <Text style={[styles.sensitivityLabel, { color: colors.textSecondary }, active && { color: colors.background }]}>
                  {cfg.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.sensitivityDesc, { color: colors.textMuted }]}>
          {SENSITIVITY_CONFIGS[sensitivity].description}
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>A4 Reference Pitch</Text>
        <View style={styles.a4Row}>
          <TouchableOpacity
            style={[styles.a4StepBtn, { borderColor: colors.text }]}
            onPress={() => handleA4Change(a4Hz - 1)}
          >
            <Text style={[styles.a4StepLabel, { color: colors.text }]}>-</Text>
          </TouchableOpacity>
          <Text style={[styles.a4Value, { color: colors.text }]}>{a4Hz} Hz</Text>
          <TouchableOpacity
            style={[styles.a4StepBtn, { borderColor: colors.text }]}
            onPress={() => handleA4Change(a4Hz + 1)}
          >
            <Text style={[styles.a4StepLabel, { color: colors.text }]}>+</Text>
          </TouchableOpacity>
        </View>
        {a4Hz !== A4_DEFAULT && (
          <TouchableOpacity onPress={() => handleA4Change(A4_DEFAULT)}>
            <Text style={[styles.a4Reset, { color: colors.accent }]}>Reset to {A4_DEFAULT} Hz</Text>
          </TouchableOpacity>
        )}
        <Text style={[styles.sensitivityDesc, { color: colors.textMuted }]}>
          Standard concert pitch is 440 Hz. Baroque tuning often uses 415 Hz.
          Range: {A4_MIN}–{A4_MAX} Hz.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Notation System</Text>

        {presets.map((preset) => (
          <TouchableOpacity
            key={preset.id}
            style={[
              styles.presetItem,
              { backgroundColor: colors.surface, borderColor: colors.borderLight },
              activeId === preset.id && { borderColor: colors.text, backgroundColor: colors.surfaceAlt },
            ]}
            onPress={() => handleSelect(preset.id)}
            onLongPress={
              !preset.isBuiltIn
                ? () => handleDeleteCustom(preset.id, preset.name)
                : undefined
            }
          >
            <View style={styles.presetMain}>
              <Text
                style={[
                  styles.presetName,
                  { color: colors.textSecondary },
                  activeId === preset.id && { color: colors.text },
                ]}
              >
                {preset.name}
              </Text>
              <Text style={[styles.presetPreview, { color: colors.textMuted }]}>
                {CHROMATIC_NOTES.slice(0, 7)
                  .map((n) => preset.noteMap[n])
                  .join(' ')}
              </Text>
            </View>
            {!preset.isBuiltIn && (
              <TouchableOpacity onPress={() => handleEditCustom(preset)}>
                <Text style={[styles.editText, { color: colors.accent }]}>Edit</Text>
              </TouchableOpacity>
            )}
            {activeId === preset.id && <Text style={[styles.check, { color: colors.text }]}>✓</Text>}
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={[styles.addBtn, { borderColor: colors.border }]} onPress={handleCreateCustom}>
          <Text style={[styles.addBtnText, { color: colors.accent }]}>+ Create Custom Notation</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  backText: {
    fontSize: 15,
    fontWeight: '500',
    width: 50,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '500',
    width: 50,
  },
  saveText: {
    fontSize: 15,
    fontWeight: '700',
    width: 50,
    textAlign: 'right',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 8,
  },
  presetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
  },
  presetMain: {
    flex: 1,
  },
  presetName: {
    fontSize: 15,
    fontWeight: '600',
  },
  presetPreview: {
    fontSize: 12,
    marginTop: 2,
  },
  editText: {
    fontSize: 13,
    fontWeight: '500',
    marginRight: 8,
  },
  check: {
    fontSize: 18,
    fontWeight: '700',
  },
  addBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Editor styles
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  label: {
    fontSize: 14,
    marginRight: 8,
  },
  nameInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 15,
  },
  noteEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noteOriginal: {
    width: 40,
    fontSize: 15,
    fontWeight: '600',
  },
  noteInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 15,
  },
  // Sensitivity picker
  sensitivityRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  sensitivityBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  sensitivityLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  sensitivityDesc: {
    fontSize: 12,
    marginBottom: 16,
    lineHeight: 17,
  },
  // A4 calibration
  a4Row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 8,
  },
  a4StepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  a4StepLabel: {
    fontSize: 20,
    fontWeight: '700',
  },
  a4Value: {
    fontSize: 24,
    fontWeight: '700',
    minWidth: 90,
    textAlign: 'center',
  },
  a4Reset: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 4,
  },
});

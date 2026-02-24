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

interface Props {
  onBack: () => void;
}

export function SettingsScreen({ onBack }: Props) {
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
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setEditingPreset(null)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Edit Notation</Text>
          <TouchableOpacity onPress={handleSaveEdit}>
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.nameRow}>
          <Text style={styles.label}>Name:</Text>
          <TextInput
            style={styles.nameInput}
            value={editingPreset.name}
            onChangeText={updateEditName}
            placeholder="Preset name"
            placeholderTextColor="#aaa"
          />
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {CHROMATIC_NOTES.map((note) => (
            <View key={note} style={styles.noteEditRow}>
              <Text style={styles.noteOriginal}>{note}</Text>
              <TextInput
                style={styles.noteInput}
                value={editingPreset.noteMap[note]}
                onChangeText={(v) => updateEditNote(note, v)}
                placeholder={note}
                placeholderTextColor="#ccc"
              />
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Preset list mode ──────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Notation Settings</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <Text style={styles.sectionTitle}>Mic Sensitivity</Text>
        <View style={styles.sensitivityRow}>
          {(['low', 'medium', 'high'] as SensitivityLevel[]).map((level) => {
            const cfg = SENSITIVITY_CONFIGS[level];
            const active = sensitivity === level;
            return (
              <TouchableOpacity
                key={level}
                style={[styles.sensitivityBtn, active && styles.sensitivityBtnActive]}
                onPress={() => handleSensitivity(level)}
              >
                <Text style={[styles.sensitivityLabel, active && styles.sensitivityLabelActive]}>
                  {cfg.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.sensitivityDesc}>
          {SENSITIVITY_CONFIGS[sensitivity].description}
        </Text>

        <Text style={styles.sectionTitle}>A4 Reference Pitch</Text>
        <View style={styles.a4Row}>
          <TouchableOpacity
            style={styles.a4StepBtn}
            onPress={() => handleA4Change(a4Hz - 1)}
          >
            <Text style={styles.a4StepLabel}>-</Text>
          </TouchableOpacity>
          <Text style={styles.a4Value}>{a4Hz} Hz</Text>
          <TouchableOpacity
            style={styles.a4StepBtn}
            onPress={() => handleA4Change(a4Hz + 1)}
          >
            <Text style={styles.a4StepLabel}>+</Text>
          </TouchableOpacity>
        </View>
        {a4Hz !== A4_DEFAULT && (
          <TouchableOpacity onPress={() => handleA4Change(A4_DEFAULT)}>
            <Text style={styles.a4Reset}>Reset to {A4_DEFAULT} Hz</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.sensitivityDesc}>
          Standard concert pitch is 440 Hz. Baroque tuning often uses 415 Hz.
          Range: {A4_MIN}–{A4_MAX} Hz.
        </Text>

        <Text style={styles.sectionTitle}>Notation System</Text>

        {presets.map((preset) => (
          <TouchableOpacity
            key={preset.id}
            style={[styles.presetItem, activeId === preset.id && styles.presetItemActive]}
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
                  activeId === preset.id && styles.presetNameActive,
                ]}
              >
                {preset.name}
              </Text>
              <Text style={styles.presetPreview}>
                {CHROMATIC_NOTES.slice(0, 7)
                  .map((n) => preset.noteMap[n])
                  .join(' ')}
              </Text>
            </View>
            {!preset.isBuiltIn && (
              <TouchableOpacity onPress={() => handleEditCustom(preset)}>
                <Text style={styles.editText}>Edit</Text>
              </TouchableOpacity>
            )}
            {activeId === preset.id && <Text style={styles.check}>✓</Text>}
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={styles.addBtn} onPress={handleCreateCustom}>
          <Text style={styles.addBtnText}>+ Create Custom Notation</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9f9f9',
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
    color: '#3498db',
    fontWeight: '500',
    width: 50,
  },
  cancelText: {
    fontSize: 15,
    color: '#e74c3c',
    fontWeight: '500',
    width: 50,
  },
  saveText: {
    fontSize: 15,
    color: '#27ae60',
    fontWeight: '700',
    width: 50,
    textAlign: 'right',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a2e',
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
    color: '#1a1a2e',
    marginTop: 12,
    marginBottom: 8,
  },
  presetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#eee',
  },
  presetItemActive: {
    borderColor: '#1a1a2e',
    backgroundColor: '#f0f0ff',
  },
  presetMain: {
    flex: 1,
  },
  presetName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  presetNameActive: {
    color: '#1a1a2e',
  },
  presetPreview: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  editText: {
    fontSize: 13,
    color: '#3498db',
    fontWeight: '500',
    marginRight: 8,
  },
  check: {
    fontSize: 18,
    color: '#1a1a2e',
    fontWeight: '700',
  },
  addBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    borderStyle: 'dashed',
  },
  addBtnText: {
    fontSize: 14,
    color: '#3498db',
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
    color: '#555',
    marginRight: 8,
  },
  nameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 15,
    color: '#1a1a2e',
  },
  noteEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  noteOriginal: {
    width: 40,
    fontSize: 15,
    fontWeight: '600',
    color: '#888',
  },
  noteInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 15,
    color: '#1a1a2e',
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
    borderColor: '#ddd',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  sensitivityBtnActive: {
    borderColor: '#1a1a2e',
    backgroundColor: '#1a1a2e',
  },
  sensitivityLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
  },
  sensitivityLabelActive: {
    color: '#fff',
  },
  sensitivityDesc: {
    fontSize: 12,
    color: '#888',
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
    borderColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  a4StepLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  a4Value: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a2e',
    minWidth: 90,
    textAlign: 'center',
  },
  a4Reset: {
    fontSize: 13,
    color: '#3498db',
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 4,
  },
});

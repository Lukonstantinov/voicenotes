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
} from '../../utils/settingsStorage';
import { uid } from '../../utils/uid';

interface Props {
  onBack: () => void;
}

export function SettingsScreen({ onBack }: Props) {
  const [presets, setPresets] = useState<NotationPreset[]>(BUILT_IN_PRESETS);
  const [activeId, setActiveId] = useState('english');
  const [editingPreset, setEditingPreset] = useState<NotationPreset | null>(null);

  const refresh = useCallback(async () => {
    const all = await getAllPresets();
    setPresets(all);
    const active = await getActivePreset();
    setActiveId(active.id);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
});

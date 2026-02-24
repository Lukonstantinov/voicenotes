import React, { useState, useCallback } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Session, NotationPreset } from '../../utils/sessionTypes';
import { analyzeSession } from '../../utils/sessionAnalysis';
import { saveSession } from '../../utils/sessionStorage';
import { translateNote } from '../../utils/notationSystems';
import { PianoRollTimeline } from '../components/PianoRollTimeline';
import { useTheme } from '../theme/ThemeContext';

const COMMON_KEYS = [
  'C major', 'G major', 'D major', 'A major', 'E major', 'B major',
  'F major', 'Bb major',
  'A minor', 'E minor', 'B minor', 'F# minor', 'C# minor',
  'D minor', 'G minor', 'C minor',
];

interface Props {
  session: Session;
  onBack: () => void;
  notation: NotationPreset;
}

export function SessionReviewScreen({ session: initialSession, onBack, notation }: Props) {
  const { colors } = useTheme();
  const [session, setSession] = useState(initialSession);
  const [showCorrected, setShowCorrected] = useState(false);
  const [bpmInput, setBpmInput] = useState(session.bpm?.toString() ?? '');
  const [selectedKey, setSelectedKey] = useState(session.key ?? 'C major');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleCorrect = useCallback(async () => {
    const bpm = parseInt(bpmInput, 10);
    if (!bpm || bpm < 20 || bpm > 300) {
      Alert.alert('Invalid BPM', 'Enter a BPM between 20 and 300.');
      return;
    }

    setIsAnalyzing(true);
    try {
      const correctedNotes = analyzeSession(session.notes, bpm, selectedKey);
      const updated: Session = {
        ...session,
        correctedNotes,
        bpm,
        key: selectedKey,
      };
      await saveSession(updated);
      setSession(updated);
      setShowCorrected(true);
    } finally {
      setIsAnalyzing(false);
    }
  }, [session, bpmInput, selectedKey]);

  const toggleView = useCallback(() => {
    setShowCorrected((prev) => !prev);
  }, []);

  const hasCorrected = session.correctedNotes != null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={[styles.backText, { color: colors.accent }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{session.name}</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Session info */}
      <View style={styles.info}>
        <Text style={[styles.infoText, { color: colors.textMuted }]}>
          {session.notes.length} notes | {formatDuration(session.durationMs)}
        </Text>
      </View>

      {/* Timeline */}
      <View style={styles.timeline}>
        <PianoRollTimeline
          notes={session.notes}
          correctedNotes={session.correctedNotes}
          showCorrected={showCorrected}
          durationMs={session.durationMs}
          notation={notation}
        />
      </View>

      {/* Toggle corrected/original */}
      {hasCorrected && (
        <TouchableOpacity style={[styles.toggleBtn, { backgroundColor: colors.text }]} onPress={toggleView}>
          <Text style={[styles.toggleText, { color: colors.background }]}>
            {showCorrected ? 'Show Original' : 'Show Corrected'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Correction controls */}
      <ScrollView style={styles.controls} contentContainerStyle={styles.controlsContent}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Correction Settings</Text>

        {/* BPM */}
        <View style={styles.row}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>BPM:</Text>
          <TextInput
            style={[styles.bpmInput, { borderColor: colors.border, color: colors.text }]}
            value={bpmInput}
            onChangeText={setBpmInput}
            keyboardType="numeric"
            placeholder="120"
            placeholderTextColor={colors.textPlaceholder}
          />
        </View>

        {/* Key selector */}
        <Text style={[styles.label, { color: colors.textSecondary }]}>Key:</Text>
        <View style={styles.keyGrid}>
          {COMMON_KEYS.map((k) => (
            <TouchableOpacity
              key={k}
              style={[styles.keyChip, { backgroundColor: colors.surface }, selectedKey === k && { backgroundColor: colors.text }]}
              onPress={() => setSelectedKey(k)}
            >
              <Text
                style={[styles.keyChipText, { color: colors.textSecondary }, selectedKey === k && { color: colors.background, fontWeight: '600' }]}
              >
                {k}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Correct button */}
        <TouchableOpacity
          style={[styles.correctBtn, isAnalyzing && styles.correctBtnDisabled]}
          onPress={handleCorrect}
          disabled={isAnalyzing}
        >
          <Text style={styles.correctBtnText}>
            {isAnalyzing ? 'Analyzing...' : hasCorrected ? 'Re-Correct' : 'Correct Notes'}
          </Text>
        </TouchableOpacity>

        {/* Note list */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Note List</Text>
        {(showCorrected && session.correctedNotes ? session.correctedNotes : session.notes).map(
          (note, i) => (
            <View key={note.id} style={[styles.noteRow, { borderBottomColor: colors.borderLight }]}>
              <Text style={[styles.noteIndex, { color: colors.textPlaceholder }]}>{i + 1}</Text>
              <Text style={[styles.noteLabel, { color: colors.text }]}>
                {translateNote(note.noteName, notation)}{note.octave}
              </Text>
              <Text style={[styles.noteDuration, { color: colors.textSecondary }]}>
                {((note.endMs - note.startMs) / 1000).toFixed(2)}s
              </Text>
              <Text style={[styles.noteTime, { color: colors.textMuted }]}>
                @{(note.startMs / 1000).toFixed(1)}s
              </Text>
            </View>
          ),
        )}
      </ScrollView>
    </View>
  );
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}:${s.toString().padStart(2, '0')}`;
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
    paddingBottom: 4,
  },
  backText: {
    fontSize: 15,
    fontWeight: '500',
    width: 50,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  info: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  infoText: {
    fontSize: 13,
  },
  timeline: {
    height: 200,
    marginHorizontal: 8,
    marginVertical: 4,
  },
  toggleBtn: {
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 16,
    marginVertical: 6,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  controls: {
    flex: 1,
  },
  controlsContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    marginRight: 8,
    marginBottom: 4,
  },
  bpmInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 16,
    width: 80,
  },
  keyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  keyChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  keyChipText: {
    fontSize: 12,
  },
  correctBtn: {
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#27ae60',
    marginVertical: 8,
  },
  correctBtnDisabled: {
    opacity: 0.5,
  },
  correctBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noteIndex: {
    width: 28,
    fontSize: 12,
  },
  noteLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  noteDuration: {
    width: 60,
    fontSize: 12,
    textAlign: 'right',
  },
  noteTime: {
    width: 60,
    fontSize: 12,
    textAlign: 'right',
  },
});

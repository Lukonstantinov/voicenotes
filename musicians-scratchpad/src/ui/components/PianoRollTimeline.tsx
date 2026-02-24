import React, { useRef, useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RecordedNote, CorrectedNote, NotationPreset } from '../../utils/sessionTypes';
import { translateNote, ENGLISH_PRESET } from '../../utils/notationSystems';
import { getNoteColor } from '../../utils/noteColors';
import { useTheme } from '../theme/ThemeContext';

// ── Constants ───────────────────────────────────────────────────────────────

const PIXELS_PER_SECOND = 80;
const ROW_HEIGHT = 28;
const NOTE_LABEL_WIDTH = 40;
const MIN_NOTE_WIDTH = 4;
const SEMITONE_PADDING = 2; // extra rows above/below range

const CORRECTED_ALPHA = '66'; // hex alpha for corrected overlay

// ── Helpers ─────────────────────────────────────────────────────────────────

function noteToMidi(noteName: string, octave: number): number {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return (octave + 1) * 12 + names.indexOf(noteName);
}

function midiToLabel(midi: number, preset: NotationPreset): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const name = names[midi % 12];
  return `${translateNote(name, preset)}${octave}`;
}

// ── Props ───────────────────────────────────────────────────────────────────

interface Props {
  notes: RecordedNote[];
  correctedNotes?: CorrectedNote[] | null;
  showCorrected?: boolean;
  durationMs: number;
  isRecording?: boolean;
  notation?: NotationPreset;
}

// ── Component ───────────────────────────────────────────────────────────────

export function PianoRollTimeline({
  notes,
  correctedNotes,
  showCorrected = false,
  durationMs,
  isRecording = false,
  notation = ENGLISH_PRESET,
}: Props) {
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollView>(null);

  // Auto-scroll to right during recording
  useEffect(() => {
    if (isRecording) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [isRecording, notes.length, durationMs]);

  // Compute the MIDI range to display
  const { minMidi, maxMidi } = useMemo(() => {
    const allNotes = showCorrected && correctedNotes ? correctedNotes : notes;
    if (allNotes.length === 0) return { minMidi: 57, maxMidi: 72 }; // A3–C5 default
    let min = Infinity;
    let max = -Infinity;
    for (const n of allNotes) {
      const m = noteToMidi(n.noteName, n.octave);
      if (m < min) min = m;
      if (m > max) max = m;
    }
    return {
      minMidi: Math.max(0, min - SEMITONE_PADDING),
      maxMidi: Math.min(127, max + SEMITONE_PADDING),
    };
  }, [notes, correctedNotes, showCorrected]);

  const rowCount = maxMidi - minMidi + 1;
  const totalWidth = Math.max(300, (durationMs / 1000) * PIXELS_PER_SECOND);

  const displayNotes = showCorrected && correctedNotes ? correctedNotes : notes;

  // Time axis markers (every second)
  const timeMarkers: number[] = [];
  for (let s = 0; s <= Math.ceil(durationMs / 1000); s++) {
    timeMarkers.push(s);
  }

  return (
    <View style={[styles.container, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      {/* Row labels (pitch axis) */}
      <View style={[styles.labels, { backgroundColor: colors.surfaceAlt, borderRightColor: colors.border }]}>
        {Array.from({ length: rowCount }, (_, i) => {
          const midi = maxMidi - i;
          return (
            <View key={midi} style={[styles.labelRow, { height: ROW_HEIGHT, borderBottomColor: colors.borderLight }]}>
              <Text style={[styles.labelText, { color: colors.textMuted }]} numberOfLines={1}>
                {midiToLabel(midi, notation)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Scrollable note area */}
      <ScrollView
        ref={scrollRef}
        horizontal
        style={styles.scroll}
        contentContainerStyle={[styles.grid, { width: totalWidth, height: rowCount * ROW_HEIGHT }]}
        showsHorizontalScrollIndicator={false}
      >
        {/* Grid row backgrounds */}
        {Array.from({ length: rowCount }, (_, i) => {
          const midi = maxMidi - i;
          const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
          return (
            <View
              key={`row-${midi}`}
              style={[
                styles.gridRow,
                {
                  top: i * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  width: totalWidth,
                  backgroundColor: isBlack ? colors.gridBlackKey : colors.gridWhiteKey,
                  borderBottomColor: colors.borderLight,
                },
              ]}
            />
          );
        })}

        {/* Time markers */}
        {timeMarkers.map((s) => (
          <View
            key={`t-${s}`}
            style={[styles.timeLine, { left: s * PIXELS_PER_SECOND, backgroundColor: colors.border }]}
          >
            <Text style={[styles.timeText, { color: colors.textMuted }]}>{s}s</Text>
          </View>
        ))}

        {/* Note blocks */}
        {displayNotes.map((note) => {
          const midi = noteToMidi(note.noteName, note.octave);
          const row = maxMidi - midi;
          const x = (note.startMs / 1000) * PIXELS_PER_SECOND;
          const w = Math.max(MIN_NOTE_WIDTH, ((note.endMs - note.startMs) / 1000) * PIXELS_PER_SECOND);
          const color = getNoteColor(note.noteName);
          const isCorrected = showCorrected && 'wasPitchCorrected' in note;

          return (
            <View
              key={note.id}
              style={[
                styles.noteBlock,
                {
                  left: x,
                  top: row * ROW_HEIGHT + 2,
                  width: w,
                  height: ROW_HEIGHT - 4,
                  backgroundColor: isCorrected ? color + CORRECTED_ALPHA : color,
                  borderWidth: isCorrected ? 2 : 0,
                  borderColor: isCorrected ? color : 'transparent',
                },
              ]}
            >
              <Text style={styles.noteText} numberOfLines={1}>
                {translateNote(note.noteName, notation)}
              </Text>
            </View>
          );
        })}

        {/* Playhead line during recording */}
        {isRecording && (
          <View
            style={[
              styles.playhead,
              { left: (durationMs / 1000) * PIXELS_PER_SECOND, height: rowCount * ROW_HEIGHT },
            ]}
          />
        )}
      </ScrollView>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  labels: {
    width: NOTE_LABEL_WIDTH,
    borderRightWidth: 1,
  },
  labelRow: {
    justifyContent: 'center',
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  labelText: {
    fontSize: 9,
    textAlign: 'right',
  },
  scroll: {
    flex: 1,
  },
  grid: {
    position: 'relative',
  },
  gridRow: {
    position: 'absolute',
    left: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timeLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  timeText: {
    position: 'absolute',
    top: 2,
    left: 2,
    fontSize: 8,
  },
  noteBlock: {
    position: 'absolute',
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  noteText: {
    fontSize: 8,
    color: '#fff',
    fontWeight: '600',
  },
  playhead: {
    position: 'absolute',
    top: 0,
    width: 2,
    backgroundColor: '#e74c3c',
  },
});

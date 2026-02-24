import React, { useRef, useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RecordedNote, CorrectedNote, NotationPreset } from '../../utils/sessionTypes';
import { translateNote, ENGLISH_PRESET } from '../../utils/notationSystems';

// ── Constants ───────────────────────────────────────────────────────────────

const PIXELS_PER_SECOND = 80;
const ROW_HEIGHT = 28;
const NOTE_LABEL_WIDTH = 40;
const MIN_NOTE_WIDTH = 4;
const SEMITONE_PADDING = 2; // extra rows above/below range

/** 12-colour palette for note names (C=0 through B=11). */
const NOTE_COLORS: Record<string, string> = {
  'C': '#e74c3c', 'C#': '#e67e22', 'D': '#f1c40f', 'D#': '#2ecc71',
  'E': '#1abc9c', 'F': '#3498db', 'F#': '#2980b9', 'G': '#9b59b6',
  'G#': '#8e44ad', 'A': '#e84393', 'A#': '#fd79a8', 'B': '#636e72',
};

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
    <View style={styles.container}>
      {/* Row labels (pitch axis) */}
      <View style={styles.labels}>
        {Array.from({ length: rowCount }, (_, i) => {
          const midi = maxMidi - i;
          return (
            <View key={midi} style={[styles.labelRow, { height: ROW_HEIGHT }]}>
              <Text style={styles.labelText} numberOfLines={1}>
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
                  backgroundColor: isBlack ? '#e8e8ee' : '#f5f5fa',
                },
              ]}
            />
          );
        })}

        {/* Time markers */}
        {timeMarkers.map((s) => (
          <View
            key={`t-${s}`}
            style={[styles.timeLine, { left: s * PIXELS_PER_SECOND }]}
          >
            <Text style={styles.timeText}>{s}s</Text>
          </View>
        ))}

        {/* Note blocks */}
        {displayNotes.map((note) => {
          const midi = noteToMidi(note.noteName, note.octave);
          const row = maxMidi - midi;
          const x = (note.startMs / 1000) * PIXELS_PER_SECOND;
          const w = Math.max(MIN_NOTE_WIDTH, ((note.endMs - note.startMs) / 1000) * PIXELS_PER_SECOND);
          const color = NOTE_COLORS[note.noteName] ?? '#999';
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
    borderColor: '#ddd',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#fafafa',
  },
  labels: {
    width: NOTE_LABEL_WIDTH,
    backgroundColor: '#f0f0f5',
    borderRightWidth: 1,
    borderRightColor: '#ddd',
  },
  labelRow: {
    justifyContent: 'center',
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  labelText: {
    fontSize: 9,
    color: '#666',
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
    borderBottomColor: '#e0e0e0',
  },
  timeLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#ccc',
  },
  timeText: {
    position: 'absolute',
    top: 2,
    left: 2,
    fontSize: 8,
    color: '#999',
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

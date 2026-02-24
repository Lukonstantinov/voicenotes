import React, { useRef, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PitchResult } from '../../bridge/types';
import { getNoteColor } from '../../utils/noteColors';
import { useTheme } from '../theme/ThemeContext';

// ── Constants ───────────────────────────────────────────────────────────────

/** Number of samples to display (3 seconds at ~30fps). */
const BUFFER_SIZE = 90;

/** Height of the graph in logical pixels. */
const GRAPH_HEIGHT = 120;

/** Width of each sample column. */
const SAMPLE_WIDTH = 3;

/** MIDI range displayed (C2–C6 = 36–84). */
const MIDI_MIN = 36;
const MIDI_MAX = 84;
const MIDI_RANGE = MIDI_MAX - MIDI_MIN;

// ── Helpers ─────────────────────────────────────────────────────────────────

function freqToMidi(freq: number): number {
  return 12 * Math.log2(freq / 440) + 69;
}

function midiToY(midi: number): number {
  const clamped = Math.max(MIDI_MIN, Math.min(MIDI_MAX, midi));
  // Invert so high pitch is at top
  return ((MIDI_MAX - clamped) / MIDI_RANGE) * GRAPH_HEIGHT;
}

// ── Sample type ─────────────────────────────────────────────────────────────

interface Sample {
  midi: number;
  noteName: string;
}

// ── Props ───────────────────────────────────────────────────────────────────

interface Props {
  pitch: PitchResult | null;
}

/**
 * A rolling pitch history graph rendered with standard RN Views.
 * Displays the last BUFFER_SIZE pitch samples as colored dots positioned
 * vertically by MIDI pitch and colored by note name.
 */
export function PitchGraph({ pitch }: Props) {
  const { colors } = useTheme();
  const bufferRef = useRef<(Sample | null)[]>(new Array(BUFFER_SIZE).fill(null));
  const writeIdx = useRef(0);

  // Push new sample into ring buffer (called on every render with new pitch)
  const pushSample = useCallback((p: PitchResult | null) => {
    if (p && p.frequency > 0) {
      bufferRef.current[writeIdx.current] = {
        midi: freqToMidi(p.frequency),
        noteName: p.noteName,
      };
    } else {
      bufferRef.current[writeIdx.current] = null;
    }
    writeIdx.current = (writeIdx.current + 1) % BUFFER_SIZE;
  }, []);

  pushSample(pitch);

  // Read buffer in display order (oldest → newest, left → right)
  const dots: React.ReactNode[] = [];
  for (let i = 0; i < BUFFER_SIZE; i++) {
    const idx = (writeIdx.current + i) % BUFFER_SIZE;
    const sample = bufferRef.current[idx];
    if (sample) {
      const y = midiToY(sample.midi);
      const color = getNoteColor(sample.noteName);
      // Fade older samples
      const age = i / BUFFER_SIZE;
      const opacity = 0.2 + 0.8 * age;
      dots.push(
        <View
          key={i}
          style={[
            styles.dot,
            {
              left: i * SAMPLE_WIDTH,
              top: y - 2,
              backgroundColor: color,
              opacity,
            },
          ]}
        />,
      );
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Center reference line */}
      <View style={[styles.centerLine, { backgroundColor: colors.border }]} />
      {dots}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: BUFFER_SIZE * SAMPLE_WIDTH,
    height: GRAPH_HEIGHT,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  centerLine: {
    position: 'absolute',
    top: GRAPH_HEIGHT / 2 - 0.5,
    left: 0,
    right: 0,
    height: 1,
  },
  dot: {
    position: 'absolute',
    width: SAMPLE_WIDTH - 1,
    height: 4,
    borderRadius: 1,
  },
});

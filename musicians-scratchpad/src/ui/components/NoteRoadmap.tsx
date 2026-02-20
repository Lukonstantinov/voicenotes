import React, { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { RoadmapResult, RoadmapSegment } from '../../bridge/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SilenceMode = 'gap' | 'hold';
export type OctaveMode  = 'note' | 'full';

interface Props {
  result:         RoadmapResult;
  silenceMode:    SilenceMode;
  octaveMode:     OctaveMode;
  activeSegIdx:   number | null;
  onSegmentPress: (seg: RoadmapSegment, idx: number) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bgColor(confidence: number, hasNote: boolean): string {
  if (!hasNote) return '#e8e8e8';
  if (confidence >= 0.7) return '#22c55e';
  if (confidence >= 0.5) return '#f97316';
  return '#ef4444';
}

function label(seg: RoadmapSegment, octaveMode: OctaveMode): string {
  if (!seg.hasNote) return '—';
  return octaveMode === 'full' ? seg.fullName : seg.noteName;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NoteRoadmap({
  result,
  silenceMode,
  octaveMode,
  activeSegIdx,
  onSegmentPress,
}: Props) {
  // Apply hold mode: fill silent gaps with previous note at reduced opacity
  const displaySegs = useMemo<(RoadmapSegment & { held?: boolean })[]>(() => {
    if (silenceMode !== 'hold') return result.segments;
    let prev: RoadmapSegment | null = null;
    return result.segments.map(seg => {
      if (seg.hasNote) { prev = seg; return seg; }
      if (prev) {
        return {
          ...seg,
          noteName:   prev.noteName,
          octave:     prev.octave,
          fullName:   prev.fullName,
          confidence: 0.25,
          hasNote:    true,
          held:       true,
        };
      }
      return seg;
    });
  }, [result.segments, silenceMode]);

  return (
    <View style={styles.wrapper}>
      {/* Summary row */}
      <View style={styles.summary}>
        <Text style={styles.dominantLabel}>
          Root: <Text style={styles.dominantNote}>{result.dominantNote || '—'}</Text>
        </Text>
        <Text style={styles.durationLabel}>
          {fmtTime(result.totalDuration)} · {result.segments.length} segments
        </Text>
      </View>

      {/* Horizontal segment timeline */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {displaySegs.map((seg, idx) => {
          const isActive = idx === activeSegIdx;
          const bg       = bgColor(seg.confidence, seg.hasNote);
          const txt      = label(seg, octaveMode);
          const isHeld   = 'held' in seg && seg.held;
          return (
            <TouchableOpacity
              key={idx}
              style={[
                styles.cell,
                { backgroundColor: bg },
                isHeld  && styles.cellHeld,
                isActive && styles.cellActive,
              ]}
              onPress={() => onSegmentPress(seg, idx)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${txt} at ${fmtTime(seg.startSec)}`}
            >
              <Text style={[styles.noteText, !seg.hasNote && styles.emptyText]}>
                {txt}
              </Text>
              <Text style={styles.timeText}>{fmtTime(seg.startSec)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Confidence legend */}
      <View style={styles.legend}>
        {([
          ['#22c55e', '≥70%'],
          ['#f97316', '≥50%'],
          ['#ef4444', '<50%'],
          ['#e8e8e8', 'Silent'],
        ] as const).map(([color, lbl]) => (
          <View key={lbl} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: color }]} />
            <Text style={styles.legendText}>{lbl}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const CELL_W = 62;

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    marginTop: 16,
  },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  dominantLabel: {
    fontSize: 14,
    color: '#444',
  },
  dominantNote: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
  },
  durationLabel: {
    fontSize: 12,
    color: '#888',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    gap: 4,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  cell: {
    width: CELL_W,
    minHeight: 60,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  cellHeld: {
    opacity: 0.45,
  },
  cellActive: {
    borderWidth: 2.5,
    borderColor: '#2563eb',
  },
  noteText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  emptyText: {
    color: '#999',
  },
  timeText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 3,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
    gap: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: '#888',
  },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import AudioPitchModule from '../../bridge/NativeAudioPitchModule';
import type { RoadmapResult, RoadmapSegment } from '../../bridge/types';
import { NoteRoadmap } from './NoteRoadmap';
import type { OctaveMode, SilenceMode } from './NoteRoadmap';

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'analysing' | 'done' | 'error';
type SegSec = 1 | 2 | 4 | 8;

interface RoadmapSettings {
  segmentSec:  SegSec;
  silenceMode: SilenceMode;
  octaveMode:  OctaveMode;
}

const DEFAULT_SETTINGS: RoadmapSettings = {
  segmentSec:  1,
  silenceMode: 'gap',
  octaveMode:  'note',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

function generateText(result: RoadmapResult, fileName: string, settings: RoadmapSettings): string {
  const lines = [
    "Musician's Scratchpad — Note Roadmap",
    `File: ${fileName}`,
    `Dominant note: ${result.dominantNote || '—'}`,
    `Duration: ${fmtTime(result.totalDuration)}`,
    `Segment size: ${settings.segmentSec}s`,
    '',
    'Time     | Note | Confidence',
    '---------+------+-----------',
    ...result.segments.map(s => {
      const note = s.hasNote
        ? (settings.octaveMode === 'full' ? s.fullName : s.noteName)
        : '—';
      const conf = s.hasNote ? `${Math.round(s.confidence * 100)}%` : '';
      return `${fmtTime(s.startSec).padEnd(9)}| ${note.padEnd(5)}| ${conf}`;
    }),
  ];
  return lines.join('\n');
}

function generateHtml(result: RoadmapResult, fileName: string, settings: RoadmapSettings): string {
  const rows = result.segments
    .map(s => {
      const note = s.hasNote
        ? (settings.octaveMode === 'full' ? s.fullName : s.noteName)
        : '—';
      const pct  = s.hasNote ? Math.round(s.confidence * 100) : 0;
      const bg   = !s.hasNote ? '#eee'
        : pct >= 70 ? '#bbf7d0'
        : pct >= 50 ? '#fed7aa'
        : '#fecaca';
      return `<tr style="background:${bg}">
        <td>${fmtTime(s.startSec)}</td>
        <td style="font-weight:bold">${note}</td>
        <td>${s.hasNote ? pct + '%' : ''}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 24px; }
    h1   { font-size: 20px; margin-bottom: 4px; }
    p    { color: #555; margin: 0 0 16px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 6px 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f3f4f6; font-size: 12px; text-transform: uppercase; }
  </style></head><body>
  <h1>Note Roadmap</h1>
  <p>File: <b>${fileName}</b> &nbsp;|&nbsp; Root: <b>${result.dominantNote || '—'}</b>
     &nbsp;|&nbsp; Duration: <b>${fmtTime(result.totalDuration)}</b>
     &nbsp;|&nbsp; Segment: <b>${settings.segmentSec}s</b></p>
  <table>
    <tr><th>Time</th><th>Note</th><th>Confidence</th></tr>
    ${rows}
  </table>
  </body></html>`;
}

// ── Segmented controls (reused within this component) ────────────────────────

interface SegCtrlProps<T extends string | number> {
  label:    string;
  options:  { value: T; label: string }[];
  selected: T;
  onChange: (v: T) => void;
}
function SegmentedCtrl<T extends string | number>({
  label, options, selected, onChange,
}: SegCtrlProps<T>) {
  return (
    <View style={ctrlStyles.row}>
      <Text style={ctrlStyles.label}>{label}</Text>
      <View style={ctrlStyles.group}>
        {options.map(o => {
          const active = o.value === selected;
          return (
            <TouchableOpacity
              key={String(o.value)}
              style={[ctrlStyles.btn, active && ctrlStyles.btnActive]}
              onPress={() => onChange(o.value)}
            >
              <Text style={[ctrlStyles.btnTxt, active && ctrlStyles.btnTxtActive]}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const ctrlStyles = StyleSheet.create({
  row:         { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  label:       { fontSize: 12, color: '#555', width: 76, textAlign: 'right' },
  group:       { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: '#ccc', overflow: 'hidden' },
  btn:         { paddingVertical: 5, paddingHorizontal: 11, backgroundColor: '#fff' },
  btnActive:   { backgroundColor: '#2563eb' },
  btnTxt:      { fontSize: 13, color: '#444' },
  btnTxtActive:{ color: '#fff', fontWeight: '600' },
});

// ── Main component ────────────────────────────────────────────────────────────

export function FileAnalysisPanel() {
  const [phase,       setPhase]       = useState<Phase>('idle');
  const [errorMsg,    setErrorMsg]    = useState('');
  const [fileUri,     setFileUri]     = useState<string | null>(null);
  const [fileName,    setFileName]    = useState('');
  const [result,      setResult]      = useState<RoadmapResult | null>(null);
  const [settings,    setSettings]    = useState<RoadmapSettings>(DEFAULT_SETTINGS);
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [positionMs,  setPositionMs]  = useState(0);

  const soundRef = useRef<Audio.Sound | null>(null);

  // ── Cleanup sound on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

  // ── Re-run analysis when segmentSec changes (file already loaded) ─────────
  const lastAnalysedUri = useRef<string | null>(null);
  const lastAnalysedSeg = useRef<SegSec | null>(null);

  useEffect(() => {
    if (
      fileUri &&
      (fileUri !== lastAnalysedUri.current ||
        settings.segmentSec !== lastAnalysedSeg.current)
    ) {
      runAnalysis(fileUri, settings.segmentSec);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUri, settings.segmentSec]);

  // ── Analysis ─────────────────────────────────────────────────────────────
  const runAnalysis = useCallback(async (uri: string, seg: SegSec) => {
    setPhase('analysing');
    setResult(null);
    lastAnalysedUri.current = uri;
    lastAnalysedSeg.current = seg;
    try {
      const raw = await (AudioPitchModule as any).analyzeFileRoadmap(uri, seg);
      setResult(raw as RoadmapResult);
      setPhase('done');
      // Load sound for playback
      await soundRef.current?.unloadAsync();
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false },
        status => {
          if (!status.isLoaded) return;
          setPositionMs(status.positionMillis ?? 0);
          if (status.didJustFinish) {
            setIsPlaying(false);
            setPositionMs(0);
          }
        }
      );
      soundRef.current = sound;
    } catch (e: any) {
      setPhase('error');
      setErrorMsg(e?.message ?? 'Analysis failed');
    }
  }, []);

  // ── File picker ───────────────────────────────────────────────────────────
  const pickFile = useCallback(async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['audio/*'],
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    setFileUri(asset.uri);
    setFileName(asset.name ?? 'Unknown file');
    setPositionMs(0);
    setIsPlaying(false);
  }, []);

  // ── Playback ──────────────────────────────────────────────────────────────
  const handleSegmentPress = useCallback(async (seg: RoadmapSegment) => {
    const sound = soundRef.current;
    if (!sound) return;
    await sound.setPositionAsync(seg.startSec * 1000);
    if (!isPlaying) {
      await sound.playAsync();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const togglePlayback = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;
    if (isPlaying) {
      await sound.pauseAsync();
      setIsPlaying(false);
    } else {
      await sound.playAsync();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const activeSegIdx = result
    ? result.segments.findIndex(
        s => positionMs / 1000 >= s.startSec && positionMs / 1000 < s.endSec
      )
    : null;

  // ── Export ────────────────────────────────────────────────────────────────
  const exportText = useCallback(async () => {
    if (!result) return;
    const text = generateText(result, fileName, settings);
    await Share.share({ message: text, title: `Note Roadmap — ${fileName}` });
  }, [result, fileName, settings]);

  const exportPDF = useCallback(async () => {
    if (!result) return;
    try {
      const html      = generateHtml(result, fileName, settings);
      const { uri }   = await Print.printToFileAsync({ html });
      const canShare  = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI:      'com.adobe.pdf',
          dialogTitle: `Share roadmap PDF`,
        });
      } else {
        Alert.alert('Sharing unavailable', 'Cannot share files on this device.');
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Unknown error');
    }
  }, [result, fileName, settings]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* File picker button */}
      <TouchableOpacity style={styles.pickBtn} onPress={pickFile} activeOpacity={0.8}>
        <Text style={styles.pickBtnTxt}>
          {fileName ? `📄 ${fileName}` : '+ Pick Audio File'}
        </Text>
      </TouchableOpacity>

      {/* Analysing spinner */}
      {phase === 'analysing' && (
        <View style={styles.stateBox}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.stateLabel}>Analysing…</Text>
        </View>
      )}

      {/* Error */}
      {phase === 'error' && (
        <View style={styles.stateBox}>
          <Text style={styles.errorText}>Error: {errorMsg}</Text>
          <TouchableOpacity onPress={() => fileUri && runAnalysis(fileUri, settings.segmentSec)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Results */}
      {phase === 'done' && result && (
        <>
          {/* Roadmap */}
          <NoteRoadmap
            result={result}
            silenceMode={settings.silenceMode}
            octaveMode={settings.octaveMode}
            activeSegIdx={activeSegIdx}
            onSegmentPress={handleSegmentPress}
          />

          {/* Playback controls */}
          <View style={styles.playbackRow}>
            <TouchableOpacity style={styles.playBtn} onPress={togglePlayback}>
              <Text style={styles.playBtnTxt}>{isPlaying ? '⏸ Pause' : '▶ Play'}</Text>
            </TouchableOpacity>
            <Text style={styles.positionTxt}>
              {fmtTime(positionMs / 1000)} / {fmtTime(result.totalDuration)}
            </Text>
          </View>

          {/* Settings */}
          <View style={styles.settingsBox}>
            <Text style={styles.settingsTitle}>Settings</Text>
            <SegmentedCtrl
              label="Segment"
              options={[
                { value: 1 as SegSec, label: '1s' },
                { value: 2 as SegSec, label: '2s' },
                { value: 4 as SegSec, label: '4s' },
                { value: 8 as SegSec, label: '8s' },
              ]}
              selected={settings.segmentSec}
              onChange={v => setSettings(s => ({ ...s, segmentSec: v }))}
            />
            <SegmentedCtrl
              label="Silence"
              options={[
                { value: 'gap' as SilenceMode,  label: 'Gap' },
                { value: 'hold' as SilenceMode, label: 'Hold' },
              ]}
              selected={settings.silenceMode}
              onChange={v => setSettings(s => ({ ...s, silenceMode: v }))}
            />
            <SegmentedCtrl
              label="Display"
              options={[
                { value: 'note' as OctaveMode, label: 'Note' },
                { value: 'full' as OctaveMode, label: 'Full' },
              ]}
              selected={settings.octaveMode}
              onChange={v => setSettings(s => ({ ...s, octaveMode: v }))}
            />
          </View>

          {/* Export */}
          <View style={styles.exportRow}>
            <Text style={styles.exportLabel}>Export:</Text>
            <TouchableOpacity style={styles.exportBtn} onPress={exportText}>
              <Text style={styles.exportBtnTxt}>Text</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.exportBtn} onPress={exportPDF}>
              <Text style={styles.exportBtnTxt}>PDF</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    paddingBottom: 32,
  },
  pickBtn: {
    marginTop: 24,
    paddingVertical: 14,
    paddingHorizontal: 28,
    backgroundColor: '#2563eb',
    borderRadius: 12,
  },
  pickBtnTxt: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  stateBox: {
    marginTop: 32,
    alignItems: 'center',
    gap: 12,
  },
  stateLabel: {
    fontSize: 16,
    color: '#555',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  retryText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '600',
  },
  playbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 14,
  },
  playBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: '#1e40af',
    borderRadius: 8,
  },
  playBtnTxt: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  positionTxt: {
    fontSize: 13,
    color: '#666',
    fontVariant: ['tabular-nums'],
  },
  settingsBox: {
    width: '100%',
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    gap: 4,
  },
  settingsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
    textAlign: 'center',
  },
  exportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 10,
  },
  exportLabel: {
    fontSize: 13,
    color: '#555',
  },
  exportBtn: {
    paddingVertical: 6,
    paddingHorizontal: 18,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  exportBtnTxt: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600',
  },
});

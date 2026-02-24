import React, { useCallback, useRef } from 'react';
import {
  Linking,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSessionRecorder } from '../hooks/useSessionRecorder';
import { PianoRollTimeline } from '../components/PianoRollTimeline';
import { PitchDisplay } from '../components/PitchDisplay';
import { CentIndicator } from '../components/CentIndicator';
import { saveSession } from '../../utils/sessionStorage';
import { uid } from '../../utils/uid';
import type { Session, NotationPreset } from '../../utils/sessionTypes';
import { translateNote } from '../../utils/notationSystems';

async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone Permission',
        message: "Musician's Scratchpad needs microphone access to detect pitch.",
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      },
    );
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      Linking.openSettings();
      return false;
    }
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  return true;
}

interface Props {
  onFinish: (session: Session) => void;
  onCancel: () => void;
  notation: NotationPreset;
}

export function RecordingScreen({ onFinish, onCancel, notation }: Props) {
  const {
    isRecording,
    elapsedMs,
    notes,
    currentPitch,
    startRecording,
    stopRecording,
  } = useSessionRecorder();

  const hasStarted = useRef(false);

  const handleStart = useCallback(async () => {
    if (hasStarted.current) return;
    const granted = await requestMicPermission();
    if (!granted) {
      onCancel();
      return;
    }
    hasStarted.current = true;
    startRecording();
  }, [startRecording, onCancel]);

  const handleStop = useCallback(async () => {
    const { notes: finalNotes, durationMs } = stopRecording();
    const now = Date.now();
    const session: Session = {
      id: uid(),
      name: formatSessionName(now),
      createdAt: now,
      durationMs,
      notes: finalNotes,
      correctedNotes: null,
      bpm: null,
      key: null,
    };
    await saveSession(session);
    onFinish(session);
  }, [stopRecording, onFinish]);

  const elapsed = formatTime(elapsedMs);
  const displayNote = currentPitch ? translateNote(currentPitch.noteName, notation) : null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.timer}>{elapsed}</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Current pitch display */}
      <View style={styles.pitchArea}>
        {displayNote && currentPitch ? (
          <View style={styles.noteRow}>
            <Text style={styles.noteName}>{displayNote}</Text>
            <Text style={styles.octave}>{currentPitch.octave}</Text>
          </View>
        ) : (
          <PitchDisplay pitch={null} />
        )}
        <CentIndicator cents={currentPitch?.cents ?? null} />
      </View>

      {/* Piano roll timeline */}
      <View style={styles.timeline}>
        <PianoRollTimeline
          notes={notes}
          durationMs={elapsedMs}
          isRecording={isRecording}
          notation={notation}
        />
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        {!isRecording ? (
          <TouchableOpacity style={styles.startBtn} onPress={handleStart}>
            <Text style={styles.btnLabel}>Start Recording</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopBtn} onPress={handleStop}>
            <Text style={styles.btnLabelWhite}>Stop & Save</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function formatSessionName(timestamp: number): string {
  const d = new Date(timestamp);
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `Session ${month}/${day} ${h}:${m}`;
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
    paddingBottom: 4,
  },
  cancelText: {
    fontSize: 15,
    color: '#e74c3c',
    fontWeight: '500',
    width: 60,
  },
  timer: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a2e',
    fontVariant: ['tabular-nums'],
  },
  pitchArea: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  noteName: {
    fontSize: 64,
    fontWeight: '700',
    color: '#1a1a2e',
    lineHeight: 72,
  },
  octave: {
    fontSize: 28,
    fontWeight: '400',
    color: '#555',
    marginBottom: 8,
    marginLeft: 2,
  },
  timeline: {
    flex: 1,
    marginHorizontal: 8,
    marginVertical: 4,
  },
  controls: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  startBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 28,
    backgroundColor: '#e74c3c',
  },
  stopBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 28,
    backgroundColor: '#1a1a2e',
  },
  btnLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  btnLabelWhite: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});

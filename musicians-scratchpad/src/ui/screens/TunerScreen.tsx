import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Linking,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import AudioPitchModule from '../../bridge/NativeAudioPitchModule';
import type { RawPitchFrame } from '../../bridge/NativeAudioPitchModule';
import { usePitchPolling } from '../hooks/usePitchPolling';
import { PitchDisplay } from '../components/PitchDisplay';
import { CentIndicator } from '../components/CentIndicator';
import { ListenButton } from '../components/ListenButton';
import { AppStatusBar } from '../components/AppStatusBar';
import type { AppState as AudioAppState } from '../components/AppStatusBar';
import type { NotationPreset, Session } from '../../utils/sessionTypes';
import { translateNote } from '../../utils/notationSystems';
import { pitchFramesToNotes } from '../../utils/pitchFrameToNotes';
import { saveSession } from '../../utils/sessionStorage';
import { uid } from '../../utils/uid';

const SILENCE_HINT_DELAY_MS = 3000;

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
  onStartRecording: () => void;
  onImportSession: (session: Session) => void;
  notation: NotationPreset;
}

export function TunerScreen({ onStartRecording, onImportSession, notation }: Props) {
  const [audioState, setAudioState] = useState<AudioAppState>('idle');
  const [isImporting, setIsImporting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isHeld, setIsHeld] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const wasListeningRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pitch = usePitchPolling(isListening, isHeld);

  // Silence hint
  useEffect(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (isListening && !pitch) {
      silenceTimerRef.current = setTimeout(() => setShowHint(true), SILENCE_HINT_DELAY_MS);
    } else {
      setShowHint(false);
    }
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, [isListening, pitch]);

  // App lifecycle
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        if (isListening) {
          wasListeningRef.current = true;
          stopAudio();
        }
      } else if (next === 'active') {
        if (wasListeningRef.current) {
          wasListeningRef.current = false;
          startAudio();
        }
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);

  const startAudio = useCallback(() => {
    AudioPitchModule.startListening();
    setIsListening(true);
    setAudioState('listening');
  }, []);

  const stopAudio = useCallback(() => {
    AudioPitchModule.stopListening();
    setIsListening(false);
    setIsHeld(false);
    setAudioState('idle');
  }, []);

  const handleButtonPress = useCallback(async () => {
    if (isListening) { stopAudio(); return; }
    setAudioState('requesting');
    const granted = await requestMicPermission();
    if (!granted) {
      setAudioState('denied');
      setTimeout(() => Linking.openSettings(), 1500);
      return;
    }
    startAudio();
  }, [isListening, startAudio, stopAudio]);

  const handleImportAudio = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    // Decode percent-encoding (e.g. %20 → space) then strip file:// so
    // AVFoundation / MediaExtractor receive a plain filesystem path.
    const filePath = decodeURIComponent(asset.uri.replace(/^file:\/\//, ''));

    setIsImporting(true);
    try {
      const frames = await AudioPitchModule.analyzeAudioFile(filePath) as RawPitchFrame[];
      const notes = pitchFramesToNotes(frames);
      if (notes.length === 0) {
        Alert.alert('No Notes Found', 'Could not detect any pitched notes in this audio file.');
        return;
      }
      const session: Session = {
        id:           uid(),
        name:         asset.name.replace(/\.[^.]+$/, ''),
        createdAt:    Date.now(),
        durationMs:   notes[notes.length - 1].endMs,
        notes,
        correctedNotes: null,
        bpm:          null,
        key:          null,
      };
      await saveSession(session);
      onImportSession(session);
    } catch {
      Alert.alert('Analysis Failed', 'Could not analyse this audio file. Make sure it is a supported format (wav, m4a, mp3).');
    } finally {
      setIsImporting(false);
    }
  }, [onImportSession]);

  // Translate note display
  const displayNote = pitch ? translateNote(pitch.noteName, notation) : null;

  return (
    <View style={styles.body}>
      {isListening && (
        <TouchableOpacity
          style={[styles.holdButton, isHeld && styles.holdButtonActive]}
          onPress={() => setIsHeld(prev => !prev)}
        >
          <Text style={[styles.holdLabel, isHeld && styles.holdLabelActive]}>
            {isHeld ? 'RESUME' : 'HOLD'}
          </Text>
        </TouchableOpacity>
      )}
      {displayNote && pitch ? (
        <View style={styles.noteContainer}>
          <Text style={styles.noteName}>{displayNote}</Text>
          <Text style={styles.octave}>{pitch.octave}</Text>
        </View>
      ) : (
        <PitchDisplay pitch={null} />
      )}
      <CentIndicator cents={pitch?.cents ?? null} />
      <ListenButton
        isListening={isListening}
        onPress={handleButtonPress}
        disabled={audioState === 'requesting'}
      />
      <TouchableOpacity style={styles.recordButton} onPress={onStartRecording}>
        <Text style={styles.recordLabel}>Record Session</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.importButton, isImporting && styles.importButtonDisabled]}
        onPress={handleImportAudio}
        disabled={isImporting}
      >
        {isImporting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.importLabel}>Import Audio File</Text>
        )}
      </TouchableOpacity>
      <AppStatusBar appState={audioState} showHint={showHint} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#1a1a2e',
    backgroundColor: 'transparent',
    zIndex: 10,
  },
  holdButtonActive: {
    backgroundColor: '#1a1a2e',
  },
  holdLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a2e',
    letterSpacing: 1,
  },
  holdLabelActive: {
    color: '#fff',
  },
  noteContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  noteName: {
    fontSize: 120,
    fontWeight: '700',
    color: '#1a1a2e',
    lineHeight: 130,
  },
  octave: {
    fontSize: 48,
    fontWeight: '400',
    color: '#555',
    alignSelf: 'flex-end',
    marginBottom: 16,
    marginLeft: 4,
  },
  recordButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#1a1a2e',
  },
  recordLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  importButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    minWidth: 160,
    alignItems: 'center',
  },
  importButtonDisabled: {
    opacity: 0.5,
  },
  importLabel: {
    color: '#1a1a2e',
    fontSize: 14,
    fontWeight: '600',
  },
});

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
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
import AudioPitchModule from '../../bridge/NativeAudioPitchModule';
import { usePitchPolling } from '../hooks/usePitchPolling';
import { PitchDisplay } from '../components/PitchDisplay';
import { CentIndicator } from '../components/CentIndicator';
import { ListenButton } from '../components/ListenButton';
import { AppStatusBar } from '../components/AppStatusBar';
import type { AppState as AudioAppState } from '../components/AppStatusBar';
import type { NotationPreset } from '../../utils/sessionTypes';
import { translateNote } from '../../utils/notationSystems';

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
  notation: NotationPreset;
}

export function TunerScreen({ onStartRecording, notation }: Props) {
  const [audioState, setAudioState] = useState<AudioAppState>('idle');
  const [isListening, setIsListening] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const wasListeningRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pitch = usePitchPolling(isListening);

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

  // Translate note display
  const displayNote = pitch ? translateNote(pitch.noteName, notation) : null;

  return (
    <View style={styles.body}>
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
});

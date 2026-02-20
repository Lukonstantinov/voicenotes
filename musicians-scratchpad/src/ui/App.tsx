import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  AppState,
  AppStateStatus,
  Linking,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  StyleSheet,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import AudioPitchModule from '../bridge/NativeAudioPitchModule';
import { usePitchPolling } from './hooks/usePitchPolling';
import { PitchDisplay } from './components/PitchDisplay';
import { CentIndicator } from './components/CentIndicator';
import { ListenButton } from './components/ListenButton';
import { AppStatusBar } from './components/AppStatusBar';
import type { AppState as AudioAppState } from './components/AppStatusBar';

const SILENCE_HINT_DELAY_MS = 3000;

// ── Permission helper (platform-specific, kept in UI layer) ──────────────────
async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: "Microphone Permission",
        message: "Musician's Scratchpad needs microphone access to detect pitch.",
        buttonPositive: "Allow",
        buttonNegative: "Deny",
      }
    );
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      Linking.openSettings();
      return false;
    }
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  // iOS: the system prompts automatically on first AVAudioSession setActive.
  return true;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function App() {
  const [audioState, setAudioState]   = useState<AudioAppState>('idle');
  const [isListening, setIsListening] = useState(false);
  const [showHint, setShowHint]       = useState(false);

  const wasListeningRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pitch = usePitchPolling(isListening);

  // ── Silence hint ────────────────────────────────────────────────────────────
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

  // ── App lifecycle ───────────────────────────────────────────────────────────
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

  // ── Audio control ───────────────────────────────────────────────────────────
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

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.body}>
        <PitchDisplay pitch={pitch} />
        <CentIndicator cents={pitch?.cents ?? null} />
        <ListenButton
          isListening={isListening}
          onPress={handleButtonPress}
          disabled={audioState === 'requesting'}
        />
        <AppStatusBar appState={audioState} showHint={showHint} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f9f9f9',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

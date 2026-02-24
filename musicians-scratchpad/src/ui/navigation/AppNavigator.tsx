import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Session, NotationPreset } from '../../utils/sessionTypes';
import { getActivePreset, getMicSensitivity, SENSITIVITY_CONFIGS } from '../../utils/settingsStorage';
import AudioPitchModule from '../../bridge/NativeAudioPitchModule';
import { ENGLISH_PRESET } from '../../utils/notationSystems';
import { TunerScreen } from '../screens/TunerScreen';
import { RecordingScreen } from '../screens/RecordingScreen';
import { SessionReviewScreen } from '../screens/SessionReviewScreen';
import { SessionListScreen } from '../screens/SessionListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type Screen =
  | { name: 'tuner' }
  | { name: 'recording' }
  | { name: 'review'; session: Session }
  | { name: 'history' }
  | { name: 'settings' };

type TabId = 'tuner' | 'history' | 'settings';

export function AppNavigator() {
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>({ name: 'tuner' });
  const [notation, setNotation] = useState<NotationPreset>(ENGLISH_PRESET);

  // Load active notation on mount and when returning to tuner
  useEffect(() => {
    getActivePreset().then(setNotation);
  }, [screen]);

  // Apply saved mic sensitivity once on mount
  useEffect(() => {
    getMicSensitivity().then((level) => {
      const cfg = SENSITIVITY_CONFIGS[level];
      AudioPitchModule.setSensitivity(cfg.silenceDb, cfg.confidenceEnter, cfg.confidenceExit);
    });
  }, []);

  const goToRecording = useCallback(() => setScreen({ name: 'recording' }), []);
  const goToTuner = useCallback(() => setScreen({ name: 'tuner' }), []);
  const goToReview = useCallback((session: Session) => setScreen({ name: 'review', session }), []);
  const goToHistory = useCallback(() => setScreen({ name: 'history' }), []);
  const goToSettings = useCallback(() => setScreen({ name: 'settings' }), []);

  const activeTab: TabId | null =
    screen.name === 'tuner' || screen.name === 'recording' ? 'tuner'
    : screen.name === 'history' || screen.name === 'review' ? 'history'
    : screen.name === 'settings' ? 'settings'
    : null;

  const renderScreen = () => {
    switch (screen.name) {
      case 'tuner':
        return (
          <TunerScreen
            onStartRecording={goToRecording}
            onImportSession={goToReview}
            notation={notation}
          />
        );
      case 'recording':
        return (
          <RecordingScreen
            onFinish={goToReview}
            onCancel={goToTuner}
            notation={notation}
          />
        );
      case 'review':
        return (
          <SessionReviewScreen
            session={screen.session}
            onBack={goToHistory}
            notation={notation}
          />
        );
      case 'history':
        return <SessionListScreen onSelect={goToReview} onBack={goToTuner} />;
      case 'settings':
        return <SettingsScreen onBack={goToTuner} />;
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.body, { paddingTop: insets.top }]}>{renderScreen()}</View>
      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TabButton
          label="Tuner"
          active={activeTab === 'tuner'}
          onPress={goToTuner}
        />
        <TabButton
          label="History"
          active={activeTab === 'history'}
          onPress={goToHistory}
        />
        <TabButton
          label="Settings"
          active={activeTab === 'settings'}
          onPress={goToSettings}
        />
      </View>
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.tab} onPress={onPress}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  tabLabel: {
    fontSize: 13,
    color: '#888',
    fontWeight: '500',
  },
  tabLabelActive: {
    color: '#1a1a2e',
    fontWeight: '700',
  },
});

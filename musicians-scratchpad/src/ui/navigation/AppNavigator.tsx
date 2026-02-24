import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Session, NotationPreset } from '../../utils/sessionTypes';
import { getActivePreset, getMicSensitivity, getA4Calibration, SENSITIVITY_CONFIGS } from '../../utils/settingsStorage';
import AudioPitchModule from '../../bridge/NativeAudioPitchModule';
import { ENGLISH_PRESET } from '../../utils/notationSystems';
import { useTheme } from '../theme/ThemeContext';
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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>({ name: 'tuner' });
  const [notation, setNotation] = useState<NotationPreset>(ENGLISH_PRESET);

  // Load active notation on mount and when returning to tuner
  useEffect(() => {
    getActivePreset().then(setNotation);
  }, [screen]);

  // Apply saved settings once on mount
  useEffect(() => {
    getMicSensitivity().then((level) => {
      const cfg = SENSITIVITY_CONFIGS[level];
      AudioPitchModule.setSensitivity(cfg.silenceDb, cfg.confidenceEnter, cfg.confidenceExit);
    });
    getA4Calibration().then((hz) => {
      AudioPitchModule.setA4Calibration(hz);
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
      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8), backgroundColor: colors.tabBar, borderTopColor: colors.tabBarBorder }]}>
        <TabButton
          label="Tuner"
          active={activeTab === 'tuner'}
          onPress={goToTuner}
          activeColor={colors.text}
          inactiveColor={colors.tabInactive}
        />
        <TabButton
          label="History"
          active={activeTab === 'history'}
          onPress={goToHistory}
          activeColor={colors.text}
          inactiveColor={colors.tabInactive}
        />
        <TabButton
          label="Settings"
          active={activeTab === 'settings'}
          onPress={goToSettings}
          activeColor={colors.text}
          inactiveColor={colors.tabInactive}
        />
      </View>
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
  activeColor,
  inactiveColor,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  activeColor: string;
  inactiveColor: string;
}) {
  return (
    <TouchableOpacity style={styles.tab} onPress={onPress}>
      <Text style={[styles.tabLabel, { color: active ? activeColor : inactiveColor, fontWeight: active ? '700' : '500' }]}>
        {label}
      </Text>
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
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  tabLabel: {
    fontSize: 13,
  },
});

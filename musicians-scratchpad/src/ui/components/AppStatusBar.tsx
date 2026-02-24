import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export type AppState = 'idle' | 'requesting' | 'listening' | 'denied' | 'error';

interface Props {
  appState: AppState;
  showHint?: boolean;
}

const STATE_MESSAGES: Record<AppState, string> = {
  idle:       'Tap Listen to start',
  requesting: 'Requesting microphone permission…',
  listening:  'Listening…',
  denied:     'Microphone access denied. Open Settings to allow.',
  error:      'Audio error. Tap Listen to retry.',
};

export function AppStatusBar({ appState, showHint }: Props) {
  const { colors } = useTheme();
  const message = STATE_MESSAGES[appState];
  const isError = appState === 'denied' || appState === 'error';

  return (
    <View style={styles.container}>
      <Text style={[styles.text, { color: colors.textMuted }, isError && { color: colors.accentDanger }]}>
        {message}
      </Text>
      {showHint && appState === 'listening' && (
        <Text style={[styles.hint, { color: colors.textPlaceholder }]}>
          Try humming or playing a note
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  text: {
    fontSize: 14,
    textAlign: 'center',
  },
  hint: {
    fontSize: 13,
    marginTop: 4,
    fontStyle: 'italic',
  },
});

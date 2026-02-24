import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PitchResult } from '../../bridge/types';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  pitch: PitchResult | null;
}

export function PitchDisplay({ pitch }: Props) {
  const { colors } = useTheme();

  if (!pitch) {
    return (
      <View style={styles.container}>
        <Text style={[styles.notePlaceholder, { color: colors.textPlaceholder }]}>—</Text>
        <Text style={styles.octavePlaceholder}> </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.noteName, { color: colors.text }]}>{pitch.noteName}</Text>
      <Text style={[styles.octave, { color: colors.textSecondary }]}>{pitch.octave}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  noteName: {
    fontSize: 120,
    fontWeight: '700',
    lineHeight: 130,
  },
  octave: {
    fontSize: 48,
    fontWeight: '400',
    alignSelf: 'flex-end',
    marginBottom: 16,
    marginLeft: 4,
  },
  notePlaceholder: {
    fontSize: 120,
    fontWeight: '300',
    lineHeight: 130,
  },
  octavePlaceholder: {
    fontSize: 48,
    alignSelf: 'flex-end',
    marginBottom: 16,
  },
});

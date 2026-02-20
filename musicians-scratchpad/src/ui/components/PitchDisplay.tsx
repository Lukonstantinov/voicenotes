import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PitchResult } from '../../bridge/types';

interface Props {
  pitch: PitchResult | null;
}

export function PitchDisplay({ pitch }: Props) {
  if (!pitch) {
    return (
      <View style={styles.container}>
        <Text style={styles.notePlaceholder}>—</Text>
        <Text style={styles.octavePlaceholder}> </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.noteName}>{pitch.noteName}</Text>
      <Text style={styles.octave}>{pitch.octave}</Text>
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
  notePlaceholder: {
    fontSize: 120,
    fontWeight: '300',
    color: '#ccc',
    lineHeight: 130,
  },
  octavePlaceholder: {
    fontSize: 48,
    alignSelf: 'flex-end',
    marginBottom: 16,
  },
});

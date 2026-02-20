import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  cents: number | null;
}

// Positive cents → sharp (right), negative → flat (left)
export function CentIndicator({ cents }: Props) {
  const clamped = cents !== null ? Math.max(-50, Math.min(50, cents)) : null;
  const inTune  = clamped !== null && Math.abs(clamped) <= 5;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>flat</Text>
      <View style={styles.track}>
        <View style={styles.center} />
        {clamped !== null && (
          <View
            style={[
              styles.needle,
              {
                backgroundColor: inTune ? '#27ae60' : '#e67e22',
                left: `${50 + (clamped / 50) * 46}%` as unknown as number,
              },
            ]}
          />
        )}
      </View>
      <Text style={styles.label}>sharp</Text>
      {clamped !== null && (
        <Text style={styles.centsValue}>
          {clamped > 0 ? `+${clamped}` : `${clamped}`} ¢
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    width: '80%',
    marginTop: 16,
  },
  track: {
    width: '100%',
    height: 8,
    backgroundColor: '#ddd',
    borderRadius: 4,
    position: 'relative',
    justifyContent: 'center',
    marginVertical: 4,
  },
  center: {
    position: 'absolute',
    left: '50%' as unknown as number,
    width: 2,
    height: 16,
    backgroundColor: '#333',
    top: -4,
  },
  needle: {
    position: 'absolute',
    width: 4,
    height: 20,
    borderRadius: 2,
    top: -6,
    marginLeft: -2,
  },
  label: {
    fontSize: 11,
    color: '#888',
    alignSelf: 'center',
  },
  centsValue: {
    fontSize: 14,
    color: '#555',
    marginTop: 4,
  },
});

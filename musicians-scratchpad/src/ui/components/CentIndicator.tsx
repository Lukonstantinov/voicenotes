import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  cents: number | null;
}

// Positive cents → sharp (right), negative → flat (left)
export function CentIndicator({ cents }: Props) {
  const { colors } = useTheme();
  const clamped = cents !== null ? Math.max(-50, Math.min(50, cents)) : null;
  const inTune  = clamped !== null && Math.abs(clamped) <= 5;

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.textMuted }]}>flat</Text>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.center, { backgroundColor: colors.text }]} />
        {clamped !== null && (
          <View
            style={[
              styles.needle,
              {
                backgroundColor: inTune ? colors.accentSuccess : colors.accentWarning,
                left: `${50 + (clamped / 50) * 46}%` as unknown as number,
              },
            ]}
          />
        )}
      </View>
      <Text style={[styles.label, { color: colors.textMuted }]}>sharp</Text>
      {clamped !== null && (
        <Text style={[styles.centsValue, { color: colors.textSecondary }]}>
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
    alignSelf: 'center',
  },
  centsValue: {
    fontSize: 14,
    marginTop: 4,
  },
});

import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  isListening: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export function ListenButton({ isListening, onPress, disabled }: Props) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      style={[
        styles.button,
        isListening
          ? styles.buttonActive
          : { backgroundColor: colors.surface, borderColor: colors.text },
        disabled && styles.buttonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={isListening ? 'Stop listening' : 'Start listening'}
    >
      <Text style={[styles.label, { color: colors.text }, isListening && styles.labelActive]}>
        {isListening ? 'Stop' : 'Listen'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    borderWidth: 3,
  },
  buttonActive: {
    backgroundColor: '#e74c3c',
    borderColor: '#c0392b',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
  },
  labelActive: {
    color: '#fff',
  },
});

import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

interface Props {
  isListening: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export function ListenButton({ isListening, onPress, disabled }: Props) {
  return (
    <TouchableOpacity
      style={[
        styles.button,
        isListening ? styles.buttonActive : styles.buttonIdle,
        disabled && styles.buttonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={isListening ? 'Stop listening' : 'Start listening'}
    >
      <Text style={[styles.label, isListening && styles.labelActive]}>
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
  buttonIdle: {
    backgroundColor: '#fff',
    borderColor: '#1a1a2e',
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
    color: '#1a1a2e',
  },
  labelActive: {
    color: '#fff',
  },
});

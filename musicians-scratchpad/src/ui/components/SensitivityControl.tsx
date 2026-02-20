import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// ── Sensitivity levels ────────────────────────────────────────────────────────
// dBFS threshold for the RMS silence gate.
// Lower (more negative) = more sensitive; higher = only loud sounds trigger.
export type SensitivityLevel = 'whisper' | 'soft' | 'normal' | 'loud';

export interface SensitivityOption {
  level: SensitivityLevel;
  label: string;
  db: number;
}

export const SENSITIVITY_OPTIONS: SensitivityOption[] = [
  { level: 'whisper', label: 'Whisper', db: -65 },
  { level: 'soft',    label: 'Soft',    db: -52 },
  { level: 'normal',  label: 'Normal',  db: -40 },
  { level: 'loud',    label: 'Loud',    db: -25 },
];

interface Props {
  selected: SensitivityLevel;
  onChange: (option: SensitivityOption) => void;
}

export function SensitivityControl({ selected, onChange }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Mic Sensitivity</Text>
      <View style={styles.row}>
        {SENSITIVITY_OPTIONS.map((opt) => {
          const active = opt.level === selected;
          return (
            <TouchableOpacity
              key={opt.level}
              style={[styles.btn, active && styles.btnActive]}
              onPress={() => onChange(opt)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.btnText, active && styles.btnTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.hint}>
        ← more sensitive &nbsp;&nbsp; less sensitive →
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginTop: 24,
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    overflow: 'hidden',
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
  },
  btnActive: {
    backgroundColor: '#2563eb',
  },
  btnText: {
    fontSize: 14,
    color: '#444',
    fontWeight: '500',
  },
  btnTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  hint: {
    fontSize: 11,
    color: '#aaa',
    marginTop: 2,
  },
});

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { lightColors, darkColors } from './colors';
import type { ThemeColors } from './colors';

export type ThemeMode = 'light' | 'dark';

interface ThemeValue {
  colors: ThemeColors;
  mode: ThemeMode;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeValue>({
  colors: darkColors,
  mode: 'dark',
  isDark: true,
});

interface ProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ProviderProps) {
  const colorScheme = useColorScheme();
  const mode: ThemeMode = colorScheme === 'light' ? 'light' : 'dark';

  const value = useMemo<ThemeValue>(() => ({
    colors: mode === 'dark' ? darkColors : lightColors,
    mode,
    isDark: mode === 'dark',
  }), [mode]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

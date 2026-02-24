export interface ThemeColors {
  // Backgrounds
  background: string;
  surface: string;
  surfaceAlt: string;

  // Text
  text: string;
  textSecondary: string;
  textMuted: string;
  textPlaceholder: string;

  // Borders
  border: string;
  borderLight: string;

  // Accents
  accent: string;
  accentDanger: string;
  accentSuccess: string;
  accentWarning: string;

  // Tab bar
  tabBar: string;
  tabBarBorder: string;
  tabInactive: string;

  // Piano roll
  gridWhiteKey: string;
  gridBlackKey: string;
}

export const lightColors: ThemeColors = {
  background: '#f9f9f9',
  surface: '#fff',
  surfaceAlt: '#f0f0ff',

  text: '#1a1a2e',
  textSecondary: '#555',
  textMuted: '#888',
  textPlaceholder: '#ccc',

  border: '#ddd',
  borderLight: '#eee',

  accent: '#3498db',
  accentDanger: '#e74c3c',
  accentSuccess: '#27ae60',
  accentWarning: '#e67e22',

  tabBar: '#fafafa',
  tabBarBorder: '#ddd',
  tabInactive: '#888',

  gridWhiteKey: '#f5f5fa',
  gridBlackKey: '#e8e8ee',
};

export const darkColors: ThemeColors = {
  background: '#121218',
  surface: '#1c1c28',
  surfaceAlt: '#252536',

  text: '#e8e8f0',
  textSecondary: '#a0a0b0',
  textMuted: '#6c6c80',
  textPlaceholder: '#4a4a5a',

  border: '#2c2c3a',
  borderLight: '#252536',

  accent: '#5dade2',
  accentDanger: '#e74c3c',
  accentSuccess: '#2ecc71',
  accentWarning: '#e67e22',

  tabBar: '#161622',
  tabBarBorder: '#2c2c3a',
  tabInactive: '#6c6c80',

  gridWhiteKey: '#1a1a26',
  gridBlackKey: '#222230',
};

/**
 * TurboModule codegen spec.
 * File MUST be named Native<ModuleName>.ts for @react-native/codegen to discover it.
 * The module name 'AudioPitch' is used on both iOS and Android.
 */
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

// Inline so codegen can introspect all fields without chasing imports
export interface PitchResult {
  frequency: number;
  noteName: string;
  octave: number;
  fullName: string;
  cents: number;
  confidence: number;
  timestamp: number;
}

export interface Spec extends TurboModule {
  startListening(): void;
  stopListening(): void;
  // Non-Promise return → synchronous JSI call in TurboModule runtime
  getLatestPitch(): PitchResult | null;
}

export default TurboModuleRegistry.getEnforcing<Spec>('AudioPitch');

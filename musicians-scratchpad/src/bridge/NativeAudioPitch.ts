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

/** One pitch-detected frame returned by analyzeAudioFile. */
export interface RawPitchFrame {
  noteName: string;
  octave: number;
  frequency: number;
  cents: number;
  confidence: number;
  timestampMs: number;
}

export interface Spec extends TurboModule {
  startListening(): void;
  stopListening(): void;
  // Non-Promise return → synchronous JSI call in TurboModule runtime
  getLatestPitch(): PitchResult | null;
  /** Update the three runtime-tunable sensitivity constants. */
  setSensitivity(silenceDb: number, confidenceEnter: number, confidenceExit: number): void;
  /** Update the A4 reference frequency used for note name / cents calculation. */
  setA4Calibration(hz: number): void;
  /** Offline pitch analysis of a local audio file. Resolves with one frame per detected note window. */
  analyzeAudioFile(filePath: string): Promise<ReadonlyArray<RawPitchFrame>>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('AudioPitch');

/**
 * TurboModule codegen spec.
 * File MUST be named Native<ModuleName>.ts for @react-native/codegen to discover it.
 * The module name 'AudioPitch' is used on both iOS and Android.
 *
 * Pitch data is delivered via 'pitchUpdate' DeviceEventEmitter events, not by polling.
 * addListener / removeListeners are required boilerplate for NativeEventEmitter support.
 */
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  startListening(): void;
  stopListening(): void;
  // Required by NativeEventEmitter
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('AudioPitch');

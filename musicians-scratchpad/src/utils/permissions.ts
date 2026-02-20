export type PermissionStatus = 'granted' | 'denied' | 'blocked' | 'unavailable';

export type MicPermissionHandlers = {
  requestPermission: () => Promise<PermissionStatus>;
  openSettings: () => void;
};

export function isPermissionGranted(status: PermissionStatus): boolean {
  return status === 'granted';
}

export function isPermissionPermanentlyDenied(status: PermissionStatus): boolean {
  return status === 'blocked';
}

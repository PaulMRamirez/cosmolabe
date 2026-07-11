import { describe, it, expect } from 'vitest';
import { webCapabilities } from '@bessel/pal-web';
import { capacitorCapabilities } from '@bessel/pal-capacitor';
import { electronCapabilities } from './index.ts';

// SPEC Phase 3: the Python scripting bridge is reported present on Electron and
// absent on web and Capacitor.
describe('Capabilities: Python bridge presence', () => {
  it('reports the Python bridge present only on Electron', () => {
    expect(electronCapabilities.pythonBridge).toBe(true);
    expect(webCapabilities.pythonBridge).toBe(false);
    expect(capacitorCapabilities.pythonBridge).toBe(false);
  });

  it('tags each Capabilities object with its platform target', () => {
    expect(electronCapabilities.target).toBe('electron');
    expect(webCapabilities.target).toBe('web');
    expect(capacitorCapabilities.target).toBe('capacitor');
  });
});

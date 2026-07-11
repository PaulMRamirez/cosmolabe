import type { CapacitorConfig } from '@capacitor/cli';

// webDir points at the canonical web build (apps/web/dist). `cap sync` keeps the
// native iOS project current after each web build. Android stays part of the
// architecture (ADR-0002) but is deferred from the gates: enabling it later is
// `cap add android` plus restoring it to the sync script.
const config: CapacitorConfig = {
  appId: 'gov.nasa.ammos.bessel',
  appName: 'Bessel',
  webDir: '../web/dist',
};

export default config;

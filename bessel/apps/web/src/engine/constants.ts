// Tunables shared by the engine and the viewer chrome. Scene units are 1e6 km;
// the focus distances frame each target (Saturn shows the rings close-up, the
// others the heliocentric system); bodies not listed use DEFAULT_FOCUS_DISTANCE.

export const STEPS = 120;

export const FOCUS_DISTANCE: Readonly<Record<string, number>> = {
  Sun: 7000, // frame the whole system out to Pluto's orbit (~39 AU)
  Earth: 320,
  Jupiter: 1200,
  Saturn: 0.7,
};

/** Default framing distance for a body not in FOCUS_DISTANCE. */
export const DEFAULT_FOCUS_DISTANCE = 600;

export const RATE_STEPS = [1, 60, 3600, 86400, 604800] as const;

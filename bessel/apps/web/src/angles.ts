// Shared angle-conversion constants for the web app. One source so the radian/degree
// factors are not redefined per module (they were copied in body-state, readouts, the
// analysis panel, and the analysis ops). Pure constants, no dependencies.

/** Radians to degrees. */
export const RAD2DEG = 180 / Math.PI;

/** Degrees to radians. */
export const DEG2RAD = Math.PI / 180;

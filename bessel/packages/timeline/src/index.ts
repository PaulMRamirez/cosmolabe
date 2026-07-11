// @bessel/timeline: time model and playback. All time is internally ephemeris
// time (ET, seconds past J2000); display formatting is UTC via @bessel/spice.

export type EphemerisTime = number;

export interface ClockListener {
  (et: EphemerisTime): void;
}

export interface ClockState {
  readonly et: EphemerisTime;
  readonly rate: number;
  readonly playing: boolean;
}

/** A playback clock the scene subscribes to. */
export class Clock {
  private et: EphemerisTime;
  private rate: number;
  private playing = false;
  private readonly listeners = new Set<ClockListener>();

  constructor(epoch: EphemerisTime = 0, rate = 1) {
    this.et = epoch;
    this.rate = rate;
  }

  get state(): ClockState {
    return { et: this.et, rate: this.rate, playing: this.playing };
  }

  setEpoch(et: EphemerisTime): void {
    this.et = et;
    this.emit();
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  /** Advance by wall-clock delta seconds, scaled by rate, when playing. */
  tick(deltaSeconds: number): void {
    if (!this.playing) return;
    this.et += deltaSeconds * this.rate;
    this.emit();
  }

  subscribe(listener: ClockListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l(this.et);
  }
}

export {
  sortByEt,
  markerFraction,
  arcBoundaryAnnotations,
  type TimelineAnnotation,
  type ArcBounds,
} from './annotations.ts';

export {
  EMPTY as EMPTY_WINDOW,
  windowFromIntervals,
  windowInsert,
  windowMeasure,
  windowCard,
  windowContains,
  windowUnion,
  windowUnionAll,
  windowIntersect,
  windowIntersectAll,
  windowDifference,
  windowComplement,
  windowContract,
  type Interval,
  type Window,
} from './window.ts';
export { findConstraintWindow, type ConstraintFn } from './geometry-finder.ts';

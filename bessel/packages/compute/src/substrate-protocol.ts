// The worker substrate's wire protocol (M-0004, generalized in Session 7
// from the grammar demo's worker): a host initializes one worker with kernel
// bytes (and optional synthetic SPK publications), then runs jobs by spec
// with streamed progress and cooperative cancel. Products cross the boundary
// by structured clone (typed arrays intact, NaN included); the f64le-base64
// encoding remains the contract for JSON and files, not postMessage. The
// wasm URL travels in init because only the host's bundler knows where its
// cspice.wasm asset lives.

import type { AccessJobRequest } from './access-job.ts';
import type { CoverageJobRequest } from './coverage-job.ts';
import type { GroundTrackJobRequest } from './ground-track-job.ts';
import type { SeriesJobRequest } from './series-job.ts';
import type { AnalysisProduct } from './product.ts';

export type JobSpec =
  | { readonly kind: 'access'; readonly request: AccessJobRequest }
  | { readonly kind: 'coverage'; readonly request: CoverageJobRequest }
  | { readonly kind: 'series'; readonly request: SeriesJobRequest }
  | { readonly kind: 'groundTrack'; readonly request: GroundTrackJobRequest };

/** A synthetic Type 13 SPK publication in wire form (structured-cloneable). */
export interface WireSpkPublication {
  readonly name: string;
  readonly body: number;
  readonly center: number;
  readonly frame: string;
  readonly segid: string;
  readonly degree: number;
  readonly epochs: Float64Array;
  readonly states: Float64Array;
}

export interface SubstrateInit {
  readonly kernels: readonly { readonly name: string; readonly bytes: Uint8Array }[];
  /** Synthetic ephemerides to publish through the frames tier (provenance-tracked). */
  readonly publish?: readonly WireSpkPublication[];
  /** Optional epoch to resolve for the host (returned as et0 in ready). */
  readonly epoch?: string;
  /** The host bundler's URL for cspice.wasm; omitted in Node-like hosts. */
  readonly wasmUrl?: string;
}

export type SubstrateRequest =
  | ({ readonly kind: 'init' } & SubstrateInit)
  | {
      readonly kind: 'publish';
      readonly id: number;
      readonly spks: readonly WireSpkPublication[];
    }
  | { readonly kind: 'run'; readonly id: number; readonly job: JobSpec }
  | { readonly kind: 'cancel'; readonly id: number };

export type SubstrateResponse =
  | { readonly kind: 'ready'; readonly kernelSetHash: string; readonly et0: number | null }
  | {
      readonly kind: 'progress';
      readonly id: number;
      readonly pct: number;
      readonly partial?: AnalysisProduct;
    }
  | { readonly kind: 'published'; readonly id: number; readonly kernelSetHash: string }
  | { readonly kind: 'result'; readonly id: number; readonly product: AnalysisProduct }
  | {
      readonly kind: 'error';
      readonly id: number | null;
      readonly message: string;
      readonly cancelled: boolean;
    };

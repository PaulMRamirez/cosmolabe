// Wire types between the app and the compute worker (the M-0008 grammar demo
// host for @bessel/compute jobs). Products cross the boundary by structured
// clone (typed arrays survive intact, NaN included); the f64le-base64 wire
// encoding remains the contract for JSON and file consumers, not for
// postMessage. Cancellation is cooperative: a cancel message trips the job's
// AbortSignal in the worker, mirroring JobHandle.cancel.

import type {
  AccessJobRequest,
  AnalysisProduct,
  CoverageJobRequest,
  GroundTrackJobRequest,
  SeriesJobRequest,
} from '@bessel/compute';

/** The four demo jobs: one per product kind, GS-2 era plus the GS-4 walker. */
export type GrammarJobKind = 'gs2-access' | 'gs2-series' | 'gs2-track' | 'gs4-field';

export type GrammarJobSpec =
  | { readonly kind: 'access'; readonly request: AccessJobRequest }
  | { readonly kind: 'coverage'; readonly request: CoverageJobRequest }
  | { readonly kind: 'series'; readonly request: SeriesJobRequest }
  | { readonly kind: 'groundTrack'; readonly request: GroundTrackJobRequest };

/** A six-plane Walker set published as synthetic Type 13 SPKs at worker init. */
export interface WalkerInit {
  readonly planes: number;
  readonly smaKm: number;
  readonly incRad: number;
  readonly centerBody: number;
  readonly bodyBase: number;
  readonly epochEt: number;
  readonly spanS: number;
  readonly stepS: number;
}

export type ComputeWorkerRequest =
  | {
      readonly kind: 'init';
      readonly kernels: readonly { readonly name: string; readonly bytes: Uint8Array }[];
      readonly walker?: WalkerInit;
      readonly epoch: string;
    }
  | { readonly kind: 'run'; readonly id: number; readonly job: GrammarJobSpec }
  | { readonly kind: 'cancel'; readonly id: number };

export type ComputeWorkerResponse =
  | { readonly kind: 'ready'; readonly kernelSetHash: string; readonly et0: number }
  | {
      readonly kind: 'progress';
      readonly id: number;
      readonly pct: number;
      readonly partial?: AnalysisProduct;
    }
  | { readonly kind: 'result'; readonly id: number; readonly product: AnalysisProduct }
  | {
      readonly kind: 'error';
      readonly id: number | null;
      readonly message: string;
      readonly cancelled: boolean;
    };

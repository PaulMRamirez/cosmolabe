// The single source of truth for the Electron IPC surface. Both the preload/main
// (apps/desktop) and the renderer-side IpcKernelSource import this, so the typed
// bridge cannot drift. This module must NOT import electron, preserving the
// dependency rule (pal-electron stays platform-interface-only at the type level).

import type { KernelHandle, PalErrorCode } from '@bessel/pal';

/** IPC channel names, namespaced and stable (public surface). */
export const BESSEL_IPC = {
  listKernels: 'bessel:listKernels',
  resolveKernel: 'bessel:resolveKernel',
  readKernel: 'bessel:readKernel',
  readKernelRange: 'bessel:readKernelRange',
  resolveMetaKernel: 'bessel:resolveMetaKernel',
  openDialog: 'bessel:openDialog',
  saveDialog: 'bessel:saveDialog',
  runPython: 'bessel:runPython',
  pythonAvailable: 'bessel:pythonAvailable',
} as const;

/** Serialized PalError shape carried across IPC so the renderer can rethrow typed. */
export interface SerializedPalError {
  readonly message: string;
  readonly code: PalErrorCode;
  readonly location?: string;
}

export interface DialogOpenOptions {
  readonly title?: string;
  readonly filters?: ReadonlyArray<{ name: string; extensions: string[] }>;
}

export interface DialogSaveOptions {
  readonly title?: string;
  readonly defaultPath?: string;
}

export interface PythonRunRequest {
  /** Geometry product to compute, for example positions over a time grid. */
  readonly kind: 'spkpos-grid';
  readonly target: string;
  readonly observer: string;
  readonly frame: string;
  readonly startUtc: string;
  readonly stopUtc: string;
  readonly steps: number;
  readonly metaKernel: string;
}

export interface PythonRunResult {
  readonly rows: ReadonlyArray<{ et: number; position: [number, number, number] }>;
}

/** The typed bridge exposed on window.bessel by the preload. */
export interface BesselBridge {
  readonly platform: 'electron';
  readonly versions: NodeJS.ProcessVersions;
  listKernels(): Promise<KernelHandle[]>;
  resolveKernel(name: string): Promise<KernelHandle>;
  readKernel(id: string): Promise<Uint8Array>;
  readKernelRange(id: string, offset: number, length: number): Promise<Uint8Array>;
  /** Resolve a meta-kernel (.tm) to loadable kernel paths. */
  resolveMetaKernel(tmPath: string): Promise<string[]>;
  openDialog(options: DialogOpenOptions): Promise<string[] | null>;
  saveDialog(options: DialogSaveOptions): Promise<string | null>;
  runPython(request: PythonRunRequest): Promise<PythonRunResult>;
  pythonAvailable(): Promise<boolean>;
}

declare global {
  interface Window {
    readonly bessel?: BesselBridge;
  }
}

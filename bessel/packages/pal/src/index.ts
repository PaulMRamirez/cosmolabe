// @bessel/pal: the Platform Abstraction Layer interface.
//
// Core and UI depend ONLY on these interfaces, never on a concrete implementation
// (the dependency rule, CLAUDE.md). Each shell injects one implementation at
// startup. The SPICE engine reads kernel bytes only through KernelSource, so the
// same engine works over HTTP range, Capacitor paths, and the Electron filesystem.

export interface KernelHandle {
  /** Stable identity for caching (for example a content hash or canonical URL). */
  readonly id: string;
  /** Logical name, for example "naif0012.tls". */
  readonly name: string;
  /** Total byte length if known ahead of read. */
  readonly size?: number;
}

export interface KernelSource {
  /** Enumerate the kernels this source can provide. */
  list(): Promise<KernelHandle[]>;
  /** Resolve a kernel by name to a handle, or throw a located error if missing. */
  resolve(name: string): Promise<KernelHandle>;
  /** Read an entire kernel as bytes. */
  read(handle: KernelHandle): Promise<Uint8Array>;
  /** Read a byte range, for range-capable transports (HTTP range, file seek). */
  readRange?(handle: KernelHandle, offset: number, length: number): Promise<Uint8Array>;
}

export interface FileSystem {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
}

export interface Storage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ShareLinkRequest {
  readonly title: string;
  readonly url: string;
}

export interface ShareFileRequest {
  readonly title: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly data: Uint8Array;
}

export interface Share {
  /** Produce or hand off a shareable link. Returns the URL actually shared. */
  shareLink(request: ShareLinkRequest): Promise<string>;
  /** Hand a file to the platform share sheet, or persist it where appropriate. */
  shareFile(request: ShareFileRequest): Promise<void>;
}

/** Feature flags so the UI can degrade gracefully per target. */
export interface Capabilities {
  readonly target: PlatformTarget;
  /** Electron-only Python scripting bridge (Phase 3). */
  readonly pythonBridge: boolean;
  /** WebXR availability (Phase 4). */
  readonly webxr: boolean;
  /** Native share sheet vs link copy. */
  readonly nativeShare: boolean;
  /** File System Access API or native file dialogs. */
  readonly fileDialogs: boolean;
}

export type PlatformTarget = 'web' | 'capacitor' | 'electron';

/** The full set a shell injects. Core consumes this aggregate. */
export interface Platform {
  readonly kernels: KernelSource;
  readonly fs: FileSystem;
  readonly storage: Storage;
  readonly share: Share;
  readonly capabilities: Capabilities;
}

/** Located, typed error for PAL failures. Fail loudly (CLAUDE.md). */
export class PalError extends Error {
  constructor(
    message: string,
    readonly code: PalErrorCode,
    readonly location?: string,
  ) {
    super(message);
    this.name = 'PalError';
  }
}

export type PalErrorCode =
  | 'kernel-not-found'
  | 'read-failed'
  | 'write-failed'
  | 'not-supported'
  | 'storage-failed';

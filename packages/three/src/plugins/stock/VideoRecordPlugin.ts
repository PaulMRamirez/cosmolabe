import type { RendererPlugin } from '../RendererPlugin.js';
import type { PluginUISlots } from '../PluginUI.js';

/**
 * Stock plugin that adds "Start/Stop video recording" commands.
 * Captures the WebGL canvas via captureStream() + MediaRecorder and triggers a webm download on stop.
 *
 * Commands toggle a single recording instance — calling start while recording is a no-op,
 * stop is a no-op when idle. The "Toggle video recording" command flips between the two.
 */
export class VideoRecordPlugin implements RendererPlugin {
  readonly name = 'video-record';

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';

  /** Bitrate for the encoded stream, in bits per second. Tweak as needed. */
  videoBitsPerSecond = 12_000_000;
  /** Capture frame rate (the canvas drives frames; this is the cap). */
  fps = 60;

  get isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording';
  }

  readonly ui: PluginUISlots = {
    commands: [
      {
        id: 'video-record-toggle',
        label: 'Toggle video recording',
        category: 'Capture',
        execute: (ctx) => {
          if (this.isRecording) this.stop();
          else this.start(ctx.canvas);
        },
      },
      {
        id: 'video-record-start',
        label: 'Start video recording',
        category: 'Capture',
        enabled: () => !this.isRecording,
        execute: (ctx) => this.start(ctx.canvas),
      },
      {
        id: 'video-record-stop',
        label: 'Stop video recording (download webm)',
        category: 'Capture',
        enabled: () => this.isRecording,
        execute: () => this.stop(),
      },
    ],
  };

  private pickMimeType(): string {
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    for (const c of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  /** Start recording the canvas. No-op if already recording. */
  start(canvas: HTMLCanvasElement): void {
    if (this.isRecording) return;
    if (typeof MediaRecorder === 'undefined') {
      console.warn('[VideoRecordPlugin] MediaRecorder API not available in this browser');
      return;
    }
    if (typeof (canvas as HTMLCanvasElement & { captureStream?: () => MediaStream }).captureStream !== 'function') {
      console.warn('[VideoRecordPlugin] canvas.captureStream() not supported');
      return;
    }

    this.mimeType = this.pickMimeType();
    const stream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(this.fps);
    const options: MediaRecorderOptions = { videoBitsPerSecond: this.videoBitsPerSecond };
    if (this.mimeType) options.mimeType = this.mimeType;

    try {
      this.recorder = new MediaRecorder(stream, options);
    } catch (err) {
      console.error('[VideoRecordPlugin] failed to create MediaRecorder', err);
      this.recorder = null;
      return;
    }

    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => {
      const ext = this.mimeType.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(this.chunks, { type: this.mimeType || `video/${ext}` });
      this.download(blob, ext);
      this.recorder = null;
      this.chunks = [];
    };
    this.recorder.start();
  }

  /** Stop recording and trigger a download. No-op if idle. */
  stop(): void {
    if (!this.recorder) return;
    if (this.recorder.state !== 'inactive') this.recorder.stop();
  }

  private download(blob: Blob, ext: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cosmolabe-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

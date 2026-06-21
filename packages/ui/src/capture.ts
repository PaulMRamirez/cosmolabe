// Screen capture (still image) and video recording over a canvas. The canvas is
// created with preserveDrawingBuffer so toBlob and captureStream work. Fails loudly
// with a typed error when the browser lacks support.

export class CaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureError';
  }
}

/** Capture the current canvas frame as a PNG blob. */
export function captureStill(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new CaptureError('Canvas toBlob produced no image'));
    }, 'image/png');
  });
}

export interface Recorder {
  stop(): Promise<Blob>;
}

const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/** Start recording the canvas to a webm video. Returns a handle whose stop resolves the blob. */
export function startRecording(canvas: HTMLCanvasElement, fps = 30): Recorder {
  const captureStream = (canvas as HTMLCanvasElement & {
    captureStream?: (fps?: number) => MediaStream;
  }).captureStream;
  if (typeof captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
    throw new CaptureError('Video recording is not supported in this environment');
  }
  const mimeType = VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const stream = captureStream.call(canvas, fps);
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  return {
    stop(): Promise<Blob> {
      return new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType ?? 'video/webm' }));
        recorder.stop();
      });
    },
  };
}

/** Trigger a browser download of a blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  // Firefox only dispatches the click when the anchor is in the document.
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously after click() cancels in-flight multi-MB downloads;
  // defer it so the browser has handed the blob to the download manager first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

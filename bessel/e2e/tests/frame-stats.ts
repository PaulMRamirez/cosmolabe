import { type Locator } from '@playwright/test';

export interface FrameStats {
  nonBackground: number;
  signature: number;
}

/** Count non-background pixels and a coarse signature of a WebGL canvas frame. */
export async function frameStats(viewport: Locator): Promise<FrameStats> {
  return viewport.evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    let nonBackground = 0;
    let signature = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (r > 24 || g > 24 || b > 24) {
        nonBackground += 1;
        signature = (signature + (i + 1) * (r + g * 3 + b * 7)) % 2147483647;
      }
    }
    return { nonBackground, signature };
  });
}

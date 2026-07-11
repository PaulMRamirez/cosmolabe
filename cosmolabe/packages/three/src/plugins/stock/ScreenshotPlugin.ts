import type { RendererPlugin } from '../RendererPlugin.js';
import type { PluginUISlots } from '../PluginUI.js';

/**
 * Stock plugin that adds a "Save screenshot" command to the command palette.
 * Captures the WebGL canvas as a PNG and triggers a download.
 */
export class ScreenshotPlugin implements RendererPlugin {
  readonly name = 'screenshot';

  readonly ui: PluginUISlots = {
    commands: [
      {
        id: 'screenshot',
        label: 'Save screenshot',
        category: 'Capture',
        execute: (ctx) => {
          // Do a full multi-pass render right now so the canvas backing store
          // holds the complete composite (bodies + tiles + models + markers +
          // bloom). Then immediately read pixels via the synchronous
          // toDataURL — async toBlob is unsafe without preserveDrawingBuffer,
          // since the next rAF can clear the buffer before encoding reads it.
          ctx.renderFrame();
          const dataUrl = ctx.canvas.toDataURL('image/png');
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `cosmolabe-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
          a.click();
        },
      },
    ],
  };
}

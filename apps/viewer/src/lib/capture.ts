/**
 * Capture utilities — small helpers around the ScreenshotPlugin and
 * VideoRecordPlugin so UI components can trigger them without reaching
 * through `renderer.getPlugins().find(...)` themselves.
 */
import type { UniverseRenderer } from '@cosmolabe/three';
import { VideoRecordPlugin } from '@cosmolabe/three';

export function takeScreenshot(renderer: UniverseRenderer): void {
  const plugin = renderer.getPlugins().find((p) => p.name === 'screenshot');
  const cmd = plugin?.ui?.commands?.find((c) => c.id === 'screenshot');
  cmd?.execute(renderer.getContext());
}

function getVideoPlugin(renderer: UniverseRenderer): VideoRecordPlugin | undefined {
  return renderer.getPlugins().find((p): p is VideoRecordPlugin => p instanceof VideoRecordPlugin);
}

export function isRecordingVideo(renderer: UniverseRenderer): boolean {
  return getVideoPlugin(renderer)?.isRecording ?? false;
}

export function toggleVideoRecording(renderer: UniverseRenderer): boolean {
  const plugin = getVideoPlugin(renderer);
  if (!plugin) return false;
  if (plugin.isRecording) plugin.stop();
  else plugin.start(renderer.getContext().canvas);
  return plugin.isRecording;
}

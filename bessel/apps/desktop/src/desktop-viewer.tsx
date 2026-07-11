// Desktop renderer: mounts the shared @bessel/scene and the SPICE worker over
// pal-electron (IPC kernel loading), resolves a meta-kernel through the typed
// bridge, reads its DSK shape model, and renders it. This is the Phase 3 desktop
// parity path (meta-kernel resolution plus DSK rendering).
import { useEffect, useRef, useState } from 'react';
import { SolarSystemScene } from '@bessel/scene';
import { createElectronPlatform } from '@bessel/pal-electron';
import { connectSpice } from './spice.ts';

const leaf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

// MU69 spans tens of km; scale it to a few scene units for a framed body view.
const DSK_SCALE = 0.5;

export function DesktopViewer(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('Initializing');
  const [ready, setReady] = useState(false);
  const [dskPlates, setDskPlates] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let disposed = false;

    void (async () => {
      try {
        const bridge = window.bessel;
        if (!bridge) throw new Error('Electron bridge unavailable');
        const platform = await createElectronPlatform(bridge);
        const spice = connectSpice();

        setStatus('Resolving meta-kernel');
        const kernelPaths = await bridge.resolveMetaKernel('mu69.tm');

        setStatus('Loading kernels');
        let dsk: { name: string; bytes: Uint8Array } | null = null;
        for (const path of kernelPaths) {
          const name = leaf(path);
          const bytes = await platform.kernels.read({ id: path, name });
          await spice.furnsh(name, bytes);
          if (name.endsWith('.bds')) dsk = { name, bytes };
        }
        if (!dsk) throw new Error('Meta-kernel did not reference a DSK (.bds)');

        setStatus('Reading DSK shape model');
        const shape = await spice.readDsk(dsk.name, dsk.bytes);
        if (disposed) return;

        const scene = new SolarSystemScene(canvas);
        scene.setDskMesh('mu69', 'MU69', shape.vertices, shape.plates, undefined, DSK_SCALE);
        scene.setPositions(new Map([['MU69', [0, 0, 0]]]));
        scene.setView(0.7, 0.3, 30);

        const frame = (): void => {
          scene.render();
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);

        setDskPlates(shape.plates.length / 3);
        setStatus('Ready');
        setReady(true);
      } catch (err) {
        if (!disposed) setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <main className="desktop-shell">
      <h1>Bessel Desktop</h1>
      <div data-testid="status">{status}</div>
      <canvas
        ref={canvasRef}
        id="viewport"
        aria-label="3D viewport"
        width={900}
        height={600}
        data-ready={ready}
        data-dsk-plates={dskPlates}
        data-testid="viewport"
      />
    </main>
  );
}

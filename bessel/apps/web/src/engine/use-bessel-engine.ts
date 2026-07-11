// React lifecycle binding for BesselEngine: constructs the engine against the
// canvas and the shared store on mount, boots it, attaches pointer controls, and
// disposes on unmount. The component reads state through useStore and calls the
// returned engine's methods from event handlers.

import { useEffect, useState, type RefObject } from 'react';
import type { AppStore } from '../store/index.ts';
import { BesselEngine } from './engine.ts';

export function useBesselEngine(
  canvasRef: RefObject<HTMLCanvasElement>,
  store: AppStore,
): BesselEngine | null {
  const [engine, setEngine] = useState<BesselEngine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const eng = new BesselEngine(canvas, store);
    setEngine(eng);
    void eng.boot();
    const detachPointer = eng.attachPointer();
    // Keep the renderer crisp as the resizable dock changes the canvas size.
    const observer = new ResizeObserver(() => {
      eng.resize(canvas.clientWidth, canvas.clientHeight);
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      detachPointer();
      eng.dispose();
      setEngine(null);
    };
  }, [canvasRef, store]);

  return engine;
}

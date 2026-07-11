// Object labels rendered as a DOM overlay above the WebGL canvas. Each frame the
// label layer projects an anchor's world position to screen pixels and positions
// a div there, so labels track bodies through the camera-relative transform.
// Using DOM (rather than sprites) keeps text crisp at any zoom and makes labels
// inspectable; the layer is aria-hidden because the object browser already lists
// the same names for assistive tech.

import { Vector3, type Camera, type Object3D } from 'three';

export interface LabelTarget {
  readonly id: string;
  readonly text: string;
  readonly object: Object3D;
  /** Optional CSS color for this label's text (a catalog per-item override). */
  readonly color?: string;
}

/** Project a world position to screen pixels and report whether it is on screen. */
export function projectToScreen(
  world: Vector3,
  camera: Camera,
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  const v = world.clone().project(camera);
  const x = (v.x * 0.5 + 0.5) * width;
  const y = (-v.y * 0.5 + 0.5) * height;
  const visible = v.z < 1 && v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1;
  return { x, y, visible };
}

interface LabelEntry {
  readonly target: LabelTarget;
  readonly el: HTMLElement;
}

export class LabelLayer {
  readonly dom: HTMLElement;
  private entries: LabelEntry[] = [];
  private width = 0;
  private height = 0;
  private visible = true;
  private readonly scratch = new Vector3();

  constructor() {
    this.dom = document.createElement('div');
    this.dom.className = 'bessel-label-layer';
    this.dom.setAttribute('aria-hidden', 'true');
    this.dom.style.position = 'absolute';
    this.dom.style.inset = '0';
    this.dom.style.overflow = 'hidden';
    this.dom.style.pointerEvents = 'none';
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.dom.style.display = visible ? '' : 'none';
  }

  setLabels(targets: readonly LabelTarget[]): void {
    for (const entry of this.entries) entry.el.remove();
    this.entries = targets.map((target) => {
      const el = document.createElement('span');
      el.className = 'bessel-label';
      el.dataset['labelId'] = target.id;
      el.textContent = target.text;
      el.style.position = 'absolute';
      el.style.transform = 'translate(-50%, -120%)';
      if (target.color) el.style.color = target.color;
      this.dom.appendChild(el);
      return { target, el };
    });
  }

  update(camera: Camera): void {
    if (!this.visible || this.width === 0) return;
    for (const { target, el } of this.entries) {
      if (!target.object.visible) {
        el.style.display = 'none';
        continue;
      }
      target.object.getWorldPosition(this.scratch);
      const p = projectToScreen(this.scratch, camera, this.width, this.height);
      if (!p.visible) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    }
  }

  dispose(): void {
    for (const entry of this.entries) entry.el.remove();
    this.entries = [];
    this.dom.remove();
  }
}

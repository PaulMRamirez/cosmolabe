/**
 * AsteroidSwarmPlugin — point-cloud rendering of 10K-1M asteroid orbits via
 * GPU Keplerian propagation. Sibling plugin to StarFieldRenderer.
 *
 * **STATUS: SCAFFOLDING ONLY.** Plan in
 * `~/code/claude-plans/cosmolabe/asteroid-swarm-plugin.md`. Implementation pending.
 *
 * The contract here matches the planned design so a host can register the
 * plugin today; calling it just logs a warning until the real implementation
 * lands.
 *
 * Why a separate plugin (vs. the catalog's `spkImport` directive):
 *   - `spkImport` creates one `Body` object per asteroid — fine up to ~hundreds.
 *   - This plugin uses a single instanced point cloud + a vertex shader that
 *     does Keplerian propagation on the GPU. Scales to ~1M without touching
 *     the universe state or per-body trajectory cache.
 */

import * as THREE from 'three';
import type { RendererPlugin } from './RendererPlugin.js';
import type { RendererContext } from './RendererContext.js';

export interface AsteroidSwarmPluginOptions {
  /**
   * URL of a binary `.swarm` file produced by `scripts/build-swarm.mjs`.
   * Format: header + interleaved Float32Array of orbital elements.
   * See plan doc for the full schema.
   */
  source: string;

  /** Base point size in screen pixels. Default 1.5. */
  pointSize?: number;

  /** Hex/RGB tint applied to all points. Default: light gray. */
  color?: number | [number, number, number];

  /** Optional name for the plugin instance (for debugging / multi-swarm scenes). */
  name?: string;
}

export class AsteroidSwarmPlugin implements RendererPlugin {
  readonly name: string;
  private readonly source: string;
  private readonly pointSize: number;
  private readonly color: THREE.Color;
  private points: THREE.Points | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private warned = false;

  constructor(options: AsteroidSwarmPluginOptions) {
    this.name = options.name ?? 'asteroid-swarm';
    this.source = options.source;
    this.pointSize = options.pointSize ?? 1.5;
    this.color = options.color !== undefined
      ? new THREE.Color(...(Array.isArray(options.color) ? options.color : [options.color]) as [number] | [number, number, number])
      : new THREE.Color(0xaaaaaa);
  }

  onSceneSetup(_ctx: RendererContext): void {
    if (!this.warned) {
      console.warn(
        `[AsteroidSwarmPlugin:${this.name}] scaffolding only — see ~/code/claude-plans/cosmolabe/asteroid-swarm-plugin.md`,
      );
      this.warned = true;
    }
    // TODO Phase A: fetch + parse this.source, build BufferGeometry with one
    // vertex per orbit (attributes: sma, ecc, inc, node, aop, M0, n), build
    // ShaderMaterial with Keplerian-propagation vertex shader, create THREE.Points,
    // add to ctx.scene.
    void this.source; void this.pointSize; void this.color;
  }

  onBeforeRender(_et: number, _ctx: RendererContext): void {
    // TODO: this.material.uniforms.u_et.value = et;
    //       this.material.uniforms.u_originOffset.value = ctx.originAbsPos;
    //       this.material.uniforms.u_scaleFactor.value = ctx.scaleFactor;
  }

  dispose(): void {
    this.points?.geometry.dispose();
    this.material?.dispose();
    this.points = null;
    this.material = null;
  }
}

// The script runner parses cosmoscripting-style lines, coerces arguments, rejects
// unknown verbs, and reports the first failing line by number while still echoing
// the lines that ran before it. It uses no eval.

import { describe, it, expect } from 'vitest';
import { BesselScript, type ScriptHost } from './scripting.ts';
import { runScript } from './script-runner.ts';

function recordingScript(): { script: BesselScript; calls: string[] } {
  const calls: string[] = [];
  const host: ScriptHost = {
    gotoObject: (name) => calls.push(`goto:${name}`),
    gotoHome: () => calls.push('home'),
    select: (ids) => calls.push(`select:${ids.join(',')}`),
    setRate: (rate) => calls.push(`rate:${rate}`),
    setPlaying: (playing) => calls.push(`playing:${playing}`),
    setTime: (et) => calls.push(`time:${et}`),
    getTime: () => 0,
    track: (name) => calls.push(`track:${name}`),
    untrack: () => calls.push('untrack'),
    setFrame: (mode) => calls.push(`frame:${mode}`),
    setLayer: (key, on) => calls.push(`layer:${key}:${on}`),
    setObjectVisible: (id, visible) => calls.push(`vis:${id}:${visible}`),
    screenshot: () => calls.push('shot'),
    toggleRecording: (on) => calls.push(`rec:${on}`),
    note: (text) => calls.push(`note:${text}`),
    loadCatalog: (url) => calls.push(`load:${url}`),
    viewFromSun: () => calls.push('viewSun'),
    viewAlongVelocity: () => calls.push('viewVel'),
  };
  return { script: new BesselScript(host), calls };
}

describe('runScript', () => {
  it('parses verbs and coerces numbers, including scientific notation', () => {
    const { script, calls } = recordingScript();
    const result = runScript('gotoObject Earth\nsetTimeRate 3600\nsetTime 7.2e8', script);
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(calls).toEqual(['goto:Earth', 'rate:3600', 'time:720000000']);
  });

  it('ignores blank lines and # comments', () => {
    const { script, calls } = recordingScript();
    const result = runScript('# a tour\n\ngotoHome   # back home\n', script);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['home']);
    expect(result.echoLines).toEqual(['3: gotoHome']);
  });

  it('coerces a double-quoted string argument, keeping spaces', () => {
    const { script, calls } = recordingScript();
    const result = runScript('displayNote "Saturn orbit insertion"', script);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['note:Saturn orbit insertion']);
  });

  it('treats a bare identifier as text for object verbs', () => {
    const { script, calls } = recordingScript();
    runScript('gotoObject Titan', script);
    expect(calls).toEqual(['goto:Titan']);
  });

  it('rejects an unknown verb with a typed loud error', () => {
    const { script } = recordingScript();
    const result = runScript('warpDrive Earth', script);
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({ line: 1, message: 'unknown verb "warpDrive"' });
  });

  it('rejects an unknown layer name', () => {
    const { script } = recordingScript();
    const result = runScript('show wormholes', script);
    expect(result.ok).toBe(false);
    expect(result.error?.line).toBe(1);
    expect(result.error?.message).toContain('unknown layer "wormholes"');
  });

  it('reports the first failing line while echoing prior successful lines', () => {
    const { script, calls } = recordingScript();
    const result = runScript('gotoObject Earth\nbogusVerb\nsetTimeRate 60', script);
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({ line: 2, message: 'unknown verb "bogusVerb"' });
    // The line before the failure ran and is echoed; the line after did not.
    expect(result.echoLines).toEqual(['1: gotoObject Earth']);
    expect(calls).toEqual(['goto:Earth']);
  });

  it('requires a number where a number is expected', () => {
    const { script } = recordingScript();
    const result = runScript('setTimeRate fast', script);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('expected a number');
  });

  it('requires the declared number of arguments', () => {
    const { script } = recordingScript();
    const result = runScript('gotoObject', script);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('expects 1 argument');
  });

  it('rejects an Object.prototype member name as a verb (no prototype pollution)', () => {
    const { script } = recordingScript();
    // 'toString', 'constructor', 'valueOf' live on Object.prototype: a bare index of
    // the verb table would resolve them and bypass the unknown-verb throw.
    for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      const result = runScript(`${name} Earth`, script);
      expect(result.ok).toBe(false);
      expect(result.error).toEqual({ line: 1, message: `unknown verb "${name}"` });
    }
  });

  it('keeps a # inside a quoted string instead of treating it as a comment', () => {
    const { script, calls } = recordingScript();
    const result = runScript('displayNote "phase #3"', script);
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(calls).toEqual(['note:phase #3']);
  });

  it('still strips an unquoted trailing comment after the arguments', () => {
    const { script, calls } = recordingScript();
    const result = runScript('gotoObject Earth   # go home', script);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['goto:Earth']);
    expect(result.echoLines).toEqual(['1: gotoObject Earth']);
  });
});

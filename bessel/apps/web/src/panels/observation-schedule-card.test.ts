import { describe, it, expect } from 'vitest';
import { scheduleToCsv, removeTargetFromText } from './observation-schedule-card.tsx';
import type { ObservationScheduleResult } from '../store/index.ts';

// The CSV serializer and the per-row target removal are pure leaves (F31: the observation-schedule
// card grows a CSV export, a Clear-targets affordance, and a per-row remove). These pin the row
// shape and the input-list re-serialization without rendering the card or touching the store.

const schedule: ObservationScheduleResult = {
  span: [1000, 1600],
  pointing: 'nadir',
  label: 'Multi-target observation schedule',
  slots: [
    { targetName: 'Titan', start: 1060, stop: 1120, slewFromPrevDeg: 0, slewFromPrevSec: 0 },
    { targetName: 'Sun', start: 1300, stop: 1360, slewFromPrevDeg: 12.5, slewFromPrevSec: 30 },
  ],
  unscheduled: [{ targetName: 'Enceladus', reason: 'no visibility window' }],
};

describe('scheduleToCsv', () => {
  it('emits a header, one row per scheduled slot, then the unscheduled rows', () => {
    const csv = scheduleToCsv(schedule);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('status,target,start_et_s,stop_et_s,start_min,stop_min,slew_deg,slew_s,reason');
    // One scheduled row per slot, with ET and minutes-from-span-start.
    expect(lines[1]).toBe('scheduled,Titan,1060,1120,1,2,0,0,');
    expect(lines[2]).toBe('scheduled,Sun,1300,1360,5,6,12.5,30,');
    // Unscheduled targets land after the scheduled rows, with their located reason.
    expect(lines[3]).toBe('unscheduled,Enceladus,,,,,,,no visibility window');
  });
});

describe('removeTargetFromText', () => {
  it('drops the named target and preserves the order of the rest', () => {
    expect(removeTargetFromText('Titan, Sun, Enceladus', 'Sun')).toBe('Titan, Enceladus');
  });

  it('de-duplicates and normalizes whitespace/commas while removing', () => {
    expect(removeTargetFromText('Titan  Sun, Titan', 'Sun')).toBe('Titan');
  });

  it('is a no-op when the target is absent', () => {
    expect(removeTargetFromText('Titan, Sun', 'Pluto')).toBe('Titan, Sun');
  });
});

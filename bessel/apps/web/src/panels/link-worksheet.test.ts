import { describe, it, expect } from 'vitest';
import { assembleLinkWorksheet, worksheetCsvRows, LinkWorksheetError, type LinkWorksheetConfig } from './link-worksheet.ts';
import { friisPathLossDb, linkBudget, MODCOD_TABLE } from '@bessel/rf';

// The link worksheet assembly is a PURE roll-up over the @bessel/rf builders (analysis-UX Phase 2).
// These tests assert the itemized lines match the underlying builders, the margin matches a direct
// linkBudget roll-up at the same geometry, and the fail-loud paths.

const modcod = MODCOD_TABLE.find((m) => m.name === 'ccsds-conv-r1_2')!;

const config: LinkWorksheetConfig = {
  eirpDbW: 65,
  freqHz: 26e9,
  gOverTDbK: 30,
  dataRateBps: 1_000_000,
  antennaPattern: 'parabolic',
  hpbwDeg: 0.5,
  pointingErrorDeg: 0.1,
  txPolarization: 'rhcp',
  rxPolarization: 'rhcp',
  polMisalignDeg: 0,
  rainRateMmHr: 0,
  rainCoeffsKey: 'ka30',
  gaseousZenithDb: 0.3,
  requiredEbN0Db: modcod.requiredEbN0Db,
};

describe('assembleLinkWorksheet', () => {
  it('itemizes the budget with the EIRP, free-space loss, and required Eb/N0 lines', () => {
    const sheet = assembleLinkWorksheet(config, { rangeKm: 800, elevationRad: Math.PI / 3 });
    const byId = Object.fromEntries(sheet.lines.map((l) => [l.id, l]));
    // EIRP passes through; the free-space loss line is the negative of the Friis loss at the geometry.
    expect(byId.eirp!.value).toBe(65);
    expect(byId['free-space-loss']!.value).toBeCloseTo(-friisPathLossDb(800, 26e9), 6);
    // The required-Eb/N0 line carries the selected MODCOD threshold.
    expect(byId['required-eb-over-n0']!.value).toBe(modcod.requiredEbN0Db);
    // The margin line equals the sheet margin.
    expect(byId.margin!.value).toBeCloseTo(sheet.marginDb, 9);
  });

  it('matches a direct clear-sky linkBudget roll-up (no rain) within tolerance', () => {
    const geometry = { rangeKm: 1200, elevationRad: Math.PI / 4 };
    const sheet = assembleLinkWorksheet(config, geometry);
    // Clear sky: rain = 0, so G/T is not degraded. Other losses are pointing + polarization + gaseous.
    const pointing = sheet.lines.find((l) => l.id === 'pointing-loss')!.value;
    const polarization = sheet.lines.find((l) => l.id === 'polarization-loss')!.value;
    const gaseous = sheet.lines.find((l) => l.id === 'gaseous-attenuation')!.value;
    const otherLossesDb = -pointing - polarization - gaseous;
    const ref = linkBudget({
      eirpDbW: config.eirpDbW,
      distanceKm: geometry.rangeKm,
      freqHz: config.freqHz,
      gOverTDbK: config.gOverTDbK,
      dataRateBps: config.dataRateBps,
      otherLossesDb,
      requiredEbN0Db: config.requiredEbN0Db,
    });
    expect(sheet.ebN0Db).toBeCloseTo(ref.ebN0Db, 9);
    expect(sheet.marginDb).toBeCloseTo(ref.marginDb!, 9);
    expect(sheet.effectiveGOverTDbK).toBeCloseTo(config.gOverTDbK, 9);
  });

  it('degrades G/T and adds a rain-noise increment when rain is on', () => {
    const wet: LinkWorksheetConfig = { ...config, rainRateMmHr: 25 };
    const sheet = assembleLinkWorksheet(wet, { rangeKm: 1000, elevationRad: Math.PI / 6 });
    const rainNoise = sheet.lines.find((l) => l.id === 'rain-noise-temp')!.value;
    expect(rainNoise).toBeGreaterThan(0);
    // Rain raises the noise temperature, so the effective G/T is below the clear-sky figure.
    expect(sheet.effectiveGOverTDbK).toBeLessThan(config.gOverTDbK);
  });

  it('a lower elevation yields a worse (lower) margin than a higher elevation', () => {
    const wet: LinkWorksheetConfig = { ...config, rainRateMmHr: 25 };
    const low = assembleLinkWorksheet(wet, { rangeKm: 2000, elevationRad: (10 * Math.PI) / 180 });
    const high = assembleLinkWorksheet(wet, { rangeKm: 800, elevationRad: (60 * Math.PI) / 180 });
    expect(low.marginDb).toBeLessThan(high.marginDb);
  });

  it('fails loud on a non-positive range or an unknown rain band', () => {
    expect(() => assembleLinkWorksheet(config, { rangeKm: 0, elevationRad: 0.5 })).toThrow(LinkWorksheetError);
    const badBand = { ...config, rainRateMmHr: 5, rainCoeffsKey: 'bogus' as never };
    expect(() => assembleLinkWorksheet(badBand, { rangeKm: 800, elevationRad: 0.5 })).toThrow(LinkWorksheetError);
  });

  it('builds CSV rows one per line item', () => {
    const sheet = assembleLinkWorksheet(config, { rangeKm: 800, elevationRad: Math.PI / 3 });
    const rows = worksheetCsvRows(sheet);
    expect(rows).toHaveLength(sheet.lines.length);
    expect(rows[0]).toEqual([sheet.lines[0]!.label, sheet.lines[0]!.value, sheet.lines[0]!.unit]);
  });
});

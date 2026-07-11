// The programmatic authoring surface: a chainable builder that accumulates a BatchJob and
// lowers to the SAME IR a hand-written JSON job parses into, so the two front-ends cannot
// drift. toJSON validates before returning (fail fast). (STK_PARITY_SPEC, SDK.)

import { validateJob } from '../job/validate.ts';
import type {
  AnalyzeOp,
  AnalyzeAccessOp,
  AnalyzeEclipseOp,
  AnalyzeLinkBudgetOp,
  BatchJob,
  EntityDecl,
  ExportCsvOp,
  ExportOemOp,
  JobDefaults,
  LoadCatalogOp,
  Operation,
  OutputDecl,
  PropagateOp,
  ReportOp,
  RunMcsOp,
  SatelliteSource,
} from '../job/types.ts';

export interface JobBuilder {
  defaults(d: JobDefaults): JobBuilder;
  satellite(id: string, source: SatelliteSource): JobBuilder;
  furnish(names: readonly string[]): JobBuilder;
  loadCatalog(args: Omit<LoadCatalogOp, 'op'>): JobBuilder;
  propagate(id: string, op: Omit<PropagateOp, 'op' | 'id'>): JobBuilder;
  runMcs(id: string, op: Omit<RunMcsOp, 'op' | 'id'>): JobBuilder;
  analyze(id: string, op: Omit<AnalyzeOp, 'op' | 'id'>): JobBuilder;
  analyzeEclipse(id: string, op: Omit<AnalyzeEclipseOp, 'op' | 'id'>): JobBuilder;
  analyzeAccess(id: string, op: Omit<AnalyzeAccessOp, 'op' | 'id'>): JobBuilder;
  analyzeLinkBudget(id: string, op: Omit<AnalyzeLinkBudgetOp, 'op' | 'id'>): JobBuilder;
  report(args: Omit<ReportOp, 'op'>): JobBuilder;
  exportOem(args: Omit<ExportOemOp, 'op'>): JobBuilder;
  exportCsv(args: Omit<ExportCsvOp, 'op'>): JobBuilder;
  output(o: OutputDecl): JobBuilder;
  toJSON(): BatchJob;
}

export function defineJob(meta?: BatchJob['meta']): JobBuilder {
  const entities: Record<string, EntityDecl> = {};
  const operations: Operation[] = [];
  let defaults: JobDefaults | undefined;
  let output: OutputDecl | undefined;

  const builder: JobBuilder = {
    defaults(d) {
      defaults = d;
      return builder;
    },
    satellite(id, source) {
      entities[id] = { type: 'satellite', source };
      return builder;
    },
    furnish(names) {
      operations.push({ op: 'furnish', names });
      return builder;
    },
    loadCatalog(args) {
      operations.push({ op: 'loadCatalog', ...args });
      return builder;
    },
    propagate(id, op) {
      operations.push({ op: 'propagate', id, ...op });
      return builder;
    },
    runMcs(id, op) {
      operations.push({ op: 'runMcs', id, ...op });
      return builder;
    },
    analyze(id, op) {
      operations.push({ op: 'analyze', id, ...op });
      return builder;
    },
    analyzeEclipse(id, op) {
      operations.push({ op: 'analyzeEclipse', id, ...op });
      return builder;
    },
    analyzeAccess(id, op) {
      operations.push({ op: 'analyzeAccess', id, ...op });
      return builder;
    },
    analyzeLinkBudget(id, op) {
      operations.push({ op: 'analyzeLinkBudget', id, ...op });
      return builder;
    },
    report(args) {
      operations.push({ op: 'report', ...args });
      return builder;
    },
    exportOem(args) {
      operations.push({ op: 'exportOem', ...args });
      return builder;
    },
    exportCsv(args) {
      operations.push({ op: 'exportCsv', ...args });
      return builder;
    },
    output(o) {
      output = o;
      return builder;
    },
    toJSON() {
      if (!output) throw new Error('a job needs an output() declaration before toJSON()');
      const job: BatchJob = {
        besselBatch: '1',
        ...(meta ? { meta } : {}),
        ...(defaults ? { defaults } : {}),
        ...(Object.keys(entities).length ? { entities } : {}),
        operations,
        output,
      };
      return validateJob(job);
    },
  };
  return builder;
}

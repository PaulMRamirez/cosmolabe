// The headless batch runner logic, separated from the process entry so it is unit
// testable: parse argv, read and validate the job, execute it against a Node PAL rooted
// at the job's directory, and map the outcome to an exit code. Kernels resolve from the
// job file's directory; artifacts write under the output directory. (STK_PARITY_SPEC, SDK.)

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { JobSchemaError, UnsupportedJobVersionError, validateJob, runJob, type BatchJob } from '@bessel/sdk';
import { createNodeRunIo } from '@bessel/pal-node';

export interface CliOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface ParsedArgs {
  readonly command: 'run' | 'validate';
  readonly jobPath: string;
  readonly out?: string;
  readonly dryRun: boolean;
}

const USAGE = 'usage: bessel <run|validate> <job.json> [--out <dir>] [--dry-run]';

function parseArgs(argv: readonly string[]): ParsedArgs {
  const command = argv[0];
  if (command !== 'run' && command !== 'validate') throw new UsageError(`unknown command "${command ?? ''}"`);
  let jobPath: string | undefined;
  let out: string | undefined;
  let dryRun = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') dryRun = true;
    else if (a === '--out') out = argv[++i];
    else if (!a.startsWith('--')) jobPath = a;
    else throw new UsageError(`unknown flag "${a}"`);
  }
  if (!jobPath) throw new UsageError('missing job file path');
  return { command, jobPath, out, dryRun };
}

class UsageError extends Error {}

/** Run the CLI for `argv` (the args after the program name). Never calls process.exit. */
export async function runCli(argv: readonly string[]): Promise<CliOutcome> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    return { exitCode: 4, stdout: '', stderr: `${(e as Error).message}\n${USAGE}\n` };
  }

  let job: BatchJob;
  try {
    const raw = JSON.parse(await readFile(args.jobPath, 'utf8')) as unknown;
    job = validateJob(raw);
  } catch (e) {
    if (e instanceof JobSchemaError) return { exitCode: 2, stdout: '', stderr: `invalid job at ${e.pointer}: ${e.message}\n` };
    if (e instanceof UnsupportedJobVersionError) return { exitCode: 2, stdout: '', stderr: `${e.message}\n` };
    return { exitCode: 4, stdout: '', stderr: `could not read job "${args.jobPath}": ${(e as Error).message}\n` };
  }

  if (args.command === 'validate') return { exitCode: 0, stdout: 'job is valid\n', stderr: '' };

  const jobDir = dirname(resolve(args.jobPath));
  const outDir = args.out ? (isAbsolute(args.out) ? args.out : resolve(jobDir, args.out)) : resolve(jobDir, job.output.dir);
  const io = createNodeRunIo({ kernelDir: jobDir, outDir });

  const result = await runJob({ job, io, dryRun: args.dryRun });
  const summary = JSON.stringify({ status: result.status, exitCode: result.exitCode, ops: result.ops });
  const failures = result.ops.filter((o) => o.status === 'failed');
  const stderr = failures.map((f) => `op ${f.index} (${f.op}) failed: ${f.error?.message ?? 'unknown'}\n`).join('');
  return { exitCode: result.exitCode, stdout: `${summary}\n`, stderr };
}

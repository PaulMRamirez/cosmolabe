#!/usr/bin/env node
// The process entry for the `bessel` batch runner. The only layer that touches process
// argv, stdio, and exit; all logic lives in runCli so it stays testable. Run via a TS
// loader (for example `node --import tsx src/main.ts`) or a built bundle. (STK_PARITY_SPEC, SDK.)

import { runCli } from './cli.ts';

const outcome = await runCli(process.argv.slice(2));
if (outcome.stdout) process.stdout.write(outcome.stdout);
if (outcome.stderr) process.stderr.write(outcome.stderr);
process.exit(outcome.exitCode);

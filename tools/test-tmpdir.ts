import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * One temporary folder per test run, removed when the run ends.
 *
 * The suites make their working folders with `mkdtempSync(join(tmpdir(), ...))`
 * and leave them behind. Pointing `TMPDIR` at a folder of the run's own, before
 * any worker starts, puts every one of them under it, so one removal clears the
 * run whatever a test forgot.
 */
export default function setup(): () => void {
  const run = mkdtempSync(join(tmpdir(), 'ahpd-test-run-'));
  process.env.TMPDIR = run;
  return () => rmSync(run, { recursive: true, force: true });
}

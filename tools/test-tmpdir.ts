import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  return () => {
    rmSync(run, { recursive: true, force: true });
    /*
     * And the checkout is not a place a run writes in.
     *
     * A suite that hands the daemon this repository as its state directory
     * leaves the file a machine's git directory is named by at the root of it,
     * since that is where `configDir` pointed - and a test leaving a file in
     * the working tree is a person finding it in `git status` long afterwards.
     * Named here rather than checked per package, so a new suite that does it
     * is caught whichever package it is in.
     */
    const stray = join(fileURLToPath(new URL('..', import.meta.url)), 'computers.gitfile');
    if (existsSync(stray)) {
      rmSync(stray, { force: true });
      throw new Error(
        `a test wrote ${stray}: a state directory must be a temporary one, not this repository`,
      );
    }
  };
}

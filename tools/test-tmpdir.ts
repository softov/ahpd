import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * One temporary folder per test run, removed when the run ends.
 *
 * The suites make their working folders with `mkdtempSync(join(tmpdir(), ...))`
 * and leave them behind. Pointing `TMPDIR` at a folder of the run's own, before
 * any worker starts, puts every one of them under it, so one removal clears the
 * run whatever a test forgot. Windows reads `TEMP` or `TMP` rather than
 * `TMPDIR`, so all three name the run's folder.
 */
export default function setup(): () => void {
  /*
   * By its long name. A Windows runner's temp folder is an 8.3 short one
   * (`C:\Users\RUNNER~1\...`), and git answers every path by its long name, so
   * a test comparing a folder it made with one git named would be comparing
   * two spellings of the same place.
   */
  const run = realpathSync.native(mkdtempSync(join(tmpdir(), 'ahpd-test-run-')));
  process.env.TMPDIR = run;
  process.env.TEMP = run;
  process.env.TMP = run;
  /*
   * And no line-ending conversion in any repository a test makes. Git for
   * Windows ships `core.autocrlf=true` in its system config, so a file a test
   * committed as `a\n` comes back from a checkout as `a\r\n`: git doing what
   * that machine asked, and a test of ahpd's own behaviour reading the
   * machine's instead. The command-line form of config outranks every file.
   */
  const count = Number(process.env.GIT_CONFIG_COUNT ?? '0');
  process.env[`GIT_CONFIG_KEY_${String(count)}`] = 'core.autocrlf';
  process.env[`GIT_CONFIG_VALUE_${String(count)}`] = 'false';
  process.env.GIT_CONFIG_COUNT = String(count + 1);
  /*
   * And a Claude config folder of the run's own, empty. A Claude session reads
   * and watches its config folder, and the person's own `~/.claude` is not a
   * thing a test should list, or be told of a change in. A test that names one
   * still sets its own.
   */
  process.env.CLAUDE_CONFIG_DIR = join(run, 'claude-config');
  /*
   * And a config home of the run's own, for the same reason: cofold's backend
   * reads the person's `~/.config/papo/config.json` as its harness layer, and
   * a model named there was read into a case that expected none. The daemon's
   * own `~/.config/ahpd` is under it too. A test that names one still sets its
   * own.
   */
  process.env.XDG_CONFIG_HOME = join(run, 'config');
  return () => {
    rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

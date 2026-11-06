/*
 * `ahpd service install` and `ahpd service uninstall`, at the command line.
 *
 * The machine a case runs on has no systemd user session, so the manager is the
 * stand-in under `fixtures/systemctl-fake`: it says what it was asked, and what
 * it does is what the case names - here, starting the daemon the unit would have
 * started.
 */
import { posix } from '../../../tools/posix.ts';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alive, BACKEND, cli, config, fakeSystemctl, gone, home, MAIN, put, recordOf, recordWithin, REPO, spawned, systemctlAsked } from './cli.js';

/** Where a unit goes, under the configuration home a case is given: the plain one unless another is named. */
const unitPath = (unit = 'ahpd'): string => join(home, 'systemd', 'user', `${unit}.service`);
/**
 * What an install asks the manager, in order, one argument per line of the log.
 * A case's configuration home is its own, outside the folder systemd reads
 * units from, so the unit is enabled by its path.
 */
const installCalls = (unit = unitPath()): string[] => ['--user', 'daemon-reload', '--user', 'enable', '--now', unit];
/** And what an uninstall asks it. */
const UNINSTALL_CALLS = ['--user', 'disable', '--now', 'ahpd'];

/**
 * What the stand-in manager does when it is asked to start the unit: run the
 * `ExecStart` line of the unit, which is what a real manager runs, plus the
 * flags a case cannot put in the file and the variable a supervised daemon
 * reads.
 *
 * The line is read out of the file rather than written out again here, so the
 * unit is the thing being tested: a flag this CLI does not take would be a
 * daemon that never comes up, and the install would wait for it and refuse.
 *
 * Its streams go to nothing, because the stand-in is run with a pipe this case
 * holds open: a daemon that inherited it would keep that pipe open past the exit
 * of the `systemctl` that started it, and the call would never be seen to end.
 */
const started = (unit = unitPath()): string =>
  `AHPD_SERVICE=systemd $(sed -n 's/^ExecStart=//p' '${unit}') --port 0 --plugin ${BACKEND} --sessions memory --automations memory --no-update-check >/dev/null 2>&1 &`;

// A service is a systemd unit or a launchd agent, and Windows has neither:
// `ahpd service install` refuses there, which `service.test.ts` asks directly.
describe.skipIf(!posix)('service install', () => {
  // VS Code's CLI says its service started once systemd has the start
  // (cli/src/tunnels/service_linux.rs L108-L113 at 6b68d3fe), and waits for
  // nothing more.
  it('writes the unit, enables it, and says the service started', async () => {
    const did = await cli(['service', 'install', '--config-file', config], { env: fakeSystemctl(started()) });
    expect({ code: did.code, stderr: did.stderr }).toEqual({ code: 0, stderr: '' });
    expect(did.stdout).toBe([
      'ahpd service successfully started under systemd; ahpd status says where it listens',
      'no token: loopback only',
      '',
    ].join('\n'));
    // The daemon the manager started writes its own record once it is up.
    const record = await recordWithin();
    spawned.push(record.pid);
    expect(record.service).toBe('systemd');

    // What the unit says: this machine's node, this ahpd, this configuration,
    // and the manager the daemon records itself under.
    const unit = readFileSync(unitPath(), 'utf8');
    expect(unit).toContain(`ExecStart=${process.execPath} ${join(REPO, MAIN)} --config-file ${config}`);
    expect(unit).toContain('Environment=AHPD_SERVICE=systemd');
    expect(unit).toContain('Environment=PATH=');
    // The case's configuration home is its own, and the manager starts the
    // daemon with none of the install's environment, so the unit names it.
    expect(unit).toContain(`Environment=XDG_CONFIG_HOME=${home}\n`);
    expect(unit).toContain('Restart=always');
    expect(unit).toContain(`WorkingDirectory=${homedir()}`);
    // And what the manager was asked, in order.
    expect(systemctlAsked()).toEqual(installCalls());
  }, 60000);

  it('names a relative configuration file in full', async () => {
    // The cli runs in REPO, and the unit starts the daemon in the home folder.
    const did = await cli(['service', 'install', '--config-file', relative(REPO, config)], { env: fakeSystemctl(started()) });
    expect({ code: did.code, stderr: did.stderr }).toEqual({ code: 0, stderr: '' });
    spawned.push((await recordWithin()).pid);
    expect(readFileSync(unitPath(), 'utf8')).toContain(`--config-file ${config}\n`);
  }, 60000);

  it('installs the service the configuration names, beside the plain one', async () => {
    put({ service: { name: 'two' } });
    const unit = unitPath('ahpd@two');
    const did = await cli(['service', 'install', '--config-file', config], { env: fakeSystemctl(started(unit)) });
    expect({ code: did.code, stderr: did.stderr }).toEqual({ code: 0, stderr: '' });
    spawned.push((await recordWithin()).pid);
    // A unit under a configuration home of its own is outside the folder
    // systemd reads units from, so it is enabled by its path, which links it in.
    expect(systemctlAsked()).toEqual(installCalls(unit));
    expect(existsSync(unitPath())).toBe(false);
    const text = readFileSync(unit, 'utf8');
    expect(text).toContain(`--config-file ${config}\n`);
    // Named or plain, the case's configuration home is its own, and the unit names it.
    expect(text).toContain(`Environment=XDG_CONFIG_HOME=${home}\n`);
  }, 60000);

  it('refuses a second service for the daemon a service already holds, and writes nothing', async () => {
    const plain = await cli(['service', 'install', '--config-file', config], { env: fakeSystemctl(started()) });
    expect(plain.code).toBe(0);
    spawned.push((await recordWithin()).pid);
    const before = systemctlAsked();

    put({ service: { name: 'two' } });
    const did = await cli(['service', 'install', '--config-file', config], { env: fakeSystemctl(started(unitPath('ahpd@two'))) });
    expect(did.code).toBe(1);
    expect(did.stderr).toBe(`ahpd: The daemon in ${join(home, 'ahpd')} runs under systemd as ahpd. Take that service out with ahpd service uninstall, then install this one.\n`);
    expect(existsSync(unitPath('ahpd@two'))).toBe(false);
    expect(systemctlAsked()).toEqual(before);
  }, 90000);

  it('says where the token comes from, and never the token', async () => {
    put({ connectionToken: 'abc' });
    const did = await cli(['service', 'install', '--config-file', config], { env: fakeSystemctl(started()) });
    expect(did.code).toBe(0);
    spawned.push((await recordWithin()).pid);
    expect(did.stdout).toContain('token: from --connection-token');
    expect(did.stdout).not.toContain('abc');
    expect(did.stdout).not.toContain('tkn=');
  }, 60000);

  it('refuses while a daemon from ahpd start runs, and writes nothing', async () => {
    const began = await cli([
      'start', '--config-file', config, '--port', '0', '--plugin', BACKEND,
      '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const record = recordOf();
    spawned.push(record.pid);

    const did = await cli(['service', 'install', '--config-file', config], { env: fakeSystemctl(started()) });
    expect(did.code).toBe(1);
    expect(did.stderr).toBe(`ahpd: A daemon from ahpd start is running: ${record.url} (pid ${String(record.pid)}). Stop it with ahpd stop, then install the service.\n`);
    // Nothing was written and the manager was not asked: the refusal is the
    // first thing the command does.
    expect(existsSync(unitPath())).toBe(false);
    expect(existsSync(join(home, 'systemctl.log'))).toBe(false);
    // And the daemon a terminal started is still the one serving.
    expect(recordOf().pid).toBe(record.pid);
  }, 60000);

  it('starts the daemon once, on the call that starts the unit', async () => {
    // The daemons the stand-in starts are counted, and not the ones left
    // running: of two for one configuration home, the second stops when it
    // finds the first in the record, unless both reach the record at once.
    const starts = join(home, 'starts');
    const did = await cli(['service', 'install', '--config-file', config], { env: fakeSystemctl(`echo started >> '${starts}'; ${started()}`) });
    expect(did.code).toBe(0);
    spawned.push((await recordWithin()).pid);
    expect(systemctlAsked()).toContain('daemon-reload');
    expect(readFileSync(starts, 'utf8')).toBe('started\n');
  }, 60000);
});

// The same: a service to take out exists only under systemd or launchd.
describe.skipIf(!posix)('service uninstall', () => {
  it('takes the service out, stops the daemon it held, and leaves no file', async () => {
    const installed = await cli(['service', 'install', '--config-file', config], { env: fakeSystemctl(started()) });
    expect(installed.code).toBe(0);
    const record = await recordWithin();
    spawned.push(record.pid);
    expect(systemctlAsked()).toEqual(installCalls());

    // What `systemctl --user disable --now` does that matters here is the
    // signal the real one sends the daemon the unit holds. `--yes` is what a
    // removal run without a terminal is asked for before it does anything.
    const took = await cli(['service', 'uninstall', '--yes'], { env: fakeSystemctl(`kill -TERM ${String(record.pid)}`) });
    expect({ code: took.code, stderr: took.stderr }).toEqual({ code: 0, stderr: '' });
    expect(took.stdout).toBe(`Stopped ${record.url} (pid ${String(record.pid)}).\nTook the service out: ${unitPath()}.\n`);
    expect(systemctlAsked()).toEqual([...installCalls(), ...UNINSTALL_CALLS]);
    expect(existsSync(unitPath())).toBe(false);
    await gone(record.pid);
    expect(alive(record.pid)).toBe(false);
    expect(existsSync(join(home, 'ahpd', 'daemon.json'))).toBe(false);
  }, 90000);

  it('takes out the service that holds the daemon, by the name it was installed under', async () => {
    put({ service: { name: 'two' } });
    const unit = unitPath('ahpd@two');
    const installed = await cli(['service', 'install', '--config-file', config], { env: fakeSystemctl(started(unit)) });
    expect(installed.code).toBe(0);
    const record = await recordWithin();
    spawned.push(record.pid);

    // The name the record holds, and not the file's: a name changed while the
    // service runs is not the service that holds the daemon.
    put({ service: { name: 'three' } });
    const took = await cli(['service', 'uninstall', '--config-file', config, '--yes'], { env: fakeSystemctl(`kill -TERM ${String(record.pid)}`) });
    expect({ code: took.code, stderr: took.stderr }).toEqual({ code: 0, stderr: '' });
    expect(took.stdout).toBe(`Stopped ${record.url} (pid ${String(record.pid)}).\nTook the service out: ${unit}.\n`);
    expect(systemctlAsked().slice(-4)).toEqual(['--user', 'disable', '--now', 'ahpd@two']);
    expect(existsSync(unit)).toBe(false);
    await gone(record.pid);
  }, 90000);

  it('takes out the service the configuration names when no daemon runs', async () => {
    put({ service: { name: 'two' } });
    const unit = unitPath('ahpd@two');
    const installed = await cli(['service', 'install', '--config-file', config], { env: fakeSystemctl(started(unit)) });
    expect(installed.code).toBe(0);
    const record = await recordWithin();
    spawned.push(record.pid);
    const stopped = await cli(['stop'], { env: fakeSystemctl(`kill -TERM ${String(record.pid)}`) });
    expect(stopped.code).toBe(0);
    await gone(record.pid);

    const took = await cli(['service', 'uninstall', '--config-file', config, '--yes'], { env: fakeSystemctl() });
    expect({ code: took.code, stderr: took.stderr }).toEqual({ code: 0, stderr: '' });
    expect(took.stdout).toBe(`Took the service out: ${unit}.\n`);
    expect(systemctlAsked().slice(-4)).toEqual(['--user', 'disable', '--now', 'ahpd@two']);
    expect(existsSync(unit)).toBe(false);
  }, 90000);

  it('says there is no service to take out', async () => {
    const took = await cli(['service', 'uninstall', '--yes'], { env: fakeSystemctl() });
    expect(took.code).toBe(1);
    expect(took.stderr).toBe('ahpd: No service is installed.\n');
    expect(existsSync(join(home, 'systemctl.log'))).toBe(false);
  });
});

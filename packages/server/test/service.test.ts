/*
 * What ahpd asks the service manager of this machine, and the file it writes
 * for it.
 *
 * The machine a case runs on has no systemd user session and no launchd, so
 * every call is made through the `Run` seam: the case answers as `systemctl`
 * or `launchctl` would, and what is asserted is the command, its arguments, and
 * what a refusal says. The unit is a string, so it is held to the words it has
 * to have.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVICE_ENV } from '../src/daemon.js';
import {
  LABEL, UNIT, agentFile, installCalls, installFile, installStarts, installText, managerCall, ownConfigHome, plistOf,
  realManager, serviceLabel, serviceOn, serviceUnit, uninstallCalls, unitFile, unitOf,
} from '../src/service.js';
import type { Run } from '../src/service.js';

/** A run that answers with that code and says that, and keeps what it was asked. */
const answering = (code: number | null, said = ''): { run: Run; asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    run: (command, argv) => {
      asked.push([command, ...argv].join(' '));
      return Promise.resolve({ code, said });
    },
  };
};

/** A run that answers each call in turn, one answer per call, and keeps what it was asked. */
const inTurn = (...answers: [number | null, string?][]): { run: Run; asked: string[] } => {
  const asked: string[] = [];
  let at = 0;
  return {
    asked,
    run: (command, argv) => {
      asked.push([command, ...argv].join(' '));
      const [code = 0, said = ''] = answers[at++] ?? [];
      return Promise.resolve({ code, said });
    },
  };
};

/** Where a case says the agent goes, which is what launchd is handed. */
const AGENT = '/Users/x/Library/LaunchAgents/dev.ahpd.daemon.plist';

describe('managerCall', () => {
  it('asks systemd for a unit of this user', () => {
    expect(managerCall('systemd', 'stop', 1000)).toEqual({ command: 'systemctl', argv: ['--user', 'stop', UNIT] });
  });

  it('asks systemd to restart without waiting for the job', () => {
    // A `systemctl` that waited for the restart is a client the stop job kills:
    // the caller may be the daemon itself, on its way down.
    expect(managerCall('systemd', 'restart', 1000))
      .toEqual({ command: 'systemctl', argv: ['--user', '--no-block', 'restart', UNIT] });
  });

  it('addresses a launch agent in the login that loaded it', () => {
    expect(managerCall('launchd', 'stop', 501)).toEqual({ command: 'launchctl', argv: ['bootout', `gui/501/${LABEL}`] });
    expect(managerCall('launchd', 'restart', 501)).toEqual({ command: 'launchctl', argv: ['kickstart', '-k', `gui/501/${LABEL}`] });
  });
});

describe('installCalls', () => {
  it('has systemd read the unit files again, then enable the unit and start it now', () => {
    expect(installCalls('systemd', 1000, '/home/x/.config/systemd/user/ahpd.service')).toEqual([
      { command: 'systemctl', argv: ['--user', 'daemon-reload'] },
      { command: 'systemctl', argv: ['--user', 'enable', '--now', UNIT] },
    ]);
  });

  it('hands launchd the plist to load into this login, over an agent that was already loaded', () => {
    // `bootstrap` refuses a label that is loaded, and a second install has one
    // loaded: the agent of the file that was there goes out first, and the
    // refusal of the machine that had none is the state this is aiming at.
    expect(installCalls('launchd', 501, AGENT)).toEqual([
      { command: 'launchctl', argv: ['bootout', `gui/501/${LABEL}`], tolerate: true },
      { command: 'launchctl', argv: ['bootstrap', 'gui/501', AGENT] },
    ]);
  });
});

describe('installStarts', () => {
  it('answers which manager loads the file as the service to start', () => {
    // systemd enables a unit that is already running and starts nothing, and
    // launchd loads the agent and the file is what starts the daemon.
    expect(installStarts('systemd')).toBe(false);
    expect(installStarts('launchd')).toBe(true);
  });
});

describe('uninstallCalls', () => {
  it('disables the unit and stops it in one call', () => {
    expect(uninstallCalls('systemd', 1000)).toEqual([
      { command: 'systemctl', argv: ['--user', 'disable', '--now', UNIT] },
    ]);
  });

  it('takes the agent out of the login that loaded it', () => {
    expect(uninstallCalls('launchd', 501)).toEqual([
      { command: 'launchctl', argv: ['bootout', `gui/501/${LABEL}`] },
    ]);
  });
});

describe('a service its configuration names', () => {
  it('is an instance of the unit on systemd, and one more part of the label on launchd', () => {
    expect(serviceUnit('two')).toBe('ahpd@two');
    expect(serviceLabel('two')).toBe('dev.ahpd.daemon.two');
    // And the plain service is what it always was.
    expect(serviceUnit()).toBe(UNIT);
    expect(serviceLabel()).toBe(LABEL);
  });

  it('is stopped, restarted and taken out by its own name', () => {
    expect(managerCall('systemd', 'stop', 1000, 'two')).toEqual({ command: 'systemctl', argv: ['--user', 'stop', 'ahpd@two'] });
    expect(managerCall('launchd', 'restart', 501, 'two'))
      .toEqual({ command: 'launchctl', argv: ['kickstart', '-k', 'gui/501/dev.ahpd.daemon.two'] });
    expect(uninstallCalls('systemd', 1000, 'two')).toEqual([
      { command: 'systemctl', argv: ['--user', 'disable', '--now', 'ahpd@two'] },
    ]);
    expect(uninstallCalls('launchd', 501, 'two')).toEqual([
      { command: 'launchctl', argv: ['bootout', 'gui/501/dev.ahpd.daemon.two'] },
    ]);
  });

  it('is installed in a file of its own name, and loaded under its label', () => {
    expect(installFile('systemd', 'two').endsWith(join('systemd', 'user', 'ahpd@two.service'))).toBe(true);
    expect(installFile('launchd', 'two')).toBe(join(homedir(), 'Library', 'LaunchAgents', 'dev.ahpd.daemon.two.plist'));
    const agent = '/Users/x/Library/LaunchAgents/dev.ahpd.daemon.two.plist';
    expect(installCalls('launchd', 501, agent, 'two')).toEqual([
      { command: 'launchctl', argv: ['bootout', 'gui/501/dev.ahpd.daemon.two'], tolerate: true },
      { command: 'launchctl', argv: ['bootstrap', 'gui/501', agent] },
    ]);
  });
});

describe('a unit under a configuration home of its own', () => {
  it('is enabled by its path, which links it into the folder systemd reads, plain or named', () => {
    const plain = '/srv/two/systemd/user/ahpd.service';
    expect(installCalls('systemd', 1000, plain, undefined, true)).toEqual([
      { command: 'systemctl', argv: ['--user', 'daemon-reload'] },
      { command: 'systemctl', argv: ['--user', 'enable', '--now', plain] },
    ]);
    const named = '/srv/two/systemd/user/ahpd@two.service';
    expect(installCalls('systemd', 1000, named, 'two', true)[1])
      .toEqual({ command: 'systemctl', argv: ['--user', 'enable', '--now', named] });
  });
});

describe('ownConfigHome', () => {
  let had: string | undefined;
  beforeEach(() => { had = process.env['XDG_CONFIG_HOME']; });
  afterEach(() => {
    if (had === undefined) delete process.env['XDG_CONFIG_HOME'];
    else process.env['XDG_CONFIG_HOME'] = had;
  });

  it('names a configuration home of its own', () => {
    process.env['XDG_CONFIG_HOME'] = '/srv/two';
    expect(ownConfigHome()).toBe(resolve('/srv/two'));
  });

  it('names nothing for the default one, unset or spelled out', () => {
    delete process.env['XDG_CONFIG_HOME'];
    expect(ownConfigHome()).toBeUndefined();
    process.env['XDG_CONFIG_HOME'] = join(homedir(), '.config');
    expect(ownConfigHome()).toBeUndefined();
  });
});

describe('serviceOn', () => {
  it('answers the systemd unit of a Linux machine', () => {
    expect(serviceOn('linux')).toBe('systemd');
  });

  it('answers the LaunchAgent of a macOS machine', () => {
    expect(serviceOn('darwin')).toBe('launchd');
  });

  it('answers nothing on a machine it writes no file for', () => {
    // Windows is not in this plan: the command refuses in words rather than
    // writing a file nothing on that machine reads.
    expect(serviceOn('win32')).toBeUndefined();
  });
});

describe('installFile', () => {
  it('writes the unit under the configuration home, and the agent where launchd reads it', () => {
    expect(installFile('systemd')).toBe(unitFile());
    expect(installFile('systemd').endsWith(join('systemd', 'user', 'ahpd.service'))).toBe(true);
    // The agent folder is launchd's own, and not the configuration home: an
    // agent anywhere else is one nothing loads.
    expect(installFile('launchd')).toBe(agentFile());
    expect(agentFile()).toBe(join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`));
  });
});

describe('installText', () => {
  const facts = {
    node: '/usr/bin/node',
    program: '/usr/local/bin/ahpd',
    configFile: '/home/x/.config/ahpd/config.json',
    home: '/home/x',
    path: '/usr/local/bin:/usr/bin:/bin',
    log: '/home/x/.config/ahpd/daemon.log',
  };

  it('answers the text of the manager it is asked about', () => {
    expect(installText('systemd', facts)).toBe(unitOf(facts));
    expect(installText('launchd', facts)).toBe(plistOf(facts));
  });
});

describe('unitOf', () => {
  const facts = {
    node: '/usr/bin/node',
    program: '/usr/local/bin/ahpd',
    configFile: '/home/x/.config/ahpd/config.json',
    home: '/home/x',
    path: '/usr/local/bin:/usr/bin:/bin',
    log: '/home/x/.config/ahpd/daemon.log',
  };

  it('runs the daemon of this install, with the file named in full', () => {
    const unit = unitOf(facts);
    expect(unit).toContain('ExecStart=/usr/bin/node /usr/local/bin/ahpd --config-file /home/x/.config/ahpd/config.json');
  });

  it('starts it in the home of this user, which is the folder a terminal would have', () => {
    // A daemon with no paths serves the folder it started in, and a manager
    // picks the folder: what a terminal in the home would have given it.
    expect(unitOf(facts)).toContain('WorkingDirectory=/home/x');
  });

  it('sets the variable a supervised daemon records itself from', () => {
    // `daemon.ts` reads this name out of the environment, and the value is what
    // it writes into the record: one name, in one place, read from there.
    expect(unitOf(facts)).toContain(`Environment=${SERVICE_ENV}=systemd`);
  });

  it('gives the daemon the PATH of the shell that ran the install', () => {
    expect(unitOf(facts)).toContain('Environment=PATH=/usr/local/bin:/usr/bin:/bin');
  });

  // service.path manager: VS Code's CLI's unit sets no PATH
  // (cli/src/tunnels/service_linux.rs L192-L219 at 6b68d3fe).
  it('gives the daemon no PATH of its own under the manager\'s, unit and agent alike', () => {
    const { path: _path, ...managers } = facts;
    expect(unitOf(managers)).not.toContain('PATH');
    expect(plistOf(managers)).not.toContain('PATH');
    expect(unitOf(managers)).toContain('Environment=AHPD_SERVICE=systemd\n');
  });

  // VS Code's CLI's unit (cli/src/tunnels/service_linux.rs L192-L219 at 6b68d3fe).
  it('starts it after the network and again ten seconds after it ends, never giving up, and holds no secret', () => {
    const unit = unitOf(facts);
    expect(unit).toContain('[Unit]\nDescription=ahpd, the agent host\nAfter=network.target\nStartLimitIntervalSec=0\n');
    expect(unit).toContain('\nRestart=always\nRestartSec=10\n');
    expect(unit).not.toContain('on-failure');
    // The token is the daemon's own, out of the configuration file or the token
    // file it names: nothing written into a unit is a credential.
    expect(unit).not.toMatch(/token|tkn=/iu);
  });

  it('quotes a word a unit would otherwise split on, and doubles what starts a specifier', () => {
    const unit = unitOf({
      node: '/opt/node 20/bin/node',
      program: '/opt/ahpd dir/ahpd',
      configFile: '/home/me/.config/ahpd/config.json',
      home: '/home/me',
      path: '/usr/bin:/opt/my tools/bin',
      log: '/home/me/.config/ahpd/daemon.log',
    });
    expect(unit).toContain('ExecStart="/opt/node 20/bin/node" "/opt/ahpd dir/ahpd" --config-file /home/me/.config/ahpd/config.json');
    expect(unit).toContain('Environment=PATH="/usr/bin:/opt/my tools/bin"');
    expect(unitOf({ ...facts, configFile: '/home/x/100%.json' })).toContain('--config-file /home/x/100%%.json');
  });

  it('names a configuration home of its own, and none for the default one', () => {
    // A manager starts the daemon with none of the install's environment, and
    // the folder a daemon keeps everything in is under that home.
    expect(unitOf({ ...facts, configHome: '/home/x/two' })).toContain('Environment=XDG_CONFIG_HOME=/home/x/two\n');
    expect(unitOf(facts)).not.toContain('XDG_CONFIG_HOME');
  });
});

describe('plistOf', () => {
  const facts = {
    node: '/usr/bin/node',
    program: '/usr/local/bin/ahpd',
    configFile: '/Users/x/.config/ahpd/config.json',
    home: '/Users/x',
    path: '/usr/local/bin:/usr/bin:/bin',
    log: '/Users/x/.config/ahpd/daemon.log',
  };

  it('runs the daemon of this install, with the file named in full', () => {
    // One argument per string, in the order a shell would have them: launchd
    // runs the program itself and splits nothing.
    expect(plistOf(facts)).toContain([
      '\t<key>ProgramArguments</key>',
      '\t<array>',
      '\t\t<string>/usr/bin/node</string>',
      '\t\t<string>/usr/local/bin/ahpd</string>',
      '\t\t<string>--config-file</string>',
      '\t\t<string>/Users/x/.config/ahpd/config.json</string>',
      '\t</array>',
    ].join('\n'));
  });

  it('starts it in the home of this user, and not in the folder launchd would pick', () => {
    // launchd chdirs a job to the root folder, and a daemon with no paths serves
    // the folder it started in: the home is what a terminal there would give it.
    expect(plistOf(facts)).toContain('\t<key>WorkingDirectory</key>\n\t<string>/Users/x</string>');
  });

  // VS Code's CLI's agent (cli/src/tunnels/service_macos.rs L127-L165 at 6b68d3fe).
  it('loads it in the graphical login, and starts it when it loads and again whenever it ends', () => {
    const plist = plistOf(facts);
    expect(plist).toContain('\t<key>LimitLoadToSessionType</key>\n\t<string>Aqua</string>');
    expect(plist).toContain('\t<key>KeepAlive</key>\n\t<true/>');
    expect(plist).not.toContain('SuccessfulExit');
  });

  it('sets the variable a supervised daemon records itself from, and the PATH of the shell', () => {
    const plist = plistOf(facts);
    expect(plist).toContain(`\t\t<key>${SERVICE_ENV}</key>\n\t\t<string>launchd</string>`);
    expect(plist).toContain('\t\t<key>PATH</key>\n\t\t<string>/usr/local/bin:/usr/bin:/bin</string>');
  });

  it('sends what the daemon prints to the log of this tool', () => {
    const plist = plistOf(facts);
    expect(plist).toContain('\t<key>StandardOutPath</key>\n\t<string>/Users/x/.config/ahpd/daemon.log</string>');
    expect(plist).toContain('\t<key>StandardErrorPath</key>\n\t<string>/Users/x/.config/ahpd/daemon.log</string>');
  });

  it('holds no secret', () => {
    // The token is the daemon's own, out of the configuration file or the token
    // file it names: nothing written into a plist is a credential.
    expect(plistOf(facts)).not.toMatch(/token|tkn=/iu);
  });

  it('writes a path that would end the text as a reference', () => {
    expect(plistOf({ ...facts, configFile: '/Users/a&b/<x>/config.json' }))
      .toContain('<string>/Users/a&amp;b/&lt;x&gt;/config.json</string>');
  });

  it('names a configuration home of its own, and none for the default one', () => {
    // launchd starts the daemon with none of the install's environment, and the
    // folder a daemon keeps everything in is under that home.
    expect(plistOf({ ...facts, configHome: '/Users/x/two' }))
      .toContain('\t\t<key>XDG_CONFIG_HOME</key>\n\t\t<string>/Users/x/two</string>\n');
    expect(plistOf(facts)).not.toContain('XDG_CONFIG_HOME');
  });

  it('holds a service its configuration names under its own label', () => {
    expect(plistOf({ ...facts, name: 'two' })).toContain('\t<key>Label</key>\n\t<string>dev.ahpd.daemon.two</string>');
  });
});

describe('realManager', () => {
  it('answers nothing when the manager took the call', async () => {
    const { run, asked } = answering(0);
    await expect(realManager(run, 1000).stop('systemd')).resolves.toBeUndefined();
    expect(asked).toEqual([`systemctl --user stop ${UNIT}`]);
  });

  it('names the command and the first thing it said when it refused', async () => {
    const { run } = answering(1, '\nFailed to stop ahpd.service: Unit ahpd.service not loaded.\nand more\n');
    await expect(realManager(run, 1000).stop('systemd')).rejects
      .toThrow(`systemctl --user stop ${UNIT} failed: Failed to stop ahpd.service: Unit ahpd.service not loaded.`);
  });

  it('says the code it left when it said nothing', async () => {
    const { run, asked } = answering(3, '\n');
    await expect(realManager(run, 1000).restart('launchd')).rejects
      .toThrow(`launchctl kickstart -k gui/1000/${LABEL} failed: it exited with 3`);
    expect(asked).toEqual([`launchctl kickstart -k gui/1000/${LABEL}`]);
  });

  it('says the failure to run the command at all, which is a machine without it', async () => {
    const { run } = answering(null, 'spawn systemctl ENOENT');
    await expect(realManager(run, 1000).stop('systemd')).rejects
      .toThrow(`systemctl --user stop ${UNIT} failed: spawn systemctl ENOENT`);
  });

  it('asks for the calls of an install in order', async () => {
    const { run, asked } = answering(0);
    await realManager(run, 1000).install('systemd', '/home/x/.config/systemd/user/ahpd.service');
    expect(asked).toEqual([`systemctl --user daemon-reload`, `systemctl --user enable --now ${UNIT}`]);
  });

  it('stops at the first call of an install that refused, and names it', async () => {
    const { run, asked } = answering(1, 'Failed to reload daemon: Access denied\n');
    await expect(realManager(run, 1000).install('systemd', '/tmp/ahpd.service')).rejects
      .toThrow('systemctl --user daemon-reload failed: Failed to reload daemon: Access denied');
    // Nothing is enabled when the files were not read again.
    expect(asked).toEqual(['systemctl --user daemon-reload']);
  });

  it('goes on past a call whose refusal is not one', async () => {
    // What `bootout` says about an agent that was not loaded, and the loading
    // of the file that follows it is the whole of what the install is doing.
    const { run, asked } = inTurn([3, 'Boot-out failed: 3: No such process\n'], [0]);
    await expect(realManager(run, 501).install('launchd', AGENT)).resolves.toBeUndefined();
    expect(asked).toEqual([`launchctl bootout gui/501/${LABEL}`, `launchctl bootstrap gui/501 ${AGENT}`]);
  });

  it('stops at a call that is not tolerated, and names it', async () => {
    const { run, asked } = inTurn([0], [5, 'Bootstrap failed: 5: Input/output error\n']);
    await expect(realManager(run, 501).install('launchd', AGENT)).rejects
      .toThrow(`launchctl bootstrap gui/501 ${AGENT} failed: Bootstrap failed: 5: Input/output error`);
    expect(asked).toEqual([`launchctl bootout gui/501/${LABEL}`, `launchctl bootstrap gui/501 ${AGENT}`]);
  });

  it('takes the service out with one call', async () => {
    const { run, asked } = answering(0);
    await realManager(run, 1000).uninstall('systemd');
    expect(asked).toEqual([`systemctl --user disable --now ${UNIT}`]);
  });

  it('takes the agent of this login out by its own name', async () => {
    const { run, asked } = answering(0);
    await realManager(run, 501).uninstall('launchd');
    expect(asked).toEqual([`launchctl bootout gui/501/${LABEL}`]);
  });
});

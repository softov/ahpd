/**
 * The service manager of this machine, and what a daemon asks of it.
 *
 * `ahpd service install` writes a systemd user unit on Linux and a LaunchAgent
 * on macOS, which is `commands/service.ts`. What is here is the other half: the
 * manager is what starts the daemon and what keeps it running, so a daemon it
 * holds is stopped and restarted through the manager rather than by a signal.
 * The unit's `Restart=always` and the agent's `KeepAlive` start the daemon
 * again whenever it ends, so a daemon killed by a signal would be started again
 * instead of left stopped.
 *
 * Every call is one command run by its name, so a machine without the manager
 * answers with that command's own words, and a case puts a stand-in on the
 * `PATH` for it.
 *
 * The file the install writes is here too, since it is the other half of the
 * same decision: what the manager is told to run is a unit naming this machine's
 * own paths, and the two are written where the platform's manager reads them.
 */

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { configHome } from './config.js';

/**
 * The managers ahpd installs under, and the two names a unit or an agent is
 * written for: `ahpd service install` takes one of these, so `container` never
 * reaches a unit or a plist writer.
 */
export type Service = 'systemd' | 'launchd';

/**
 * The kinds that hold a daemon, which is the values a record's `service` field
 * holds: a manager it was installed under, or the container runtime that runs
 * it as an image's main process. `daemon.ts` reads one out of `AHPD_SERVICE`,
 * and nothing else writes that field.
 */
export type Held = Service | 'container';

/** The unit systemd holds the daemon in. */
export const UNIT = 'ahpd';

/** The label launchd holds the agent under. */
export const LABEL = 'dev.ahpd.daemon';

/**
 * The unit a service is held in: `UNIT`, or `ahpd@<name>` for a service its
 * configuration names.
 *
 * A name is what lets a second daemon, in a configuration home of its own, run
 * beside the first as a service of its own, and `<prefix>@<instance>` is
 * systemd's own form for several of one service:
 * https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html
 */
export const serviceUnit = (name?: string): string => (name === undefined ? UNIT : `${UNIT}@${name}`);

/** And the label launchd holds its agent under: `LABEL`, or `dev.ahpd.daemon.<name>`. */
export const serviceLabel = (name?: string): string => (name === undefined ? LABEL : `${LABEL}.${name}`);

/** What a manager holds a service as: its unit on systemd, and its label on launchd. */
export const managedAs = (service: Service, name?: string): string =>
  (service === 'systemd' ? serviceUnit(name) : serviceLabel(name));

/**
 * The configuration home of this process when it is one of its own, and
 * nothing when it is the default `~/.config`.
 *
 * A private `XDG_CONFIG_HOME` is how a daemon has a folder of its own, beside
 * another on the same machine (`shellEnv` in `packages/sdk/src/machines/shellenv.ts`
 * and `config.ts` take a service unit's own `XDG_CONFIG_HOME` as given). A
 * manager starts a daemon with none of the environment the install ran in, so
 * the file names that home, as it names the `PATH`.
 */
export const ownConfigHome = (): string | undefined => {
  const home = resolve(configHome());
  return home === join(homedir(), '.config') ? undefined : home;
};

/** The two things a daemon asks a manager, each a verb of that manager's command. */
export type ManagerVerb = 'stop' | 'restart';

/** One command and its arguments, as a manager is asked. */
export interface Call {
  command: string;
  argv: string[];
  /**
   * Set on a call whose refusal is not one.
   *
   * `bootout` of an agent that is not loaded says there is no such process, and
   * that is the state an install is putting the machine in anyway: what the
   * sequence is doing is loading the file it just wrote.
   */
  tolerate?: true;
}

/**
 * The one command a verb is asked with, and its arguments.
 *
 * A restart on systemd is `--no-block` because the caller may be the daemon
 * itself: the stop job that a restart begins with signals this process, and a
 * `systemctl` waiting for that job to finish is one the job kills before it can
 * answer.
 *
 * An agent is addressed in the domain of the login that started it, which is
 * the person running this: `bootout` stops it and leaves it stopped until the
 * next login loads it again, and `kickstart -k` stops the one running and
 * starts it again.
 *
 * `name` is the one the service was installed under, for a service its
 * configuration names.
 */
export const managerCall = (service: Service, verb: ManagerVerb, uid: number, name?: string): Call => {
  if (service === 'systemd') {
    return { command: 'systemctl', argv: ['--user', ...(verb === 'restart' ? ['--no-block'] : []), verb, serviceUnit(name)] };
  }
  const target = `gui/${String(uid)}/${serviceLabel(name)}`;
  return verb === 'stop'
    ? { command: 'launchctl', argv: ['bootout', target] }
    : { command: 'launchctl', argv: ['kickstart', '-k', target] };
};

/**
 * What a manager is asked, in order, to make a file just written take effect.
 *
 * systemd reads its unit files again first, so the file the install wrote is one
 * it knows, and `enable --now` puts the unit in the list it starts at login and
 * starts it now. launchd reads each plist itself, so the file is handed to it
 * instead: `bootstrap` loads the agent into the login that will own it, which is
 * the login of the person running the install.
 *
 * `byPath` is set for a unit written under a configuration home of its own.
 * That is outside the folder systemd reads this user's units from, the
 * manager's `$XDG_CONFIG_HOME/systemd/user` or `~/.config/systemd/user`
 * (https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html),
 * so the unit is enabled by its path, and `enable` given a path links the file
 * into that folder first
 * (https://www.freedesktop.org/software/systemd/man/latest/systemctl.html).
 */
export const installCalls = (service: Service, uid: number, file: string, name?: string, byPath = false): Call[] => (service === 'systemd'
  ? [
    { command: 'systemctl', argv: ['--user', 'daemon-reload'] },
    { command: 'systemctl', argv: ['--user', 'enable', '--now', byPath ? file : serviceUnit(name)] },
  ]
  : [
    // An agent that is already loaded is one `bootstrap` refuses, and a second
    // install is a file written over the one it was loaded from: the old agent
    // goes out first, and an installer meeting an agent that was not loaded
    // says so rather than failing.
    { command: 'launchctl', argv: ['bootout', `gui/${String(uid)}/${serviceLabel(name)}`], tolerate: true },
    { command: 'launchctl', argv: ['bootstrap', `gui/${String(uid)}`, file] },
  ]);

/**
 * And what it is asked to take the service out again.
 *
 * The daemon goes with the service, and the file is the caller's to remove: a
 * manager is not one to delete files. The stop comes with the disable, because
 * an enabled service is one this machine starts again at the next login, and an
 * agent is loaded by the login that owns it, where `bootout` is both the stop
 * and the taking out. The disable of a named unit also takes out the link its
 * install made.
 */
export const uninstallCalls = (service: Service, uid: number, name?: string): Call[] => (service === 'systemd'
  ? [{ command: 'systemctl', argv: ['--user', 'disable', '--now', serviceUnit(name)] }]
  : [{ command: 'launchctl', argv: ['bootout', `gui/${String(uid)}/${serviceLabel(name)}`] }]);

/**
 * Whether what a manager is asked at install is what starts the service from the
 * file as it is now.
 *
 * systemd reads the unit file again and knows it, but `enable --now` on a unit
 * that is already running changes nothing, so a second install restarts the
 * service after it. launchd's `bootstrap` loads an agent into a login that has
 * none, and the install takes the old one out to get there, so the file it
 * loads is what starts the daemon: a restart after that would stop a daemon
 * that has just come up, and the install would go on to read a record written
 * by a process it had already ended.
 */
export const installStarts = (service: Service): boolean => service === 'launchd';

/**
 * The manager this platform installs under, or nothing.
 *
 * Read from the platform rather than by looking for the command: a machine
 * without the manager is one the command refuses in words, and a file written
 * for it first would be one left behind. A `systemctl` that is not on the
 * `PATH` is the manager's own refusal, said in `realManager`.
 */
export const serviceOn = (platform: NodeJS.Platform): Service | undefined => {
  if (platform === 'linux') return 'systemd';
  if (platform === 'darwin') return 'launchd';
  return undefined;
};

/**
 * Where the user unit is written: under the configuration home, which by
 * default is the folder systemd reads this user's units from. A unit under a
 * configuration home of its own is linked into that folder by `installCalls`.
 */
export const unitFile = (name?: string): string => join(configHome(), 'systemd', 'user', `${serviceUnit(name)}.service`);

/**
 * Where the LaunchAgent is written.
 *
 * Not beside the configuration as the unit is: launchd reads the agents of a
 * login from this one folder and from nowhere else, so an agent written
 * anywhere else is a file nothing ever loads. The login it belongs to is read
 * from the folder, and not from a file of this tool's.
 */
export const agentFile = (name?: string): string => join(homedir(), 'Library', 'LaunchAgents', `${serviceLabel(name)}.plist`);

/** What the install knows about this machine, and the whole of what the file it writes says. */
export interface ServiceFacts {
  /** The interpreter that runs ahpd, in full: a unit gets no login shell's `PATH`. */
  node: string;
  /** The ahpd entry itself, in full, as the process running the install named it. */
  program: string;
  /** The configuration file the daemon reads. */
  configFile: string;
  /**
   * The folder the daemon starts in.
   *
   * A daemon with no `paths` serves the folder it started in, and a manager
   * starts a job in a folder of the manager's choosing: the home of this user
   * is what a terminal in that home would have given the same daemon.
   */
  home: string;
  /**
   * The `PATH` of the shell that ran the install, so the agents this host
   * starts find their runtimes, or absent under `service.path` `manager`, which
   * gives the daemon the manager's own.
   */
  path?: string;
  /**
   * Where a supervised daemon writes what it prints.
   *
   * systemd hands a unit's output to the journal and needs no file, so the unit
   * says nothing about this one. launchd gives a daemon neither a terminal nor a
   * journal, and a file is the only place its output can go.
   */
  log: string;
  /** The name the configuration gives the service, which only a service beside another needs. */
  name?: string;
  /**
   * The configuration home of the install when it is one of its own, which the
   * file sets as `XDG_CONFIG_HOME`, so the daemon keeps to the folder the
   * install read: `ownConfigHome`.
   */
  configHome?: string;
}

/**
 * One word as a unit line reads it.
 *
 * A unit splits a line on whitespace, so a word with a space in it is quoted,
 * and `%` starts a specifier, so it is doubled. A backslash and a quote are what
 * a quoted run cannot hold plainly.
 */
const unitWord = (word: string): string => {
  const escaped = word.replaceAll('%', '%%');
  return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(word)
    ? escaped
    : `"${escaped.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
};

/** The lines of a unit that give its daemon a configuration home of its own, and none for the default one. */
const unitHome = (facts: ServiceFacts): string => (facts.configHome === undefined ? '' : `# The configuration home of the install, which is its own: the daemon keeps to
# the folder under it.
Environment=XDG_CONFIG_HOME=${unitWord(facts.configHome)}
`);

/**
 * The unit `service install` writes.
 *
 * `Type=simple` is the daemon as a terminal runs it, in the foreground: the same
 * process `ahpd` with no command is. `AHPD_SERVICE` is what makes that daemon
 * record itself as one a manager holds, so `ahpd stop` and `ahpd restart` ask
 * systemd rather than sending a signal. The start and restart lines are VS
 * Code's CLI's for the service it installs (cli/src/tunnels/service_linux.rs
 * L192-L219 at 6b68d3fe): after the network, started again ten seconds after it
 * ends however it ends, and never given up on; a stop goes through systemd,
 * which starts nothing after it. `WorkingDirectory` is the home of this user: a
 * daemon with no `paths` serves the folder it started in, and the user manager
 * would have picked that home by itself, which is a default of one manager this
 * file does not lean on. An install from a configuration home of its own sets
 * `XDG_CONFIG_HOME` too, so its daemon keeps to that folder.
 */
export const unitOf = (facts: ServiceFacts): string => `[Unit]
Description=ahpd, the agent host
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
# The same daemon a terminal starts, with the configuration file named in full:
# a unit has no shell of its own.
ExecStart=${unitWord(facts.node)} ${unitWord(facts.program)} --config-file ${unitWord(facts.configFile)}
# Where it starts: a daemon with no paths serves the folder it started in, and
# this is the one a terminal there would have given it.
WorkingDirectory=${unitWord(facts.home)}
# What makes the daemon record that a manager holds it.
Environment=AHPD_SERVICE=systemd
${facts.path === undefined ? '' : `# The PATH of the shell that ran the install, so the agents this host starts
# find their own runtimes.
Environment=PATH=${unitWord(facts.path)}
`}${unitHome(facts)}# Started again ten seconds after it ends, as VS Code's CLI keeps its service
# running; a stop through systemd starts nothing after it.
Restart=always
RestartSec=10
# The whole group, so nothing the daemon left running outlives the unit.
KillMode=control-group

[Install]
WantedBy=default.target
`;

/**
 * One word as the text of a plist reads it.
 *
 * A plist is XML, so the three characters a path can hold that would end the
 * text where it is written are written as references instead.
 */
const plistWord = (word: string): string => word
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

/** The entries of an agent that give its daemon a configuration home of its own, and none for the default one. */
const plistHome = (facts: ServiceFacts): string => (facts.configHome === undefined ? '' : `		<!-- The configuration home of the install, which is its own: the daemon
		     keeps to the folder under it. -->
		<key>XDG_CONFIG_HOME</key>
		<string>${plistWord(facts.configHome)}</string>
`);

/**
 * The LaunchAgent `service install` writes.
 *
 * `KeepAlive` and `LimitLoadToSessionType` are VS Code's CLI's for the agent it
 * installs (cli/src/tunnels/service_macos.rs L127-L165 at 6b68d3fe): loaded in
 * the login's graphical session, started when it loads and again whenever it
 * ends; `ahpd stop` takes the agent out of the login, which starts nothing
 * after it. `AHPD_SERVICE` is what makes the
 * daemon record itself as one a manager holds, so `ahpd stop` and `ahpd
 * restart` ask launchd rather than sending a signal. `WorkingDirectory` is the
 * home of this user, because launchd starts a job in the root folder and a
 * daemon with no `paths` serves the folder it started in. An install from a
 * configuration home of its own sets `XDG_CONFIG_HOME` too, so its daemon keeps
 * to that folder, and a named service's agent has the label of its name.
 */
export const plistOf = (facts: ServiceFacts): string => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${serviceLabel(facts.name)}</string>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
	<!-- The same daemon a terminal starts, with the configuration file named in full. -->
	<key>ProgramArguments</key>
	<array>
		<string>${plistWord(facts.node)}</string>
		<string>${plistWord(facts.program)}</string>
		<string>--config-file</string>
		<string>${plistWord(facts.configFile)}</string>
	</array>
	<!-- Where it starts: launchd chdirs a job to the root folder, and a daemon
	     with no paths serves the folder it started in. -->
	<key>WorkingDirectory</key>
	<string>${plistWord(facts.home)}</string>
	<!-- Started when it loads and again whenever it ends, as VS Code's CLI keeps
	     its agent running; ahpd stop takes it out of the login. -->
	<key>KeepAlive</key>
	<true/>
	<key>EnvironmentVariables</key>
	<dict>
		<!-- What makes the daemon record that a manager holds it. -->
		<key>AHPD_SERVICE</key>
		<string>launchd</string>
${facts.path === undefined ? '' : `		<!-- The PATH of the shell that ran the install, so the agents this host
		     starts find their own runtimes. -->
		<key>PATH</key>
		<string>${plistWord(facts.path)}</string>
`}${plistHome(facts)}	</dict>
	<!-- Where the daemon's output goes: launchd gives it no terminal to print to. -->
	<key>StandardOutPath</key>
	<string>${plistWord(facts.log)}</string>
	<key>StandardErrorPath</key>
	<string>${plistWord(facts.log)}</string>
</dict>
</plist>
`;

/** Where the file an install writes goes: the folder this platform's manager reads. */
export const installFile = (service: Service, name?: string): string =>
  (service === 'systemd' ? unitFile(name) : agentFile(name));

/** And what that file says. */
export const installText = (service: Service, facts: ServiceFacts): string =>
  (service === 'systemd' ? unitOf(facts) : plistOf(facts));

/** What one command answered: the code it left, and what it wrote to its standard error. */
export interface Runned {
  code: number | null;
  said: string;
}

/** How one command is run. Replaced in cases, which is the only reason this is a value at all. */
export type Run = (command: string, argv: readonly string[]) => Promise<Runned>;

/** The default: the command by its name, on the `PATH` this process has. */
export const run: Run = (command, argv) => new Promise((done) => {
  const child = spawn(command, argv, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let said = '';
  child.stderr.on('data', (chunk: Buffer) => { said += String(chunk); });
  // A command that is not there has no words of its own, so the failure to
  // start it is what the caller is told.
  child.once('error', (error: Error) => { done({ code: null, said: error.message }); });
  child.once('close', (code: number | null) => { done({ code, said }); });
});

/** The first line of what a command said, which is the whole of a refusal here. */
const firstLine = (said: string): string | undefined =>
  said.split('\n').map((one) => one.trim()).find((one) => one !== '');

/**
 * What ahpd asks the service manager of this machine about the daemon it holds.
 *
 * `name` is the one the service was installed under, for a service its
 * configuration names, and absent for the plain service.
 */
export interface Manager {
  /** Stop the daemon it holds, and answer once the request has been taken. */
  stop(service: Service, name?: string): Promise<void>;
  /** Stop it and start it again from its own unit or agent. */
  restart(service: Service, name?: string): Promise<void>;
}

/** And what an install asks it about this machine's own list of services. */
export interface Installer {
  /** Read the file just written and start the service from it: `byPath` as `installCalls` takes it. */
  install(service: Service, file: string, name?: string, byPath?: boolean): Promise<void>;
  /** Stop the service and take it out of the list this machine starts at login. */
  uninstall(service: Service, name?: string): Promise<void>;
}

/**
 * The manager of the machine this process runs on.
 *
 * `uid` is the login launchd is addressed by, read from this process: the agent
 * is the one this person's login loaded.
 */
export const realManager = (runner: Run = run, uid: number = process.getuid?.() ?? 0): Manager & Installer => {
  /** One command, refused with its own words when it does not answer zero. */
  const asked = async (command: string, argv: readonly string[]): Promise<void> => {
    const answer = await runner(command, argv);
    if (answer.code === 0) return;
    throw new Error(`${command} ${argv.join(' ')} failed: ${firstLine(answer.said) ?? `it exited with ${String(answer.code)}`}`);
  };
  /** Every call of one verb, in order, or the first one that failed. */
  const each = async (calls: readonly Call[]): Promise<void> => {
    for (const call of calls) {
      try {
        await asked(call.command, call.argv);
      }
      catch (error) {
        if (call.tolerate !== true) throw error;
      }
    }
  };
  return {
    stop: (service, name) => each([managerCall(service, 'stop', uid, name)]),
    restart: (service, name) => each([managerCall(service, 'restart', uid, name)]),
    install: (service, file, name, byPath) => each(installCalls(service, uid, file, name, byPath)),
    uninstall: (service, name) => each(uninstallCalls(service, uid, name)),
  };
};

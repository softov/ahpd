import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Owner } from '@ahpd/sdk';
import { cliOf, definitionOf, DEVCONTAINER_FOLDER, execArgv, folderLabelOf, idLabels, LOCAL_FOLDER, masked, parseUp, probeEnv, probeKept, reachOf, runCli, workdirOf } from './devcontainer.js';
import { adoptedOf, keepProbe, probeOf } from './owners.js';
import type { MadeNeed } from './owners.js';
import { byName, DOCKER_OWN, DOCKER_OWN_PREFIX, dockerOwn } from './byname.js';
import type { Cli, CliOptions, Reach } from './devcontainer.js';

/**
 * What a machine is, and what a runtime does with one.
 *
 * The seam the provider and the tools are written against, so the package knows
 * what a machine is without knowing what makes it. Docker is the runtime that
 * ships; decision
 * `one-computer-provider-with-runtimes-as-options` is why the runtime is an
 * option of one package rather than a package of its own.
 *
 * A runtime is reached by running a command, which is the same choice
 * `scripts/computer.mjs` made and the reason a test can drive a fixture instead
 * of a daemon.
 */

/** One machine, as a runtime reports it. */
export interface Machine {
  /** The name a URI and a tool call use, unique in the runtime. */
  id: string;
  /** What it was made from. */
  image: string;
  /** The runtime's own words for what it is doing. */
  status: string;
  /** When it was made, as the runtime says it. */
  created: string;
  /**
   * The folder whose `devcontainer.json` made this machine, when one did.
   *
   * Read back from the `ahpd.devcontainer.folder` label, so a listing says
   * which folder a dev container computer belongs to and a picker can tell
   * that the folder already has one - decision
   * `a-dev-container-is-a-computer-made-from-its-devcontainer-json`.
   */
  folder?: string;
  /**
   * The agents this machine was prepared for, from its own label.
   *
   * Empty for one made before the label existed, which is offered to every
   * agent; absent for a runtime that reports no such thing.
   */
  agents?: string[];
  /**
   * The disposable profile this machine was made from, when it was.
   *
   * Read back from its own label, so a daemon that restarted can find the
   * machines it left behind and a picker can tell one that must not be offered
   * to a second session. Absent for every machine made any other way.
   */
  disposable?: { profile: string; alone: boolean };
  /**
   * The session this machine was made for, when it was made for one.
   *
   * Read back from the machine's own `ahpd.session` label: a daemon that
   * restarted adopts a leftover only when the session it names is one it keeps,
   * and a `disposableAlone` machine answers for that one session alone.
   */
  session?: string;
  /**
   * The daemon that made this machine, when the daemon said which it was.
   *
   * Read back from the machine's own `ahpd.host` label, which is what tells a
   * daemon that a machine labelled for a session it keeps was not made by this
   * daemon, and is not its to adopt or to enter.
   */
  host?: string;
  /**
   * Whose the machine is, and what its work is charged under.
   *
   * Read back from the machine's own labels rather than from a table this
   * process keeps, so a daemon that restarted - or one that did not make the
   * machine - still says who is paying for the time it spends up.
   */
  owner?: Owner;
  team?: string;
  project?: string;
}

/** What to make. */
export interface MachineSpec {
  /**
   * The name to give it.
   *
   * Required rather than generated here: a machine nobody can name is one no
   * tool can release and no client can read, and the caller is the one that
   * knows what to call it.
   */
  name: string;
  /**
   * The image to make it from, or nothing when a dev container makes it.
   *
   * A machine is one of two recipes: an image run by Docker, or a folder's
   * `devcontainer.json` read by the Dev Container CLI - decision
   * `a-dev-container-is-a-computer-made-from-its-devcontainer-json`. The
   * image is absent exactly when `devcontainer` is set, and the CLI's own
   * file decides what the container is then.
   */
  image?: string;
  /**
   * The folder whose `devcontainer.json` makes this machine, when it does.
   *
   * The CLI reads the file, so this host decides none of the image, the
   * features, the mounts or the user in there.
   */
  devcontainer?: string;
  /** The label every machine this provider made carries. */
  label: string;
  cpus?: string;
  memory?: string;
  /**
   * Host paths made visible in the machine, as `source:target` or
   * `source:target:ro`.
   *
   * A bind mount is the host's filesystem inside the machine, which is what
   * lets a session work on the same files outside it. It is not a boundary
   * this host enforces: the container is the isolation, and what is mounted
   * is readable and writable in there.
   */
  mounts?: string[];
  /**
   * Variables set inside the machine, as `docker run -e NAME` flags with the
   * values in the environment `docker` is spawned with.
   *
   * What an agent's environment needs come to. The docker program's own
   * environment is `CommandOptions.env` and is a different thing: this is set
   * in the machine, not around the runtime that makes it.
   */
  env?: Record<string, string>;
  /**
   * The needs whose variable in `env` has a value read from the vault, with the
   * secret each named.
   *
   * Left out of what makes the machine, on every recipe, so the value is never
   * in the machine's own record - `docker inspect`'s `Config.Env` - nor in a
   * dev container's override config. The caller holds them and passes them on
   * each `docker exec` instead.
   */
  named?: MadeNeed[];
  /**
   * Host paths copied in, rather than made visible.
   *
   * Paid on every create and lost when the machine goes, which is why a mount
   * is preferred; a runtime that cannot bind-mount has this instead. Each one
   * is `docker cp` between the container being created and its first process
   * starting, so what is copied is there before anything runs.
   */
  copies?: { source: string; target: string }[];
  /**
   * The agents this machine is prepared for, recorded as a label.
   *
   * What the picker filters by and what the host checks before a session runs
   * in one, so a session never pairs an agent with a machine not made for it.
   */
  agents?: string[];
  /**
   * The disposable profile this machine is made from, recorded as a label.
   *
   * A disposable machine is made for one session and goes a delay after the
   * last session using it is disposed, so which profile it came from and
   * whether it is meant to be alone have to outlive the daemon that made it:
   * both are read back from the label at startup, when the timers are gone.
   * `alone` machine is kept out of the picker, so only the session it was made
   * for runs there.
   */
  disposable?: { profile: string; alone?: boolean };
  /**
   * The session this machine is made for, recorded as a label.
   *
   * The session URI the caller was asked for, which outlives the daemon that
   * made it: it is what tells a later daemon that a leftover found at startup
   * is one to adopt rather than one to leave alone - decision
   * `a-daemon-adopts-only-the-disposable-machines-whose-session-it-keeps` - and
   * it is what a `disposableAlone` machine's own session is read back from.
   */
  session?: string;
  /**
   * The daemon making this machine, recorded as a label beside the session.
   *
   * The daemon's own id rather than a name a person chose, because it is what a
   * leftover has to be matched against before it is adopted or entered, and two
   * daemons on one Docker keep their sessions under the same ids.
   */
  host?: string;
  /**
   * The profile this machine was made from, recorded as a label.
   *
   * Every machine a body makes from a profile carries it, disposable or not,
   * so the profile's own recipe - `host` - can be read back after the
   * daemon that made it is gone. Absent for a machine made without one, which
   * falls back to the runtime's defaults.
   */
  profile?: string;
  /**
   * A host folder to mount at the same path inside the machine.
   *
   * Where a session works, made visible under the name it has outside. The
   * same path is the point: an agent that keys its own record by the working
   * directory - Claude's history is one - then finds the same key inside and
   * out, and resuming on this host shows the turns written in the machine.
   */
  folder?: string;
  /** Where a command starts inside the machine. */
  workdir?: string;
  /**
   * Whose the machine is, recorded as a label, and what its work is charged
   * under beside it.
   *
   * The owner is a typed reference as the usage rules spell one, and it is the
   * owner of every stretch this machine spends up - decision
   * `a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time`. Stored
   * rather than remembered because it has to survive the daemon that made it:
   * a machine outlives the process that started it, and a meter that only knew
   * what this run created would charge nothing for a machine it found.
   */
  owner?: Owner;
  /** The team the machine was made for a session's work in, as a label. */
  team?: string;
  /** The project within that team, as a label. */
  project?: string;
}

/** What running a command inside a machine answered. */
export interface ExecResult {
  output: string;
  code: number;
}

/** What this runtime can be asked for, for the `capabilities` resource. */
export interface RuntimeCapabilities {
  runtime: string;
  actions: string[];
  resources: string[];
}

/** A machine maker. */
export interface ComputerRuntime {
  /** The name `capabilities` reports and the option a host was configured with. */
  readonly kind: string;
  list(): Promise<Machine[]>;
  /** The runtime's own record of one machine, or nothing when it is not there. */
  inspect(id: string): Promise<Record<string, unknown> | undefined>;
  run(spec: MachineSpec): Promise<Machine>;
  stop(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /**
   * Run a command inside one, and answer what it printed and what it exited with.
   *
   * `env` is set for the command alone, each variable by name with its value in
   * the environment the runtime's program is spawned with.
   */
  exec(id: string, command: string[], env?: Record<string, string>): Promise<ExecResult>;
  /** Start one that is stopped. */
  start(id: string): Promise<void>;
  /** Stop and start one, whichever it was. */
  restart(id: string): Promise<void>;
  /** What one machine is using right now, or nothing when it is not running. */
  stats(id: string): Promise<MachineStats | undefined>;
  capabilities(): RuntimeCapabilities;
  /** Whether one image is already here, which is the answer that skips a build. */
  hasImage(tag: string): Promise<boolean>;
  /** Build one image from a build context piped on stdin. */
  buildImage(tag: string, context: Uint8Array): Promise<void>;
}

/**
 * The machines already here when one more would pass `max`, or nothing.
 *
 * Every road that makes a machine asks this: a write to `computer://<name>`,
 * the tool that asks for one in words, and a session that names a source it is
 * started in. One count rather than three, because a limit one road checks and
 * another does not is no limit at all - decision
 * `a-machine-made-for-a-session-counts-against-max-and-needs-computer-write`.
 *
 * The machines come back with it, because each road says so in its own words:
 * the ones already here to a tool that has to name them, and the one that
 * would not fit to a request that names what was refused. They are the caller's
 * own listing rather than a listing of their own, so a road that counts them
 * against something else - a name that is taken - lists them once.
 */
export const roomFor = (held: Machine[], max: number): Machine[] | undefined =>
  held.length >= max ? held : undefined;

/** The turn each runtime takes, which is the last one asked for and not yet over. */
const turns = new WeakMap<ComputerRuntime, Promise<unknown>>();

/**
 * One create at a time per runtime.
 *
 * `max` is a count, and a count read and then acted on is read too early: two
 * calls at once both read the same listing, both find room, and one more machine
 * exists than the limit says. So the count and the create it allows go in one
 * turn, and a caller that arrives second counts the first create as one of the
 * machines rather than racing it.
 *
 * Per runtime rather than per host: two runtimes are two sets of machines, and
 * a limit on one is not a limit on the other. A turn a create fails in is over
 * like any other, and the next one starts.
 */
export const inTurn = <T>(runtime: ComputerRuntime, work: () => Promise<T>): Promise<T> => {
  const next = (turns.get(runtime) ?? Promise.resolve()).then(work);
  // What is held is the turn after this one and never its result, so a create
  // that threw does not refuse every create behind it.
  turns.set(runtime, next.catch(() => {}));
  return next;
};

/**
 * What a machine is using, as numbers rather than as a runtime's display text.
 *
 * `docker stats` answers in strings meant for a terminal - `444KiB / 512MiB` -
 * and a client that drew a dial from those would be parsing a human sentence.
 * The parsing happens once, here, so every client is handed bytes and a
 * percentage and a second runtime answers in the same units.
 *
 * A limit is the machine's own, which is what a gauge is drawn against: a
 * machine made with no memory limit reports the host's, because that is what
 * it may actually use.
 */
export interface MachineStats {
  cpu: {
    /** Percent of one core's worth of time, so two busy cores read 200. */
    percent: number;
    /** Cores this machine may use, when it was limited to some. */
    cores?: number;
  };
  memory: {
    /** Bytes in use. */
    used: number;
    /** Bytes it may use. */
    limit: number;
    /** `used` over `limit`, as the runtime itself computed it. */
    percent: number;
  };
  /** Processes inside it. */
  pids?: number;
  /** Bytes in and out of its network. */
  network?: { rx: number; tx: number };
  /** Bytes read from and written to its filesystem. */
  block?: { read: number; write: number };
}


/**
 * A size a runtime printed, as bytes.
 *
 * `docker stats` writes `444KiB`, `1.01kB`, `512MiB` and `0B` in one column,
 * mixing binary and decimal units in the same line, so both are read here and
 * each is given the multiplier its suffix actually means. Anything that does
 * not parse is nothing rather than a guess, because a gauge drawn from a
 * misread number is worse than a gauge that is not drawn.
 */
const UNITS: Record<string, number> = {
  b: 1,
  kb: 1000, mb: 1000 ** 2, gb: 1000 ** 3, tb: 1000 ** 4,
  kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
};

export const bytesOf = (said: string): number | undefined => {
  const found = /^\s*([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)\s*$/.exec(said);
  if (found === null) return undefined;
  const size = Number(found[1]);
  if (!Number.isFinite(size)) return undefined;
  const unit = (found[2] ?? '').toLowerCase();
  const scale = unit === '' ? 1 : UNITS[unit];
  return scale === undefined ? undefined : size * scale;
};

/** A percentage a runtime printed, as a number. `0.00%` is 0. */
const percentOf = (said: string): number | undefined => {
  const found = /^\s*([0-9]*\.?[0-9]+)\s*%?\s*$/.exec(said);
  if (found === null) return undefined;
  const size = Number(found[1]);
  return Number.isFinite(size) ? size : undefined;
};

/** The two halves of `444KiB / 512MiB`, or of `1.01kB / 126B`. */
const pairOf = (said: string): [number, number] | undefined => {
  const halves = said.split('/');
  if (halves.length !== 2) return undefined;
  const left = bytesOf(halves[0] as string);
  const right = bytesOf(halves[1] as string);
  return left === undefined || right === undefined ? undefined : [left, right];
};

/** Where the runtime's program is, and how to run it. */
export interface CommandOptions {
  /** The program to run. `docker` unless a configuration said otherwise. */
  command: string;
  /** Arguments before the runtime's own, for a wrapper or a context. */
  args?: string[];
  /** Environment variables merged over this process's own. */
  env?: Record<string, string>;
  /** Where the program starts. */
  cwd?: string;
}

/** The command, its arguments and the label, which is all `docker` needs. */
export interface DockerOptions extends CommandOptions {
  /** The label every machine this provider made carries, so a listing is only its own. */
  label: string;
  /**
   * The Dev Container CLI, for a machine made from a folder's
   * `devcontainer.json` rather than from an image.
   *
   * Absent leaves the default program, `devcontainer`, which is what the
   * plugin's own option defaults to as well.
   */
  devcontainerCli?: CliOptions;
  /**
   * Where the daemon keeps its own configuration, which is where the probed
   * environment of a dev container is kept.
   *
   * Absent leaves the probe out of it, so a container is probed on every reach:
   * right, and a spawn per command.
   */
  configDir?: string;
  /** Lines worth keeping. A probe that could not be run is said here. */
  log?: (line: string) => void;
}

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the program once and collect what it said.
 *
 * `env` is laid over the program's own, which is how a `-e NAME` flag in
 * `args` is given its value.
 */
const ran = (options: CommandOptions, args: string[], input?: Buffer, env?: Record<string, string>): Promise<Ran> => new Promise((resolve, reject) => {
  const child = spawn(options.command, [...(options.args ?? []), ...args], {
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(options.env ?? {}), ...(env ?? {}) },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  // A program that reads its input is given it and closed, rather than left
  // waiting on a pipe nothing will write to.
  if (input !== undefined) child.stdin?.end(input);
  // A program that is not installed is an error rather than an exit code, and
  // it is the one failure a caller most needs to read.
  child.on('error', reject);
  child.on('close', (code) => { resolve({ code: code ?? 0, stdout, stderr }); });
});

/** The lines of a `--format {{json .}}` listing, as objects. */
const rows = (text: string): Record<string, unknown>[] => text
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '')
  .flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? [parsed as Record<string, unknown>]
        : [];
    }
    catch { return []; }
  });

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Whether one machine carries the label this provider puts on its own.
 *
 * The listing has always filtered on it, and nothing else did: a name that
 * reached `inspect` was inspected, so `computer://<anything docker runs>` read
 * another container's whole record, and the verbs that go through `inspect`
 * first - stop, start, restart, destroy - reached it too. A container this
 * provider did not make is not a computer, and the answer is the same as for
 * one that does not exist.
 */
const ours = (found: Record<string, unknown>, label: string): boolean => {
  const at = label.indexOf('=');
  const key = at === -1 ? label : label.slice(0, at);
  const value = at === -1 ? undefined : label.slice(at + 1);
  const config = (typeof found.Config === 'object' && found.Config !== null ? found.Config : {}) as Record<string, unknown>;
  const labels = (typeof config.Labels === 'object' && config.Labels !== null ? config.Labels : {}) as Record<string, unknown>;
  const held = labels[key];
  if (typeof held !== 'string') return false;
  return value === undefined || held === value;
};

/**
 * The label a machine prepared for agents carries, as a comma-separated list.
 *
 * One label rather than one per agent, because a runtime's label vocabulary is
 * flat and the empty list has to be tellable from the label being absent: an
 * absent label is a machine made before any of this, which is offered to every
 * agent, and an empty value is a machine prepared for none.
 */
export const MACHINE_AGENTS = 'ahpd.agents';

/**
 * The label the name a create gave a dev container is kept as.
 *
 * A machine made from an image is `docker run --name <name>`, and a dev
 * container is made by the CLI, which names the container after the folder
 * rather than after anything said here. So the name a `computer://<name>` write
 * asked for is left on the container as a plain label and read back by a
 * listing, and a container with no such label is one the CLI named for its
 * folder - decision `the-name-a-create-gives-a-dev-container-is-a-label-on-it`.
 *
 * Never an `--id-label`: the set of id labels is how the CLI finds a folder's
 * container, and a name among them would give the folder a second container.
 */
export const MACHINE_NAME = 'ahpd.name';

/**
 * The label a machine made from a disposable profile carries, and the one that
 * marks it alone.
 *
 * Two labels rather than one, because the profile is what a listing and a
 * restart read and `alone` is a rule about who may pick it: a value that packed
 * both would have to be parsed to answer either question.
 */
export const MACHINE_DISPOSABLE = 'ahpd.disposable';
export const MACHINE_ALONE = 'ahpd.disposable.alone';

/**
 * The label a machine made from a profile carries.
 *
 * Read back so a machine found by a daemon that did not make it is still
 * reached with its profile's own `host` - the one thing about a machine that
 * cannot be re-derived from its image alone.
 */
export const MACHINE_PROFILE = 'ahpd.profile';

/**
 * The labels a machine carries so that whoever made it is still known later.
 *
 * One each rather than one packed value, for the reason the disposable pair
 * above is two: what a reader asks is a question in its own right - whose is
 * this machine, which team is its work in - and an answer that had to be
 * unpacked out of a shared string would be a value that could be half right.
 * The owner is written as it is spelled everywhere else, so a reader tells a
 * person from the host by the prefix.
 */
export const MACHINE_OWNER = 'ahpd.owner';
export const MACHINE_TEAM = 'ahpd.team';
export const MACHINE_PROJECT = 'ahpd.project';

/**
 * The label a machine made for a session carries, naming that session.
 *
 * The session URI, so a daemon that finds a disposable machine at startup can
 * ask whether the session it was made for is one this daemon keeps, and adopt
 * it only then - decision
 * `a-daemon-adopts-only-the-disposable-machines-whose-session-it-keeps`. The
 * same label is what a `disposableAlone` machine's own session is read back
 * from, so the two answers outlive the daemon that made them.
 */
export const MACHINE_SESSION = 'ahpd.session';

/**
 * The label a machine made for a session carries, naming the daemon that made it.
 *
 * A machine's session label alone is not enough to say whose machine it is: a
 * client picks the channel a session id comes from, so another daemon on the
 * same Docker keeps sessions under the same ids and a leftover would look like
 * one of this daemon's. This is the daemon's own id, kept beside its
 * configuration so it is the same across its restarts, and a machine labelled
 * with another is left where it lies.
 *
 * Absent on a machine made by a daemon that named no id, which is a daemon
 * that labels nothing and therefore matches a daemon that also labels nothing.
 */
export const MACHINE_HOST = 'ahpd.host';

/** A typed reference a label held, or nothing when it names no kind. */
export const ownerSaid = (value: unknown): Owner | undefined =>
  typeof value === 'string' && /^(?:user|team|project|root):.+$/.test(value) ? value as Owner : undefined;

/**
 * Whose a machine is and what its work is charged under, from its own labels.
 *
 * Every field absent on a machine made before this existed, and the owner
 * absent on one made outside ahpd at all - which is a machine with no recorded
 * owner rather than one somebody owns.
 */
export const claimedBy = (labels: Record<string, unknown>): {
  owner?: Owner;
  team?: string;
  project?: string;
} => {
  const owner = ownerSaid(labels[MACHINE_OWNER]);
  const team = labels[MACHINE_TEAM];
  const project = labels[MACHINE_PROJECT];
  return {
    ...(owner === undefined ? {} : { owner }),
    ...(typeof team === 'string' && team !== '' ? { team } : {}),
    ...(typeof project === 'string' && project !== '' ? { project } : {}),
  };
};

/** The agents in a label value, as a list. */
const agentsSaid = (value: unknown): string[] =>
  (typeof value === 'string'
    ? value.split(',').map((one) => one.trim()).filter((one) => one !== '')
    : []);
/** The labels `docker inspect` recorded, as a flat record. */
const labelsOf = (found: Record<string, unknown>): Record<string, unknown> => {
  const config = (typeof found.Config === 'object' && found.Config !== null ? found.Config : {}) as Record<string, unknown>;
  return (typeof config.Labels === 'object' && config.Labels !== null ? config.Labels : {}) as Record<string, unknown>;
};

/** The agents a machine was prepared for, from the record `inspect` answered. */
export const preparedFor = (found: Record<string, unknown>): string[] =>
  agentsSaid(labelsOf(found)[MACHINE_AGENTS]);

/**
 * The name a create gave a machine, from the record `inspect` answered.
 *
 * The label a dev container carries rather than a Docker container name, so a
 * machine made from an image - which is `docker run --name` - answers nothing
 * here and is listed by the name it was run under.
 */
export const namedOf = (found: Record<string, unknown>): string | undefined => {
  const named = labelsOf(found)[MACHINE_NAME];
  return typeof named === 'string' && named !== '' ? named : undefined;
};

/**
 * Whose a machine is, from the record `inspect` answered.
 *
 * `claimedBy` over the flat labels a listing reads; this is the same answer for
 * the one machine, which is what a caller holding a single record asks.
 */
export const claimedOf = (found: Record<string, unknown>): ReturnType<typeof claimedBy> =>
  claimedBy(labelsOf(found));

/**
 * The folder whose `devcontainer.json` made a machine, from its own label.
 *
 * The one place both a listing and a port answer read it, so a machine made by
 * the Dev Container CLI is reached through the CLI and a machine made from an
 * image is reached through Docker: the label is what says which recipe it was.
 *
 * A container the CLI made before this host passed its own labels to `up`
 * carries the CLI's folder label instead, which names the same folder.
 */
export const devcontainerFolder = (found: Record<string, unknown>): string | undefined =>
  folderLabelOf(found);

/**
 * A `source:target` mount as the Dev Container CLI's `--mount` takes it.
 *
 * A manifest and a need speak the short Docker form, because that is what
 * `docker run -v` takes; the CLI wants its own. Read-only is not here: the
 * CLI's pattern has no word for it and answers "Unmatched argument format", so
 * a read-only mount goes in the override config's `mounts` instead.
 */
const cliMount = (mount: string): string => {
  const [source, target] = mount.split(':');
  return `type=bind,source=${source ?? ''},target=${target ?? ''}`;
};

/** Whether a mount is the read-only one, which the override config carries. */
const readOnlyMount = (mount: string): boolean => mount.endsWith(':ro');

/**
 * A folder's own definition as an object, read the way the CLI reads it.
 *
 * JSONC rather than JSON: the file is the one the Dev Container CLI documents
 * as carrying comments and a trailing comma, so a plain parse would refuse a
 * folder whose definition works, and the override config is that file's own
 * contents with this host's keys laid over it.
 */
const configOf = (folder: string): Record<string, unknown> => {
  const where = definitionOf(folder);
  if (where === undefined) {
    throw new Error(`${folder} has no devcontainer.json or .devcontainer/devcontainer.json, so there is no dev container to make`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsoncOf(readFileSync(where, 'utf8')));
  }
  catch (error) {
    throw new Error(`${where} is the folder's devcontainer.json and it does not parse: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${where} is the folder's devcontainer.json and it is not an object`);
  }
  return parsed as Record<string, unknown>;
};

/** JSONC as JSON: the comments and trailing commas taken out, nothing else. */
const jsoncOf = (text: string): string => {
  let out = '';
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? '';
    if (quoted) {
      out += char;
      // A backslash inside a string escapes the next character, so a quote
      // behind one is not the end of the string.
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; out += char; continue; }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    /*
     * A comma that is the last one before a closing bracket, taken out where a
     * string is not: a definition's own text may hold `"echo a, }"`, and a
     * comma inside one is part of the value rather than a JSONC habit.
     */
    if (char === ',' && /^[\s]*[}\]]/.test(text.slice(i + 1))) continue;
    out += char;
  }
  return out;
};

/**
 * The variables a machine is made with: its `env` less the ones the vault gave.
 *
 * Both recipes keep what they are made with in the container's own record, the
 * CLI in its log and its `docker run` as well, so a vault-named value is not
 * among them on either.
 */
const madeWith = (spec: MachineSpec): Record<string, string> => {
  const named = new Set((spec.named ?? []).map((one) => one.variable));
  return Object.fromEntries(Object.entries(spec.env ?? {}).filter(([key]) => !named.has(key)));
};

/**
 * What this host adds to a folder's own definition for one make, or nothing.
 *
 * `--override-config` replaces that file rather than merging with it, so this
 * is the folder's whole config with the added keys laid over it: an override
 * holding only what was added names no recipe at all, and the CLI says so by
 * name rather than building an image from nothing.
 *
 * What goes in, and why each is here:
 *
 * - a read-only mount, which `--mount` cannot spell;
 * - a need's environment as `containerEnv`, which is the container's own
 *   environment and so is inherited by every `docker exec` into it, less a
 *   value read from the vault, which the CLI would put in its own `docker run`
 *   argv, its log and the container's record;
 * - the working directory, as `workspaceFolder` with the `workspaceMount` that
 *   puts the folder there, since the CLI mounts at `/workspaces/<basename>`
 *   without it and the path a command is given would name nothing;
 * - the name, the agents, the profile and the limits as `runArgs`, which is the one place a
 *   plain Docker label and a limit reach a container the CLI makes.
 *
 * A read-only mount is the CLI's own string spelling and not the object form,
 * because the CLI renders an object mount as `type`, `source` and `target` and
 * silently drops `readOnly` from it: the container would be made with the mount
 * writable and every write inside it would succeed.
 *
 * The name and the agents are `--label` and never `--id-label`: the set of id
 * labels is how the CLI finds a folder's container, and a third one would give
 * the folder a second container - decision
 * `a-dev-container-owner-is-kept-beside-the-config`.
 */
const overrideOf = (spec: MachineSpec, config: Record<string, unknown>): Record<string, unknown> => {
  const held: Record<string, unknown> = { ...config };
  const readOnly = (spec.mounts ?? []).filter(readOnlyMount);
  if (readOnly.length > 0) {
    held.mounts = [
      ...(Array.isArray(held.mounts) ? (held.mounts as unknown[]) : []),
      ...readOnly.map((mount) => {
        const at = mount.slice(0, -':ro'.length).lastIndexOf(':');
        const source = mount.slice(0, at);
        const target = mount.slice(at + 1, -':ro'.length);
        return `type=bind,source=${source},target=${target},readonly`;
      }),
    ];
  }
  const plain = madeWith(spec);
  if (Object.keys(plain).length > 0) {
    held.containerEnv = {
      ...(typeof held.containerEnv === 'object' && held.containerEnv !== null ? held.containerEnv as Record<string, string> : {}),
      ...plain,
    };
  }
  if (spec.workdir !== undefined) {
    held.workspaceFolder = spec.workdir;
    held.workspaceMount = `source=${spec.devcontainer ?? ''},target=${spec.workdir},type=bind`;
  }
  const runArgs = [...(Array.isArray(held.runArgs) ? (held.runArgs as string[]) : [])];
  runArgs.push('--label', `${MACHINE_NAME}=${spec.name}`);
  const agents = spec.agents ?? [];
  if (agents.length > 0) {
    runArgs.push('--label', `${MACHINE_AGENTS}=${agents.join(',')}`);
  }
  // The profile, so a daemon that did not make the container still reads its
  // recipe - the needs whose vault-named values it reads again among them.
  if (spec.profile !== undefined && spec.profile !== '') {
    runArgs.push('--label', `${MACHINE_PROFILE}=${spec.profile}`);
  }
  if (spec.cpus !== undefined) runArgs.push('--cpus', spec.cpus);
  if (spec.memory !== undefined) runArgs.push('--memory', spec.memory);
  held.runArgs = runArgs;
  return held;
};

/**
 * A command as a refusal may name it, with every environment value left out.
 *
 * An env need may be a credential, so a `run` that failed over a duplicate
 * mount point would otherwise write `-e ANTHROPIC_API_KEY=sk-...` into a log
 * and into the sentence a session is answered with. The value is not what
 * identifies the call that failed - the flag before it is, and the name is what
 * is worth keeping.
 */
const readable = (args: string[]): string => {
  const said: string[] = [];
  for (let at = 0; at < args.length; at++) {
    const one = args[at] ?? '';
    said.push(one);
    if (one !== '-e' && one !== '--env') continue;
    const value = args[at + 1];
    if (value === undefined) continue;
    at += 1;
    said.push(value.split('=', 1)[0] ?? '');
  }
  return said.join(' ');
};

/**
 * The disposable profile a machine was made from, from the record `inspect`
 * answered, and whether it is alone.
 */
export const disposableOf = (found: Record<string, unknown>): { profile: string; alone: boolean } | undefined => {
  const labels = labelsOf(found);
  const profile = labels[MACHINE_DISPOSABLE];
  if (typeof profile !== 'string' || profile === '') return undefined;
  return { profile, alone: labels[MACHINE_ALONE] === 'true' };
};

/**
 * The session a machine was made for, from the record `inspect` answered.
 *
 * The one place a single machine's session label is read, as `disposableOf` is
 * for its profile: the port that answers for one machine and the listing that
 * answers for all of them are the same question asked of the same record.
 */
export const sessionOf = (found: Record<string, unknown>): string | undefined => {
  const session = labelsOf(found)[MACHINE_SESSION];
  return typeof session === 'string' && session !== '' ? session : undefined;
};

/**
 * The daemon that made a machine, from the record `inspect` answered.
 *
 * The other half of `sessionOf`, and what a leftover has to be matched against
 * before it is adopted: a session id is the client's to choose, so on one
 * Docker two daemons keep sessions under the same ones. Nothing for a machine
 * made before the label existed, which is a machine no daemon has claimed.
 */
export const hostOf = (found: Record<string, unknown>): string | undefined => {
  const said = labelsOf(found)[MACHINE_HOST];
  return typeof said === 'string' && said !== '' ? said : undefined;
};

/**
 * The profile a machine was made from, from the record `inspect` answered.
 *
 * A disposable machine records its profile under the disposable label, which
 * is the older spelling; a machine made from a profile any other way records
 * it under `ahpd.profile`. Either is this machine's recipe.
 */
export const profileOf = (found: Record<string, unknown>): string | undefined => {
  const labels = labelsOf(found);
  const held = labels[MACHINE_PROFILE];
  if (typeof held === 'string' && held !== '') return held;
  return disposableOf(found)?.profile;
};

/**
 * The labels a listing reads, by name.
 *
 * A listing does not read the `Labels` column: `docker ps` prints every label
 * of a machine as one comma-joined column of `key=value` pairs whatever the
 * `--format` says, so a value holding a comma cannot be told from the pair
 * after it, and the agents a machine was prepared for lose every one after the
 * first. The labels come from `inspect` instead, which holds them as a real map
 * where a value is a value. A label added to a machine later is read by adding
 * it here.
 */
const LISTED_LABELS = [
  MACHINE_AGENTS,
  MACHINE_DISPOSABLE,
  MACHINE_ALONE,
  DEVCONTAINER_FOLDER,
  LOCAL_FOLDER,
  MACHINE_NAME,
  MACHINE_OWNER,
  MACHINE_TEAM,
  MACHINE_PROJECT,
  MACHINE_SESSION,
  MACHINE_HOST,
] as const;

/**
 * The `--format` a listing asks with: the fields a machine is read from, and its
 * id, which is what a record of an adopted container names it by.
 */
const LISTED_FORMAT = ['{{.Names}}', '{{.Image}}', '{{.Status}}', '{{.CreatedAt}}', '{{.ID}}'].join('\t');

/**
 * The `--format` the labels come back by.
 *
 * `.Config.Labels` is a map rather than the listing's column, so every value
 * is quoted and escaped and nothing a value holds - a comma, a tab, a newline -
 * can be read as the boundary between two things. One call for every machine
 * the listing named.
 *
 * The name is asked for with it, because the answer is one line per machine and
 * a machine removed between the two calls is a line that is not there: without
 * the name beside it a line cannot be told from whose it is.
 */
const LISTED_LABELS_FORMAT = ['{{.Name}}', '{{json .Config.Labels}}'].join('\t');

/** One machine as a listing answered it. */
type Listed = { name: string; image: string; status: string; created: string; id: string };

/** The labels one row answered, by the keys `LISTED_LABELS` holds. */
type ListedLabels = Record<(typeof LISTED_LABELS)[number], string>;

/**
 * One machine as a listing answered it, before any label is read.
 *
 * A tab between the columns, which is what `LISTED_FORMAT` joins with, so the
 * fields come in the order that string holds them.
 */
const listed = (said: string): Listed[] =>
  said
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [name, image, status, created, id] = line.split('\t');
      return { name: name ?? '', image: image ?? '', status: status ?? '', created: created ?? '', id: id ?? '' };
    });

/**
 * The labels `inspect` answered, by the machine each line named.
 *
 * `inspect` prints a machine that is not there as an error and a non-zero exit,
 * with every other machine still printed, so the lines are read by name rather
 * than by their order: the order a caller asked in is not the order that comes
 * back once one of them is gone. A machine with no labels at all is not a row
 * either - `inspect` says `null` for a container that carries none.
 */
const labelRecords = (said: string): Map<string, Record<string, unknown>> => {
  const byName = new Map<string, Record<string, unknown>>();
  for (const line of said.split('\n')) {
    if (line.trim() === '') continue;
    const [named, labels] = line.split('\t');
    if (named === undefined || labels === undefined) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(labels); } catch { continue; }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    // `inspect` names a container with a leading `/` where a listing does not.
    byName.set(named.startsWith('/') ? named.slice(1) : named, parsed as Record<string, unknown>);
  }
  return byName;
};

/**
 * One listing row with the labels `inspect` answered for that same machine.
 *
 * A row whose labels came back with nothing is dropped rather than answered
 * empty: a machine this listing named and the call after it did not is one that
 * was removed in between, and an empty label is how a machine says it has no
 * owner and no session. A label the machine does carry answers empty rather than
 * being absent, so a row is read the same way whatever it holds.
 */
const withLabels = (
  found: Listed[],
  held: Map<string, Record<string, unknown>>,
): (Listed & { labels: ListedLabels })[] =>
  found.flatMap((row) => {
    const labels = held.get(row.name);
    if (labels === undefined) return [];
    return [{
      ...row,
      labels: Object.fromEntries(LISTED_LABELS.map((key) => [key, text(labels[key])])) as ListedLabels,
    }];
  });

/**
 * Whether a machine from a listing is up.
 *
 * A listing is `docker ps -a`, so it holds what is stopped beside what is
 * running, and the two are told apart by the runtime's own words: `Up ...` for
 * one that is up, `Exited ...` for one that is not. The word this package
 * writes on a machine it just made is the same answer in the other spelling.
 */
export const isRunning = (machine: Machine): boolean =>
  machine.status === 'running' || machine.status.startsWith('Up ');

/**
 * Machines, on Docker.
 *
 * Every call is one run of the `docker` program. A failure that is not
 * tolerated throws with the command, the exit code and what it printed, because
 * a provider that answers an empty listing when the daemon is unreachable is
 * worse than one that says so.
 */
/**
 * How one dev container is reached: its user, its environment and the folder
 * its workspace is in.
 *
 * From the probe kept beside the daemon's configuration, or from a fresh one.
 * The probe is what the user's login shell was holding when the container was
 * made and it cannot be read off the container, so it is kept: read back for a
 * container it names, taken again for one the CLI has since made afresh, and
 * taken once for a machine this daemon has no record of - one made by a daemon
 * before this, or by a person by hand - decision
 * `a-dev-container-is-reached-by-docker-exec`.
 *
 * Kept under the machine id every road uses rather than under whichever id the
 * road happens to hold, so the three ways in - a create, `computer_exec` and the
 * relay - read and write one entry for one computer. A probe that answered
 * nothing is not kept, so a container whose shell was not in place yet is
 * asked again rather than reached without an environment for the rest of its
 * life.
 */
export const reachedDevContainer = async (
  options: DockerOptions,
  id: string,
  found: Record<string, unknown>,
): Promise<Reach> => {
  const log = options.log ?? ((): void => { /* nothing is kept without one */ });
  const container = typeof found.Id === 'string' && found.Id !== '' ? found.Id : id;
  // `${localEnv:NAME}` resolves against the environment the CLI itself was run
  // with, its own `env` option included, rather than against this process's.
  const local = { ...process.env, ...options.devcontainerCli?.env };
  const kept = options.configDir === undefined ? undefined : probeOf(options.configDir, id, log);
  if (kept !== undefined && kept.container === container) return reachOf(found, kept, local);
  const env = await probeEnv(cliOf(options), found, log);
  const probe = probeKept(found, container, env);
  if (options.configDir !== undefined && Object.keys(env).length !== 0) {
    keepProbe(options.configDir, id, probe, log);
  }
  return reachOf(found, probe, local);
};

/**
 * The label the Dev Container CLI puts on every container it makes.
 *
 * Re-exported from where it is written down, beside the folder label it is the
 * other half of.
 */
export { LOCAL_FOLDER };

/**
 * How a variable reaches `docker run` and `docker exec`: by name, with its value
 * in the program's own environment. Written down beside the relay's use of it.
 */
export { byName, DOCKER_OWN, DOCKER_OWN_PREFIX, dockerOwn };

/**
 * A container the CLI made for a folder before this host labelled it.
 *
 * Asked for where the folder's own computer is not listed, which is what an
 * older connect leaves behind: it made the container through the CLI's own
 * route, so the container carries the CLI's label and none of this host's. The
 * answer is what is needed to reach it without `up` - the container id, and
 * where in it the folder lands, read back out of the mount the container
 * carries rather than out of a label it does not have. A container no mount
 * names the folder for is not answered for: `up` would have to be asked what
 * the CLI decided, and a guess at the path would start the session in a
 * directory the definition never chose.
 */
export const adoptedDevContainer = async (
  options: DockerOptions,
  folder: string,
): Promise<{ id: string; remoteWorkspaceFolder: string } | undefined> => {
  const listed = await ran(options, ['ps', '-a', '--filter', `label=${LOCAL_FOLDER}=${folder}`, '--format', '{{json .}}']);
  if (listed.code !== 0) return undefined;
  const named = text(rows(listed.stdout)[0]?.Names);
  if (named === '') return undefined;
  const held = rows((await ran(options, ['inspect', '--format', '{{json .}}', named])).stdout)[0];
  if (held === undefined) return undefined;
  const remote = workdirOf(held, folder);
  // The container id rather than the name, because this is the machine id it is
  // recorded and listed under from here on.
  const id = text(held.Id);
  if (remote === undefined || id === '') return undefined;
  return { id, remoteWorkspaceFolder: remote };
};

export function dockerRuntime(options: DockerOptions): ComputerRuntime {
  /** Run the program and answer what it printed, or throw; `env` gives each `-e NAME` its value. */
  const must = async (args: string[], env?: Record<string, string>): Promise<string> => {
    const held = await ran(options, args, undefined, env);
    if (held.code !== 0) {
      const said = held.stderr.trim() || held.stdout.trim() || 'no output';
      throw new Error(`${options.command} ${readable(args)} exited ${held.code}: ${said}`);
    }
    return held.stdout;
  };

  /**
   * The containers a connect adopted, as the record beside the configuration
   * says them.
   *
   * Read on every call rather than held, because the record is written by a
   * relay that runs after this runtime was made and a listing has to show it.
   */
  const adoptedIds = (): string[] =>
    options.configDir === undefined
      ? []
      : adoptedOf(options.configDir, options.log ?? ((): void => { /* nothing is kept without one */ }));

  /**
   * What a dev container is called, by the folder label the CLI was given.
   *
   * The CLI answers a container id, and a listing answers a name: the two are
   * the same container, and a session that wrote the id down would be a URI a
   * picker drawing names could not match. So the name is read back from the
   * label, which is the one record both share; a container the listing cannot
   * see yet keeps the id the CLI answered.
   */
  const namedByFolder = async (containerId: string, folder: string): Promise<string> => {
    const held = await rows(await must([
      'ps', '-a',
      '--filter', `label=${options.label}`,
      '--filter', `label=${DEVCONTAINER_FOLDER}=${folder}`,
      '--format', '{{json .}}',
    ]));
    const name = held.map((row) => text(row.Names)).find((one) => one !== '');
    return name ?? containerId;
  };

  /** What `docker inspect` says about one machine, or an empty record. */
  const recordOf = async (id: string): Promise<Record<string, unknown>> =>
    rows((await ran(options, ['inspect', '--format', '{{json .}}', id])).stdout)[0] ?? {};

  /**
   * The container a caller's id names, whichever of the two names it is.
   *
   * A dev container carries the name its create gave as a label, and the name
   * Docker knows it by is the one the CLI gave it after the folder. So a
   * `computer://<name>` write is reached by the name it was written under, and
   * an id Docker does not know is looked for by that label before any verb runs
   * - otherwise every verb past the make would have to be told both.
   */
  const containerOf = async (id: string): Promise<string> => {
    if ((await ran(options, ['inspect', '--format', '{{json .}}', id])).code === 0) return id;
    const held = await rows(await must([
      'ps', '-a',
      '--filter', `label=${options.label}`,
      '--filter', `label=${MACHINE_NAME}=${id}`,
      '--format', '{{json .}}',
    ]));
    const name = text(held[0]?.Names);
    return name === '' ? id : name;
  };

  return {
    kind: 'docker',

    /*
     * A listing is two calls: `ps` for what is there, then one `inspect` for
     * the labels of exactly those, because a listing prints a label map as one
     * comma-joined column and a value holding a comma cannot be told from the
     * pair after it. One `inspect` for the whole listing rather than one per
     * machine, so the answer is not one call per machine on a host with `max`
     * of them.
     *
     * The second call is not held to a zero exit. `inspect` prints the machines
     * it found and exits non-zero when one it was asked for is gone, which is
     * what a machine removed between the two calls looks like; a listing that
     * threw there would be failing over a machine that is no longer a problem.
     * A machine whose labels came back with nothing is dropped rather than
     * answered empty ones, which is how a machine says it has no owner and no
     * session.
     *
     * An adopted container cannot be given `ahpd.computer`: Docker will not
     * change a container's labels, and asking the CLI to make one again would
     * leave two containers over one `devcontainer.json`. The record beside the
     * configuration is what says it is a computer, so the listing reads it and
     * asks Docker about the ids it names - one unfiltered `ps` rather than one
     * per record.
     */
    list: async () => {
      const adopted = adoptedIds();
      /*
       * Which row an adopted record names, and under which id.
       *
       * `docker ps` prints a container id in its short form, so the record is
       * matched on the prefix either way names.
       */
      const isAdopted = (row: Listed): string | undefined => {
        const at = row.id || row.name;
        return at === '' ? undefined : adopted.find((one) => one.startsWith(at) || at.startsWith(one));
      };
      const every = listed(await must([
        'ps', '-a', '--filter', `label=${options.label}`, '--format', LISTED_FORMAT,
      ]));
      const rest = adopted.length === 0
        ? []
        : listed((await ran(options, ['ps', '-a', '--format', LISTED_FORMAT])).stdout)
          .filter((row) => isAdopted(row) !== undefined && !every.some((one) => one.name === row.name));
      const found = [...every, ...rest];
      const held = found.length === 0
        ? new Map<string, Record<string, unknown>>()
        : labelRecords((await ran(options, [
          'inspect', '--type', 'container', '--format', LISTED_LABELS_FORMAT, ...found.map((one) => one.name),
        ])).stdout);
      return withLabels(found, held)
        .map((row) => {
          const profile = row.labels[MACHINE_DISPOSABLE];
          const folder = row.labels[DEVCONTAINER_FOLDER] || row.labels[LOCAL_FOLDER];
          const session = row.labels[MACHINE_SESSION];
          const host = row.labels[MACHINE_HOST];
          const named = row.labels[MACHINE_NAME];
          return {
            // The name a create gave, where the container carries one: the CLI
            // names its own after the folder, and a listing has to answer what
            // the create said or `computer://<name>` would not be found again.
            // An adopted container carries no such label, so it is listed under
            // the id its record was written with.
            id: isAdopted(row) ?? (named === '' ? row.name : named),
            image: row.image,
            status: row.status,
            created: row.created,
            ...(folder === '' ? {} : { folder }),
            agents: agentsSaid(row.labels[MACHINE_AGENTS]),
            ...(profile === '' ? {} : { disposable: { profile, alone: row.labels[MACHINE_ALONE] === 'true' } }),
            ...(session === '' ? {} : { session }),
            ...(host === '' ? {} : { host }),
            // Who is paying for these, said by the machine itself rather than by
            // whatever this daemon happens to remember making.
            ...claimedBy(row.labels),
          };
        })
        .filter((one) => one.id !== '');
    },

    inspect: async (id) => {
      // The name a create gave, when that is what the caller holds: a listing
      // answers it, so every caller reading a listing back must be able to
      // hand that answer to anything that inspects.
      const held = await ran(options, ['inspect', '--format', '{{json .}}', await containerOf(id)]);
      // A machine that is not there is docker exiting non-zero, which is an
      // answer rather than a failure: the provider turns it into `-32008`.
      if (held.code !== 0) return undefined;
      const parsed = rows(held.stdout)[0];
      // Docker runs plenty this provider did not make, and none of them is a
      // computer. Not there and not ours read the same on purpose: a refusal
      // that named the difference would answer whether a container exists.
      // An adopted container is ours by its record, not by a label.
      if (parsed !== undefined && !ours(parsed, options.label) && !adoptedIds().includes(id)) return undefined;
      return parsed;
    },

    /*
     * Make one.
     *
     * The flags are built once, because a create and a run take the same ones:
     * `run -d` starts what it makes, and a create leaves it stopped. A machine
     * with a copy-in is made the second way, because what is copied has to be
     * there before the first process starts - so `create`, then one `cp` per
     * copy, then `start`. A machine without one stays a single `run`, which is
     * what every machine was before copy-ins existed.
     */
    run: async (spec) => {
      /*
       * A dev container: the folder's own file, by the CLI that reads it.
       *
       * The CLI decides the image, the features, the mounts, the user and the
       * lifecycle commands, so none of that is built here - which is the whole
       * reason the CLI makes it - decision
       * `a-dev-container-is-reached-by-docker-exec`. The id labels are
       * how the CLI finds the folder's container rather than making another
       * beside it, so the container this makes is the one every later call
       * reaches.
       */
      if (spec.devcontainer !== undefined) {
        const cli = cliOf(options.devcontainerCli);
        const argv = [
          'up',
          '--workspace-folder', spec.devcontainer,
          ...idLabels(options.label, spec.devcontainer),
        ];
        /*
         * A host path made visible, in the CLI's own spelling of one.
         *
         * A copy-in has no CLI verb, so it is bind-mounted as well, which is
         * the delivery this recipe has - and a copy saying what a mount already
         * says is one mount, not two, as it is on the Docker route. A read-only
         * mount is not here: the override config carries it.
         */
        const bound = [...new Set([
          ...(spec.mounts ?? []).filter((mount) => !readOnlyMount(mount)).map(cliMount),
          ...(spec.copies ?? []).map((one) => `type=bind,source=${one.source},target=${one.target}`),
        ])];
        for (const mount of bound) argv.push('--mount', mount);
        /*
         * The override config, for the length of this `up` and gone once it answers.
         *
         * It is the folder's own definition with this host's keys over it, and
         * it holds environment values on disk while the CLI runs - never a
         * value read from the vault, which `overrideOf` leaves out - so a fresh
         * directory and a file only its user may read, and nothing here logs
         * what is in it.
         *
         * The folder's definition is read before the directory exists, so a
         * definition that does not parse is refused in its own words and leaves
         * nothing behind.
         */
        const config = configOf(spec.devcontainer);
        const scratch = mkdtempSync(join(tmpdir(), 'ahpd-devcontainer-'));
        const override = join(scratch, 'override.json');
        let ran: { code: number; stdout: string; stderr: string };
        try {
          writeFileSync(override, JSON.stringify(overrideOf(spec, config), undefined, 2), { mode: 0o600 });
          argv.push('--override-config', override);
          ran = await runCli(cli, argv).catch((error: unknown) => {
            throw new Error(`The Dev Container CLI (${cli.command}) could not be run, so ${spec.devcontainer} was not made a computer: ${error instanceof Error ? error.message : String(error)}. Install @devcontainers/cli, or name it under the plugin's devcontainer.command`);
          });
        }
        finally {
          // The directory holds the definition's own values, so it goes whether
          // the CLI ran, refused or was never written to.
          rmSync(scratch, { recursive: true, force: true });
        }
        const made = parseUp(ran.stdout);
        if (made === undefined) {
          /*
           * Masked before it is thrown: the CLI echoes the `docker run` it
           * builds at info level, which carries every `-e` a need asked for, and
           * an error text goes into a log and into whatever a person is told.
           */
          const said = masked([ran.stdout.trim(), ran.stderr.trim()].filter((one) => one !== '').join(' '));
          throw new Error(`The Dev Container CLI reported no container for ${spec.devcontainer}: ${said === '' ? `exit ${String(ran.code)}` : said}`);
        }
        /*
         * The name this create gave, when the container carries it.
         *
         * The CLI names a container for its folder, so a listing answers that
         * unless the container says what it was created as. A container
         * carrying no such label keeps the name a listing reads for it.
         */
        const named = namedOf(await recordOf(made.containerId));
        /*
         * Two names for one folder is one container with two answers, and the
         * second name is refused rather than quietly ignored: a `runArgs` label
         * is set when the container is made, so a create for a folder that
         * already has one finds the container the first made and cannot rename
         * it - decision `the-name-a-create-gives-a-dev-container-is-a-label-on-it`.
         */
        if (named !== undefined && named !== spec.name) {
          throw new Error(`${spec.devcontainer} is already the computer ${named}, and its name is set when the container is made; destroy ${named} or choose another folder`);
        }
        const id = named ?? await namedByFolder(made.containerId, spec.devcontainer);
        /*
         * The probe, taken once for the container this `up` answered.
         *
         * Every command in a dev container afterwards is a `docker exec` with
         * this environment on it, and the only way to know it is to run the
         * user's own login shell in there - so it is taken now and kept beside
         * the configuration, keyed by the machine's id, rather than once per
         * command. A container the CLI makes again gets its own.
         */
        await reachedDevContainer(options, id, await recordOf(made.containerId));
        return {
          // The name a create gave, which is what a listing reports, so the id
          // a session writes down and the row a picker offers are one.
          id,
          image: '',
          status: 'running',
          created: new Date().toISOString(),
          folder: spec.devcontainer,
        };
      }
      const image = spec.image;
      if (image === undefined) {
        throw new Error(`${spec.name} names neither an image nor a folder's devcontainer.json, so there is nothing to make it from`);
      }
      const flags = ['--name', spec.name, '--label', spec.label];
      if (spec.agents !== undefined && spec.agents.length > 0) {
        flags.push('--label', `${MACHINE_AGENTS}=${spec.agents.join(',')}`);
      }
      // The disposability, recorded so a daemon that restarts finds the
      // machines it left behind and a picker knows which ones only one session
      // may run in.
      if (spec.disposable !== undefined) {
        flags.push('--label', `${MACHINE_DISPOSABLE}=${spec.disposable.profile}`);
        if (spec.disposable.alone === true) flags.push('--label', `${MACHINE_ALONE}=true`);
      }
      // And the profile itself, so the machine's recipe - where its host
      // inside is - survives the daemon that made it.
      if (spec.profile !== undefined && spec.profile !== '') {
        flags.push('--label', `${MACHINE_PROFILE}=${spec.profile}`);
      }
      // And the session it was made for, which has to survive the same restart
      // too: that is what tells a daemon finding it whether it is a leftover of
      // its own to adopt or one to leave running for somebody else, and what an
      // alone machine answers for.
      if (spec.session !== undefined && spec.session !== '') {
        flags.push('--label', `${MACHINE_SESSION}=${spec.session}`);
      }
      // And the daemon that is making it, which is the other half of the same
      // question: a leftover has to be matched against this daemon before it is
      // adopted or entered, and a session id is not enough to say whose it is.
      if (spec.host !== undefined && spec.host !== '') {
        flags.push('--label', `${MACHINE_HOST}=${spec.host}`);
      }
      // And who the machine belongs to, which has to survive the same restart
      // the recipe does: the time it spends up is charged to this owner, and a
      // daemon that finds a machine nobody remembers making still has to know
      // whose it is.
      if (spec.owner !== undefined) flags.push('--label', `${MACHINE_OWNER}=${spec.owner}`);
      if (spec.team !== undefined) flags.push('--label', `${MACHINE_TEAM}=${spec.team}`);
      if (spec.project !== undefined) flags.push('--label', `${MACHINE_PROJECT}=${spec.project}`);
      if (spec.cpus !== undefined) flags.push('--cpus', spec.cpus);
      if (spec.memory !== undefined) flags.push('--memory', spec.memory);
      /*
       * One `-v` per entry, however many said the same one.
       *
       * The manifest collapses identical entries, since a target two different
       * mounts share is refused there and the same one twice is one statement.
       * The session's folder is not among them - the runtime adds it - so a
       * profile that mounts the folder by hand at the same path, and a need
       * resolved to exactly what a mount says, would each hand Docker the same
       * target twice. Docker refuses that as a duplicate mount point, so the
       * machine is not made at all; the fold is here rather than in the
       * manifest because this is where the last of the entries appears.
       */
      const mounted = [...new Set([
        ...(spec.mounts ?? []),
        // The folder a session works in, at the same path, so an agent that
        // keys its own record by the working directory finds the same key
        // inside and out - Claude's history is one such record.
        ...(spec.folder === undefined ? [] : [`${spec.folder}:${spec.folder}`]),
      ])];
      for (const mount of mounted) flags.push('-v', mount);
      // Each variable by name, with its value in docker's own environment, and
      // none the vault gave: those would be kept in the container's record.
      const given = byName(madeWith(spec));
      flags.push(...given.flags);
      if (spec.workdir !== undefined) flags.push('-w', spec.workdir);
      // Kept alive with nothing running in it, as the script does: a machine
      // waits for work.
      const keeps = [image, 'sleep', 'infinity'];
      const copies = spec.copies ?? [];
      if (copies.length === 0) {
        await must(['run', '-d', ...flags, ...keeps], given.env);
      }
      else {
        await must(['create', ...flags, ...keeps], given.env);
        for (const copy of copies) await must(['cp', copy.source, `${spec.name}:${copy.target}`]);
        await must(['start', spec.name]);
      }
      return { id: spec.name, image, status: 'running', created: new Date().toISOString() };
    },

    stop: async (id) => { await must(['stop', await containerOf(id)]); },
    start: async (id) => { await must(['start', await containerOf(id)]); },
    /*
     * One `restart` rather than a stop and a start.
     *
     * The runtime's own verb, so a machine that is already stopped is started
     * and one that is running is cycled, both without this having to ask which
     * it was: a stop-then-start of its own would race anybody else acting on
     * the same machine between the two.
     */
    restart: async (id) => { await must(['restart', await containerOf(id)]); },
    remove: async (id) => { await must(['rm', '-f', await containerOf(id)]); },

    exec: async (id, command, env) => {
      const at = await containerOf(id);
      const given = byName(env ?? {});
      /*
       * A dev container is reached by the same `docker exec` as any other
       * machine, with the user and environment its own definition asks for -
       * which is exactly what the CLI's own exec builds - decision
       * `a-dev-container-is-reached-by-docker-exec`.
       */
      const found = await recordOf(at);
      if (devcontainerFolder(found) !== undefined) {
        // Under the machine id a caller holds, which is what the create and the
        // relay keep their probe against, not the name Docker answers for it.
        const reached = await reachedDevContainer(options, id, found);
        // Against the container id, as `how` and the relay reach it.
        const container = text(found.Id) === '' ? at : text(found.Id);
        const into = execArgv({ ...reached, id: container }, command, env ?? {});
        const held = await ran(options, into.argv, undefined, into.env);
        // Not tolerated and not thrown: a command that failed is the tool
        // working, and its exit code is what the caller asked for.
        return { output: `${held.stdout}${held.stderr}`.trim(), code: held.code };
      }
      const held = await ran(options, ['exec', '-i', ...given.flags, at, ...command], undefined, given.env);
      // Not tolerated and not thrown: a command that failed is the tool
      // working, and its exit code is what the caller asked for.
      return { output: `${held.stdout}${held.stderr}`.trim(), code: held.code };
    },

    /**
     * What one machine is using, once.
     *
     * `--no-stream` because this answers a question rather than opening a
     * feed: a client that wants a moving dial asks again, and a stream held
     * open here would be a subscription this provider does not have a way to
     * end. A machine that is not running has nothing to report and is
     * `undefined` rather than zeroes, which a gauge would draw as idle.
     */
    stats: async (id) => {
      const held = await ran(options, ['stats', '--no-stream', '--format', '{{json .}}', await containerOf(id)]);
      if (held.code !== 0) return undefined;
      const row = rows(held.stdout)[0];
      if (row === undefined) return undefined;
      const said = (key: string): string => (typeof row[key] === 'string' ? row[key] : '');
      const memory = pairOf(said('MemUsage'));
      if (memory === undefined) return undefined;
      const network = pairOf(said('NetIO'));
      const block = pairOf(said('BlockIO'));
      const pids = Number(said('PIDs'));
      return {
        cpu: { percent: percentOf(said('CPUPerc')) ?? 0 },
        memory: {
          used: memory[0],
          limit: memory[1],
          percent: percentOf(said('MemPerc')) ?? 0,
        },
        ...(Number.isFinite(pids) && said('PIDs') !== '' ? { pids } : {}),
        ...(network === undefined ? {} : { network: { rx: network[0], tx: network[1] } }),
        ...(block === undefined ? {} : { block: { read: block[0], write: block[1] } }),
      };
    },

    capabilities: () => ({
      runtime: 'docker',
      actions: ['create', 'destroy', 'exec', 'start', 'stop', 'restart'],
      resources: ['status', 'capabilities', 'stats', 'state'],
    }),

    /*
     * Two verbs about images rather than machines, and they are the ones a part
     * is built with.
     *
     * `image inspect` rather than `inspect`, because the latter is machines and
     * its not-found answer is a container error. The context is piped rather
     * than left in a directory, so nothing is written into the package at run
     * time and an installed package may sit on a read-only filesystem.
     */
    hasImage: async (tag) => (await ran(options, ['image', 'inspect', tag])).code === 0,

    buildImage: async (tag, context) => {
      const held = await ran(options, ['build', '-t', tag, '-'], Buffer.from(context));
      if (held.code !== 0) {
        // Docker's own last lines, which is where a failed build says what it
        // was: a download that 404'd, a checksum that did not match, a
        // Dockerfile that names a stage that is not there.
        const said = held.stderr.trim() || held.stdout.trim() || 'no output';
        throw new Error(`${options.command} build -t ${tag} exited ${held.code}: ${said.split('\n').slice(-8).join('\n')}`);
      }
    },
  };
}

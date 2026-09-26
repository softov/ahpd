import { spawn } from 'node:child_process';
import { cliOf, DEVCONTAINER_FOLDER, hasDefinition, idLabels, parseUp, runCli } from './devcontainer.js';
import type { Cli, CliOptions } from './devcontainer.js';

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
   * Variables set inside the machine, as `docker run -e` flags.
   *
   * What an agent's environment needs come to. The docker program's own
   * environment is `CommandOptions.env` and is a different thing: this is set
   * in the machine, not around the runtime that makes it.
   */
  env?: Record<string, string>;
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
   * The profile this machine was made from, recorded as a label.
   *
   * Every machine a body makes from a profile carries it, disposable or not,
   * so the profile's own recipe - `host`, today - can be read back after the
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
  /** Run a command inside one, and answer what it printed and what it exited with. */
  exec(id: string, command: string[]): Promise<ExecResult>;
  /** Start one that is stopped. */
  start(id: string): Promise<void>;
  /** Stop and start one, whichever it was. */
  restart(id: string): Promise<void>;
  /** What one machine is using right now, or nothing when it is not running. */
  stats(id: string): Promise<MachineStats | undefined>;
  capabilities(): RuntimeCapabilities;
}

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
}

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the program once and collect what it said. */
const ran = (options: CommandOptions, args: string[]): Promise<Ran> => new Promise((resolve, reject) => {
  const child = spawn(options.command, [...(options.args ?? []), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(options.env ?? {}) },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
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
 * The folder whose `devcontainer.json` made a machine, from its own label.
 *
 * The one place both a listing and a port answer read it, so a machine made by
 * the Dev Container CLI is reached through the CLI and a machine made from an
 * image is reached through Docker: the label is what says which recipe it was.
 */
export const devcontainerFolder = (found: Record<string, unknown>): string | undefined => {
  const folder = labelsOf(found)[DEVCONTAINER_FOLDER];
  return typeof folder === 'string' && folder !== '' ? folder : undefined;
};

/**
 * A `source:target[:ro]` mount as the Dev Container CLI's `--mount` takes it.
 *
 * A manifest and a need speak the short Docker form, because that is what
 * `docker run -v` takes; the CLI wants its own. The two halves are the same
 * statement, so it is spelled once here rather than in every caller.
 */
const cliMount = (mount: string): string => {
  const parts = mount.split(':');
  const source = parts[0] ?? '';
  const target = parts[1] ?? '';
  const readOnly = parts[2] === 'ro';
  return `type=bind,source=${source},target=${target}${readOnly ? ',readonly' : ''}`;
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

/** The labels a `docker ps` row's `Labels` column names, as a flat record. */
const labelsListed = (labels: string): Record<string, string> => {
  const held: Record<string, string> = {};
  for (const pair of labels.split(',')) {
    const at = pair.indexOf('=');
    if (at !== -1) held[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return held;
};

/** The agents a `docker ps` row's `Labels` column names. */
const agentsListed = (labels: string): string[] =>
  agentsSaid(labelsListed(labels)[MACHINE_AGENTS]);

/** The disposable profile a `docker ps` row names, and whether it is alone. */
const disposableListed = (labels: string): { profile: string; alone: boolean } | undefined => {
  const held = labelsListed(labels);
  const profile = held[MACHINE_DISPOSABLE];
  return profile === undefined || profile === ''
    ? undefined
    : { profile, alone: held[MACHINE_ALONE] === 'true' };
};

/**
 * Machines, on Docker.
 *
 * Every call is one run of the `docker` program. A failure that is not
 * tolerated throws with the command, the exit code and what it printed, because
 * a provider that answers an empty listing when the daemon is unreachable is
 * worse than one that says so.
 */
export function dockerRuntime(options: DockerOptions): ComputerRuntime {
  const must = async (args: string[]): Promise<string> => {
    const held = await ran(options, args);
    if (held.code !== 0) {
      const said = held.stderr.trim() || held.stdout.trim() || 'no output';
      throw new Error(`${options.command} ${args.join(' ')} exited ${held.code}: ${said}`);
    }
    return held.stdout;
  };

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

  return {
    kind: 'docker',

    list: async () => rows(await must(['ps', '-a', '--filter', `label=${options.label}`, '--format', '{{json .}}']))
      .map((row) => {
        const labels = text(row.Labels);
        const disposable = disposableListed(labels);
        const folder = labelsListed(labels)[DEVCONTAINER_FOLDER];
        return {
          id: text(row.Names),
          image: text(row.Image),
          status: text(row.Status),
          created: text(row.CreatedAt),
          ...(folder === undefined || folder === '' ? {} : { folder }),
          agents: agentsListed(labels),
          ...(disposable === undefined ? {} : { disposable }),
        };
      })
      .filter((one) => one.id !== ''),

    inspect: async (id) => {
      const held = await ran(options, ['inspect', '--format', '{{json .}}', id]);
      // A machine that is not there is docker exiting non-zero, which is an
      // answer rather than a failure: the provider turns it into `-32008`.
      if (held.code !== 0) return undefined;
      const parsed = rows(held.stdout)[0];
      // Docker runs plenty this provider did not make, and none of them is a
      // computer. Not there and not ours read the same on purpose: a refusal
      // that named the difference would answer whether a container exists.
      if (parsed !== undefined && !ours(parsed, options.label)) return undefined;
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
       * `a-dev-container-is-made-by-the-dev-container-cli`. The two id labels
       * are the same pair `how` and the relay hand back, so the container this
       * makes is the one every later call reaches.
       */
      if (spec.devcontainer !== undefined) {
        if (!hasDefinition(spec.devcontainer)) {
          throw new Error(`${spec.devcontainer} has no devcontainer.json or .devcontainer/devcontainer.json, so there is no dev container to make`);
        }
        const cli = cliOf(options.devcontainerCli);
        const argv = [
          'up',
          '--workspace-folder', spec.devcontainer,
          ...idLabels(options.label, spec.devcontainer),
        ];
        // What the agents this machine is prepared for need, in the CLI's own
        // two flags: a host path made visible, and a variable set in there.
        for (const mount of spec.mounts ?? []) argv.push('--mount', cliMount(mount));
        // A copy-in has no CLI verb: a file or folder is bind-mounted instead,
        // which is the delivery this recipe has.
        for (const copy of spec.copies ?? []) {
          argv.push('--mount', `type=bind,source=${copy.source},target=${copy.target}`);
        }
        for (const [key, value] of Object.entries(spec.env ?? {})) argv.push('--remote-env', `${key}=${value}`);
        let ran: { code: number; stdout: string; stderr: string };
        try {
          ran = await runCli(cli, argv);
        }
        catch (error) {
          throw new Error(`The Dev Container CLI (${cli.command}) could not be run, so ${spec.devcontainer} was not made a computer: ${error instanceof Error ? error.message : String(error)}. Install @devcontainers/cli, or name it under the plugin's devcontainer.command`);
        }
        const made = parseUp(ran.stdout);
        if (made === undefined) {
          const said = [ran.stdout.trim(), ran.stderr.trim()].filter((one) => one !== '').join(' ');
          throw new Error(`The Dev Container CLI reported no container for ${spec.devcontainer}: ${said === '' ? `exit ${String(ran.code)}` : said}`);
        }
        return {
          // The container's own name, which is what a listing reports, so the
          // id a session writes down and the row a picker offers are one.
          id: await namedByFolder(made.containerId, spec.devcontainer),
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
      if (spec.cpus !== undefined) flags.push('--cpus', spec.cpus);
      if (spec.memory !== undefined) flags.push('--memory', spec.memory);
      for (const mount of spec.mounts ?? []) flags.push('-v', mount);
      // The folder a session works in, at the same path, so an agent that keys
      // its own record by the working directory finds the same key inside and
      // out - Claude's history is one such record.
      if (spec.folder !== undefined) flags.push('-v', `${spec.folder}:${spec.folder}`);
      for (const [key, value] of Object.entries(spec.env ?? {})) flags.push('-e', `${key}=${value}`);
      if (spec.workdir !== undefined) flags.push('-w', spec.workdir);
      // Kept alive with nothing running in it, as the script does: a machine
      // waits for work.
      const keeps = [image, 'sleep', 'infinity'];
      const copies = spec.copies ?? [];
      if (copies.length === 0) {
        await must(['run', '-d', ...flags, ...keeps]);
      }
      else {
        await must(['create', ...flags, ...keeps]);
        for (const copy of copies) await must(['cp', copy.source, `${spec.name}:${copy.target}`]);
        await must(['start', spec.name]);
      }
      return { id: spec.name, image, status: 'running', created: new Date().toISOString() };
    },

    stop: async (id) => { await must(['stop', id]); },
    start: async (id) => { await must(['start', id]); },
    /*
     * One `restart` rather than a stop and a start.
     *
     * The runtime's own verb, so a machine that is already stopped is started
     * and one that is running is cycled, both without this having to ask which
     * it was: a stop-then-start of its own would race anybody else acting on
     * the same machine between the two.
     */
    restart: async (id) => { await must(['restart', id]); },
    remove: async (id) => { await must(['rm', '-f', id]); },

    exec: async (id, command) => {
      /*
       * A dev container is reached by the CLI, not by Docker.
       *
       * Its user, its environment and its lifecycle are the repository's own,
       * so a command that went through `docker exec` would run as whoever the
       * image defaults to with none of what the file asks for - decision
       * `a-dev-container-is-made-by-the-dev-container-cli`. The folder comes
       * from the container's own label, never from the caller.
       */
      const found = await (async () => {
        const held = await ran(options, ['inspect', '--format', '{{json .}}', id]);
        return held.code === 0 ? rows(held.stdout)[0] : undefined;
      })();
      const folder = found === undefined ? undefined : devcontainerFolder(found);
      if (folder !== undefined) {
        const cli = cliOf(options.devcontainerCli);
        const held = await runCli(cli, [
          'exec',
          '--workspace-folder', folder,
          ...idLabels(options.label, folder),
          ...command,
        ]);
        // Not tolerated and not thrown: a command that failed is the tool
        // working, and its exit code is what the caller asked for.
        return { output: `${held.stdout}${held.stderr}`.trim(), code: held.code };
      }
      const held = await ran(options, ['exec', '-i', id, ...command]);
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
      const held = await ran(options, ['stats', '--no-stream', '--format', '{{json .}}', id]);
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
  };
}

import { spawn } from 'node:child_process';

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
  image: string;
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

  return {
    kind: 'docker',

    list: async () => rows(await must(['ps', '-a', '--filter', `label=${options.label}`, '--format', '{{json .}}']))
      .map((row) => ({
        id: text(row.Names),
        image: text(row.Image),
        status: text(row.Status),
        created: text(row.CreatedAt),
      }))
      .filter((one) => one.id !== ''),

    inspect: async (id) => {
      const held = await ran(options, ['inspect', '--format', '{{json .}}', id]);
      // A machine that is not there is docker exiting non-zero, which is an
      // answer rather than a failure: the provider turns it into `-32008`.
      if (held.code !== 0) return undefined;
      const parsed = rows(held.stdout)[0];
      return parsed;
    },

    run: async (spec) => {
      const args = ['run', '-d', '--name', spec.name, '--label', spec.label];
      if (spec.cpus !== undefined) args.push('--cpus', spec.cpus);
      if (spec.memory !== undefined) args.push('--memory', spec.memory);
      for (const mount of spec.mounts ?? []) args.push('-v', mount);
      if (spec.workdir !== undefined) args.push('-w', spec.workdir);
      // Kept alive with nothing running in it, as the script does: a machine
      // waits for work.
      args.push(spec.image, 'sleep', 'infinity');
      await must(args);
      return { id: spec.name, image: spec.image, status: 'running', created: new Date().toISOString() };
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

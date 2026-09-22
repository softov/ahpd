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
  capabilities(): RuntimeCapabilities;
}

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
      // Kept alive with nothing running in it, as the script does: a machine
      // waits for work.
      args.push(spec.image, 'sleep', 'infinity');
      await must(args);
      return { id: spec.name, image: spec.image, status: 'running', created: new Date().toISOString() };
    },

    stop: async (id) => { await must(['stop', id]); },
    remove: async (id) => { await must(['rm', '-f', id]); },

    exec: async (id, command) => {
      const held = await ran(options, ['exec', '-i', id, ...command]);
      // Not tolerated and not thrown: a command that failed is the tool
      // working, and its exit code is what the caller asked for.
      return { output: `${held.stdout}${held.stderr}`.trim(), code: held.code };
    },

    capabilities: () => ({
      runtime: 'docker',
      actions: ['create', 'release', 'exec'],
      resources: ['status', 'capabilities'],
    }),
  };
}

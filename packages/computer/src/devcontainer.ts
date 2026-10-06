import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ContainerConnect, ContainerConnectResult, ContainerPort, ContainerSink, PluginSpec } from '@ahpd/sdk';
import { byName } from './byname.js';

/**
 * Dev containers, by the CLI that defines them.
 *
 * The launcher the `containers` port is: it makes the container a workspace's
 * own `devcontainer.json` asks for, starts a host inside it, and hands the
 * frames back and forth. The CLI runs `up` and nothing else; every command in
 * there is a `docker exec` against the id `up` answered with, which is how
 * the CLI itself runs the command a user types in there - decision
 * `a-dev-container-is-reached-by-docker-exec`.
 *
 * Everything here is a process, and nothing here is protocol: a line that is a
 * frame is handed to the sink, a line that is not is handed over as output, and
 * what a frame means is the SDK's to know.
 */

/** The label that carries the folder a dev container computer was made from. */
export const DEVCONTAINER_FOLDER = 'ahpd.devcontainer.folder';

/** The CLI's program, the words before its verb, and the environment it runs in. */
export interface CliOptions {
  /** The CLI program. Default `devcontainer`. */
  command?: string;
  /** Arguments before the CLI's own verb, for a wrapper. */
  args?: string[];
  /** Environment for the CLI, on top of this process's. */
  env?: Record<string, string>;
}

/** A CLI resolved from its options, which is what a caller runs. */
export interface Cli {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** A CLI and its arguments, with every default filled in. */
export const cliOf = (options: CliOptions = {}): Cli => ({
  command: options.command ?? 'devcontainer',
  args: options.args ?? [],
  ...(options.env === undefined ? {} : { env: options.env }),
});

/**
 * The `--id-label` pair every `up` about one dev container computer passes.
 *
 * The CLI identifies a container by its labels, so the pair is what makes a
 * second `up` find the container the folder's definition already made rather
 * than make another beside it. Nothing else passes them: a command is reached
 * by `docker exec` against the container id, which needs no lookup - decision
 * `a-dev-container-is-reached-by-docker-exec`.
 *
 * The provider's own label is one of the pair, so the container is listed like
 * any other computer - decision
 * `a-dev-container-is-a-computer-made-from-its-devcontainer-json`.
 */
export const idLabels = (label: string, folder: string): string[] => [
  '--id-label', label,
  '--id-label', `${DEVCONTAINER_FOLDER}=${folder}`,
];

/**
 * What one `userEnvProbe` run found for a machine, and the container it was
 * taken for.
 *
 * The environment a user's login shell was holding cannot be read off the
 * container: it is whatever that shell set, and the only way to know is to run
 * it. So it is probed once and kept, and the container it was probed for is
 * kept beside it, because a container the CLI has since made again has a shell
 * that has since started afresh.
 */
export interface Probe {
  /** The container id the probe was taken for. */
  container: string;
  /** What the user's shell was holding, as `K=V`. */
  env: Record<string, string>;
}

/**
 * How one dev container is reached, as the CLI derives it.
 *
 * Every part of this is a reading of the container's own `devcontainer.metadata`
 * label plus the one probe, which is the `docker exec` the CLI itself builds for
 * the command a user types in there - decision
 * `a-dev-container-is-reached-by-docker-exec`.
 */
export interface Reach {
  /** The user the container's definition asks for, as its own `docker exec` used it. */
  user: string;
  /** The probe's environment with the definition's `remoteEnv` laid over it. */
  env: Record<string, string>;
  /** The container's own environment, which every `docker exec` already holds. */
  containerEnv: Record<string, string>;
  /** The folder the workspace is mounted at inside, or nothing to run in. */
  workdir?: string | undefined;
}

/**
 * The `docker exec` that runs one command inside a dev container.
 *
 * One function so no road spells the flags a second time. It answers the argv
 * and the environment `docker` is spawned with beside it: every variable goes
 * by name through `byName`, the probe's and the definition's `remoteEnv` as
 * much as the caller's, since a `remoteEnv` value may be this host's own,
 * pulled in with `${localEnv:NAME}`. A caller spawns `docker` with `env` laid
 * over its own, or each `-e NAME` is missing in there.
 *
 * Only what the container is not already holding is put on the flags. A `docker
 * exec` inherits the container's own environment, so a variable written there -
 * a need's, as the override config's `containerEnv` - is on no argv and
 * therefore in no process list on this host.
 *
 * `more` is the caller's own variables, after the machine's and over them: it
 * is how a value reaches a command without ever being kept.
 */
export const execArgv = (
  into: Reach & { id: string },
  command: readonly string[],
  more: Record<string, string> = {},
): { argv: string[]; env: Record<string, string> } => {
  const own = byName(Object.fromEntries(Object.entries(into.env)
    .filter(([key, value]) => value !== into.containerEnv[key])));
  const asked = byName(more);
  return {
    argv: [
      'exec', '-i',
      '-u', into.user,
      ...own.flags,
      ...(into.workdir === undefined ? [] : ['-w', into.workdir]),
      ...asked.flags,
      into.id,
      ...command,
    ],
    env: { ...own.env, ...asked.env },
  };
};

/**
 * A program's own words with every environment value taken out of them.
 *
 * The CLI logs the `docker run` it makes, environment and all, and that text
 * goes to a client through the relay and into the message a caller reads when a
 * make fails. Only the name is kept: what a variable is for is a property of the
 * machine, and what it says is a credential wherever the image keeps one.
 */
export const masked = (said: string): string => said
  .split('\n')
  .map((line) => line.replace(ENV_FLAG, (_all, flag: string, gap: string, double?: string, single?: string, plain?: string) =>
    `${flag}${gap}${double ?? single ?? plain ?? ''}=<set>`))
  .join('\n');

/**
 * One `-e` or `--env` and its value, however the value is quoted.
 *
 * The pair quoted whole (`-e "K=a b"`, `-e 'K=a b'`), the value quoted on its
 * own (`-e K="a b"`) or nothing quoted at all, and a quote the line never closes
 * runs to the end of the line: a value with a space in it is masked whole rather
 * than up to its first space. The name is one of three groups, by which form it
 * was written in.
 */
const ENV_FLAG = /(-e|--env)([= ])(?:"([A-Za-z_]\w*)=(?:[^"\\]|\\.)*"?|'([A-Za-z_]\w*)=[^']*'?|([A-Za-z_]\w*)=(?:"(?:[^"\\]|\\.)*"?|'[^']*'?|[^\s'"]+)*)/g;

/**
 * `masked`, a whole line at a time, for output that arrives in pieces.
 *
 * A pipe hands over whatever was written, and a `-e NAME=value` may be cut
 * anywhere in it: masked a piece at a time, the halves either side of the cut
 * match nothing and the value goes out as it is. So a piece is held until its
 * line ends, and `end` hands over what is left when the stream closes.
 */
export const maskedLines = (out: (said: string) => void): { write: (chunk: string) => void; end: () => void } => {
  let tail = '';
  return {
    write: (chunk) => {
      tail += chunk;
      const at = tail.lastIndexOf('\n');
      if (at === -1) return;
      out(masked(tail.slice(0, at + 1)));
      tail = tail.slice(at + 1);
    },
    end: () => {
      if (tail !== '') out(masked(tail));
      tail = '';
    },
  };
};

/**
 * An argv as it is shown to a person, with every environment value left off.
 *
 * The same rule as `masked`, applied before the quoting rather than after: what
 * a watcher reads is a command line, and a need's value in it is a value in
 * somebody's terminal scrollback.
 */
const shown = (argv: readonly string[]): string[] => argv.flatMap((one, at) =>
  (argv[at - 1] === '-e' || argv[at - 1] === '--env') && one.includes('=')
    ? [one.slice(0, one.indexOf('='))]
    : [one]);

/** The label the CLI leaves the folder's own configuration on the container. */
const METADATA = 'devcontainer.metadata';

/**
 * The label the CLI puts on every container it makes.
 *
 * The folder the container was made from, as a path on this host. A container
 * this host made carries the id labels instead and not this one, so the label
 * answers for a container made before those labels were passed to `up` and for
 * nothing else.
 */
export const LOCAL_FOLDER = 'devcontainer.local_folder';

/** The shell flags each `userEnvProbe` mode runs its shell with. */
const PROBES: Record<string, string> = {
  loginInteractiveShell: '-lic',
  loginShell: '-lc',
  interactiveShell: '-ic',
};

/** `${containerEnv:NAME}`, which the definition asks the container itself for. */
const CONTAINER_ENV = /\$\{containerEnv:([^}]*)\}/g;

/**
 * `${localEnv:NAME}` and `${localEnv:NAME:fallback}`, which the definition asks
 * the process reaching it for.
 *
 * The fallback is the CLI's own spelling of a name that is not set, so a
 * definition written for one host still works where the variable is absent.
 */
const LOCAL_ENV = /\$\{localEnv:([^:}]*)(?::([^}]*))?\}/g;

/** One field of a `docker inspect` record, as an object rather than as nothing. */
const held = (found: Record<string, unknown>, key: string): Record<string, unknown> => {
  const one = found[key];
  return typeof one === 'object' && one !== null && !Array.isArray(one) ? one as Record<string, unknown> : {};
};

/** The labels `docker inspect` recorded, as a flat record. */
const labelsOf = (found: Record<string, unknown>): Record<string, unknown> => held(held(found, 'Config'), 'Labels');

/** A `K=V` list as a record, keeping the first `=` of each entry. */
const pairs = (list: readonly string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const one of list) {
    const at = one.indexOf('=');
    if (at !== -1) out[one.slice(0, at)] = one.slice(at + 1);
  }
  return out;
};

/** The configuration entries the CLI left on the container, in the order it left them. */
const entriesOf = (found: Record<string, unknown>): Record<string, unknown>[] => {
  let parsed: unknown;
  try { parsed = JSON.parse(String(labelsOf(found)[METADATA] ?? '')); }
  catch { return []; }
  return Array.isArray(parsed)
    ? parsed.filter((one): one is Record<string, unknown> => typeof one === 'object' && one !== null && !Array.isArray(one))
    : [];
};

/**
 * The last value any entry gave a key, which is the one the CLI takes.
 *
 * A features base image and the folder's own file each leave an entry, and the
 * later entry is the one closer to the machine: a `remoteUser` in the file wins
 * over the image's.
 */
const last = (entries: Record<string, unknown>[], key: string): string | undefined => {
  let found: string | undefined;
  for (const one of entries) {
    const said = one[key];
    if (typeof said === 'string' && said !== '') found = said;
  }
  return found;
};

/** The `remoteEnv` of every entry, merged in the order the CLI merged them. */
const remoteEnvOf = (entries: Record<string, unknown>[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const one of entries) {
    const said = one.remoteEnv;
    if (typeof said !== 'object' || said === null || Array.isArray(said)) continue;
    for (const [key, value] of Object.entries(said as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
  }
  return out;
};

/**
 * The folder a dev container computer was made from, by whichever label it
 * carries.
 *
 * This host's own label on a container it made, and the CLI's own label on one
 * it made before those were passed to `up`. A container this host made carries
 * only the first, which is what keeps `adopted` and a listing apart.
 */
export const folderLabelOf = (found: Record<string, unknown>): string | undefined => {
  const said = labelsOf(found)[DEVCONTAINER_FOLDER] ?? labelsOf(found)[LOCAL_FOLDER];
  return typeof said === 'string' && said !== '' ? said : undefined;
};

/**
 * The folder the workspace is mounted at inside the container.
 *
 * The CLI mounts the folder it was given at its `remoteWorkspaceFolder` and
 * answers that path once, on `up`; this is the same answer read back out of the
 * mount the container carries, which is what every later command has.
 *
 * The folder is the one the container labels with, unless a caller already
 * knows which folder it is asking about.
 */
export const workdirOf = (found: Record<string, unknown>, folder = folderLabelOf(found)): string | undefined => {
  if (folder === undefined) return undefined;
  const mounts = Array.isArray(found.Mounts) ? found.Mounts : [];
  const one = mounts.find((mount) => {
    const held = typeof mount === 'object' && mount !== null ? mount as Record<string, unknown> : {};
    return held.Source === folder && held.Type === 'bind';
  });
  const destination = one === undefined ? undefined : (one as Record<string, unknown>).Destination;
  return typeof destination === 'string' && destination !== '' ? destination : undefined;
};

/** The container's own environment, as `docker inspect` records it in `Config.Env`. */
const containerEnvOf = (found: Record<string, unknown>): Record<string, string> => {
  const config = held(found, 'Config');
  return pairs(Array.isArray(config.Env) ? config.Env.filter((one): one is string => typeof one === 'string') : []);
};

/**
 * The probe as it is kept: each variable whose value the container's own
 * `Config.Env` does not already hold, and the container it was taken for.
 *
 * The same rule `execArgv` puts on its flags. A variable the container holds is
 * inherited by every `docker exec`, so keeping it adds nothing to a later
 * command, and a need's value - the override config's `containerEnv` - is one
 * of them, so none is written to the file the probe is kept in.
 */
export const probeKept = (found: Record<string, unknown>, container: string, env: Record<string, string>): Probe => {
  const own = containerEnvOf(found);
  return {
    container,
    env: Object.fromEntries(Object.entries(env).filter(([key, value]) => own[key] !== value)),
  };
};

/**
 * How one dev container is reached, from its own label and a kept probe.
 *
 * The user is the last `remoteUser` in the label, else the last `containerUser`,
 * else the image's own, else `root`. The environment is the probe's as the shell
 * printed it, with every entry's `remoteEnv` laid over it in the order the
 * entries are in - which is what makes a `remoteEnv` key replace the probe's
 * value where it stands rather than append beside it.
 *
 * Two references in a `remoteEnv` value are resolved here rather than kept:
 * `${containerEnv:NAME}` from the container's own `Config.Env`, and
 * `${localEnv:NAME}` from the process reaching in, which is why a machine made
 * with one value and reached with another is what the CLI does too. `local` is
 * that process's environment, and the CLI's own `env` option is part of it: the
 * CLI resolves the reference against the environment it was run with.
 */
export const reachOf = (
  found: Record<string, unknown>,
  probe: Probe | undefined,
  local: Record<string, string | undefined> = process.env,
): Reach => {
  const entries = entriesOf(found);
  const config = held(found, 'Config');
  const user = last(entries, 'remoteUser') ?? last(entries, 'containerUser')
    ?? (typeof config.User === 'string' && config.User !== '' ? config.User : undefined) ?? 'root';
  const containerEnv = containerEnvOf(found);
  const env: Record<string, string> = { ...probe?.env };
  for (const [key, value] of Object.entries(remoteEnvOf(entries))) {
    env[key] = value
      .replace(CONTAINER_ENV, (_, name: string) => containerEnv[name] ?? '')
      .replace(LOCAL_ENV, (_, name: string, fallback: string | undefined) => local[name] ?? fallback ?? '');
  }
  const workdir = workdirOf(found);
  return { user, env, containerEnv, ...(workdir === undefined ? {} : { workdir }) };
};

/** One `docker inspect --format '{{json .}}'`, as the record it is. */
const record = (stdout: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  }
  catch { return {}; }
};

/** The half of a probe's output between its two markers. */
const between = (text: string, marker: string): string | undefined => {
  const from = text.indexOf(marker);
  const to = text.indexOf(marker, from + marker.length);
  return from === -1 || to === -1 ? undefined : text.slice(from + marker.length, to);
};

/**
 * Run one container's `userEnvProbe` and answer what the user's shell held.
 *
 * The shell is the one the user is recorded with rather than `/bin/sh`, because
 * it is the shell that sets the login environment being read; it comes from the
 * seventh field of the user's own `passwd` entry in there. The environment is
 * printed by `/proc/self/environ` rather than by `env`, which is what the
 * process is really holding.
 *
 * Nothing here is fatal: a definition asking for no probe, a shell that refuses,
 * or an image with no `/proc` all answer an empty environment, which is what a
 * command reached by `docker exec` would see anyway.
 */
export const probeEnv = async (
  docker: Cli,
  found: Record<string, unknown>,
  log: (line: string) => void = (): void => { /* nothing is kept without one */ },
): Promise<Record<string, string>> => {
  const flags = PROBES[last(entriesOf(found), 'userEnvProbe') ?? 'loginInteractiveShell'];
  const id = String(found.Id ?? '');
  if (flags === undefined || id === '') return {};
  const user = reachOf(found, undefined).user;
  /** One `docker exec` into this container, answering nothing when it cannot be run. */
  const exec = async (argv: string[]) => runCli(docker, argv).catch((error: unknown) => {
    log(`could not probe ${id} as ${user}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  });
  const passwd = await exec(['exec', '-i', '-u', user, id, 'getent', 'passwd', user]);
  const shell = passwd?.stdout.trim().split('\n')[0]?.split(':')[6];
  const marker = randomUUID();
  const ran = await exec([
    'exec', '-i', '-u', user, id,
    typeof shell === 'string' && shell !== '' ? shell : '/bin/sh', flags,
    `echo -n ${marker}; cat /proc/self/environ; echo -n ${marker}`,
  ]);
  const said = ran === undefined ? undefined : between(ran.stdout, marker);
  if (said === undefined) {
    log(`could not probe ${id} as ${user}: its shell printed no environment`);
    return {};
  }
  // `PWD` is dropped, as the CLI drops it: it is the probe's own working
  // directory, which `-w` says in its own way.
  const env = pairs(said.split('\0').filter((one) => one !== ''));
  delete env.PWD;
  return env;
};

/** One run of a program, collected rather than streamed. */
export const runCli = (cli: Cli, argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(cli.command, [...cli.args, ...argv], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(cli.env ?? {}) },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    // A program that is not installed is an error rather than an exit code,
    // and it is the one failure a caller most needs to read.
    child.once('error', reject);
    child.once('close', (code) => { resolve({ code: code ?? 0, stdout, stderr }); });
  });

/** What a launcher can be told. All of it has a default. */
export interface DevContainerOptions {
  /** The CLI program. Default `devcontainer`. */
  command?: string;
  /** Arguments before the CLI's own verb, for a wrapper. */
  args?: string[];
  /** Environment for the CLI, on top of this process's. */
  env?: Record<string, string>;
  /**
   * The Docker program, run the way the listing runs it. Default `docker`.
   *
   * Every command inside a container is a `docker exec` against this program,
   * so it is the plugin's own `command`, `args` and `env` rather than a
   * program named here - decision `a-dev-container-is-reached-by-docker-exec`.
   */
  docker?: Cli;
  /**
   * The probes kept beside the daemon's configuration, handed in rather than
   * read from here.
   *
   * `computers.json` is the daemon's own file and this launcher does not know
   * where the daemon keeps it, so the plugin passes the two calls it is read
   * and written through. Absent, a container is probed on every connect.
   */
  probes?: {
    of: (id: string) => Probe | undefined;
    keep: (id: string, probe: Probe) => void;
  };
  /**
   * The label every computer this deployment makes carries. Default
   * `ahpd.computer=1`.
   *
   * Passed to `up` as the CLI's `--id-label`, so the container a folder's
   * definition made is the same one a session reaches and the same one a
   * listing shows. No command passes it: a command is reached by container id.
   */
  label?: string;
  /**
   * The computer already made for a folder, and whether it is running.
   *
   * A relay finds a computer rather than making a second: the host inside is
   * started in what is there, and `up` runs when this answers nothing, when
   * this launcher has not yet learned the folder's remote workspace, or when
   * the container is stopped - `up` starts a stopped container and keeps its
   * id, where a `docker exec` into one is refused. The plugin hands this in
   * from the runtime that lists the computers.
   */
  existing?: (folder: string) => Promise<{ id: string; running: boolean } | undefined>;
  /**
   * A container the CLI made for a folder before this launcher labelled it.
   *
   * The CLI records the folder it was given on every container it makes, in a
   * label of its own. A container from before ahpd's labels were passed to `up`
   * carries that one and nothing else, and `up` is asked with the id labels
   * this host uses, so it would not find it and a second container would stand
   * beside the first. This is what a connect adopts instead, asked when
   * `existing` has nothing, and when `existing` answers a computer this
   * launcher has not yet learned the remote workspace of - an adopted one is
   * listed from its record, and is adopted again rather than brought up.
   *
   * What it answers has to be enough to reach the container without `up`: the
   * container id, and where in it the folder lands, read back out of the mount.
   * A container it answers is started here rather than by the CLI, which is
   * what `up` would have done to it.
   */
  adopted?: (folder: string) => Promise<{ id: string; remoteWorkspaceFolder: string } | undefined>;
  /**
   * What is done with a container a connect adopted rather than made.
   *
   * An adopted container carries no `ahpd.computer` label and cannot be given
   * one: Docker will not change a container's labels, and asking the CLI to
   * make one again would leave a second container over the folder's own
   * `devcontainer.json`. So this is the only record that it is a computer at
   * all - who adopted it, under its id, beside the configuration. A listing, an
   * inspection and an up-time stretch read it from there, which is what makes
   * an adopted container owned and metered like any other the relay starts -
   * decision `a-relay-container-is-owned-by-who-connected`.
   */
  onAdopted?: (connect: ContainerConnect, id: string) => void;
  /**
   * The variables a computer holds whose values were read from the vault, by
   * its machine id.
   *
   * They were never given to `up`, so the container does not hold them, and
   * every command a connect runs in there is given them by name. A rejection
   * refuses the connect in its own words. Absent, nothing more is given.
   */
  named?: (machine: string) => Promise<Record<string, string>>;
  /**
   * How the host inside the container is started.
   *
   * The program and its arguments, before ours: `--stdio`, the workspace path
   * and the generated configuration are appended. It defaults to `ahpd`, which
   * is the command the install step below provides: a program that exists in
   * the container, rather than a resolution through `npx` on every start.
   */
  host?: string[];
  /**
   * How the host inside is installed when the image has not got one.
   *
   * A sentence is the command, and `false` says the image already has it or
   * `host` names something else entirely - a checkout mounted into the
   * container, for instance. Skipping the probe as well as the install is the
   * point: an operator who named `host` should not wait a minute for a package
   * nothing is going to run.
   */
  install?: string | false;
  /**
   * What the host inside loads, and the one option with no useful default.
   *
   * The host inside is an `ahpd` like this one, and it bundles no backend
   * either - decision `the-daemon-bundles-no-agent` - so a list with nothing
   * in it is a host that exits rather than one that serves files and shells.
   * `connect` refuses on an empty list instead of building a container for it.
   *
   * Not defaulted to this daemon's own list, tempting as that is: these
   * specs are resolved inside the container, where this host's configuration
   * directory does not exist and a relative path means a different tree.
   * What runs in there is a deployment fact, and the deployment says it.
   *
   * This is also the whole of cofold's answer: its loop runs in this process
   * and cannot be moved into a machine, so naming it here - where the *host*
   * is the thing inside the container - is the only way it runs in one.
   */
  plugins?: PluginSpec[];
  /**
   * The daemon's `@ahpd/sdk` version, `PluginContext.version`, which the
   * server installed in a container is pinned to. Absent installs the
   * published latest.
   */
  version?: string;
  /** Lines worth keeping. Nothing is logged without one. */
  log?: (line: string) => void;
}

/** One line at a time, with the half of a line that has not arrived yet held. */
const lines = (handle: (line: string) => void): (chunk: string) => void => {
  let tail = '';
  return (chunk) => {
    tail += chunk;
    let at = tail.indexOf('\n');
    while (at !== -1) {
      handle(tail.slice(0, at).replace(/\r$/, ''));
      tail = tail.slice(at + 1);
      at = tail.indexOf('\n');
    }
  };
};

/** One shell word, quoted so a path with a space or a quote survives. */
const quote = (word: string): string => `'${word.replace(/'/g, `'\\''`)}'`;

/** What a spec is called, whether it was written as a string or an object. */
const nameOf = (spec: PluginSpec): string => (typeof spec === 'string' ? spec : spec.name);

/**
 * Whether a spec is a package name the container's npm can install.
 *
 * The same test `ahpd plugin install` refuses on: a path and a spec with a
 * scheme of its own are used as written inside the container, where the
 * meaning of both is the deployment's and not this launcher's.
 */
const isPackageName = (spec: PluginSpec): boolean => {
  const name = nameOf(spec);
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(name) && !name.startsWith('.') && !name.startsWith('/');
};

/**
 * The shell line that installs the backends a container has not got.
 *
 * One `[ -e ]` per package against the configuration directory the host
 * inside resolves from, so an image built with its backends runs no npm at
 * all and starts offline. What is missing goes to one `plugin install`, run
 * with the same program and arguments as the host itself.
 */
export const pluginInstallLine = (host: readonly string[], specs: readonly string[]): string => {
  const dir = '"${XDG_CONFIG_HOME:-$HOME/.config}/ahpd/node_modules"';
  const checks = specs.map((spec) => {
    const at = spec.indexOf('@', 1);
    const name = at === -1 ? spec : spec.slice(0, at);
    return `[ -e ${dir}/${quote(name)}/package.json ] || set -- "$@" ${quote(spec)}`;
  });
  return ['set --', ...checks, `[ $# -eq 0 ] || ${host.map(quote).join(' ')} plugin install --no-enable "$@"`].join('; ');
};

/** The CLI's own result, from its last line that is one. */
export const parseUp = (stdout: string): { containerId: string; remoteWorkspaceFolder: string } | undefined => {
  const found = stdout.trim().split('\n').reverse();
  for (const line of found) {
    let held: unknown;
    try { held = JSON.parse(line); }
    catch { continue; }
    if (typeof held !== 'object' || held === null || Array.isArray(held)) continue;
    const one = held as Record<string, unknown>;
    // The CLI logs as it works, so the result is one line among many. What
    // makes it the result is the outcome and the two fields, not its position.
    if (one.outcome !== 'success' || typeof one.containerId !== 'string' || typeof one.remoteWorkspaceFolder !== 'string') continue;
    return { containerId: one.containerId, remoteWorkspaceFolder: one.remoteWorkspaceFolder };
  }
  return undefined;
};

/**
 * Where a folder's own definition is, by the CLI's two names, or nothing.
 *
 * The file rather than the fact of it, because an override config replaces that
 * file instead of merging with it, so anything this host adds to a make has to
 * be written on top of what the folder's owner wrote.
 */
export const definitionOf = (folder: string): string | undefined => {
  const beside = join(folder, '.devcontainer', 'devcontainer.json');
  const at = join(folder, '.devcontainer.json');
  return existsSync(beside) ? beside : existsSync(at) ? at : undefined;
};

/** Whether a folder is a dev container at all, by the CLI's own two names. */
export const hasDefinition = (folder: string): boolean => definitionOf(folder) !== undefined;

/**
 * The launcher, as the port a host carries.
 *
 * Its per-connection state is one map: the CLI process in stdio mode whose
 * pipes are the relay's. Nothing else is remembered, because nothing else is
 * this host's - the container belongs to the CLI and the workspace.
 */
export const devContainer = (options: DevContainerOptions = {}): ContainerPort => {
  const command = options.command ?? 'devcontainer';
  const base = options.args ?? [];
  const docker = options.docker ?? { command: 'docker', args: [] };
  const probes = options.probes;
  const env = options.env;
  const log = options.log ?? ((): void => { /* nothing is kept without one */ });
  const host = options.host ?? ['ahpd'];
  const install = options.install;
  const plugins = options.plugins ?? [];
  const label = options.label ?? 'ahpd.computer=1';
  const existing = options.existing;
  const adopted = options.adopted;
  const live = new Map<string, ChildProcessWithoutNullStreams>();
  /*
   * The remote workspace each folder's container was made with, for this
   * daemon's life.
   *
   * A second `connect` for the same folder must not run `up` again, and the
   * nested host still has to be told the container path `--path` takes. The
   * CLI only answers that when it is asked to bring the container up, so what
   * it said the first time is kept here; a daemon that has not seen the folder
   * asks the CLI again, which finds the labelled container rather than making
   * a second one.
   */
  const remotes = new Map<string, string>();

  /** The CLI's own environment: this process's, plus whatever the caller named. */
  const where = (): Record<string, string> => ({ ...process.env, ...env }) as Record<string, string>;

  /**
   * Whether one program answers its version flag, asked once.
   *
   * `isDockerAvailable` is ungated - the reference client asks it before it can
   * ask for anything else - so anybody who completes a handshake could reach
   * this, and every call was a process. `available()` is worse: the host asks
   * it on every `initialize`, so two more spawns arrived with every client that
   * connected.
   *
   * Held for the life of the daemon rather than for a while, because the
   * question is whether a program is installed and a program does not appear
   * between two connections. It is not whether the Docker *daemon* is up: that
   * is answered by the command that needs it, which is `up`, and answered in
   * its own words. An operator who installs Docker beside a running daemon
   * restarts the daemon.
   */
  const asked = new Map<string, Promise<boolean>>();
  const there = (program: string, argv: string[]): Promise<boolean> => {
    const key = [program, ...argv].join('\u0000');
    const held = asked.get(key);
    if (held !== undefined) return held;
    const answer = new Promise<boolean>((resolve) => {
      const child = spawn(program, argv, { stdio: 'ignore', env: where() });
      child.once('error', () => resolve(false));
      child.once('close', (code) => resolve(code === 0));
    });
    // Held before it settles, so calls that arrive together are one spawn.
    asked.set(key, answer);
    return answer;
  };

  /** One command, collected and streamed. */
  const run = (argv: string[], sink: ContainerSink): Promise<{ code: number; stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      // Echoed first, as the reference does: a person watching a container
      // build should see the command whose output follows.
      sink.output(`$ ${[command, ...argv].map(quote).join(' ')}\n`);
      const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'pipe'], env: where() });
      let stdout = '';
      let stderr = '';
      // The CLI echoes the `docker run` it builds at info level, which carries
      // every `-e` a need asked for, so what it prints is masked on the way out,
      // a whole line at a time.
      const out = maskedLines((said) => { sink.output(said); });
      const err = maskedLines((said) => { sink.output(said); });
      child.stdout.on('data', (chunk: Buffer) => { const said = String(chunk); stdout += said; out.write(said); });
      child.stderr.on('data', (chunk: Buffer) => { const said = String(chunk); stderr += said; err.write(said); });
      child.once('error', reject);
      child.once('close', (code) => {
        out.end();
        err.end();
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });

  /**
   * How the folder's container is reached, from the probe kept beside the
   * configuration or a fresh one.
   *
   * Kept against the machine id rather than the container, so the same computer
   * answers from one entry whichever of the three ids - the container id, the
   * Docker name, the label - the road that reached it happens to have. The
   * entry records the container it was probed from, and a container the CLI
   * made again is probed again: the shell that answered last time is not the
   * one in there now.
   *
   * A probe that answered nothing is not kept, so a container whose shell was
   * not yet in place is asked again on the next connect.
   */
  const reachOfContainer = async (machine: string, id: string): Promise<Reach> => {
    const inspect = await runCli(docker, ['inspect', '--format', '{{json .}}', id]);
    const found = record(inspect.stdout);
    const container = String(found.Id ?? id);
    const kept = probes?.of(machine);
    // `${localEnv:NAME}` resolves against the environment the CLI is spawned
    // with, its own `env` option included.
    if (kept?.container === container) return reachOf(found, kept, where());
    const env = await probeEnv(docker, found, log);
    const probe = probeKept(found, container, env);
    if (Object.keys(env).length !== 0) probes?.keep(machine, probe);
    return reachOf(found, probe, where());
  };

  /**
   * One command inside the container, by `docker exec` as the CLI builds it,
   * with `given` passed by name beside the container's own.
   */
  const inside = async (
    into: Reach & { id: string },
    said: string,
    sink: ContainerSink,
    given: Record<string, string>,
  ) => {
    const { argv, env: values } = execArgv(into, ['/bin/sh', '-c', said], given);
    sink.output(`$ ${[docker.command, ...shown(argv)].map(quote).join(' ')}\n`);
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(docker.command, [...docker.args, ...argv], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(docker.env ?? {}), ...env, ...values },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); sink.output(String(chunk)); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); sink.output(String(chunk)); });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
  };

  return {
    docker: async () => there(docker.command, [...docker.args, '--version']),

    /*
     * Whether this host can run a host inside a container at all.
     *
     * The backend list is asked first, and not only because it costs no
     * process: a deployment that named none could never start the host
     * inside, and a capability advertised over that is a flow a client offers
     * and every `connect` refuses. Said on the log rather than silently,
     * because an empty list is a configuration somebody can fix and Docker
     * being absent is not.
     */
    available: async () => {
      if (plugins.length === 0) {
        log('no devcontainer.plugins, so the host inside would have no backend: the capability is not advertised');
        return false;
      }
      return (await there(docker.command, [...docker.args, '--version'])) && (await there(command, [...base, '--version']));
    },

    connect: async (one: ContainerConnect, sink: ContainerSink): Promise<ContainerConnectResult> => {
      /*
       * Asked before anything is built, because `devcontainer up` is a minute
       * and this failure is knowable at the start: a host with no backend
       * exits on startup, and the relay would report that as a container that
       * closed rather than as a list nobody filled in.
       */
      if (plugins.length === 0) {
        throw new Error('The host inside the container would have no backend and would not start. Name at least one under the computer plugin\'s devcontainer.plugins - "@ahpd/agent-cofold" runs this way and no other');
      }
      if (!hasDefinition(one.workspaceFolder)) {
        throw new Error(`${one.workspaceFolder} has no devcontainer.json or .devcontainer/devcontainer.json, so there is no dev container to make`);
      }
      /*
       * The computer that folder already is, when there is one.
       *
       * A relay finds the same computer a session makes: the container a
       * folder's `devcontainer.json` made is one object, listed and reached
       * like any other - decision
       * `a-dev-container-is-a-computer-made-from-its-devcontainer-json`. Only
       * the id and whether it is up are asked for, because this port has no
       * listing of its own: the plugin hands the runtime's own answer in.
       */
      const known = existing === undefined
        ? undefined
        : await existing(one.workspaceFolder).catch(() => undefined);
      let made: { containerId: string; remoteWorkspaceFolder: string };
      /*
       * The id this computer is listed and recorded under, which is not the same
       * thing as the container id a `docker exec` is given: a listing answers
       * the name a create gave, and the probe is kept against that name so all
       * three roads into a computer read one entry.
       */
      let machine = known?.id;
      const remembered = remotes.get(one.workspaceFolder);
      /*
       * The container this folder already has, when it is one the CLI made
       * before this host labelled it.
       *
       * Asked only where there is nothing of ours, and the answer is taken as it
       * stands: a container somebody else's connect made is the folder's own,
       * and a second one beside it would be two containers over one
       * `devcontainer.json`.
       */
      /*
       * It is asked again for a computer that is listed but that this launcher
       * did not bring up: an adopted container is listed from its record beside
       * the configuration, and after a restart nothing remembers where in it the
       * folder lands. `up` with the id labels would not find it and would make a
       * second container, so a listed computer that is the container the folder
       * already had is adopted again rather than brought up.
       */
      const older = adopted !== undefined && (known === undefined || remembered === undefined)
        ? await adopted(one.workspaceFolder).catch(() => undefined)
        : undefined;
      if (older !== undefined && (known === undefined || known.id === older.id)) {
        // Started here, which is what `up` would have done to it and the only
        // thing between a stopped container and the first command in it. A
        // refusal is refused here rather than carried on into an exec: nothing
        // below works in a container that is not running, and `docker start`
        // says why in its own words.
        const started = await runCli(docker, ['start', older.id]);
        if (started.code !== 0) {
          const said = started.stderr.trim() || started.stdout.trim();
          throw new Error(`The container the Dev Container CLI made for ${one.workspaceFolder} could not be started: ${said === '' ? `exit ${String(started.code)}` : said}`);
        }
        options.onAdopted?.(one, older.id);
        machine = older.id;
        made = { containerId: older.id, remoteWorkspaceFolder: older.remoteWorkspaceFolder };
        remotes.set(one.workspaceFolder, older.remoteWorkspaceFolder);
      }
      else if (known !== undefined && remembered !== undefined && known.running) {
        // Already up, and this daemon knows where in there the folder is: the
        // CLI is not asked to bring anything up a second time.
        made = { containerId: known.id, remoteWorkspaceFolder: remembered };
      }
      else {
        /*
         * The id labels, on the same `up` a session's create runs.
         *
         * They are what makes the CLI find the folder's own container rather
         * than make another, so a second connect, or a connect after a session
         * made one, reaches the same computer - decision
         * `a-dev-container-is-reached-by-docker-exec`.
         */
        const up = await run(
          [...base, 'up', '--log-level', 'debug', '--workspace-folder', one.workspaceFolder, ...idLabels(label, one.workspaceFolder)],
          sink,
        );
        const fresh = parseUp(up.stdout);
        if (fresh === undefined) {
          const said = masked([up.stdout.trim(), up.stderr.trim()].filter((one) => one !== '').join(' '));
          throw new Error(`The Dev Container CLI reported no container: ${said === '' ? `exit ${String(up.code)}` : said}`);
        }
        made = fresh;
        remotes.set(one.workspaceFolder, fresh.remoteWorkspaceFolder);
        // A container just made was not in the listing `known` was read from, so
        // it is asked for again: what names it in a listing is what its probe is
        // kept against.
        if (machine === undefined && existing !== undefined) {
          machine = (await existing(one.workspaceFolder).catch(() => undefined))?.id;
        }
      }
      const remote = made.remoteWorkspaceFolder;
      /*
       * How every command below reaches that container.
       *
       * Asked once per connect rather than once per command, because the probe
       * runs the user's login shell and its answer is kept beside the daemon's
       * configuration: the container this connect is about, not the command, and
       * under the machine id rather than the container id so the create and
       * `computer_exec` read the same entry. A container the CLI made again is
       * probed again, because the shell that answered last time is not the one
       * in there now - decision `a-dev-container-is-reached-by-docker-exec`.
       */
      const reached = { ...await reachOfContainer(machine ?? made.containerId, made.containerId), id: made.containerId };
      // The computer's vault-named variables, which no command in there has
      // unless it is given them.
      const given = options.named === undefined ? {} : await options.named(machine ?? made.containerId);

      /*
       * The host inside, put there if the image has not got one.
       *
       * Probed rather than assumed: an image built for this already has it,
       * and installing over it would be a version nobody chose. The version
       * installed is this build's own, so the two hosts are one build.
       */
      if (install !== false) {
        /*
         * The program that is actually going to run, not the default's name.
         *
         * This asked for `ahpd` however `host` was set, so a deployment that
         * names a checkout mounted into the container - `node /work/main.js` -
         * was told its image had no host and watched a package it will never
         * run being installed. The question is about `host[0]`, because that
         * is the program the line below starts.
         */
        const program = host[0] ?? 'ahpd';
        const present = await inside(reached, `command -v ${quote(program)}`, sink, given);
        if (present.code !== 0) {
          /*
           * The published server, pinned to the daemon's version where that is
           * knowable.
           *
           * `version` is the daemon's `@ahpd/sdk` version, which the plugin
           * reads from `PluginContext.version`; the `@ahpd/sdk` this package
           * imports may be another copy, installed beside it. Where it is not
           * given, or is `unknown`, `@ahpd/server@unknown` would be a registry
           * error about a version rather than about the install, so the
           * published latest is taken instead.
           */
          const version = options.version ?? 'unknown';
          const line = install ?? `npm i -g @ahpd/server${version === 'unknown' ? '' : `@${version}`} --allow-scripts=node-pty`;
          const installed = await inside(reached, line, sink, given);
          if (installed.code !== 0) {
            throw new Error(`The container has no ${program} and could not install one: ${installed.stderr.trim() || `exit ${String(installed.code)}`}. Give the image Node and npm, build it with @ahpd/server in it, or name the host it already has`);
          }
        }

        /*
         * And the backends, put there beside the server.
         *
         * The host inside is handed its plugins on the command line, but a
         * bare name still resolves from the configuration directory *in there*
         * - so the packages have to be installed into it or the nested host
         * exits saying they are missing. This runs whether or not the image
         * already had the server, because an image built with `@ahpd/server`
         * may still have no backend, and `--no-enable` because the list is
         * given on the command line rather than read from a file. A package
         * already in the configuration directory is not asked for, so an image
         * that has them all never reaches the registry.
         */
        const named = plugins.filter(isPackageName).map(nameOf);
        if (named.length > 0) {
          const installed = await inside(reached, pluginInstallLine(host, named), sink, given);
          if (installed.code !== 0) {
            throw new Error(`The container has no ${named.join(', ')} and could not install it: ${installed.stderr.trim() || `exit ${String(installed.code)}`}. Build the image with it, or name a path inside the container`);
          }
        }
      }

      /*
       * The configuration the nested host reads.
       *
       * Its own file, written owner-only, and a name nothing chose: the
       * connection's name is the client's, and a client's string in a shell
       * command is not a path. No credential goes in here - the relayed client
       * signs in to the host inside, which is where a credential for the
       * container's models belongs.
       */
      const config = {
        paths: [remote],
        sessions: 'memory',
        automations: 'memory',
        plugins,
      };
      const encoded = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
      const at = `/tmp/ahpd-nested-${randomUUID()}.json`;
      const written = await inside(reached, `printf %s ${encoded} | base64 -d > ${quote(at)} && chmod 600 ${quote(at)}`, sink, given);
      if (written.code !== 0) {
        throw new Error(`The container could not be given the host's configuration: ${written.stderr.trim() || `exit ${String(written.code)}`}`);
      }

      /*
       * And the host itself, in stdio mode.
       *
       * Not a port and not a token: `docker exec` carries this process's pipes
       * into the container, and the host inside answers on them - decision
       * `a-nested-host-speaks-stdio`. It is reached as every other command in
       * there is, and by container id rather than by the folder, which is what
       * removes the CLI's own lookup by `devcontainer.local_folder` - decision
       * `a-dev-container-is-reached-by-docker-exec`.
       */
      const line = [...host, '--stdio', '--path', remote, '--config-file', at].map(quote).join(' ');
      const { argv, env: values } = execArgv(reached, ['/bin/sh', '-c', line], given);
      // Echoed without values: this stream goes to the connecting client, and a
      // need's value is not the client's to read.
      sink.output(`$ ${[docker.command, ...shown(argv)].map(quote).join(' ')}\n`);
      const child = spawn(
        docker.command,
        [...docker.args, ...argv],
        { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(docker.env ?? {}), ...env, ...values } },
      );
      live.set(one.connectionId, child);

      child.stdout.on('data', lines((said) => {
        if (said.trim() === '') return;
        // A frame is JSON; anything else is the CLI talking, and a person
        // watching the startup should see it rather than a parse error.
        try {
          const held: unknown = JSON.parse(said);
          if (typeof held === 'object' && held !== null && !Array.isArray(held)) { sink.message(said); return; }
        }
        catch { /* not a frame */ }
        sink.output(`${said}\n`);
      }));
      child.stderr.on('data', (chunk: Buffer) => { sink.output(String(chunk)); });
      const ended = (why?: string): void => {
        if (live.get(one.connectionId) !== child) return;
        live.delete(one.connectionId);
        log(`${one.connectionId} ended${why === undefined ? '' : `: ${why}`}`);
        sink.close(why);
      };
      child.once('error', (error) => { ended(error.message); });
      child.once('close', (code) => { ended(code === 0 || code === null ? undefined : `exit ${String(code)}`); });

      return {
        address: `devcontainer:${made.containerId}`,
        remoteWorkspaceFolder: remote,
        hostWorkspaceFolder: one.workspaceFolder,
      };
    },

    send: (connectionId: string, data: string): void => {
      const child = live.get(connectionId);
      // One frame per line, which is the transport the host inside speaks.
      child?.stdin.write(`${data}\n`);
    },

    disconnect: (connectionId: string): void => {
      const child = live.get(connectionId);
      if (child === undefined) return;
      // Asked to stop, and the ending is reported by the same path a crash
      // takes: the map is cleared there, so one end is reported once whether
      // the process was killed or died on its own. What a client is told about
      // it is the host's business, and the host has already forgotten a
      // connection the client itself asked to end.
      child.kill('SIGTERM');
    },
  };
};

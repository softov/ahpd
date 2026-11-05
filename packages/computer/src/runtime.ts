import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, posix, resolve } from 'node:path';
import { hostPathOf, machinePathOf, ownerOf, partTarget } from '@ahpd/sdk';
import type { BroughtBack, Owner, ResolvedSeed, Spawn, SpawnOptions } from '@ahpd/sdk';
import { parse as parseJsonc } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';
import { isMap, isScalar, parseDocument as parseYamlDocument } from 'yaml';
import { cliOf, DEVCONTAINER_FOLDER, execArgv, folderLabelOf, idLabels, LOCAL_FOLDER, masked, parseUp, probeEnv, probeKept, reachOf, readConfiguration, runCli, workdirOf } from './devcontainer.js';
import { adoptedOf, keepProbe, probeOf } from './owners.js';
import type { MadeNeed } from './owners.js';
import { byName, DOCKER_OWN, DOCKER_OWN_PREFIX, dockerOwn } from './byname.js';
import { sourceOnHost, spelledOnHost, windowsHost } from './hostpath.js';
import { cliMountOf, cliVolumeOf, copyOf, gitVolumeOf, guardFor, guardedMounts, idsOfUser, MACHINE_GIT, MACHINE_USER, openReadingOf, seedOf, treeOf, userLabelOf, volumeFlagOf } from './gitdir.js';
import type { GitGuard, GitMounts, SessionTree } from './gitdir.js';
import { codeRouteOf } from './clone.js';
import type { CodeRoute } from './clone.js';
import { bringBack, bundledInto, checkedOut, fetchedInto, followOfCopy, hostGit, keepUncommitted, movesOver } from './machinegit.js';
import type { FarSeed, MachineGit, Ran } from './machinegit.js';
import { absoluteOnHost, mountParts } from './manifest.js';
import { archiveOf, FILLED_MARKER, firstFileOf, IMAGE_PATH, MACHINE_PARTS, once, partsLabel, partsSaid, pathWith, volumeOf } from './parts.js';
import type { ArchiveEntry, MadePart, Tarball } from './parts.js';
import type { Cli, CliOptions, DevContainerConfiguration, Reach } from './devcontainer.js';
import type { ServerReport } from './servercheck.js';

/**
 * What a machine is, and what a runtime does with one.
 *
 * The seam the provider and the tools are written against, so the package knows
 * what a machine is without knowing what makes it. Docker is the runtime that
 * ships; is why the runtime is an
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
   * that the folder already has one.
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

/** One state directory a machine asks for, as its manifest answers it. */
export interface AskedState {
  /** The need's name, for a refusal and a log line. */
  need: string;
  /** The provider id of the agent that declared it. */
  provider: string;
  /** The state directory inside the machine. */
  target: string;
  /** What it is seeded from. */
  seed?: ResolvedSeed[];
}

/** One state directory with the volume that holds it. */
export interface MadeState extends AskedState {
  /** The named volume, as `stateVolumeOf` names it. */
  volume: string;
}

/** The label a machine with state volumes carries, valued `volume`. */
export const MACHINE_STATE = 'ahpd.state';

/** A name as one piece of a volume name: lowercased, every character outside `[a-z0-9-]` a dash. */
const volumePiece = (said: string): string => said.toLowerCase().replace(/[^a-z0-9-]/g, '-');

/**
 * The volume one provider's state lives in on a machine, and the one place a
 * state volume is named.
 *
 * By profile, owner and provider, `ahpd-state-<profile>-<owner>-<provider>`;
 * with a `shared` scope by profile and provider, `ahpd-state-<profile>-<provider>`;
 * without a profile by the machine's id and provider,
 * `ahpd-state-<id>-<provider>`, which goes with the machine. Each piece is
 * lowercased with every character outside `[a-z0-9-]` written as a dash, so
 * `user:alice` is `user-alice`, and the name ends in the first 8 hex of the
 * sha256 of the pieces as written, joined by NUL - the profile, the owner or
 * nothing, and the provider, or the id and the provider - so two machines whose
 * readable names meet, `user:a` with `b-claude` and `user:a-b` with `claude`,
 * still get two volumes.
 */
export const stateVolumeOf = (
  machine: { profile?: string; owner?: string; id: string; scope?: 'owner' | 'shared' },
  provider: string,
): string => {
  const pieces = machine.profile === undefined || machine.profile === ''
    ? [machine.id, provider]
    : [machine.profile, machine.scope === 'shared' ? '' : machine.owner ?? '', provider];
  const readable = ['ahpd-state', ...pieces.filter((one) => one !== '')].map(volumePiece).join('-');
  return `${readable}-${createHash('sha256').update(pieces.join('\0')).digest('hex').slice(0, 8)}`;
};

/**
 * The file in a state volume that records each seed as it was when it was
 * written, by its target: its size and mtime and its filters, or that it was
 * absent.
 */
export const SEED_STAMP = '.ahpd-seed.json';

/**
 * Where a state volume is mounted in a helper that seeds it: one level under
 * a directory of its own, so the archive written into that directory names the
 * volume's root as an entry of its own, `state/`, whose owner Docker sets. An
 * entry for the directory an archive is written into is not one Docker applies.
 */
const SEED_AT = '/ahpd-seed/state';

/**
 * Every regular file under a directory, by its path relative to it, in a fixed
 * order, and the links found there.
 *
 * Read with `lstat`, so a link is never followed: one to a parent would walk
 * forever, and one out of the directory would copy a file the seed never named.
 * Each link is answered in `links` by its host path.
 */
const filesUnder = (root: string, at = '', links: string[] = []): { files: string[]; links: string[] } => {
  const files: string[] = [];
  for (const entry of readdirSync(join(root, at), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = at === '' ? entry.name : `${at}/${entry.name}`;
    const stat = lstatSync(join(root, path), { throwIfNoEntry: false });
    if (stat === undefined) continue;
    if (stat.isSymbolicLink()) links.push(join(root, path));
    else if (stat.isDirectory()) files.push(...filesUnder(root, path, links).files);
    else if (stat.isFile()) files.push(path);
  }
  return { files, links };
};

/**
 * What a seed is on this host now, as the stamp records it.
 *
 * A file by its size and mtime, a directory by its files' count, total size and
 * newest mtime, and an absent source as absent; the filters are part of it, so
 * a changed `keep` or `drop` seeds the file again. A source that is itself a
 * link is followed, since the agent named it.
 */
const seedMark = (seed: ResolvedSeed): string => {
  const filters = { ...(seed.keep === undefined ? {} : { keep: seed.keep }), ...(seed.drop === undefined ? {} : { drop: seed.drop }) };
  const stat = statSync(seed.source, { throwIfNoEntry: false });
  if (stat === undefined) return JSON.stringify({ source: seed.source, absent: true });
  if (!stat.isDirectory()) return JSON.stringify({ source: seed.source, size: stat.size, mtime: stat.mtimeMs, ...filters });
  const files = filesUnder(seed.source).files.map((one) => lstatSync(join(seed.source, one)));
  return JSON.stringify({
    source: seed.source,
    files: files.length,
    size: files.reduce((sum, one) => sum + one.size, 0),
    mtime: files.reduce((newest, one) => Math.max(newest, one.mtimeMs), 0),
  });
};

/** One own property of an object, never one its prototype answers. */
const ownOf = (value: unknown, key: string): unknown =>
  (typeof value === 'object' && value !== null && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined);

/**
 * A JSON file's text with only the `keep` keys at its top, and each `drop`
 * dotted path taken out, walking own properties alone.
 */
const filteredJson = (text: string, keep?: string[], drop?: string[]): string => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('it is not a JSON object');
  let value = parsed as Record<string, unknown>;
  if (keep !== undefined) value = Object.fromEntries(Object.entries(value).filter(([key]) => keep.includes(key)));
  for (const path of drop ?? []) {
    const keys = path.split('.');
    const last = keys.pop() ?? '';
    let at: unknown = value;
    for (const key of keys) at = ownOf(at, key);
    if (typeof at === 'object' && at !== null && Object.hasOwn(at, last)) delete (at as Record<string, unknown>)[last];
  }
  return `${JSON.stringify(value, undefined, 2)}\n`;
};

/**
 * One seed's files as archive entries under its target, a JSON file filtered,
 * and the links inside a seeded directory that were left out.
 */
const seedEntries = (seed: ResolvedSeed): { entries: Tarball[]; links: string[] } => {
  if (statSync(seed.source).isDirectory()) {
    const found = filesUnder(seed.source);
    return {
      entries: found.files.map((one) => ({ name: `${seed.target}/${one}`, bytes: readFileSync(join(seed.source, one)) })),
      links: found.links,
    };
  }
  const bytes = readFileSync(seed.source);
  if (seed.keep === undefined && seed.drop === undefined) return { entries: [{ name: seed.target, bytes }], links: [] };
  return { entries: [{ name: seed.target, bytes: Buffer.from(filteredJson(bytes.toString('utf8'), seed.keep, seed.drop), 'utf8') }], links: [] };
};

/**
 * A seed archive owned by `ids`, to be written into the directory above the
 * volume's root: the root as `<dir>/`, every directory the files sit in, then
 * the files, each entry carrying the uid and gid, which `docker cp -a` keeps.
 */
const ownedArchive = (files: Tarball[], ids: { uid: number; gid: number }, dir: string): ArchiveEntry[] => {
  const directories = [...new Set(files.flatMap((one) => {
    const parts = one.name.split('/').slice(0, -1);
    return parts.map((_, at) => `${parts.slice(0, at + 1).join('/')}/`);
  }))];
  const empty = Buffer.alloc(0);
  return [
    { name: `${dir}/`, bytes: empty, directory: true, ...ids },
    ...directories.map((name) => ({ name: `${dir}/${name}`, bytes: empty, directory: true, ...ids })),
    ...files.map((one) => ({ ...one, name: `${dir}/${one.name}`, ...ids })),
  ];
};

/** Whether a container user is root, which owns whatever `docker cp` wrote. */
const isRoot = (user: string): boolean => user === '' || /^(?:root|0)(?::|$)/.test(user);

/** A host mount that stands in for a part a machine could not have built. */
export interface PartFallback {
  /** The part it stands in for. */
  part: string;
  /** The need that declared it, for the line that says it was used. */
  need: string;
  /** The host path mounted. */
  source: string;
  /** Where it is mounted in the machine. */
  target: string;
  /** The mount as the runtime is handed it, `<source>:<target>[:ro]`. */
  mount: string;
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
   * `devcontainer.json` read by the Dev Container CLI. The
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
   * The OCI runtime Docker starts this machine's container under, `runsc` for
   * gVisor; absent starts it under Docker's own default.
   *
   * What a profile's `ociRuntime` comes to, and the profile's alone: the
   * boundary a machine is given is the operator's to choose. Written as one argument,
   * `--runtime=<value>`, and passed as given, so a Docker that has no such
   * runtime refuses the machine with its own message. Nothing reads it on the
   * dev container route, which the CLI makes rather than `docker run`.
   */
  ociRuntime?: string;
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
   * The parts this machine asks for, by id, the ones each requires among them.
   *
   * What a manifest answers; the plugin builds them into `parts` before the
   * machine is made, and a runtime reads only `parts`.
   */
  partsAsked?: string[];
  /**
   * The parts the session's own agent needs, on a machine made for one
   * session; absent on a machine any session may share.
   */
  sessionParts?: string[];
  /**
   * The parts this machine is made with, each built and tagged.
   *
   * Each is mounted read-only at `/opt/ahpd/<id>`: from its own image where the
   * runtime takes an image mount, from a volume filled once from that image
   * otherwise. The
   * machine is labelled `ahpd.parts` with exactly these, and its `PATH` has each
   * one's `bin` in front.
   */
  parts?: MadePart[];
  /**
   * The host mount each asked part is replaced by when it cannot be built, by
   * part id, as the agent that needs the part declared it.
   *
   * What a manifest answers; the plugin adds a fallback's mount to `mounts`
   * and its part to `hostParts` only for a part whose build failed.
   */
  partFallbacks?: PartFallback[];
  /**
   * The parts this machine has from this host rather than from their image,
   * each a fallback mount made in place of a part that could not be built.
   * The `ahpd.parts` label names each as `<id>@host`.
   */
  hostParts?: string[];
  /**
   * The state directories this machine asks for, each by the agent that
   * declared it; the plugin names each one's volume into `states`.
   */
  statesAsked?: AskedState[];
  /** Who shares this machine's state volumes, as its profile says. */
  stateScope?: 'owner' | 'shared';
  /**
   * The state volumes this machine is made with, each mounted at its state
   * directory and seeded before the machine starts. The machine is labelled
   * `ahpd.state=volume` when it has one.
   */
  states?: MadeState[];
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
   * is one to adopt rather than one to leave alone - and
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
  /**
   * The repository's common git directory, mounted read-write at its own path
   * beside the folder, with what git on the host runs bound read-only over it.
   */
  gitDir?: string;
  /**
   * The root of the tree the folder is in, mounted at its own path in place of
   * the folder, for a session in a folder below it.
   */
  repository?: string;
  /** How the git directory is guarded; `fetch` when absent. */
  gitGuard?: GitGuard;
  /** How a machine on another box's Docker is given its code; `bundle` when absent. */
  code?: CodeRoute;
  /**
   * Whether the machine works in the host's tree or in a copy of it, at the
   * tree's own path in the volume it commits into; `shared` when absent.
   *
   * A copy machine binds nothing of the host's tree: the volume holds the
   * working tree and the machine's git directory together, and what the agent
   * commits reaches the host by fetch - decision
   * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
   */
  sessionTree?: SessionTree;
  /**
   * The `<uid>:<gid>` the machine's commands run as, recorded as the
   * `ahpd.user` label: the host user's, on a machine with a git directory.
   */
  user?: string;
  /** Where a command starts inside the machine. */
  workdir?: string;
  /**
   * Whose the machine is, recorded as a label, and what its work is charged
   * under beside it.
   *
   * The owner is a typed reference as the usage rules spell one, and it is the
   * owner of every stretch this machine spends up. Stored
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

/**
 * Whose a machine is, and what its work is charged under.
 *
 * The same answer whether it was read from a label or from the record beside
 * the configuration: an owner, and the team and the project within it that a
 * stretch of up time is charged to.
 */
export interface Ownership {
  owner?: Owner;
  team?: string;
  project?: string;
}

/** A machine maker. */
export interface ComputerRuntime {
  /** The name `capabilities` reports and the option a host was configured with. */
  readonly kind: string;
  /**
   * Whether the machines this runtime makes are off this host.
   *
   * Asked before a backend is started, because a machine on another box cannot
   * be reached by a command run here: every backend runs nested in such a
   * machine.
   */
  readonly remote: boolean;
  /**
   * Whether a command into one of its machines carries its variables inside
   * the command line, where the box's own process list reads them.
   *
   * Absent is no: Docker gives a variable to `docker exec` by name and its
   * value through the API, whichever box the daemon is on.
   */
  readonly envInCommand?: boolean;
  list(): Promise<Machine[]>;
  /** The runtime's own record of one machine, or nothing when it is not there. */
  inspect(id: string): Promise<Record<string, unknown> | undefined>;
  /**
   * What one machine is doing, in the words the `state` leaf reads and writes.
   *
   * The runtime's own answer rather than a record read here: a machine this
   * host made says it from its own record, and a machine off this host from one
   * reach over the network, and a caller that read either shape would have to
   * know which runtime it was asking. `undefined` for a machine that is not
   * there, the same answer `inspect` gives. `suspended` comes only from a
   * runtime that has `suspend`.
   */
  state(id: string): Promise<'running' | 'stopped' | 'suspended' | undefined>;
  /**
   * The agents one machine was prepared for, or nothing when it is not there.
   *
   * A machine prepared for nobody answers an empty list, which is not the same
   * answer: the picker offers it to every agent, and the host lets every agent
   * in.
   */
  agents(id: string): Promise<string[] | undefined>;
  /**
   * The parts one machine was made with, or nothing when there is nothing to
   * check them against.
   *
   * Nothing for a machine that is not there, and nothing for one whose runtime
   * mounts no parts: a part is an image mounted when a machine is made, and a
   * box that is listed rather than made brings its own ahpd and agents. A
   * machine made without the label answers an empty list, which is a machine
   * made with no parts.
   */
  parts(id: string): Promise<string[] | undefined>;
  /**
   * Whose one machine is and what its work is charged under, or nothing when it
   * is not there.
   *
   * Every field is absent on a machine that carries none of them, which is a
   * machine made outside ahpd rather than one nobody owns.
   */
  owner(id: string): Promise<Ownership | undefined>;
  /**
   * The command that runs a program inside one, or nothing when there is no
   * such machine.
   *
   * A descriptor and not a running process, as `nested` answers one: the caller
   * owns the spawn and its stdio. The environment a spawned
   * program needs travels in the descriptor, so no value is in the argv a
   * process list shows. A runtime that cannot reach its host at all throws,
   * because "there is no such machine" and "the runtime is not answering" are
   * different answers.
   */
  how(id: string, asked: SpawnOptions): Promise<Spawn | undefined>;
  /**
   * The command that starts a nested host inside one of this runtime's
   * machines, or nothing when there is no such machine.
   *
   * The machine's own recipe says it, rather than the caller: a profile's
   * `host`, or what the runtime starts a host with by default.
   */
  hostCommand(id: string): Promise<string[] | undefined>;
  run(spec: MachineSpec): Promise<Machine>;
  stop(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /**
   * Run a command inside one, and answer what it printed and what it exited with.
   *
   * `env` is set for the command alone, each variable by name with its value in
   * the environment the runtime's program is spawned with. `provider` is the
   * agent whose session asked for the command, which the computer plugin gives
   * only that agent's vault-read variables; a runtime itself ignores it.
   */
  exec(id: string, command: string[], env?: Record<string, string>, provider?: string): Promise<ExecResult>;
  /**
   * Host paths written into a machine, each at the path it already has.
   *
   * A host file a session is handed by path is a file only if the machine holds
   * one at that path, and a running machine takes no new mount. The copy is
   * read-only, so nothing inside a machine writes over what it was handed, and
   * the folder above each path is made on the way in.
   *
   * A machine that is not there, or is not running, is an error: there is no
   * copy to be had, and a caller reads the runtime's own sentence.
   */
  putIn(id: string, paths: string[]): Promise<void>;
  /**
   * Host paths taken back out of a machine, with whatever is under them.
   *
   * What a session's folder is removed with when the session goes: the copy is
   * this host's, made for one session, and nothing else in the machine reads it.
   */
  takeOut(id: string, paths: string[]): Promise<void>;
  /**
   * Bring the commits a machine made in a git directory of its own back into
   * the host's repository, and answer what became of them.
   *
   * The commits leave the machine as a bundle on a pipe, and the host's git
   * reads nothing of the machine but the private file this host writes them
   * into - decision
   * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
   *
   * `undefined` for a machine that is not here, like `inspect`'s answer.
   */
  bringBack(id: string): Promise<BroughtBack | undefined>;
  /**
   * Put a machine where the host's branch is, before a turn reads it.
   *
   * A machine that commits in a git directory of its own reads history the host
   * already has and writes commits the host does not, so between two turns the
   * two drift: a commit made on the host - a person's in the tree, or one a
   * changeset operation made - is not in what the agent's git reads. This hands
   * it over, and only where the machine holds nothing the host has not fetched.
   *
   * Nothing of the host's is written, and `undefined` for a machine that is not
   * here, like `inspect`'s answer.
   */
  follow(id: string): Promise<void>;
  /** Start one that is stopped. */
  start(id: string): Promise<void>;
  /** Stop and start one, whichever it was. */
  restart(id: string): Promise<void>;
  /**
   * Hold one running machine where it is, with its memory kept and no CPU used.
   *
   * Only a runtime whose machines can be held has it, and `suspends` says
   * which machines those are.
   */
  suspend?(id: string): Promise<void>;
  /** Let one suspended machine run again from where it was held. */
  resume?(id: string): Promise<void>;
  /**
   * Whether `suspend` and `resume` work on this machine, without reaching it.
   *
   * A runtime serving several asks the one the id names.
   */
  suspends?(id: string): boolean;
  /** What one machine is using right now, or nothing when it is not running. */
  stats(id: string): Promise<MachineStats | undefined>;
  /**
   * What the box one machine is can run, from the server check.
   *
   * Only a runtime whose machines are boxes an operator set up has it: a
   * machine this host made is the image it was made from, and there is nothing
   * on it to install. `undefined` for a machine that is not there.
   */
  check?(id: string): Promise<ServerReport | undefined>;
  /**
   * Whether `check` answers for this machine, without reaching it.
   *
   * Asked for a listing, which must not cost a reach per machine, and which
   * a runtime serving several asks of the one the id names.
   */
  checks?(id: string): boolean;
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
 * another does not is no limit at all.
 *
 * The machines come back with it, because each road says so in its own words:
 * the ones already here to a tool that has to name them, and the one that
 * would not fit to a request that names what was refused. They are the caller's
 * own listing rather than a listing of their own, so a road that counts them
 * against something else - a name that is taken - lists them once.
 */
export const roomFor = (held: Machine[], max: number): Machine[] | undefined =>
  held.length >= max ? held : undefined;

/** The operation each runtime has queued last, which the next one waits on until it settles. */
const operations = new WeakMap<ComputerRuntime, Promise<unknown>>();

/**
 * One create at a time per runtime, queued as VS Code queues one source's dev
 * container operations: a `SequencerByKey` (devContainerAgentHostService.ts
 * L224 and L246, and its `queue` in src/vs/base/common/async.ts L338-L363, at
 * 6b68d3fe), keyed by the runtime.
 *
 * `max` is a count, and a count read and then acted on is read too early: two
 * calls at once both read the same listing, both find room, and one more machine
 * exists than the limit says. So the count and the create it allows are one
 * operation, and a caller that arrives second counts the first create as one of
 * the machines.
 *
 * Keyed by runtime: two runtimes are two sets of machines, each with its own
 * limit. An operation that fails settles like any other, and the next one runs.
 */
export const queue = <T>(runtime: ComputerRuntime, task: () => Promise<T>): Promise<T> => {
  const next: Promise<T> = (operations.get(runtime) ?? Promise.resolve())
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (operations.get(runtime) === next) operations.delete(runtime);
    });
  operations.set(runtime, next);
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
  /**
   * The command that starts a nested host inside one of a profile's machines,
   * by profile key.
   *
   * A profile's `host` is what a machine made from it runs its host with, so it
   * is read here rather than in the plugin: which host a machine starts is read
   * from the machine's own record, and that record names the profile it was
   * made from.
   */
  hosts?: Record<string, string[] | undefined>;
  /** How a nested host is started in a machine, before a profile says otherwise. */
  host?: string[];
  /**
   * Whether a part may be mounted from its own image. Absent asks Docker once.
   *
   * `false` mounts every part from its volume without asking, which is the
   * route a Docker that refuses image mounts takes anyway.
   */
  imageMounts?: boolean;
  /**
   * Whether this Docker is on another box, reached through `env.DOCKER_HOST`.
   *
   * Such a Docker is not this host's: its machines run every backend nested,
   * and a dev container record kept beside this host's configuration names
   * none of its containers.
   */
  remote?: boolean;
  /**
   * The profile every machine this runtime makes is made from, by key.
   *
   * Set for a profile's own Docker, so its listing is that profile's machines
   * only: two profiles on one Docker list disjoint machines.
   */
  profile?: string;
  /**
   * This daemon's own id, which every machine a remote runtime makes carries
   * as `ahpd.host`.
   *
   * A remote Docker may be another daemon's too, so its listing is the
   * machines carrying this id only.
   */
  hostId?: string;
}

/** How a part reaches a machine: from its own image, or from a volume filled from it. */
export type PartRoute = 'image' | 'volume';

/**
 * The directory this host keeps its own files for a machine in.
 *
 * The daemon's configuration where it named one, which is where its other
 * records are; else the system's temporary directory, which is what a runtime
 * made by a test or by hand still needs to write a linked worktree's gitfile
 * into. Nothing here is read back from the machine.
 */
const stateDirOf = (options: DockerOptions): string => options.configDir ?? tmpdir();

/**
 * Whether a refused image mount was refused for the mount type itself.
 *
 * Only that answer is kept for the daemon's life: Docker answers a missing
 * source image with a pull error that names the container's image, and an
 * unreachable daemon says so, and neither says anything about image mounts.
 */
const refusesImageMounts = (said: string): boolean =>
  /type=image|image-subpath|mount type|type "image"|invalid field 'type'/i.test(said)
  && !/no such image|unable to find image|pull access denied|cannot connect/i.test(said);

/** A part as the `--mount` that takes it from its own image, read-only. */
const imageMountOf = (part: MadePart): string =>
  `type=image,source=${part.tag},image-subpath=${partTarget(part.id).slice(1)},target=${partTarget(part.id)},readonly`;

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
    // No console window on Windows, where each run of the command would open
    // one over whatever the daemon is drawing.
    windowsHide: true,
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
 * folder.
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
 * it only then. The
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

/**
 * A typed reference a label held, or nothing when it names no kind.
 *
 * The shared reader under this file's own word for it: a machine's label said
 * whose it is, and a label saying something else belongs to nobody.
 */
export const ownerSaid = ownerOf;

/**
 * Whose a machine is and what its work is charged under, from its own labels.
 *
 * Every field absent on a machine made before this existed, and the owner
 * absent on one made outside ahpd at all - which is a machine with no recorded
 * owner rather than one somebody owns.
 */
export const claimedBy = (labels: Record<string, unknown>): Ownership => {
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

/** One machine's mounts, as its own record says them. */
const mountsOf = (found: Record<string, unknown>): unknown[] => (Array.isArray(found.Mounts) ? found.Mounts : []);

/** Whether a machine is up, from the record `inspect` answered. */
const running = (found: Record<string, unknown>): boolean => {
  const state = (typeof found.State === 'object' && found.State !== null ? found.State : {}) as Record<string, unknown>;
  return state.Running === true;
};

/**
 * What a machine is doing, as the `state` leaf and the computer channel say it.
 *
 * Answered in the words the write takes, not the runtime's own.
 *
 * `docker`'s own status is a longer vocabulary than the two below, and a client
 * that read `exited` and wrote it back would be refused its own reading. The
 * runtime's word is not lost - `status` is its whole record and `State.Status`
 * is in it - but this leaf is the one a client round-trips, so it says only
 * what it will accept.
 */
export const stateOf = (found: Record<string, unknown>): 'running' | 'stopped' =>
  (running(found) ? 'running' : 'stopped');

/** The agents a machine was prepared for, from the record `inspect` answered. */
export const preparedFor = (found: Record<string, unknown>): string[] =>
  agentsSaid(labelsOf(found)[MACHINE_AGENTS]);

/** The part ids a machine was made with, from its own `ahpd.parts` label; none where it has no label. */
export const partsHeld = (found: Record<string, unknown>): string[] =>
  partsSaid(labelsOf(found)[MACHINE_PARTS]);

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
 * Where a path on this host is inside one machine, or nothing.
 *
 * A caller's working directory is this host's, and a `-w` of a host path is a
 * directory the machine does not have. A bind mount is the one thing that
 * makes the two the same place, so a path a mount covers is rewritten to its
 * path inside and a path no mount covers has no answer here - the caller falls
 * back to the machine's own working directory rather than starting somewhere
 * that only looks right.
 *
 * The longest source wins, so a mount nested inside another is not shadowed by
 * it, and a match is on a path boundary: `/srv/app` does not cover
 * `/srv/application`.
 *
 * One function for every runtime that mounts a host path into a machine, and
 * none for one that does not: a path on this host is not a path on a box
 * reached over the network, and an answer here would be a directory that is not
 * there.
 */
export const within = (held: Record<string, unknown>, path: string): string | undefined => {
  const mounts = Array.isArray(held.Mounts) ? held.Mounts : [];
  let best: { source: string; target: string } | undefined;
  for (const mount of mounts) {
    if (typeof mount !== 'object' || mount === null) continue;
    const { Source: reported, Destination: target } = mount as Record<string, unknown>;
    if (typeof reported !== 'string' || typeof target !== 'string' || reported === '' || target === '') continue;
    const source = sourceOnHost(reported);
    const [asked, mounted] = [spelledOnHost(path), spelledOnHost(source)];
    if (asked !== mounted && !asked.startsWith(mounted.endsWith('/') ? mounted : `${mounted}/`)) continue;
    if (best === undefined || source.length > best.source.length) best = { source, target };
  }
  if (best === undefined) return undefined;
  // The rest in the machine's separators: it is a path inside, which is POSIX.
  const rest = windowsHost ? path.slice(best.source.length).replaceAll('\\', '/') : path.slice(best.source.length);
  if (rest === '') return best.target;
  return `${best.target.endsWith('/') ? best.target.slice(0, -1) : best.target}${rest}`;
};

/**
 * The directory a machine's own commands start in, from its record.
 *
 * A machine this host made keeps it in the record's `Config.WorkingDir`, and a
 * box the operator configured says it as its own `workdir`, since nothing of
 * Docker's is there to read. One reader for both, so a session inside either
 * starts where the machine's own operator said - and the two are a fallback
 * under `within` above, which answers nothing for a box.
 *
 * Every other reader of a record is Docker's own: a machine's labels, its
 * mounts, its profile. This one is not, which is why it is here rather than at
 * a caller.
 */
export const machineDirectory = (found: Record<string, unknown>): string | undefined => {
  const config = (typeof found.Config === 'object' && found.Config !== null ? found.Config : {}) as Record<string, unknown>;
  const said = [config.WorkingDir, found.workdir].find((one) => typeof one === 'string' && one !== '');
  return typeof said === 'string' ? said : undefined;
};

/**
 * A `source:target` mount as the Dev Container CLI's `--mount` takes it.
 *
 * A manifest and a need speak the short Docker form, because that is what
 * `docker run -v` takes; the CLI wants its own. Read-only is not here: the
 * CLI's pattern has no word for it and answers "Unmatched argument format", so
 * a read-only mount goes in the override config's `mounts` instead.
 */
const cliMount = (mount: string): string => {
  const { source, target } = mountParts(mount);
  return `type=bind,source=${source},target=${target}`;
};

/** Whether a mount is the read-only one, which the override config carries. */
const readOnlyMount = (mount: string): boolean => mount.endsWith(':ro');

/**
 * A folder's own definition as an object, where the CLI's `read-configuration`
 * finds it, read as VS Code's dev container host reads it
 * (devContainerSandbox.ts L102-L106 at 6b68d3fe): with VS Code's JSONC parser,
 * published as jsonc-parser, under its default options
 * (src/vs/base/common/json.ts L145-L147), a parse error or a value that is
 * not an object refused in VS Code's words.
 *
 * The override config is that file's own contents with this host's keys laid
 * over it, so the file is read whole.
 */
const configOf = async (
  run: (argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
  folder: string,
): Promise<{ configuration: DevContainerConfiguration; config: Record<string, unknown> }> => {
  const configuration = await readConfiguration(run, folder);
  const errors: ParseError[] = [];
  const config: unknown = parseJsonc(readFileSync(configuration.configPath, 'utf8'), errors, { allowTrailingComma: true });
  if (errors.length > 0 || typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error(`Invalid Dev Container configuration: ${configuration.configPath}`);
  }
  return { configuration, config: config as Record<string, unknown> };
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
 * - the machine's `docker run` options (`runOptionsOf`), as `runArgs` for an
 *   image or Dockerfile definition, the place the CLI takes a plain Docker
 *   label and a limit from, and for a Compose definition as a Compose file of
 *   their own (`composeOverrideOf`);
 * - each part, as an image mount among those options where `route` is
 *   `image`, or as a read-only volume in `mounts` where it is `volume`;
 * - the git mounts, as `mounts` too: the host's objects read-only, the file a
 *   linked worktree's `.git` is replaced by, and the volume the machine commits
 *   into, with the guard as the `ahpd.git` label.
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
const overrideOf = (spec: MachineSpec, config: Record<string, unknown>, route?: PartRoute, git?: GitMounts): Record<string, unknown> => {
  const held: Record<string, unknown> = { ...config };
  const tree = spec.sessionTree ?? 'shared';
  const guard = guardFor(spec.gitGuard, tree);
  const readOnly = (spec.mounts ?? []).filter(readOnlyMount);
  // A part from its volume is a read-only mount like any other, and the CLI's
  // `--mount` has no word for read-only either.
  const volumes = route === 'volume' ? spec.parts ?? [] : [];
  // The git mounts: the host's objects read-only, the gitfile a linked worktree
  // needs, and the volume the machine commits into, in that order, after the rest.
  // Under `copy` the volume is the workspace mount above and not one of these.
  const binds = git?.binds ?? [];
  const own = git?.volume === undefined || tree === 'copy' ? [] : [cliVolumeOf(gitVolumeOf(spec.name), git.volume)];
  if (readOnly.length > 0 || volumes.length > 0 || binds.length > 0 || own.length > 0) {
    held.mounts = [
      ...(Array.isArray(held.mounts) ? (held.mounts as unknown[]) : []),
      ...readOnly.map((mount) => {
        const { source, target } = mountParts(mount);
        return `type=bind,source=${source},target=${target},readonly`;
      }),
      ...volumes.map((part) => `type=volume,source=${volumeOf(part)},target=${partTarget(part.id)},readonly`),
      ...binds.map(cliMountOf),
      ...own,
    ];
  }
  // Under `open`, how the host's git reads the tree, as `run` gives it too.
  const reading = guard === 'open' && spec.gitDir !== undefined && spec.devcontainer !== undefined
    ? openReadingOf(spec.repository ?? spec.devcontainer)
    : {};
  const plain = { ...madeWith(spec), ...reading };
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
  /*
   * With a git directory, the tree at its machine path, as on the Docker route: the
   * worktree's `.git` file names the git directory by its host path, and its
   * read-only bind has to land where the file is. Under `copy` the CLI's own
   * workspace mount is the machine's volume instead: it is the checkout the
   * machine works in, and nothing of the host's tree is bound - the volume is
   * mounted once, here, rather than again among the mounts below.
   */
  if (git !== undefined && spec.devcontainer !== undefined) {
    const root = spec.repository ?? spec.devcontainer;
    if (tree === 'copy') {
      held.workspaceMount = `source=${gitVolumeOf(spec.name)},target=${git.volume ?? machinePathOf(root)},type=volume`;
      held.workspaceFolder = git.volume ?? machinePathOf(root);
    }
    else {
      held.workspaceMount = `source=${root},target=${machinePathOf(root)},type=bind`;
      held.workspaceFolder = machinePathOf(spec.devcontainer);
    }
  }
  // A Compose definition takes its `docker run` options from a Compose file of
  // their own, which `composeOverrideOf` writes.
  if (config.dockerComposeFile === undefined) {
    const options = runOptionsOf(spec, guard, route);
    held.runArgs = [
      ...(Array.isArray(held.runArgs) ? (held.runArgs as string[]) : []),
      ...Object.entries(options.labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
      ...(options.cpus === undefined ? [] : ['--cpus', options.cpus]),
      ...(options.memory === undefined ? [] : ['--memory', options.memory]),
      // A part from its own image, which only `runArgs` can spell: the CLI
      // passes the entry to its `docker run` as written.
      ...options.images.flatMap((part) => ['--mount', imageMountOf(part)]),
    ];
  }
  return held;
};

/**
 * The `docker run` options a container the CLI makes is given: the machine's
 * labels, its limits, and each part mounted from its own image where `route`
 * is `image`.
 *
 * The labels are the name; the user and the guard a git directory is made
 * with; the agents; the profile, so a daemon that did not make the container
 * still reads its recipe, the needs whose vault-named values it reads again
 * among them; the parts, which a session needing one is checked against and
 * which put each part's `bin` on every command's `PATH`; and whether its
 * agents' state lives in volumes, which a remove reads back.
 */
const runOptionsOf = (spec: MachineSpec, guard: GitGuard, route?: PartRoute): {
  labels: Record<string, string>;
  cpus?: string;
  memory?: string;
  images: MadePart[];
} => {
  const agents = spec.agents ?? [];
  return {
    labels: {
      [MACHINE_NAME]: spec.name,
      ...(spec.user === undefined ? {} : { [MACHINE_USER]: spec.user }),
      ...(spec.gitDir === undefined ? {} : { [MACHINE_GIT]: guard }),
      ...(agents.length === 0 ? {} : { [MACHINE_AGENTS]: agents.join(',') }),
      ...(spec.profile === undefined || spec.profile === '' ? {} : { [MACHINE_PROFILE]: spec.profile }),
      ...(spec.parts === undefined ? {} : { [MACHINE_PARTS]: partsLabel(spec.parts, spec.hostParts) }),
      ...((spec.states ?? []).length === 0 ? {} : { [MACHINE_STATE]: 'volume' }),
    },
    ...(spec.cpus === undefined ? {} : { cpus: spec.cpus }),
    ...(spec.memory === undefined ? {} : { memory: spec.memory }),
    images: route === 'image' ? spec.parts ?? [] : [],
  };
};

/**
 * A Compose definition's `docker run` options, as a Compose override of its
 * service.
 *
 * The CLI gives `runArgs` to an image or Dockerfile definition alone, so these
 * are written as VS Code writes its sandbox's options for a definition with
 * `dockerComposeFile` (devContainerSandbox.ts L67-L94 and L107-L141 at
 * 6b68d3fe): a `compose.json` in the override's own directory, owner-only,
 * carrying the first Compose file's `version` as the CLI carries it into its
 * own overrides, and added after the definition's files. Where the definition
 * names `[]`, the CLI's own discovery is followed (`COMPOSE_FILE`, the
 * workspace's `.env`, else `docker-compose.yml` with its override beside it),
 * and the list goes to the CLI as `COMPOSE_FILE`, which keeps the workspace's
 * `.env` reaching it.
 *
 * The labels are the service's `labels`, the limits its `cpus` and
 * `mem_limit`, and a part from its own image a `volumes` entry of Compose's
 * `image` type.
 */
const composeOverrideOf = (
  options: ReturnType<typeof runOptionsOf>,
  configuration: DevContainerConfiguration,
  config: Record<string, unknown>,
  folder: string,
  directory: string,
  environment: Record<string, string | undefined>,
): { dockerComposeFile: string[] } | { COMPOSE_FILE: string } => {
  const declared = config.dockerComposeFile;
  const service = configuration.service ?? config.service;
  const files = typeof declared === 'string' ? [declared] : declared;
  if (!Array.isArray(files) || files.some((one) => typeof one !== 'string') || typeof service !== 'string' || service === '') {
    throw new Error('A computer requires a Dev Container Compose configuration with files and a service.');
  }
  const implicit = files.length === 0;
  const configured = configuration.dockerComposeFile ?? (files as string[]);
  const named = typeof configured === 'string' ? [configured] : configured;
  // The CLI's discovery, with its deliberately limited `.env` syntax, as VS
  // Code's `discoverComposeFiles` matches it (devContainerSandbox.ts L67-L94).
  const discovered = (): string[] => {
    let composeFile = environment.COMPOSE_FILE;
    if (composeFile === undefined || composeFile === '') {
      const env = join(folder, '.env');
      composeFile = existsSync(env) && statSync(env).isFile() ? /^COMPOSE_FILE=(.+)$/m.exec(readFileSync(env, 'utf8'))?.[1]?.trim() : undefined;
    }
    if (composeFile !== undefined && composeFile !== '') return composeFile.split(delimiter).map((one) => resolve(folder, one));
    const override = resolve(folder, 'docker-compose.override.yml');
    return [resolve(folder, 'docker-compose.yml'), ...(existsSync(override) && statSync(override).isFile() ? [override] : [])];
  };
  const read = implicit ? discovered() : named;
  const source = readFileSync(resolve(implicit ? folder : dirname(configuration.configPath), read[0] ?? ''), 'utf8');
  const document = parseYamlDocument(/^\s*(version:.*)$/m.exec(source)?.[1] ?? source);
  const version = isMap(document.contents) ? document.contents.get('version', true) : undefined;
  const composePath = join(directory, 'compose.json');
  writeFileSync(composePath, JSON.stringify({
    ...(isScalar(version) ? { version: version.source ?? String(version.value) } : {}),
    services: {
      [service]: {
        labels: options.labels,
        ...(options.cpus === undefined ? {} : { cpus: options.cpus }),
        ...(options.memory === undefined ? {} : { mem_limit: options.memory }),
        ...(options.images.length === 0 ? {} : {
          volumes: options.images.map((part) => ({
            type: 'image',
            source: part.tag,
            target: partTarget(part.id),
            read_only: true,
            image: { subpath: partTarget(part.id).slice(1) },
          })),
        }),
      },
    },
  }), { mode: 0o600 });
  return implicit
    ? { COMPOSE_FILE: [...read, composePath].join(delimiter) }
    : { dockerComposeFile: [...(files as string[]), composePath] };
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
 * Whether a path is in a git directory: the directory itself, or something in it.
 *
 * Read from the path alone, because nothing else in a record says where a
 * session's git directory was: a mount of one names `<root>/.git` or a linked
 * worktree's `<repo>/.git/worktrees/<name>`, and a mount of something in it has
 * a path after that. A named volume, a state directory, a part's own mount and
 * a session's folder all answer no.
 */
const inGitDirectory = (source: string): boolean => /(^|\/)\.git(\/|$)/.test(spelledOnHost(sourceOnHost(source)));

/**
 * The labels every machine this host makes carries one of.
 *
 * A container ahpd did not make has labels of its own - a dev container is
 * labelled by the CLI, which writes the provider's label and the folder's and
 * nothing else - and its mounts are whatever its definition asks for, a
 * read-only bind of a path in a git directory among them. So these labels are
 * what say a machine is this host's to judge at all, and a container without
 * one of them is left where it is, whatever it mounts.
 */
const MADE_LABELS = [
  MACHINE_AGENTS,
  MACHINE_DISPOSABLE,
  MACHINE_PROFILE,
  MACHINE_OWNER,
  MACHINE_SESSION,
  MACHINE_HOST,
] as const;

/**
 * Whether a machine was made under the old `bind` guard, from its own record.
 *
 * A machine this plan made carries `ahpd.git`, and one that does not was made
 * before the label existed. `bind`, gone from `gitGuard`, was both of the
 * guards before this: the machine mounted the host's git directory, or the tree
 * holding it, with every path git reads pinned read-only over it - `hooks/`,
 * `config`, `worktrees/`, `modules/`, the session's worktree entry, and under
 * the allowlist the directory itself, so that it stayed a mount point the
 * writable paths inside it could be bound over - and a main checkout's root
 * writable with the files git must not see written pinned. `open` is the other
 * guard, and it mounts the host's git directory writable and *nothing* of it
 * read-only: a machine with no label and no read-only mount in a git directory
 * is one whose guard was `open`, and this plan keeps it as it is - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`, whose
 * predecessor lists both guards' mounts.
 *
 * A machine this plan makes is excluded by its label rather than by its mounts,
 * and has to be: under `fetch` the host's `<gitDir>/objects` is mounted
 * read-only, which is the same mount by a guard that is nothing of the sort.
 *
 * The labels come first, because a mount says nothing about who made a
 * container: a dev container whose definition binds a path in a git directory
 * read-only carries the same mount, and it is a person's own container.
 */
export const madeUnderBind = (found: Record<string, unknown>): boolean => {
  const labels = labelsOf(found);
  if (!MADE_LABELS.some((one) => labels[one] !== undefined)) return false;
  if (labels[MACHINE_GIT] !== undefined) return false;
  return mountsOf(found).some((mount) => {
    if (typeof mount !== 'object' || mount === null) return false;
    const held = mount as Record<string, unknown>;
    return held.RW === false && typeof held.Source === 'string' && inGitDirectory(held.Source);
  });
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

/**
 * How a nested host is started inside a machine, when no profile says otherwise.
 *
 * The daemon's own program, in stdio mode, is what serves a session that runs
 * in a machine.
 */
const DEFAULT_HOST: string[] = ['ahpd'];

export function dockerRuntime(options: DockerOptions): ComputerRuntime {
  /**
   * Run the program and answer what it printed, or throw; `env` gives each `-e
   * NAME` its value and `input` is piped to it.
   *
   * Success is the exit code alone, so a warning on stderr - an image mount's
   * "experimental feature" line among them - is not a failure.
   */
  const must = async (args: string[], env?: Record<string, string>, input?: Buffer): Promise<string> => {
    const held = await ran(options, args, input, env);
    if (held.code !== 0) {
      const said = held.stderr.trim() || held.stdout.trim() || 'no output';
      throw new Error(`${options.command} ${readable(args)} exited ${held.code}: ${said}`);
    }
    return held.stdout;
  };

  /**
   * Whether this Docker takes an image mount, once it has said so about the
   * mount type.
   *
   * Asked with the part being mounted, after its image is built, so the probe
   * never names an image that may not exist. A yes, and a refusal of the mount
   * type, are kept for this runtime's life; any other failure - the image
   * missing, the daemon unreachable - is not an answer about image mounts, and
   * the next machine asks again.
   */
  let imagesMount: boolean | undefined = options.imageMounts === false ? false : undefined;
  const canMountImages = async (tag: string): Promise<boolean> => {
    if (imagesMount !== undefined) return imagesMount;
    const probe = `ahpd-part-probe-${randomUUID().slice(0, 8)}`;
    const held = await ran(options, ['create', '--name', probe, '--mount', `type=image,source=${tag},target=/probe`, tag, 'x']);
    if (held.code === 0) {
      await ran(options, ['rm', '-f', probe]);
      imagesMount = true;
      return true;
    }
    if (refusesImageMounts(held.stderr)) imagesMount = false;
    return false;
  };

  /**
   * How a dev container gets its parts, and the one place that is chosen.
   *
   * The image route is a `--mount type=image` in the override config's
   * `runArgs`, which the Dev Container CLI 0.89.0 passes to its `docker run`
   * as written; it is taken where Docker takes image mounts, and the volume
   * route everywhere else.
   */
  const devcontainerPartRoute = async (tag: string): Promise<PartRoute> =>
    (await canMountImages(tag) ? 'image' : 'volume');

  /**
   * One part's volume, filled from its image the first time it is asked for.
   *
   * `docker create` with an empty named volume at the part's path fills the
   * volume from the image, and nothing is started. The marker is written last,
   * through the same container, so a fill that stopped half way leaves a volume
   * without it, and such a volume is removed and filled again. One fill per
   * volume at a time, shared as a build is.
   */
  const ensurePartVolume = (part: MadePart): Promise<string> => {
    const volume = volumeOf(part);
    const at = partTarget(part.id);
    const helper = (): string => `ahpd-part-fill-${randomUUID().slice(0, 8)}`;
    return once(`volume:${volume}`, async () => {
      if ((await ran(options, ['volume', 'inspect', volume])).code === 0) {
        const looking = helper();
        let filled = false;
        try {
          await must(['create', '--name', looking, '-v', `${volume}:${at}`, part.tag, 'x']);
          filled = (await ran(options, ['cp', `${looking}:${at}/${FILLED_MARKER}`, '-'])).code === 0;
        }
        finally {
          await ran(options, ['rm', '-f', looking]);
        }
        if (filled) return volume;
        await must(['volume', 'rm', volume]);
      }
      const filling = helper();
      try {
        await must(['create', '--name', filling, '-v', `${volume}:${at}`, part.tag, 'x']);
        await must(['cp', '-', `${filling}:${at}`], undefined,
          archiveOf([{ name: FILLED_MARKER, bytes: Buffer.from(`${part.tag}\n`, 'utf8') }]));
      }
      finally {
        await ran(options, ['rm', '-f', filling]);
      }
      return volume;
    });
  };

  /**
   * How a machine's parts reach it, and the parts that can.
   *
   * On the volume route each volume is filled first, and a part whose volume
   * cannot be filled is left out with a line naming it, as a part whose build
   * failed is: the machine is made with the rest and labelled with them.
   */
  const mountable = async (
    name: string,
    parts: readonly MadePart[],
    routeOf: (tag: string) => Promise<PartRoute>,
  ): Promise<{ route?: PartRoute; parts: MadePart[] }> => {
    const first = parts[0];
    if (first === undefined) return { parts: [] };
    const route = await routeOf(first.tag);
    if (route === 'image') return { route, parts: [...parts] };
    const filled: MadePart[] = [];
    for (const part of parts) {
      try {
        await ensurePartVolume(part);
        filled.push(part);
      }
      catch (error) {
        options.log?.(`${name} is made without the part ${part.id}: its volume ${volumeOf(part)} could not be filled: ${(error instanceof Error ? error.message : String(error)).replace(/\s*\n\s*/g, ' ')}`);
      }
    }
    // A part whose requirement was left out cannot run, so it goes too.
    let kept = filled;
    for (;;) {
      const next = kept.filter((part) => (part.requires ?? []).every((need) => kept.some((one) => one.id === need)));
      for (const part of kept.filter((one) => !next.includes(one))) {
        options.log?.(`${name} is made without the part ${part.id}: it requires ${(part.requires ?? []).join(', ')}, which the machine is made without`);
      }
      if (next.length === kept.length) break;
      kept = next;
    }
    return { route, parts: kept };
  };

  /**
   * The `PATH` an image gives its containers, or Docker's own where it sets none.
   *
   * Pulled first when it is not here yet, since `docker run` would pull it
   * anyway and its environment is only known once it is.
   */
  const imagePath = async (image: string): Promise<string> => {
    const asked = (): Promise<Ran> => ran(options, ['image', 'inspect', '--format', '{{json .Config.Env}}', image]);
    let held = await asked();
    if (held.code !== 0) {
      await ran(options, ['pull', image]);
      held = await asked();
    }
    if (held.code !== 0) return IMAGE_PATH;
    let env: unknown;
    try { env = JSON.parse(held.stdout.trim()); } catch { return IMAGE_PATH; }
    const path = Array.isArray(env) ? env.find((one) => typeof one === 'string' && one.startsWith('PATH=')) as string | undefined : undefined;
    return path === undefined ? IMAGE_PATH : path.slice('PATH='.length);
  };

  /** The user an image's containers run as, or root's empty one where it cannot be read. */
  const imageUser = async (image: string): Promise<string> => {
    const asked = (): Promise<Ran> => ran(options, ['image', 'inspect', '--format', '{{json .Config.User}}', image]);
    let held = await asked();
    if (held.code !== 0) {
      await ran(options, ['pull', image]);
      held = await asked();
    }
    if (held.code !== 0) return '';
    try {
      const user: unknown = JSON.parse(held.stdout.trim());
      return typeof user === 'string' ? user : '';
    }
    catch { return ''; }
  };

  /**
   * A container user as numeric ids, read once per image and user from the
   * image itself, or nothing where they cannot be read.
   */
  const idsHeld = new Map<string, Promise<{ uid: number; gid: number } | undefined>>();
  const idsOf = (image: string, user: string): Promise<{ uid: number; gid: number } | undefined> => {
    const key = `${image}\n${user}`;
    const known = idsHeld.get(key);
    if (known !== undefined) return known;
    const reading = (async () => {
      const id = async (flag: string): Promise<string> =>
        (await must(['run', '--rm', '--user', user, image, 'id', flag])).trim();
      try {
        const [uid, gid] = [await id('-u'), await id('-g')];
        return /^\d+$/.test(uid) && /^\d+$/.test(gid) ? { uid: Number(uid), gid: Number(gid) } : undefined;
      }
      catch { return undefined; }
    })();
    idsHeld.set(key, reading);
    return reading;
  };

  /**
   * The ids a machine made from `image` runs as for `user`: root's for a root
   * user, else read from the image, else root's with a line saying so.
   */
  const ownerIds = async (machine: string, image: string, user: string): Promise<{ uid: number; gid: number }> => {
    if (isRoot(user)) return { uid: 0, gid: 0 };
    const ids = await idsOf(image, user);
    if (ids !== undefined) return ids;
    options.log?.(`${machine} leaves its state volumes owned by root: the ids of ${user} could not be read from ${image}`);
    return { uid: 0, gid: 0 };
  };

  /**
   * Seed one state volume where its stamp says a seed changed.
   *
   * The stamp is read and the seeds written through a helper created from
   * `image` with the volume mounted and never started, so an image without a
   * shell seeds the same way. Only a seed whose mark differs from the stamp's is
   * written, over the file at its target, and everything else in the volume -
   * what the agent wrote - is left alone. A seed whose host source is absent is
   * skipped with a line and stamped absent, so it is seeded once it appears; one
   * that cannot be read is skipped with a line and left unstamped, and a link
   * inside a seeded directory is left out with a line. What is written is owned
   * by `ids` - the volume's root, each directory and each file - through the
   * archive's own entries and `docker cp -a`. One seed per volume at a time.
   *
   * `into` is where the volume is reached: a helper created from `image` and
   * never started, with the volume at `SEED_AT`, or a running `container`,
   * with the volume at the state directory itself.
   */
  const seedState = (
    machine: string,
    state: MadeState,
    into: { image: string } | { container: string },
    ids: { uid: number; gid: number },
  ): Promise<void> =>
    once(`state:${state.volume}`, async () => {
      const helper = 'image' in into ? `ahpd-state-seed-${randomUUID().slice(0, 8)}` : undefined;
      const container = 'container' in into ? into.container : helper ?? '';
      const at = helper === undefined ? state.target : SEED_AT;
      const dir = posix.basename(at);
      if (dir === '') throw new Error(`${machine} cannot seed ${state.volume} at ${at}, which has no directory above it`);
      try {
        if ('image' in into) await must(['create', '--name', container, '-v', `${state.volume}:${SEED_AT}`, into.image, 'x']);
        const out = await ran(options, ['cp', `${container}:${at}/${SEED_STAMP}`, '-']);
        let stamp: Record<string, unknown> | undefined;
        try {
          const text = out.code === 0 ? firstFileOf(Buffer.from(out.stdout, 'utf8')) : undefined;
          const parsed: unknown = text === undefined ? undefined : JSON.parse(text.toString('utf8'));
          stamp = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
        }
        catch { stamp = undefined; }
        const next: Record<string, unknown> = { ...(stamp ?? {}) };
        const entries: Tarball[] = [];
        for (const seed of state.seed ?? []) {
          const mark = seedMark(seed);
          if (stamp?.[seed.target] === mark) continue;
          const stat = statSync(seed.source, { throwIfNoEntry: false });
          if (stat === undefined) {
            options.log?.(`${machine} seeds ${state.volume} without ${seed.source}, which is not on this host`);
            next[seed.target] = mark;
            continue;
          }
          try {
            const found = seedEntries(seed);
            entries.push(...found.entries);
            for (const link of found.links) options.log?.(`${machine} seeds ${state.volume} without ${link}, a link it does not follow`);
            next[seed.target] = mark;
          }
          catch (error) {
            options.log?.(`${machine} seeds ${state.volume} without ${seed.source}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (stamp !== undefined && entries.length === 0 && JSON.stringify(next) === JSON.stringify(stamp)) return;
        entries.push({ name: SEED_STAMP, bytes: Buffer.from(`${JSON.stringify(next)}\n`, 'utf8') });
        await must(['cp', '-a', '-', `${container}:${posix.dirname(at)}`], undefined, archiveOf(ownedArchive(entries, ids, dir)));
      }
      finally {
        if (helper !== undefined) await ran(options, ['rm', '-f', helper]);
      }
    });

  /**
   * The ids a machine's commands run as, read from its label where it names
   * them and inside the machine where they are a name, or nothing.
   */
  const idsOfMachine = async (spec: MachineSpec, container: string): Promise<{ uid: number; gid: number } | undefined> => {
    const named = idsOfUser(spec.user);
    if (named !== undefined) return named;
    const read = async (flag: string): Promise<string> =>
      (await must(['exec', ...(spec.user === undefined ? [] : ['-u', spec.user]), container, 'id', flag])).trim();
    try {
      const [uid, gid] = [await read('-u'), await read('-g')];
      return /^\d+$/.test(uid) && /^\d+$/.test(gid) ? { uid: Number(uid), gid: Number(gid) } : undefined;
    }
    catch { return undefined; }
  };

  /**
   * Seed a machine's own git directory, in the machine, from the tree it was given.
   *
   * The machine's git directory is a volume, which Docker made owned by root,
   * and every command in there runs as the machine's user: nothing could be
   * written in it until the volume's own directory is that user's, which is one
   * `chown` as root and nothing else. Everything after it is the machine's own
   * git, as that user, so every file it writes stays the host user's - decision
   * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
   *
   * What it writes is the tree's repository and nothing more: the host's
   * objects reachable through `objects/info/alternates`, the branch the tree is
   * on at the commit it is at, the index that commit names, the two config
   * values a commit needs, and the two that say how the host's git reads the
   * tree's files. The commit itself is never read into the working
   * tree - a `reset --hard` would rewrite the host's own files, mounted at the
   * same path - so a host change nobody committed shows up in the machine as
   * the uncommitted change it is.
   *
   * A machine whose repository could not be made is not a machine: it is removed
   * before git's own words are thrown, so nothing is left up with nothing to
   * commit into.
   */
  const seedGit = async (machine: string, spec: MachineSpec, git: GitMounts, container: string): Promise<void> => {
    /*
     * Under `copy` the volume holds the tree as well: it is mounted at the
     * tree's own path, so `git.volume` is the tree the seed reads the host's
     * branch and identity from, and the machine's git directory is `.git`
     * inside it. Under `shared` the volume is the git directory itself, mounted
     * over the host tree's own `.git`, and the tree is the host's.
     *
     * `root` is the tree inside the machine, and `seedOf` reads it on the host,
     * by the host path it names: on Windows the two are spelled differently.
     */
    const root = git.copy === true ? git.volume : machinePathOf(spec.repository ?? spec.folder ?? spec.devcontainer ?? '');
    const at = git.copy === true ? (git.volume === undefined ? undefined : posix.join(git.volume, '.git')) : git.volume;
    const objects = git.objects;
    if (root === undefined || root === '' || at === undefined || git.volume === undefined) return;
    // A machine on another box has no host objects to read, and is seeded from a bundle.
    if (objects === undefined && options.remote !== true) return;
    const seed = seedOf(hostPathOf(root));
    const asUser = (args: string[]): Promise<string> =>
      must(['exec', ...(spec.user === undefined ? [] : ['--user', spec.user]), container, ...args]);
    const own = [`--git-dir=${at}`, `--work-tree=${root}`];
    try {
      const ids = await idsOfMachine(spec, container);
      if (ids === undefined) options.log?.(`${machine} leaves its git directory root's: the ids of its user could not be read inside it`);
      else if (ids.uid !== 0 || ids.gid !== 0) {
        // The volume's own mount point, which is the git directory under
        // `shared` and the tree it sits in under `copy`: either way it is what
        // Docker made root's and what the machine's git has to write in.
        await must(['exec', '--user', '0', container, 'chown', `${String(ids.uid)}:${String(ids.gid)}`, git.volume]);
      }
      /*
       * A git directory at `at` itself, and not the `<at>/.git` a plain `init`
       * would make: the volume is mounted where git looks for the directory, so
       * the layout has to be the directory's own. `--bare` writes it, and
       * `core.bare` is then turned off, which is what tells the machine's git
       * that this directory belongs to a working tree - the one the gitfile
       * names it from, or the folder the volume is mounted over.
       */
      await asUser(['git', 'init', '--bare', '-q', at]);
      await asUser(['git', `--git-dir=${at}`, 'config', 'core.bare', 'false']);
      /*
       * Where the history is: the host's objects, read-only at the mount they
       * were given, named as the machine's alternate. Written through `cp -a`
       * rather than a shell, so an image whose git comes without one seeds the
       * same way, and owned as the machine's own user, who is what its git runs
       * as. `info/` is carried by the archive as well, since a git that does not
       * make it on `init` would otherwise have nowhere to put the file.
       */
      const owner = ids ?? { uid: 0, gid: 0 };
      if (objects !== undefined) {
        await must(
          ['cp', '-a', '-', `${container}:${posix.join(at, 'objects')}`],
          undefined,
          archiveOf([
            { name: 'info/', bytes: Buffer.alloc(0), directory: true, ...owner },
            { name: 'info/alternates', bytes: Buffer.from(`${objects}\n`, 'utf8'), ...owner },
          ]),
        );
      }
      /*
       * On another box's Docker, the history is a bundle of the tree's `HEAD`
       * instead, or the session's branch fetched from `origin` where the
       * profile says `clone`, fetched into the seed ref either way: the commit
       * the checkout below is made at is read back from that ref.
       */
      const reached: FarSeed = {
        name: spec.name,
        must: asUser,
        ran: (command) => ran(options, ['exec', ...(spec.user === undefined ? [] : ['--user', spec.user]), container, ...command]),
        put: async (file, path) => { await must(['cp', file, `${container}:${path}`]); },
        drop: async (path) => { await ran(options, ['exec', '--user', '0', container, 'rm', '-f', path]); },
      };
      const far = (): Promise<string | undefined> => (codeRouteOf(spec) === 'clone'
        ? fetchedInto(reached, root, at, seed.branch)
        : bundledInto(reached, root, at));
      const commit = objects === undefined ? await far() : seed.commit;
      await checkedOut(asUser, own, seed, commit, git.copy === true);
    }
    catch (error) {
      await ran(options, ['rm', '-f', container]);
      throw error;
    }
  };

  /**
   * The containers a connect adopted, as the record beside the configuration
   * says them.
   *
   * Read on every call rather than held, because the record is written by a
   * relay that runs after this runtime was made and a listing has to show it.
   */
  /**
   * The labels a listing filters on beside the plugin's own: a profile's own
   * Docker lists that profile's machines, and a remote one this daemon's only.
   */
  const ownFilters = [
    ...(options.profile === undefined ? [] : ['--filter', `label=${MACHINE_PROFILE}=${options.profile}`]),
    ...(options.remote === true && options.hostId !== undefined ? ['--filter', `label=${MACHINE_HOST}=${options.hostId}`] : []),
  ];

  const adoptedIds = (): string[] =>
    options.configDir === undefined || options.remote === true
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
   *
   * The id itself is taken only for a container that is this host's - which is
   * what the label is read for. `docker inspect <name>` answers for any
   * container, image or volume with that name, and a lookup that took whatever
   * answered would hand `stop`, `restart` and `rm -f` to something that is not
   * a computer here. So the record is read, and a container that is not this
   * host's is looked for again by the label its create wrote - which is the
   * only name a dev container has that this host chose.
   *
   * A name that answers to something this host did not make is `undefined`:
   * `inspect` reads that as a machine that is not there, which is what it
   * already answers for a container Docker does not have, so nothing here
   * tells a caller whether some other container holds the name.
   */
  const containerOf = async (id: string): Promise<string | undefined> => {
    const found = await recordOf(id);
    /*
     * The id itself, for a container that is this host's: one carrying this
     * host's own label, or one the record beside the configuration says a
     * connect adopted.
     */
    if (Object.keys(found).length > 0 && (ours(found, options.label) || adoptedIds().includes(id))) return id;
    /*
     * Otherwise the name a create gave it, which is the one label both routes
     * share: a machine made under a name of its own is found above, and a dev
     * container - which the CLI names for its folder, and which carries no
     * label of this host's - is found here.
     */
    const held = await rows(await must([
      'ps', '-a',
      '--filter', `label=${options.label}`,
      '--filter', `label=${MACHINE_NAME}=${id}`,
      '--format', '{{json .}}',
    ]));
    const name = text(held[0]?.Names);
    if (name !== '') return name;
    /*
     * Nothing of this host's answers, and something else does - another
     * container, an image, a volume: not a computer here, and no name for
     * Docker to be handed either.
     */
    if (Object.keys(found).length > 0) return undefined;
    // Nothing by that name at all: the verb's own refusal is Docker's to say.
    return id;
  };

  /**
   * The same name for the verbs that run something at it.
   *
   * `inspect` answers a name this host did not make as a machine that is not
   * there; a verb that would `stop`, `exec` or `rm -f` something cannot answer
   * anything, so it refuses and says why rather than handing Docker a name that
   * would run against whatever holds it.
   */
  const containerOrFail = async (id: string): Promise<string> => {
    const at = await containerOf(id);
    if (at === undefined) throw new Error(`${id} names a container this host did not make, and no computer is named that`);
    return at;
  };

  /**
   * What `docker inspect` says about the machine a caller's id names, or
   * nothing when there is no such computer here.
   *
   * The one reading of a record behind `inspect`, `how` and `hostCommand`, so
   * the three answer about the same machine: a name that is not this host's is
   * not there, whichever of them is asked.
   */
  const look = async (id: string): Promise<Record<string, unknown> | undefined> => {
    const at = await containerOf(id);
    if (at === undefined) return undefined;
    const held = await ran(options, ['inspect', '--format', '{{json .}}', at]);
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
  };

  /**
   * The `docker` program's own environment, with the values `-e NAME` reads
   * laid over it.
   *
   * The environment a machine is given travels by name, so each value has to be
   * in the environment `docker` is spawned with or the flag reads nothing.
   */
  const spawnEnvOf = (over: Record<string, string>): Record<string, string> | undefined =>
    (options.env === undefined && Object.keys(over).length === 0 ? undefined : { ...(options.env ?? {}), ...over });

  /** The `Config` of a record, which is where its working directory and labels are. */
  const configIn = (found: Record<string, unknown>): Record<string, unknown> =>
    (typeof found.Config === 'object' && found.Config !== null ? found.Config : {}) as Record<string, unknown>;

  /** Where inside a machine a caller's working directory is, or the machine's own. */
  const startIn = (found: Record<string, unknown>, asked?: string): string | undefined => {
    const workdir = configIn(found).WorkingDir;
    const own = typeof workdir === 'string' && workdir !== '' ? workdir : undefined;
    // A caller that names a path names one on *this host*, so it is read
    // through the machine's mounts: covered by one, it is the same place under
    // another name; covered by none, there is no such directory in there and
    // the machine's own stands.
    // A machine on another box mounts no path of this host's, so a path here
    // names nothing in it.
    return (asked === undefined || options.remote === true ? undefined : within(found, asked)) ?? own;
  };

  /** The command that starts a nested host inside a machine, as its recipe says. */
  const hostFor = (found: Record<string, unknown>): string[] => {
    const key = profileOf(found);
    return (key === undefined ? undefined : options.hosts?.[key]) ?? options.host ?? DEFAULT_HOST;
  };

  /**
   * What one command in a machine is, whichever of the two roads reaches it.
   *
   * A dev container is reached by the same `docker exec` as any other machine,
   * with the user and environment its own definition asks for, and every other
   * machine with the user its label names: the two roads `exec` takes, in one
   * place, because `bringBack` runs a command in a machine the way every other
   * caller does - and needs the argv, since what it pipes out is bytes rather
   * than words.
   */
  const argvInto = async (
    id: string,
    at: string,
    found: Record<string, unknown>,
    command: string[],
    env: Record<string, string>,
  ): Promise<{ argv: string[]; env: Record<string, string> }> => {
    if (devcontainerFolder(found) !== undefined) {
      // Under the machine id a caller holds, which is what the create and the
      // relay keep their probe against, not the name Docker answers for it.
      const reached = await reachedDevContainer(options, id, found);
      // Against the container id, as `how` and the relay reach it.
      const container = text(found.Id) === '' ? at : text(found.Id);
      return execArgv({ ...reached, id: container }, command, env);
    }
    const user = userLabelOf(labelsOf(found));
    const given = byName(env);
    return {
      argv: ['exec', '-i', ...(user === undefined ? [] : ['--user', user]), ...given.flags, at, ...command],
      env: given.env,
    };
  };

  /**
   * Run one and let what it writes to stdout land in a file, byte for byte.
   *
   * `ran` collects text, which is what a sentence needs and what would corrupt
   * anything else: a bundle on a pipe is a pack, holding bytes that are not
   * UTF-8 at all, and a string in between is a bundle whose own checksum no
   * longer holds. So the child's stdout goes straight into a file and only its
   * stderr is read as text. The write is waited for as well as the process: a
   * file read while its last block is still on the way is a file read
   * half-written.
   */
  const poured = async (
    into: { argv: string[]; env: Record<string, string> },
    path: string,
  ): Promise<{ code: number; stderr: string }> => {
    const child = spawn(options.command, [...(options.args ?? []), ...into.argv], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env ?? {}), ...into.env },
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      windowsHide: true,
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    const out = createWriteStream(path, { mode: 0o600 });
    // A child that never started has no stdout to pipe, and the file still has
    // to be closed: the rejection below is the answer, not this.
    if (child.stdout === null) out.end();
    else child.stdout.pipe(out);
    const ended = new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => { resolve(code ?? 0); });
    });
    const written = new Promise<void>((resolve, reject) => {
      out.on('error', reject);
      out.on('close', () => { resolve(); });
    });
    const [code] = await Promise.all([ended, written]);
    return { code, stderr };
  };

  /** One machine's git, reached by `docker exec` in the tree it was given. */
  const gitOf = (id: string, at: string, found: Record<string, unknown>, tree: string): MachineGit => ({
    id,
    tree,
    copy: copyOf(mountsOf(found)),
    remote: options.remote === true,
    git: async (args) => {
      const into = await argvInto(id, at, found, ['git', '-C', tree, ...args], {});
      return await ran(options, into.argv, undefined, into.env);
    },
    pour: async (args, path) => poured(await argvInto(id, at, found, ['git', '-C', tree, ...args], {}), path),
    ...(options.log === undefined ? {} : { log: options.log }),
  });

  /*
   * What a machine committed, brought back by fetch: `bringBack` in
   * `machinegit.ts`, through `docker exec`.
   */
  const bringBackOfMachine = async (id: string): Promise<BroughtBack | undefined> => {
    const at = await containerOf(id);
    if (at === undefined) return undefined;
    const found = await recordOf(at);
    if (Object.keys(found).length === 0) return undefined;
    // A machine with no git directory of its own has nothing to bring back,
    // and one whose guard left the host's own mounted wrote in the host's
    // repository already, where every commit of it is.
    if (labelsOf(found)[MACHINE_GIT] !== 'fetch') return { moved: false };
    const tree = treeOf(mountsOf(found));
    if (tree === undefined) return { moved: false };
    return await bringBack(gitOf(id, at, found, tree));
  };

  /*
   * The host's branch, handed to a machine - decision
   * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
   *
   * A machine that commits in a git directory of its own reads history the host
   * already has, through the alternates, and writes commits the host does not -
   * so between two turns the two drift. A person commits in the tree the two
   * share, a changeset operation makes one, and the machine's git still answers
   * from where the machine left off. This is the machine being told where the
   * host is: the branch checked out in the tree, the commit it is at, and an
   * index that names it.
   *
   * Only where the machine holds nothing the host has not fetched. What it is
   * at has to be a commit the host's repository has - one it has not is work
   * that exists nowhere else, and the machine is the only place it is - and the
   * host's branch has to lead on from it, and from the branch of that name it
   * is about to re-point. Anywhere else the machine is left exactly as it is,
   * and the log says why: moving it would be dropping a commit on the floor,
   * and the way out is a fetch (`bringBack`) and then this again.
   *
   * Nothing of the host's is written and no object is copied: a commit the host
   * made is an object the machine's git can already read through the alternates,
   * so the only writes are the machine's own ref and index. `reset` is not
   * `--hard`: the folder is the host's own working tree, holding what the agent
   * left there, and this only says which commit that is.
   */
  const followOfMachine = async (id: string): Promise<void> => {
    const at = await containerOf(id);
    if (at === undefined) return;
    const found = await recordOf(at);
    if (Object.keys(found).length === 0) return;
    // A machine with no git directory of its own already answers from the
    // host's - its git *is* the host's - and one whose guard left the host's
    // mounted wrote in the host's repository in the first place.
    if (labelsOf(found)[MACHINE_GIT] !== 'fetch') return;
    const tree = treeOf(mountsOf(found));
    if (tree === undefined) return;
    // A machine that works in a copy of the tree is a checkout of its own, so
    // the host's commit has to be merged into it rather than pointed at.
    if (copyOf(mountsOf(found))) return await followOfCopy(gitOf(id, at, found, tree));
    /*
     * Where the host is, read in the tree: the branch a person's own checkout
     * put it on - none at all where it is detached - and the commit it is at.
     * A tree with no commit has nothing to hand over and nothing to be at.
     */
    const branch = hostGit(tree, ['symbolic-ref', '-q', '--short', 'HEAD']).stdout.trim();
    const tip = hostGit(tree, ['rev-parse', '--verify', '--quiet', 'HEAD']).stdout.trim();
    if (tip === '') return;
    /** One git command in the machine, in the folder it was given. */
    const inMachine = async (...args: string[]): Promise<Ran> => {
      const into = await argvInto(id, at, found, ['git', '-C', tree, ...args], {});
      return await ran(options, into.argv, undefined, into.env);
    };
    // Where the machine is: the same two answers, asked of it.
    const held = await inMachine('symbolic-ref', '-q', '--short', 'HEAD');
    const onBranch = held.code === 0 ? held.stdout.trim() : '';
    const where = await inMachine('rev-parse', '--verify', '--quiet', 'HEAD');
    const mine = where.code === 0 ? where.stdout.trim() : '';
    // A machine with no commit of its own - a seed that did not happen - has
    // nothing a hand-over could be leaving behind.
    if (mine === '') return;
    // Already there, both halves of it: the branch the host is on and the
    // commit it is at. Nothing is written, so nothing of the machine's - the
    // index an agent is working in above all - is touched for nothing.
    if (mine === tip && onBranch === branch) return;
    if (mine !== tip) {
      /*
       * A commit the host's repository does not have is the machine's own work
       * and the only copy of it, so the machine stays on it. Nothing is fetched
       * here: the fetch is `bringBack`, and where it leaves work waiting the
       * host has it and the branch still does not lead on from it, which is the
       * check below.
       */
      if (hostGit(tree, ['cat-file', '-e', `${mine}^{commit}`]).code !== 0) {
        options.log?.(`the machine ${id} is not moved: it is at ${mine}, which the host has not fetched`);
        return;
      }
      // What the host's branch does not lead on from - a person's own rebase,
      // reset or commit of their own - is a history the machine's commit is not
      // in, and moving the machine to the branch would be dropping it.
      if (hostGit(tree, ['merge-base', '--is-ancestor', mine, tip]).code !== 0) {
        options.log?.(`the machine ${id} is not moved: ${branch === '' ? 'the host is detached' : branch} does not lead on from ${mine}`);
        return;
      }
    }
    /*
     * The branch, made in the machine where it does not have it: a person who
     * checked another branch out in the tree asked for the machine to be in the
     * same place, and a branch of the machine's own that the host is not on is
     * left where it is rather than moved or removed.
     *
     * A branch of the machine's that already carries that name is re-pointed
     * only where the host's commit leads on from it: a branch holding a commit
     * the host's branch is not on top of - work the fetch has not brought back
     * yet - is the only copy of it, and this would drop it. The same check the
     * machine's own `HEAD` gets above, on the branch that is not the one it is
     * standing on.
     */
    if (branch !== '' && !(await movesOver(inMachine, branch, tip))) {
      options.log?.(`the machine ${id} is not moved: its branch ${branch} holds work the host's does not lead on from`);
      return;
    }
    if (branch === '') await inMachine('update-ref', '--no-deref', 'HEAD', tip);
    else {
      await inMachine('update-ref', `refs/heads/${branch}`, tip);
      await inMachine('symbolic-ref', 'HEAD', `refs/heads/${branch}`);
    }
    // The index, so the folder reads as the commit it is at rather than as
    // changes nobody made.
    await inMachine('reset', '-q');
  };

  return {
    kind: 'docker',

    // A Docker machine is a container on the Docker this runtime was given:
    // this host's own, or another box's when the options say so.
    remote: options.remote === true,

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
        'ps', '-a', '--filter', `label=${options.label}`, ...ownFilters, '--format', LISTED_FORMAT,
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

    // The name a create gave, when that is what the caller holds: a listing
    // answers it, so every caller reading a listing back must be able to hand
    // that answer to anything that inspects.
    inspect: look,

    /*
     * The three facts a caller reads about a machine without wanting its whole
     * record: what it is doing, which agents it was prepared for, and whose it
     * is.
     *
     * Each is read from the same record `inspect` answers, and each answers
     * `undefined` for a machine that is not here. They are here as their own
     * methods so that the readers of those three facts ask a runtime rather
     * than a shape: the same three are answered by a runtime whose machines
     * carry no Docker record, where they come from something else.
     */
    state: async (id) => {
      const found = await look(id);
      return found === undefined ? undefined : stateOf(found);
    },
    agents: async (id) => {
      const found = await look(id);
      return found === undefined ? undefined : preparedFor(found);
    },
    parts: async (id) => {
      const found = await look(id);
      return found === undefined ? undefined : partsHeld(found);
    },
    owner: async (id) => {
      const found = await look(id);
      return found === undefined ? undefined : claimedOf(found);
    },

    /*
     * How a command reaches one of these machines.
     *
     * A descriptor rather than a running process: the caller owns the spawn and
     * its stdio, and this only says what to spawn. The machine's own environment
     * travels as `-e NAME` flags and the descriptor's `env` is the `docker`
     * program's own with each value laid over it, so no value is in the argv a
     * process list shows.
     */
    how: async (id, asked) => {
      const found = await look(id);
      if (found === undefined) return undefined;
      const values = asked.env ?? {};
      const start = startIn(found, asked.cwd);
      /*
       * The container Docker knows this machine by, which is not always the name
       * the caller gave: a dev container carries the name its create gave as a
       * label and the CLI named it after the folder, so the `docker exec` is
       * handed the latter.
       */
      const at = text(found.Id) === '' ? id : text(found.Id);
      /*
       * A dev container is reached the way the CLI reaches it, which is the same
       * `docker exec` as any other machine with the user and environment its own
       * definition asks for - decision `a-dev-container-is-reached-by-docker-exec`.
       */
      if (devcontainerFolder(found) !== undefined) {
        // Under the machine id the caller gave, which is what a create and the
        // relay keep their probe against, not the container id `at` holds.
        const reached = await reachedDevContainer(options, id, found);
        const into = execArgv(
          { ...reached, id: at, ...(start === undefined ? {} : { workdir: start }) },
          [asked.command, ...(asked.args ?? [])],
          values,
        );
        const devEnv = spawnEnvOf(into.env);
        return {
          command: options.command,
          args: [...(options.args ?? []), ...into.argv],
          ...(devEnv === undefined ? {} : { env: devEnv }),
        };
      }
      const given = byName(values);
      const env = spawnEnvOf(given.env);
      // The user its label names, which a machine with a git directory carries.
      const user = userLabelOf(labelsOf(found));
      return {
        command: options.command,
        args: [
          ...(options.args ?? []),
          'exec', '-i',
          ...(user === undefined ? [] : ['--user', user]),
          ...(start === undefined ? [] : ['-w', start]),
          ...given.flags,
          at,
          asked.command,
          ...(asked.args ?? []),
        ],
        ...(env === undefined ? {} : { env }),
      };
    },

    /** The command this machine starts its nested host with, as its recipe says. */
    hostCommand: async (id) => {
      const found = await look(id);
      return found === undefined ? undefined : hostFor(found);
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
    run: async (asked) => {
      /*
       * A profile's own Docker labels each machine with its profile, and a
       * remote one with this daemon's id too, because those labels are what
       * its listing reads its machines back by.
       */
      const spec: MachineSpec = {
        ...asked,
        ...(options.profile === undefined ? {} : { profile: options.profile }),
        ...(options.remote === true && asked.host === undefined && options.hostId !== undefined ? { host: options.hostId } : {}),
      };
      if (options.remote === true && spec.devcontainer !== undefined) {
        throw new Error(`${spec.name} is not made from a devcontainer.json on another box's Docker: the Dev Container CLI reads the folder on this host`);
      }
      // No path on this host is on another box: the manifest turns the needs
      // into copies, and anything that still binds one is refused here.
      const bound = options.remote === true
        ? [...spec.mounts ?? [], ...(spec.partFallbacks ?? []).map((one) => one.mount)].find((one) => absoluteOnHost(mountParts(one).source))
        : undefined;
      if (bound !== undefined) {
        throw new Error(`${spec.name} is made on another box's Docker, and the mount ${bound} is a path on this host`);
      }
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
        // The CLI's two runs, `read-configuration` and `up`, each saying what
        // installs the CLI where it could not be started, `up` with the
        // `COMPOSE_FILE` a Compose override may give it.
        const run = (argv: string[], env?: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> =>
          runCli(env === undefined ? cli : { ...cli, env: { ...(cli.env ?? {}), ...env } }, argv).catch((error: unknown) => {
            throw new Error(`The Dev Container CLI (${cli.command}) could not be run, so ${spec.devcontainer ?? ''} was not made a computer: ${error instanceof Error ? error.message : String(error)}. Install @devcontainers/cli, or name it under the plugin's devcontainer.command`);
          });
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
          // Each state volume, writable, at its state directory.
          ...(spec.states ?? []).map((one) => `type=volume,source=${one.volume},target=${one.target}`),
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
         * definition that does not parse is refused and leaves nothing behind.
         */
        const { configuration, config } = await configOf(run, spec.devcontainer);
        /*
         * The tree the machine is given, and the guard its git directory is
         * made with. Under `copy` the machine's volume is the CLI's own
         * workspace mount, in place of the host's tree - `overrideOf` writes
         * that - so the volume is not among the mounts it adds.
         */
        const tree = spec.sessionTree ?? 'shared';
        const guard = guardFor(spec.gitGuard, tree);
        // The git mounts, every source made on the host first, so a refusal
        // leaves nothing made.
        const git = spec.gitDir === undefined
          ? undefined
          : guardedMounts(spec.gitDir, spec.repository ?? spec.devcontainer, stateDirOf(options), guard, tree);
        /*
         * Each state volume seeded before `up`, from the definition's own image
         * and owned by the machine's own user where it has one, else by its
         * `remoteUser`, else its `containerUser`, else the image's user. A
         * definition that builds its image has no image before `up`, so its
         * volumes are seeded once the container is up.
         */
        const base = typeof config.image === 'string' && config.image !== '' ? config.image : undefined;
        const asUser = [config.remoteUser, config.containerUser].find((one): one is string => typeof one === 'string' && one !== '');
        if (base !== undefined && (spec.states ?? []).length > 0) {
          const ids = idsOfUser(spec.user) ?? await ownerIds(spec.name, base, asUser ?? await imageUser(base));
          for (const one of spec.states ?? []) await seedState(spec.name, one, { image: base }, ids);
        }
        /*
         * The parts, by the route a dev container takes: an image mount needs
         * the part image here before `up`, which the plugin has built, and the
         * volume route needs each volume filled before the CLI mounts it.
         */
        const reached = await mountable(spec.name, spec.parts ?? [], devcontainerPartRoute);
        const withParts: MachineSpec = spec.parts === undefined ? spec : { ...spec, parts: reached.parts };
        const scratch = mkdtempSync(join(tmpdir(), 'ahpd-devcontainer-'));
        const override = join(scratch, 'override.json');
        let ran: { code: number; stdout: string; stderr: string };
        try {
          const held = overrideOf(withParts, config, reached.route, git);
          const compose = config.dockerComposeFile === undefined
            ? undefined
            : composeOverrideOf(
              runOptionsOf(withParts, guard, reached.route),
              configuration,
              config,
              spec.devcontainer,
              scratch,
              { ...process.env, ...(cli.env ?? {}) },
            );
          if (compose !== undefined && 'dockerComposeFile' in compose) held.dockerComposeFile = compose.dockerComposeFile;
          writeFileSync(override, JSON.stringify(held, undefined, 2), { mode: 0o600 });
          // The folder's own file stays the base for its relative paths and
          // its identity, as VS Code passes it beside its override
          // (devContainerSandbox.ts L101 and L151 at 6b68d3fe).
          argv.push('--config', configuration.configPath, '--override-config', override);
          ran = await run(argv, compose !== undefined && 'COMPOSE_FILE' in compose ? compose : undefined);
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
         * A definition that builds its image is seeded now, inside the running
         * container at each state directory, owned by its user's ids as read
         * there.
         */
        if (base === undefined && (spec.states ?? []).length > 0) {
          const as = asUser === undefined ? [] : ['-u', asUser];
          const id = async (flag: string): Promise<string> =>
            (await must(['exec', ...as, made.containerId, 'id', flag])).trim();
          const [uid, gid] = spec.user === undefined ? [await id('-u'), await id('-g')] : spec.user.split(':');
          if (uid === undefined || gid === undefined || !/^\d+$/.test(uid) || !/^\d+$/.test(gid)) {
            throw new Error(`${spec.name} could not read the ids of ${asUser ?? 'its user'} inside ${made.containerId}`);
          }
          const ids = { uid: Number(uid), gid: Number(gid) };
          for (const one of spec.states ?? []) await seedState(spec.name, one, { container: made.containerId }, ids);
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
         * it.
         */
        if (named !== undefined && named !== spec.name) {
          throw new Error(`${spec.devcontainer} is already the computer ${named}, and its name is set when the container is made; destroy ${named} or choose another folder`);
        }
        const id = named ?? await namedByFolder(made.containerId, spec.devcontainer);
        /*
         * The machine's own git directory, seeded in the container the CLI made
         * - reached by its id, which is what every command before the name is
         * read back goes through.
         */
        if (git !== undefined) await seedGit(spec.name, spec, git, made.containerId);
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
      /*
       * The tree the machine is given, and the guard its git directory is made
       * with. Under `copy` the machine's volume is mounted at the tree's own
       * path in place of it, so the folder is not bound at all - the volume
       * holds the working tree and the machine's git directory together.
       */
      /*
       * On another box's Docker neither the folder nor its git directory is a
       * path there, so the machine works in a copy: its volume holds the tree
       * and its own git directory, seeded from a bundle, and nothing of this
       * host's is bound. A folder that is not a repository has no bundle to
       * send, and is refused.
       */
      const remote = options.remote === true;
      if (remote && spec.folder !== undefined && spec.gitDir === undefined) {
        throw new Error(`${spec.name} is made on another box's Docker, and ${spec.repository ?? spec.folder} is not a repository it may be given, so its code cannot be sent there`);
      }
      const tree = remote ? 'copy' : spec.sessionTree ?? 'shared';
      const guard = remote ? 'fetch' : guardFor(spec.gitGuard, tree);
      // The git mounts, every source made on the host first, so a refusal
      // leaves nothing made.
      const git = spec.gitDir === undefined || spec.folder === undefined
        ? undefined
        : remote
          ? { binds: [], volume: machinePathOf(spec.repository ?? spec.folder), copy: true }
          : guardedMounts(spec.gitDir, spec.repository ?? spec.folder, stateDirOf(options), guard, tree);
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
       * The OCI runtime the container is started under, one argument so the
       * value cannot be read as a flag of its own and passed as given: a
       * Docker that has no such runtime refuses the machine itself.
       */
      if (spec.ociRuntime !== undefined) flags.push(`--runtime=${spec.ociRuntime}`);
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
        // The folder a session works in, at its machine path: the same path on
        // Linux and macOS, so an agent that keys its own record by the working
        // directory finds the same key inside and out - Claude's history is one
        // such record - and the drive-style one on Windows, where no Linux path
        // is the host's.
        // A folder below a repository's root brings the whole tree instead, so
        // the rest of it is not missing to git in there. Under `copy` the tree
        // is the machine's own and this is not bound at all: the volume below
        // lands at that path instead.
        ...(spec.folder === undefined || tree === 'copy'
          ? []
          : [`${spec.repository ?? spec.folder}:${machinePathOf(spec.repository ?? spec.folder)}`]),
        // Then the git mounts: the host's objects read-only, the file a linked
        // worktree's `.git` is replaced by, and the volume the machine commits
        // into.
        ...(git?.binds ?? []).map(volumeFlagOf),
        ...(git?.volume === undefined ? [] : [`${gitVolumeOf(spec.name)}:${git.volume}`]),
      ])];
      for (const mount of mounted) flags.push('-v', mount);
      /*
       * The host user, on a machine with a git directory: git accepts the
       * repository as its owner's, and every file it writes stays the host
       * user's. The label is what each later `docker exec` reads it back from.
       */
      if (spec.user !== undefined) flags.push('--user', spec.user, '--label', `${MACHINE_USER}=${spec.user}`);
      // And how the git directory is guarded, which a later daemon reads back
      // to tell a machine of its own from one made under the allowlist this
      // plan removes - task 07. Under `copy` it is `fetch`, which is what the
      // machine's own git directory in its volume is.
      if (spec.gitDir !== undefined) flags.push('--label', `${MACHINE_GIT}=${guard}`);
      /*
       * Each state volume at its state directory, after the binds, and the label
       * that says the machine has them.
       */
      for (const one of spec.states ?? []) flags.push('-v', `${one.volume}:${one.target}`);
      if ((spec.states ?? []).length > 0) flags.push('--label', `${MACHINE_STATE}=volume`);
      /*
       * Each part, read-only at `/opt/ahpd/<id>`, after the binds; the label
       * names exactly the parts the machine has, and its `PATH` puts each one's
       * `bin` in front of the image's own, so a command a preset names is found
       * without its path.
       */
      const { route, parts } = await mountable(spec.name, spec.parts ?? [], async (tag) => (await canMountImages(tag) ? 'image' : 'volume'));
      for (const part of parts) {
        if (route === 'image') flags.push('--mount', imageMountOf(part));
        else flags.push('-v', `${volumeOf(part)}:${partTarget(part.id)}:ro`);
      }
      if (spec.parts !== undefined) flags.push('--label', `${MACHINE_PARTS}=${partsLabel(parts, spec.hostParts)}`);
      // Under `open`, how the host's git reads the tree, which the machine's git
      // would not otherwise know.
      const reading = guard === 'open' && spec.gitDir !== undefined && spec.folder !== undefined
        ? openReadingOf(spec.repository ?? spec.folder)
        : {};
      const variables = { ...madeWith(spec), ...reading };
      if (parts.length > 0) {
        variables.PATH = pathWith(parts.map((one) => one.id), spec.env?.PATH ?? await imagePath(image));
      }
      // Each variable by name, with its value in docker's own environment, and
      // none the vault gave: those would be kept in the container's record.
      const given = byName(variables);
      flags.push(...given.flags);
      if (spec.workdir !== undefined) flags.push('-w', spec.workdir);
      // Kept alive with nothing running in it, as the script does: a machine
      // waits for work.
      // Each state volume seeded before the machine exists, for the image's user.
      if ((spec.states ?? []).length > 0) {
        const ids = idsOfUser(spec.user) ?? await ownerIds(spec.name, image, await imageUser(image));
        for (const one of spec.states ?? []) await seedState(spec.name, one, { image }, ids);
      }
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
      // The machine's own git directory, seeded from the tree now that there is
      // a machine to seed it in.
      if (git !== undefined) await seedGit(spec.name, spec, git, spec.name);
      return { id: spec.name, image, status: 'running', created: new Date().toISOString() };
    },

    stop: async (id) => { await must(['stop', await containerOrFail(id)]); },
    start: async (id) => { await must(['start', await containerOrFail(id)]); },
    /*
     * One `restart` rather than a stop and a start.
     *
     * The runtime's own verb, so a machine that is already stopped is started
     * and one that is running is cycled, both without this having to ask which
     * it was: a stop-then-start of its own would race anybody else acting on
     * the same machine between the two.
     */
    restart: async (id) => { await must(['restart', await containerOrFail(id)]); },
    /*
     * Take one away, with its own git directory and with a machine made without
     * a profile its state volumes, which nothing else would ever mount: one per
     * agent its label names, as `stateVolumeOf` names them, and a volume that
     * is not there is nothing to remove. A profile's state volumes outlive
     * every machine; the git volume is this machine's and goes with it.
     *
     * What it committed, and under `copy` what it never committed, leave it
     * here: the first is in the git volume and the second in the machine's own
     * working tree, and the container is the last place either exists. So a
     * machine whose work cannot be read out is kept, with its volumes, and a
     * machine that is not up is started again for the commands that read it.
     */
    remove: async (id) => {
      const at = await containerOrFail(id);
      const found = await recordOf(at);
      const labels = labelsOf(found);
      const named = namedOf(found) ?? id;
      const mounts = mountsOf(found);
      const working = treeOf(mounts);
      const keeping = working !== undefined && copyOf(mounts);
      const fetching = labels[MACHINE_GIT] === 'fetch';
      /*
       * A stopped container runs nothing, and `docker exec` refuses one whatever
       * it is asked: a machine that is not up is started again for both of the
       * commands below, and one that will not start is refused here rather than
       * quietly emptied of nothing.
       */
      try {
        if ((fetching || keeping) && !running(found)) await must(['start', at]);
        if (fetching) await bringBackOfMachine(id);
        if (keeping && working !== undefined) await keepUncommitted(gitOf(id, at, found, working));
      }
      catch (error) {
        const said = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not remove ${named}, so it is still here: ${said}`);
      }
      await must(['rm', '-f', at]);
      // The machine's own git directory goes with the machine where it had one:
      // a machine whose profile leaves the host's git directory open mounts no
      // volume of its own, so there is nothing there to remove.
      if (labels[MACHINE_GIT] === 'fetch') await ran(options, ['volume', 'rm', gitVolumeOf(named)]);
      if (labels[MACHINE_STATE] !== 'volume' || profileOf(found) !== undefined) return;
      for (const provider of preparedFor(found)) {
        await ran(options, ['volume', 'rm', stateVolumeOf({ id: named }, provider)]);
      }
    },

    exec: async (id, command, env) => {
      const at = await containerOrFail(id);
      /*
       * A dev container is reached by the same `docker exec` as any other
       * machine, with the user and environment its own definition asks for -
       * which is exactly what the CLI's own exec builds - decision
       * `a-dev-container-is-reached-by-docker-exec`.
       */
      const into = await argvInto(id, at, await recordOf(at), command, env ?? {});
      const held = await ran(options, into.argv, undefined, into.env);
      // Not tolerated and not thrown: a command that failed is the tool
      // working, and its exit code is what the caller asked for.
      return { output: `${held.stdout}${held.stderr}`.trim(), code: held.code };
    },

    /*
     * Host files written into a machine, each at its machine path: the path it
     * already has on Linux and macOS, its drive-style one on Windows.
     *
     * As root, in one command: the machine's own user cannot make the folders
     * above a path this host chose - `/home/softov/...` inside a container
     * belongs to root - and a file the machine's user owns is one it could
     * write over, which is the whole of what read-only means here. The bytes
     * arrive on the command's own input, so a file of any size crosses as one
     * stream rather than as part of a command line.
     */
    putIn: async (id, paths) => {
      const at = await containerOrFail(id);
      for (const path of paths) {
        const bytes = readFileSync(path);
        await must(
          ['exec', '-i', '--user', '0', at, 'sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1" && chmod 0444 "$1"', 'sh', machinePathOf(path)],
          undefined,
          bytes,
        );
      }
    },

    /** The same paths, taken back out with whatever is under them, as root too. */
    takeOut: async (id, paths) => {
      const at = await containerOrFail(id);
      for (const path of paths) await must(['exec', '--user', '0', at, 'rm', '-rf', machinePathOf(path)]);
    },

    /** What a machine committed, brought back by fetch: `bringBackOfMachine`. */
    bringBack: bringBackOfMachine,

    /** The host's branch, handed to the machine: `followOfMachine`. */
    follow: followOfMachine,

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
      const at = await containerOf(id);
      // A name that answers to something this host did not make is nothing to
      // report, the way a machine that is not running is.
      if (at === undefined) return undefined;
      const held = await ran(options, ['stats', '--no-stream', '--format', '{{json .}}', at]);
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

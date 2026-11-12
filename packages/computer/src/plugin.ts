import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComputerPort, ContainerPort, MachineNeed, MachineSource, Owner, Plugin, PluginSpec, SecretRef, SecretWork, SpawnOptions } from '@ahpd/sdk';
import { AGENT_RECORD_VARIABLE, resolveNeeds, secretRef, strings } from '@ahpd/sdk';
import { cliOf, devContainer, hasDefinition, idLabels } from './devcontainer.js';
import type { CliOptions } from './devcontainer.js';
import { CATALOGUE_PASS_MS, COMPUTERS_SCHEME, computerCatalogue } from './catalogue.js';
import { computerMethods, computerProvider } from './provider.js';
import { scopeOf } from './reference.js';
import { madeAgain, namedAgain, revealed, scopedTo, vaultNamed, withDefaults } from './secrets.js';
import type { VaultRead } from './secrets.js';
import { absoluteOnHost, manifestOf } from './manifest.js';
import { ensureJoined, ensureParts, PART_VOLUME_SWEEP_DELAY_MS, readParts, refusedWithout, requestedVolume } from './parts.js';
import type { Part } from './parts.js';
import type { FolderAnswer, Profile } from './manifest.js';
import { SequencerByKey, adoptedDevContainer, disposableOf, dockerRuntime, hostOf, isRunning, machineDirectory, madeUnderBind, profileOf, queue, sessionOf, stateVolumeOf, within } from './runtime.js';
import type { ComputerRuntime, DockerOptions, Machine, MachineSpec } from './runtime.js';
import { routed, parseMachineId, spellMachineId } from './router.js';
import type { Routed } from './router.js';
import { machinesOf, sshRuntime } from './ssh.js';
import { libvirtRuntime } from './libvirt.js';
import type { LibvirtOptions, LibvirtProfile } from './libvirt.js';
import { proxmoxRuntime } from './proxmox.js';
import type { ProxmoxOptions } from './proxmox.js';
import type { VmProfile } from './vm.js';
import { partsFromDocker } from './template.js';
import type { SshMachine, SshOptions } from './ssh.js';
import { serverGate } from './servercheck.js';
import { NODE_RUNTIME, nodeRuntime } from './node.js';
import { claimAdopted, claimOwned, forgetOwned, keepMadeNeeds, keepProbe, madeNeedsOf, ownedOf, probeOf } from './owners.js';
import { computerTools } from './tools.js';
import {
  hostSandboxPlace, hostSandboxRefusal, isSandboxSupported, MACHINE_SANDBOX_CHECK, MACHINE_SANDBOX_START, sandboxConfiguration,
  sandboxedCommand, sandboxedServer, sandboxSettingsOf, sandboxTempDir, writeSandboxSettings,
} from './sandbox.js';
import { guardFor, hostUser, runsAsHost } from './gitdir.js';
import type { GitGuard, SessionTree } from './gitdir.js';
import type { LogLevel } from '@ahpd/sdk';

/**
 * The package as a plugin.
 *
 * One runtime, one provider for the `computer:` scheme and three tools, all
 * built from the options and registered before the host exists. The runtime is
 * an option rather than a package of its own because a host serves one provider
 * per scheme.
 *
 * The options are checked against `optionsSchema` before `apply` runs. The
 * values of a map - `env`, `needs`, a profile - are what the schema cannot
 * describe, so an entry there that cannot be used is dropped rather than fatal.
 */

/** The plugin's id, unique among the plugins a daemon loads. */
export const name = 'computer';

/** What a listing prints. */
export const title = 'Computer';

/** What an option falls back to. */
export const defaults = {
  runtime: 'docker',
  command: 'docker',
  image: 'debian:bookworm-slim',
  max: 3,
  label: 'ahpd.computer=1',
  prefix: 'ahpd-computer',
  disposableDelay: 300000,
  /** How a nested host is started in a machine, before a profile says otherwise. */
  host: ['ahpd'],
} as const;

/*
 * A list of words, or nothing when the value is not a list at all.
 *
 * `undefined` rather than an empty list, because a profile that says nothing is
 * not a profile that says nothing is there: `words(said.mounts) === undefined`
 * is what leaves the field out of the body below.
 */
const words = (value: unknown): string[] | undefined =>
  (Array.isArray(value) ? strings(value) : undefined);

const named = (value: unknown): Record<string, string> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const held = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return held.length > 0 ? Object.fromEntries(held) : undefined;
};

/**
 * A set of machine needs, with a reference kept as one.
 *
 * Beside `named`, which drops a value that is not a string and so would drop
 * `{ "$secret": "<name>" }`: a need naming a secret is read when the machine is
 * made, not when the option loads, so the name has to survive to get there.
 */
const needValuesOf = (value: unknown): Record<string, string | SecretRef> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const held = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string | SecretRef] =>
      typeof entry[1] === 'string' || secretRef(entry[1]) !== undefined);
  return held.length > 0 ? Object.fromEntries(held) : undefined;
};

/**
 * The profiles an option named, with anything unusable dropped.
 *
 * The plugin's rule throughout: a misspelled key costs its own setting rather
 * than the plugin, so a profile that is not an object is not a profile and the
 * rest still load. What survives is checked properly when a body picks it.
 */
export const profilesOf = (value: unknown): Record<string, Profile> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const held: Record<string, Profile> = {};
  for (const [name, one] of Object.entries(value as Record<string, unknown>)) {
    if (typeof one !== 'object' || one === null || Array.isArray(one)) continue;
    const said = one as Record<string, unknown>;
    const text = (key: string): string | undefined =>
      (typeof said[key] === 'string' && said[key].trim() !== '' ? said[key] : undefined);
    held[name] = {
      ...(text('title') === undefined ? {} : { title: text('title') as string }),
      ...(text('description') === undefined ? {} : { description: text('description') as string }),
      ...(text('image') === undefined ? {} : { image: text('image') as string }),
      ...(text('cpus') === undefined ? {} : { cpus: text('cpus') as string }),
      ...(text('memory') === undefined ? {} : { memory: text('memory') as string }),
      // The OCI runtime Docker starts its machines under, `runsc` for gVisor:
      // how a container's kernel is isolated, which is the profile's to say.
      ...(text('ociRuntime') === undefined ? {} : { ociRuntime: text('ociRuntime') as string }),
      // The box from `ssh.machines` its machines are made on, checked against
      // that option once both are read.
      ...(text('server') === undefined ? {} : { server: text('server') as string }),
      // And what makes them there: a container on its Docker, or a VM.
      ...(said.runtime === 'docker' || said.runtime === 'libvirt' || said.runtime === 'proxmox' ? { runtime: said.runtime } : {}),
      // How a machine there is given the session's code.
      ...(said.code === 'bundle' || said.code === 'clone' ? { code: said.code } : {}),
      ...(text('workdir') === undefined ? {} : { workdir: text('workdir') as string }),
      ...(words(said.mounts) === undefined ? {} : { mounts: words(said.mounts) as string[] }),
      // The agents a profile prepares for, and any value it gives their needs.
      ...(words(said.agents) === undefined ? {} : { agents: words(said.agents) as string[] }),
      // The parts its machines carry beside the ones its agents name, checked
      // against the versions file once the plugin applies.
      ...(words(said.parts) === undefined ? {} : { parts: words(said.parts) as string[] }),
      ...(needValuesOf(said.needs) === undefined ? {} : { needs: needValuesOf(said.needs) as Record<string, string | SecretRef> }),
      ...(text('folder') === undefined ? {} : { folder: text('folder') as string }),
      // How the host inside a machine from this profile is started. Absent
      // means the port's own default, which is `ahpd`.
      ...(words(said.host) === undefined ? {} : { host: words(said.host) as string[] }),
      // The three fields that make a profile disposable: a machine is made
      // from it when a session starts, it goes a delay after the last session,
      // and `alone` keeps it out of the picker. The delay is written down as
      // the number that will be used, so the timer and the docs cannot
      // disagree.
      ...(said.disposable === true ? { disposable: true, disposableDelay: whole(said.disposableDelay, defaults.disposableDelay) } : {}),
      ...(said.disposableAlone === true ? { disposableAlone: true } : {}),
      // And whether the session that made the machine brings its folder in,
      // which is the host's filesystem inside a machine the client chose to be
      // somewhere else.
      ...(said.sessionFolder === true ? { sessionFolder: true } : {}),
      // And where a machine made for a session works: in the host's tree, the
      // default, or in a copy of it of its own - decision
      // `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
      // Absent is `shared`.
      ...(said.sessionTree === 'shared' || said.sessionTree === 'copy' ? { sessionTree: said.sessionTree } : {}),
      // And whether the repository that folder sits inside comes with it, the
      // root a folder below it would otherwise mount in its place. The same
      // gate one step wider, from the same decision: the folder being the
      // client's does not make the whole repository the client's.
      ...(said.sessionRepository === true ? { sessionRepository: true } : {}),
      // What a command into one of its machines does when a vault-named value
      // cannot be read again. Absent is `fail`.
      ...(said.secretUnreadable === 'fail' || said.secretUnreadable === 'drop' ? { secretUnreadable: said.secretUnreadable } : {}),
      // Where its agents' state lives, and who shares a state volume. Absent
      // is `volume` and `owner`.
      ...(said.state === 'volume' || said.state === 'host' ? { state: said.state } : {}),
      ...(said.stateScope === 'owner' || said.stateScope === 'shared' ? { stateScope: said.stateScope } : {}),
      // How a git directory in its machines is guarded. Absent is `fetch`.
      ...(said.gitGuard === 'fetch' || said.gitGuard === 'open' ? { gitGuard: said.gitGuard } : {}),
      // What deleting one of its machines' sessions when it is not running
      // does to the machine's own copy. Absent is `inside`.
      ...(said.nestedDelete === 'inside' || said.nestedDelete === 'record' ? { nestedDelete: said.nestedDelete } : {}),
    };
  }
  return Object.keys(held).length === 0 ? undefined : held;
};

/**
 * The boxes an `ssh` option names, or nothing when it names none this host can use.
 *
 * The whole option rather than its map, because the other fields are read here
 * as well and the map is the only part of it that cannot be read twice. The
 * plugin's rule as everywhere else: a misspelled key costs its own setting
 * rather than the plugin, so a box written without a destination is not a box,
 * the rest still load, and the runtime is simply not built when none survives.
 * A `pollSeconds` that is not a whole number above zero is a setting this host
 * does not understand, and is left out rather than refused.
 *
 * An ssh runtime is not built without a box: `ssh` on its own is a program this
 * host would run for machines that do not exist, and the plugin's runtimes are
 * the machines it serves rather than the programs it knows.
 */
export const sshOptionsOf = (value: unknown): SshOptions | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const said = value as Record<string, unknown>;
  const machines = machinesOf(said.machines);
  if (machines === undefined) return undefined;
  const command = typeof said.command === 'string' && said.command.trim() !== '' ? said.command : undefined;
  const args = words(said.args);
  const connectTimeout = whole(said.connectTimeout, 0) || undefined;
  const pollSeconds = whole(said.pollSeconds, 0) || undefined;
  return {
    machines,
    ...(command === undefined ? {} : { command }),
    ...(args === undefined ? {} : { args }),
    ...(connectTimeout === undefined ? {} : { connectTimeout }),
    ...(pollSeconds === undefined ? {} : { pollSeconds }),
  };
};

/** What the `libvirt` option says, without what the plugin gives every runtime. */
export type LibvirtSaid = Pick<LibvirtOptions, 'uri' | 'pool' | 'network' | 'template' | 'image' | 'user' | 'disk' | 'virsh' | 'virtInstall'>;

/**
 * The `libvirt` option, with anything unusable dropped.
 *
 * The pool and the network are libvirt's own `default` when absent, which is
 * what a box with libvirt installed has. A template is never defaulted: a VM
 * made from a disk its operator did not name is not one they meant.
 */
export const libvirtOptionsOf = (value: unknown): LibvirtSaid => {
  const said = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = (key: string): string | undefined =>
    (typeof said[key] === 'string' && said[key].trim() !== '' ? said[key] : undefined);
  return {
    pool: text('pool') ?? 'default',
    network: text('network') ?? 'default',
    ...(text('uri') === undefined ? {} : { uri: text('uri') as string }),
    ...(text('template') === undefined ? {} : { template: text('template') as string }),
    ...(text('image') === undefined ? {} : { image: text('image') as string }),
    ...(text('user') === undefined ? {} : { user: text('user') as string }),
    ...(text('disk') === undefined ? {} : { disk: text('disk') as string }),
    ...(words(said.virsh) === undefined ? {} : { virsh: words(said.virsh) as string[] }),
    ...(words(said.virtInstall) === undefined ? {} : { virtInstall: words(said.virtInstall) as string[] }),
  };
};

/** What the `proxmox` option says: its secret as written, and its `ca` as a path. */
export type ProxmoxSaid = Pick<ProxmoxOptions, 'url' | 'tokenId' | 'node' | 'storage' | 'bridge' | 'template' | 'image' | 'user'> & {
  /** The token's secret, or a `$secret` reference to it, read when a call needs it. */
  secret: unknown;
  /** The PEM file the node's certificate is checked against. */
  ca?: string;
};

/**
 * The `proxmox` option, or nothing when it lacks what a VM is made with.
 *
 * Every field but the template, the image, the user and the `ca` is needed:
 * there is no default node, storage or bridge a VM could be put on unasked.
 */
export const proxmoxOptionsOf = (value: unknown): ProxmoxSaid | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const said = value as Record<string, unknown>;
  const text = (key: string): string | undefined =>
    (typeof said[key] === 'string' && said[key].trim() !== '' ? said[key] : undefined);
  const [url, tokenId, node, storage, bridge] = [text('url'), text('tokenId'), text('node'), text('storage'), text('bridge')];
  if (url === undefined || tokenId === undefined || node === undefined || storage === undefined || bridge === undefined) return undefined;
  if (said.secret === undefined) return undefined;
  return {
    url,
    tokenId,
    node,
    storage,
    bridge,
    secret: said.secret,
    ...(text('template') === undefined ? {} : { template: text('template') as string }),
    ...(text('image') === undefined ? {} : { image: text('image') as string }),
    ...(text('user') === undefined ? {} : { user: text('user') as string }),
    ...(text('ca') === undefined ? {} : { ca: text('ca') as string }),
  };
};

const whole = (value: unknown, fallback: number): number =>
  (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback);

/**
 * A disposable machine and the sessions using it.
 *
 * The sessions are a set rather than a count, because the same session may
 * announce itself more than once for reasons this plugin cannot see and only
 * the host knows when one is really gone. The timer is the delay running once
 * the set is empty; the profile and its delay are kept because a machine made
 * by a daemon before this one has to be given the delay again from its own
 * label.
 */
interface Disposable {
  /** The profile it was made from. */
  profile: string;
  /** How long it outlives its last session, in milliseconds. */
  delay: number;
  /** The sessions running in it right now. */
  sessions: Set<string>;
  /** The delay already running, or nothing while a session is in it. */
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Who a stretch of up time is charged to, as the machine itself said.
 *
 * Read while the machine is still there: a machine that is removed leaves
 * nothing behind to read, and a stretch whose owner cannot be named would
 * charge the host for work somebody else made.
 */
export interface Claim {
  /** The owner as the machine carried it, or the host where it carried none. */
  owner: Owner;
  team?: string;
  project?: string;
}

/** What a stretch of up time is opened and closed by, as `made` does it. */
export interface StretchBook {
  /** Begin a machine's stretch, ignoring one already open for it. */
  open(id: string): void;
  /** End a machine's stretch and write it, charged for what `claimed` says. */
  close(id: string, claimed: Claim): Promise<void>;
}

/**
 * The up time of a runtime that only lists, read from what its listings see.
 *
 * Such a runtime never starts or stops a machine of its own, so there is no
 * moment of its own to open a stretch at. The only thing that says one of its
 * machines is up is a listing that found it reachable, and the only thing that
 * says it went is one that found it unreachable, or a daemon that is stopping -
 * so a machine that is up between two listings is charged for the time between
 * them.
 *
 * Charged to the host, because a machine on a runtime that only lists is
 * nobody's: it was not made here, so no owner was recorded for it, read the
 * other way round.
 *
 * Two events rather than one call, because a listing is not the only thing that
 * knows: a runtime that learns a machine went down from a connection or a
 * disconnect feeds the same two events, and the rule stays in one place.
 */
export const listingMeter = (
  book: StretchBook,
  hostName: string,
): { reachable(id: string): void; unreachable(id: string): Promise<void> } => ({
  reachable: (id) => { book.open(id); },
  unreachable: (id) => book.close(id, { owner: `root:${hostName}` }),
});

/**
 * The Docker on a box, as `DOCKER_HOST` names it: `ssh://<destination>`, with
 * the box's port when it sets one.
 */
export const dockerAddressOf = (box: SshMachine): string =>
  `ssh://${box.destination}${box.port === undefined ? '' : `:${box.port}`}`;

/**
 * Whether a runtime makes machines, from the actions it says it has.
 *
 * A runtime that only lists answers no `create`, and it is metered from what a
 * listing sees rather than from a start and a stop - the one thing about a
 * runtime the plugin decides for itself, since it is read from the runtime's
 * own answer.
 */
export const makesMachines = (runtime: ComputerRuntime | undefined): boolean =>
  runtime === undefined || runtime.capabilities().actions.includes('create');

/**
 * The pools a stretch is charged to.
 *
 * The owner as written, the team and the project within it, each only when the
 * record has it.
 */
const poolsOf = (claimed: Claim): string[] => [
  claimed.owner,
  ...(claimed.team === undefined ? [] : [`team:${claimed.team}`]),
  ...(claimed.team === undefined || claimed.project === undefined
    ? []
    : [`project:${claimed.team}:${claimed.project}`]),
];

/** The folder a session's own files are under, as the host names it. */
const ATTACHMENTS = 'attachments';

/**
 * Whether a path is one a session's attachments live under.
 *
 * The host writes them at `<its own state folder>/attachments/<session>/...`,
 * and that is the only shape this plugin writes into a machine or removes from
 * one. A path that is a folder named `attachments`, or the folder above it, is
 * not one the host named for a session, and removing it would take every
 * session's files with it. The path is resolved first, so a removal that
 * reaches above the folder is no more one of these than any other path is.
 */
const underAttachments = (path: string): boolean => {
  if (!isAbsolute(path)) return false;
  const parts = resolve(path).split(sep);
  const at = parts.lastIndexOf(ATTACHMENTS);
  return at >= 0 && at < parts.length - 1;
};

export const apply: Plugin['apply'] = (host, options) => {
  /*
   * The runtime a create that names none goes to, which is also what a caller
   * that knows only one runtime reads: every other value this host serves is
   * addressed by the id of a machine that is already there.
   */
  const runtime = options.runtime as string | undefined ?? defaults.runtime;
  const command = options.command as string | undefined ?? defaults.command;
  const args = options.args as string[] | undefined;
  const env = named(options.env);
  const cpus = options.cpus as string | undefined;
  const memory = options.memory as string | undefined;
  const image = options.image as string | undefined ?? defaults.image;
  const max = options.max as number | undefined ?? defaults.max;
  const label = options.label as string | undefined ?? defaults.label;
  const prefix = options.prefix as string | undefined ?? defaults.prefix;
  /*
   * How a nested host is started in a machine, when the machine's profile says
   * nothing: the daemon's own program, in stdio mode.
   */
  const hostDefault = options.host as string[] | undefined ?? defaults.host;
  /*
   * The session setting, which is how a person names the machine a session
   * runs in. Contributed unless the option switches it off, and its default is
   * one machine the operator chose rather than every session sharing one.
   */
  const sessionSetting = options.sessionSetting !== false;
  const sessionDefault = options.sessionDefault as string | undefined ?? '';

  /*
   * What any agent's machine needs are given, by need name.
   *
   * The deployment's, beside the profiles': a host whose Claude configuration
   * lives somewhere else says so once, and every profile that prepares for
   * Claude picks it up without repeating it.
   */
  const needValues = needValuesOf(options.needs);

  /*
   * What every machine this plugin makes can see.
   *
   * The operator's, in the configuration, so one line shares a directory with
   * every machine rather than every manifest repeating it. A body's own
   * mounts are added to these.
   */
  const mounts = options.mounts as string[] | undefined;
  /*
   * The named sets a person picks from when making a machine.
   *
   * The operator's, in the configuration, because what a machine is given is
   * a deployment decision: a profile that shares this host's agent
   * configuration and one that shares nothing are the same mechanism, and
   * which a person may pick is the operator saying so.
   */
  const profiles = profilesOf(options.profiles);
  /*
   * The boxes this host reaches over ssh, which are listed rather than made.
   *
   * A box is on a machine somebody else set up, so it is an operator's line in
   * the configuration rather than anything a session or a person may ask this
   * host for: what it adds is a runtime that answers, and nothing it can be
   * asked to make.
   */
  const ssh = sshOptionsOf(options.ssh);
  /*
   * Each profile's parts, against the versions file: an id the file does not
   * name is left out with a line naming it, and the profile keeps the rest. A
   * file that cannot be read leaves the ids as written, and each build says so
   * when a machine asks for it.
   */
  const partIds = ((): Set<string> | undefined => {
    try { return new Set(readParts().map((one) => one.id)); }
    catch { return undefined; }
  })();
  for (const [key, one] of Object.entries(profiles ?? {})) {
    if (one.parts === undefined || partIds === undefined) continue;
    for (const id of one.parts.filter((part) => !partIds.has(part))) {
      host.log.warn(`${name}: profiles.${key}.parts names ${id}, which the versions file does not, so its machines are made without it`);
    }
    one.parts = one.parts.filter((part) => partIds.has(part));
  }
  /*
   * Each profile's `server`, against the boxes the ssh option names: a profile
   * whose box is not there is left out with a line naming both, because a
   * machine made from it would be made somewhere its operator did not mean.
   */
  for (const [key, one] of Object.entries(profiles ?? {})) {
    if (one.server === undefined || ssh?.machines[one.server] !== undefined) continue;
    host.log.warn(`${name}: profiles.${key} names the server ${one.server}, which ssh.machines does not, so the profile is left out`);
    delete profiles?.[key];
  }
  /*
   * A `secretUnreadable`, `state`, `stateScope`, `gitGuard`, `sessionTree`,
   * `nestedDelete`, `code` or `runtime` that is not one of its answers is fatal here rather than
   * dropped: the loader's check does not reach into a profile, and a value read
   * as the default would make a machine other than the one its operator asked
   * for.
   */
  const answers: [field: string, values: string[]][] = [
    ['secretUnreadable', ['fail', 'drop']],
    ['state', ['volume', 'host']],
    ['stateScope', ['owner', 'shared']],
    ['gitGuard', ['fetch', 'open']],
    ['sessionTree', ['shared', 'copy']],
    ['nestedDelete', ['inside', 'record']],
    ['code', ['bundle', 'clone']],
    ['runtime', ['docker', 'libvirt', 'proxmox']],
  ];
  const asList = (values: string[]): string =>
    values.length < 3 ? values.join(' or ') : `${values.slice(0, -1).join(', ')} or ${values[values.length - 1] as string}`;
  for (const [key, one] of Object.entries(options.profiles as Record<string, unknown> | undefined ?? {})) {
    for (const [field, values] of answers) {
      const said = typeof one === 'object' && one !== null ? (one as Record<string, unknown>)[field] : undefined;
      if (said === undefined) continue;
      if (!values.includes(said as string)) {
        throw new Error(`plugin ${name}: profiles.${key}.${field} is ${asList(values)}, and ${String(said)} is neither`);
      }
    }
  }
  /*
   * Whether a person making a machine may name mounts of their own.
   *
   * Off unless the deployment says otherwise, because a mount is the one field
   * in a create body that reaches outside the machine: a body free to name
   * `/:/host` makes `computer:write` a permission over this host rather than
   * over the machines it makes. On is the older behaviour and a fair setting
   * for a host with one person on it.
   */
  const bodyMounts = options.bodyMounts === true;
  /*
   * The images a machine may be made from, as image scopes.
   *
   * Absent, any image is allowed: naming a set is the operator opting in. A
   * scope in a form the policy does not read is fatal here, since it would
   * silently match nothing, and an operator who wrote one meant something by
   * it.
   */
  const images = options.images as string[] | undefined;
  for (const one of images ?? []) {
    try { scopeOf(one); }
    catch (error) {
      throw new Error(`plugin ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /*
   * The Dev Container CLI, as a launcher and as a machine maker.
   *
   * One option, read once, because both routes run the same program with the
   * same words before its verb: the launcher puts a nested host in a
   * container, and the runtime makes a computer from a folder's definition -
   * decision `a-dev-container-is-reached-by-docker-exec`. `false`
   * switches every dev container route off: no `folders` are read, `folderFor`
   * refuses every folder, the picker offers no row, the create form draws no
   * source field and no launcher is contributed, while the runtime is still
   * built so the machines already there are listed, reached and stopped.
   */
  const container = options.devcontainer as boolean | Record<string, unknown> | undefined;
  const held = typeof container === 'object' ? container : {};
  const cliArgs = held.args as string[] | undefined;
  const hostCommand = held.host as string[] | undefined;
  const containerEnv = named(held.env);
  const containerPlugins = held.plugins as PluginSpec[] | undefined;
  /*
   * The folders a dev container may be made from, as the operator wrote them.
   *
   * Absent allows any, as an unset `images` does: a definition is a recipe the
   * folder's owner wrote, and an operator on a host with one person on it has
   * nothing to narrow. Naming a set is the opting in. On a host with a users
   * directory absent allows none until the operator names them, which
   * `folderFor` says.
   */
  const containerFolders = words(held.folders);
  for (const one of containerFolders ?? []) {
    if (!absoluteOnHost(one)) {
      throw new Error(`plugin ${name}: devcontainer.folders are absolute paths on this host, and ${one} is not one`);
    }
  }
  const cliOptions: CliOptions = {
    ...(held.command === undefined ? {} : { command: held.command as string }),
    ...(cliArgs === undefined ? {} : { args: cliArgs }),
    ...(containerEnv === undefined ? {} : { env: containerEnv }),
  };

  /** A path resolved, so `..` and a symlink cannot be walked out of a list. */
  const resolved = (path: string): string => {
    try { return realpathSync(path); }
    catch { return path; }
  };

  /**
   * The folder a dev container is made from here, resolved, or the sentence for
   * one this host will not build from.
   *
   * One check for all four routes - a create body, a `devcontainer://` session
   * setting, the picker's row and a relay's `connect` - because a route that
   * checked for itself is a route the operator's list does not cover, and the
   * folder is the whole of what a definition can reach.
   *
   * It answers with the folder rather than a yes, so no route can pass on the
   * spelling it was given: the CLI is handed this one and the container is
   * labelled with it, and two spellings of a folder are two containers.
   */
  const folderFor = (folder: string): FolderAnswer => {
    const here = resolved(folder);
    if (container === false) {
      return { refusal: `Dev containers are switched off on this host, so ${here} makes no computer` };
    }
    /*
     * A host more than one person signs in to names the folders first: a
     * `devcontainer.json` may ask for `--privileged` and mounts, so an unset
     * list would make anybody holding `computer:write` the host by way of a
     * file they wrote - decision
     * `dev-containers-need-allowed-folders-on-a-host-with-users`.
     */
    if (host.hasUsers === true && containerFolders === undefined) {
      return { refusal: `This host has a users directory, so no dev container is made from ${here} until its operator names the folders it may use in devcontainer.folders` };
    }
    if (containerFolders === undefined) return here;
    if (containerFolders.some((one) => resolved(one) === here)) return here;
    return { refusal: `This host makes dev containers from ${containerFolders.join(', ')}, and ${here} is not one of them` };
  };

  /** What the daemon's own record said, in this plugin's own log. */
  const noted = (line: string, level?: LogLevel): void => { host.log(`${name}: ${line}`, level); };

  /*
   * The Docker this plugin runs, as one set of options.
   *
   * The runtime and the launcher and `reach` are three roads into the same
   * machines, and each is given this rather than a copy of it: the probe a dev
   * container is reached with is kept where the daemon keeps its own
   * configuration, and a probe written by one road and read by another is the
   * one thing a container reached twice must not do differently.
   */
  const dockeredOptions: DockerOptions = {
    command,
    label,
    devcontainerCli: cliOptions,
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env }),
    configDir: host.configDir,
    log: noted,
    // How a machine starts its nested host, read from the machine's own record
    // as the profile it names says. The profile's
    // own `host` wins over the plugin's, which is the one thing a profile can
    // say about it.
    hosts: Object.fromEntries(Object.entries(profiles ?? {}).map(([key, one]) => [key, one.host])),
    host: [...hostDefault],
    ...(options.imageMounts === false ? { imageMounts: false } : {}),
  };
  const dockered = dockerRuntime(dockeredOptions);

  /*
   * The boxes this host reaches over ssh, built beside docker and only where
   * the operator named one: a runtime with no machine behind it would be a
   * value that prefixes an id nothing answers to.
   *
   * The program's environment is the plugin's own `env`, the same one docker is
   * run with: both are the environment the program is reached through rather
   * than anything a machine holds, and an operator who reaches two runtimes
   * through one proxy or one agent says so once.
   */
  const sshed = ssh === undefined ? undefined : sshRuntime({ ...ssh, ...(env === undefined ? {} : { env }), log: noted });

  /*
   * One Docker for each profile that names a box, reached through Docker's own
   * `ssh://` transport, by the value its machines' ids are spelled with.
   *
   * A box with an `identity` is left out with its profile: Docker's transport
   * takes no key, so the key is named in ssh's own configuration instead. A
   * box whose address is the plugin's own Docker gets no second runner, since
   * its machines would be listed twice; the profile makes them on that one.
   */
  const farValues: Record<string, string> = {};
  const farDockers: Record<string, ComputerRuntime> = {};
  /*
   * And one libvirt for every profile that makes VMs, on whichever box each
   * names. A VM is reached with this host's own key through its box, and `-J`
   * gives the box the person's own ssh configuration, so a box with an
   * `identity` is left out here as it is for Docker.
   */
  const vmProfiles: Record<string, LibvirtProfile> = {};
  /*
   * And one Proxmox for every profile that makes VMs on the `proxmox` option's
   * node. Its `server` is not where the VM is made but the box a VM is reached
   * through, for a node whose VM network this host has no route to.
   */
  const proxmoxSaid = proxmoxOptionsOf(options.proxmox);
  const proxmoxProfiles: Record<string, VmProfile> = {};
  for (const [key, one] of Object.entries(profiles ?? {})) {
    const box = one.server === undefined ? undefined : ssh?.machines[one.server];
    if (one.runtime === 'proxmox') {
      if (proxmoxSaid === undefined) {
        host.log.warn(`${name}: profiles.${key} makes Proxmox VMs, and the proxmox option does not name its url, tokenId, secret, node, storage and bridge, so the profile is left out`);
        delete profiles?.[key];
        continue;
      }
      if (one.server !== undefined && box === undefined) {
        host.log.warn(`${name}: profiles.${key} reaches its VMs through ${one.server}, which is not in ssh.machines, so the profile is left out`);
        delete profiles?.[key];
        continue;
      }
      if (box?.identity !== undefined) {
        host.log.warn(`${name}: profiles.${key} names the server ${one.server as string}, whose identity ssh -J cannot be given; name the key for ${box?.destination as string} in ssh's own configuration instead, so the profile is left out`);
        delete profiles?.[key];
        continue;
      }
      proxmoxProfiles[key] = { server: proxmoxSaid.node, ...(box === undefined ? {} : { box }), ...(one.host === undefined ? {} : { host: one.host }) };
      continue;
    }
    if (one.runtime === 'libvirt') {
      if (box === undefined || one.server === undefined) {
        host.log.warn(`${name}: profiles.${key} makes VMs and names no server to make them on, so the profile is left out`);
        delete profiles?.[key];
        continue;
      }
      if (box.identity !== undefined) {
        host.log.warn(`${name}: profiles.${key} names the server ${one.server}, whose identity ssh -J cannot be given; name the key for ${box.destination} in ssh's own configuration instead, so the profile is left out`);
        delete profiles?.[key];
        continue;
      }
      vmProfiles[key] = { server: one.server, box, ...(one.host === undefined ? {} : { host: one.host }) };
      continue;
    }
    if (box === undefined) continue;
    if (key.includes('.')) {
      host.log.warn(`${name}: profiles.${key} names a server, and a dot in its name would read as part of its machines' ids, so the profile is left out`);
      delete profiles?.[key];
      continue;
    }
    if (box.identity !== undefined) {
      host.log.warn(`${name}: profiles.${key} names the server ${one.server}, whose identity Docker cannot be given; name the key for ${box.destination} in ssh's own configuration instead, so the profile is left out`);
      delete profiles?.[key];
      continue;
    }
    const address = dockerAddressOf(box);
    if (address === (env?.DOCKER_HOST ?? '')) {
      host.log(`${name}: profiles.${key} names the server ${one.server}, whose Docker is this plugin's own, so its machines are made on that one`);
      continue;
    }
    const value = `${dockered.kind}-${key}`;
    farValues[key] = value;
    farDockers[value] = dockerRuntime({
      ...dockeredOptions,
      env: { ...env, DOCKER_HOST: address },
      remote: true,
      profile: key,
      ...(host.hostId === undefined ? {} : { hostId: host.hostId }),
    });
  }
  /*
   * How long a box's Docker is given for a question about its machines: as
   * long as `ssh` is given for one command to a box.
   */
  const farTimeout = (ssh?.connectTimeout ?? 10) * 1000 + 10_000;
  const libvirted = ssh === undefined || Object.keys(vmProfiles).length === 0 ? undefined : libvirtRuntime({
    ...libvirtOptionsOf(options.libvirt),
    ssh: {
      ...(ssh.command === undefined ? {} : { command: ssh.command }),
      ...(ssh.args === undefined ? {} : { args: ssh.args }),
      ...(ssh.connectTimeout === undefined ? {} : { connectTimeout: ssh.connectTimeout }),
      ...(env === undefined ? {} : { env }),
    },
    ...(env === undefined ? {} : { env }),
    profiles: vmProfiles,
    label,
    configDir: host.configDir,
    ...(host.hostId === undefined ? {} : { hostId: host.hostId }),
    // A template's parts come out of the joined image on this host's Docker.
    parts: partsFromDocker(
      { command, ...(args === undefined ? {} : { args }), ...(env === undefined ? {} : { env }) },
      async () => (await ensureJoined({ runtime: dockered, log: noted, image })).tag,
    ),
    log: noted,
  });
  for (const key of Object.keys(vmProfiles)) if (libvirted !== undefined) farValues[key] = libvirted.kind;

  /*
   * The certificate a node's own is checked against, read once here: a `ca`
   * that cannot be read leaves the Proxmox profiles out rather than trusting
   * whatever certificate the node shows.
   */
  let proxmoxCa: string | undefined;
  if (proxmoxSaid?.ca !== undefined && Object.keys(proxmoxProfiles).length > 0) {
    try {
      proxmoxCa = readFileSync(proxmoxSaid.ca, 'utf8');
    }
    catch (error) {
      host.log.error(`${name}: proxmox.ca ${proxmoxSaid.ca} could not be read (${error instanceof Error ? error.message : String(error)}), so the Proxmox profiles are left out`);
      for (const key of Object.keys(proxmoxProfiles)) {
        delete proxmoxProfiles[key];
        delete profiles?.[key];
      }
    }
  }
  /*
   * The token's secret, read each time a call needs it rather than at load:
   * one that cannot be read fails only the Proxmox calls, by its name.
   */
  const proxmoxSecret = async (): Promise<string> => {
    const named = secretRef(proxmoxSaid?.secret);
    if (named === undefined) {
      if (typeof proxmoxSaid?.secret === 'string' && proxmoxSaid.secret !== '') return proxmoxSaid.secret;
      throw new Error('the proxmox option\'s secret is neither a value nor a {"$secret": "<name>"}');
    }
    try {
      return await host.secret(named);
    }
    catch (error) {
      throw new Error(`the proxmox option's secret ${named} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const proxmoxed = proxmoxSaid === undefined || Object.keys(proxmoxProfiles).length === 0 ? undefined : proxmoxRuntime({
    url: proxmoxSaid.url,
    tokenId: proxmoxSaid.tokenId,
    secret: proxmoxSecret,
    node: proxmoxSaid.node,
    storage: proxmoxSaid.storage,
    bridge: proxmoxSaid.bridge,
    ...(proxmoxSaid.template === undefined ? {} : { template: proxmoxSaid.template }),
    ...(proxmoxSaid.image === undefined ? {} : { image: proxmoxSaid.image }),
    ...(proxmoxSaid.user === undefined ? {} : { user: proxmoxSaid.user }),
    ...(proxmoxCa === undefined ? {} : { ca: proxmoxCa }),
    ssh: {
      ...(ssh?.command === undefined ? {} : { command: ssh.command }),
      ...(ssh?.args === undefined ? {} : { args: ssh.args }),
      ...(ssh?.connectTimeout === undefined ? {} : { connectTimeout: ssh.connectTimeout }),
      ...(env === undefined ? {} : { env }),
    },
    profiles: proxmoxProfiles,
    label,
    configDir: host.configDir,
    ...(host.hostId === undefined ? {} : { hostId: host.hostId }),
    parts: partsFromDocker(
      { command, ...(args === undefined ? {} : { args }), ...(env === undefined ? {} : { env }) },
      async () => (await ensureJoined({ runtime: dockered, log: noted, image })).tag,
    ),
    log: noted,
  });
  for (const key of Object.keys(proxmoxProfiles)) if (proxmoxed !== undefined) farValues[key] = proxmoxed.kind;

  /*
   * The box a profile's machines are made on, checked for a Docker this
   * account can reach before each one is made. The report is kept a minute.
   */
  const gate = sshed === undefined ? undefined : serverGate(async (server) => {
    const report = await sshed.check?.(server);
    if (report === undefined) throw new Error(`${server} is not a box this host reaches over ssh`);
    return report;
  });

  /*
   * The hosts that joined this one, built only where this daemon has a join
   * path.
   *
   * Nothing is configured here and nothing can be: a node dialled this host, so
   * the registry the daemon keeps is the whole of what this runtime knows. A
   * host nobody joined has no runtime of that kind, and no listing either.
   */
  const joined = host.nodes;
  const noded = joined === undefined ? undefined : nodeRuntime(joined);

  /*
   * The runtimes this host serves, by the value that prefixes a machine's id.
   *
   * One entry for each kind this host was configured or joined with, and this
   * map is where a later runtime is added: the plugin holds one runtime per
   * value, and every road into a machine - the provider, the tools, `reach` -
   * goes through the router, so nothing outside it knows how many there are.
   * They differ in what they can be asked, not in how they are reached:
   * docker makes machines, ssh and node only list them.
   */
  const runtimes: Record<string, ComputerRuntime> = {
    [dockered.kind]: dockered,
    ...(sshed === undefined ? {} : { [sshed.kind]: sshed }),
    ...(noded === undefined ? {} : { [noded.kind]: noded }),
    ...farDockers,
    ...(libvirted === undefined ? {} : { [libvirted.kind]: libvirted }),
    ...(proxmoxed === undefined ? {} : { [proxmoxed.kind]: proxmoxed }),
  };
  /*
   * The runners whose machines were never adopted, because their startup
   * listing did not answer, and what adopts them once the startup is over.
   */
  const unadopted = new Set<string>();
  let adoptLate: ((found: Machine[]) => Promise<void>) | undefined;
  const computerRouter = routed(runtimes, runtime, {
    log: noted,
    timeouts: Object.fromEntries([
      ...Object.keys(farDockers),
      ...(libvirted === undefined ? [] : [libvirted.kind]),
      ...(proxmoxed === undefined ? [] : [proxmoxed.kind]),
    ].map((value) => [value, farTimeout])),
    makerFor: (spec) => {
      const key = spec.disposable?.profile ?? spec.profile;
      return key === undefined ? undefined : farValues[key];
    },
    listed: (value, rows) => {
      if (rows === undefined) {
        if (adoptLate === undefined && !unadopted.has(value)) {
          unadopted.add(value);
          noted(`the ${value} runtime's machines are adopted at the next listing that reaches it`);
        }
        return;
      }
      if (adoptLate !== undefined && unadopted.delete(value)) {
        void adoptLate(rows).catch((error: unknown) => {
          noted(`the ${value} runtime's machines were not adopted: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    },
  });

  /*
   * Read one need's value when it names a secret.
   *
   * Handed the host's own `secret` and nothing of this plugin's: the vault is
   * the host's, and a need is read for the machine's owner and team rather than
   * for whoever loaded the option.
   */
  const secret = async (name: string, work: SecretWork): Promise<string> => host.secret(name, work);

  /*
   * One open stretch of up time per running machine.
   *
   * What a machine costs is known only once it has stopped, so a stretch
   * opens when a machine starts and is written whole when it stops: `at` is when
   * it began and `seconds` how long it ran. The
   * epoch it began at is the whole of it that is held, because the owner is read
   * at the other end, where the machine's own labels are still there to read.
   */
  const stretches = new Map<string, number>();

  /** Begin a machine's stretch, ignoring one already open for it. */
  const open = (id: string): void => {
    if (!stretches.has(id)) stretches.set(id, Date.now());
  };

  /**
   * Who a machine's time is charged to, as the machine itself said.
   *
   * The machine's and not this daemon's: it outlives the daemon, and a machine
   * found already running carries the label whoever created it left on it. A
   * machine the Dev Container CLI made carries no label, because the CLI can
   * only label through the pairs that identify a container, so its creator is
   * in the file beside the configuration - decision
   * `a-dev-container-owner-is-kept-beside-the-config`. One made outside ahpd is
   * in neither, and is the host's own.
   */
  const claimOf = async (id: string): Promise<Claim> => {
    // The runtime's own answer, so a machine on any runtime this host serves
    // has its owner read in that runtime's own words rather than out of
    // Docker's record. A machine whose owner the runtime says nothing about is
    // read again from this daemon's own file.
    const said = await computerRouter.owner(id) ?? {};
    const labels = said.owner === undefined ? ownedOf(host.configDir, id, noted) : said;
    return {
      owner: labels?.owner ?? `root:${host.hostName}`,
      ...(labels?.team === undefined ? {} : { team: labels.team }),
      ...(labels?.project === undefined ? {} : { project: labels.project }),
    };
  };

  /*
   * The variables each machine holds whose values were read from the vault,
   * with the agents each belongs to.
   *
   * Never given when the machine was made, so they are not in its own record,
   * and never written to a file: they live here for as long as this daemon
   * does, and are passed by name on each command run in the machine, an
   * agent's command given only the ones its own needs declared.
   */
  const vaulted = new Map<string, Pick<VaultRead, 'env' | 'owners'>>();

  /**
   * A machine's vault-named variables, held or read again.
   *
   * A machine this daemon made has them in `vaulted`. One it did not - made
   * before a restart, or by another daemon - has them read again for the owner
   * and team the machine carries: from the references recorded beside the
   * configuration when it was made, or, for a machine with none recorded, from
   * the needs the agents its label names declare and the profile it was made
   * from. What was read is held, so the vault is asked once per machine.
   *
   * A reference that cannot be read is the profile's `secretUnreadable` to
   * decide: `fail`, the default and the answer for a machine made from no
   * profile, refuses the command naming the need, and nothing is held so the
   * next command reads again; `drop` answers without that variable and logs a
   * line naming the need, once per command.
   *
   * `provider` is the agent the command runs for, which is given only the
   * variables its own needs declared; absent, for a command no agent runs,
   * every one is given.
   */
  const namedFor = async (id: string, found?: Record<string, unknown>, provider?: string): Promise<Record<string, string>> => {
    const known = vaulted.get(id);
    if (known !== undefined) return scopedTo(known, provider);
    const held = found ?? await computerRouter.inspect(id);
    if (held === undefined) return {};
    const key = profileOf(held);
    const profile = key === undefined ? undefined : profiles?.[key];
    const claimed = await claimOf(id);
    const work: SecretWork = { owner: claimed.owner, ...(claimed.team === undefined ? {} : { team: claimed.team }) };
    const recorded = madeNeedsOf(host.configDir, id, noted);
    const read = recorded === undefined
      ? await namedAgain(profile?.needs, needValues, await made.agents(id) ?? [], (provider) => host.machineNeeds(provider), work, secret)
      : await madeAgain(recorded, work, secret);
    if (read.unread.length === 0) {
      vaulted.set(id, read);
      return scopedTo(read, provider);
    }
    if (profile?.secretUnreadable !== 'drop') {
      throw new Error(`${id} is not reached without what its vault-named needs give it: ${read.unread.map((one) => one.said).join('; ')}`);
    }
    for (const one of read.unread) noted(`${id} is reached without ${one.variable}: ${one.said}`);
    return scopedTo(read, provider);
  };

  /**
   * End a machine's stretch and write it, or do nothing when it had none.
   *
   * `claimed` was read while the machine was still there, because whatever
   * ended it may have taken the labels with it. A store that refuses the write
   * is reported and nothing more: losing a stretch is not a reason to fail the
   * stop or the removal that was asked for.
   */
  const close = async (id: string, claimed: Claim): Promise<void> => {
    const started = stretches.get(id);
    if (started === undefined) return;
    stretches.delete(id);
    try {
      await host.recordUsage({
        kind: 'computer',
        source: 'computer',
        at: new Date(started).toISOString(),
        // To the millisecond it was measured in, so a machine that was up for
        // less than a second is not written as zero.
        seconds: Math.round(Date.now() - started) / 1000,
        computer: id,
        owner: claimed.owner,
        ...(claimed.team === undefined ? {} : { team: claimed.team }),
        ...(claimed.project === undefined ? {} : { project: claimed.project }),
        pools: poolsOf(claimed),
      });
    }
    catch (error) {
      host.log.error(`${name}: could not write the up time of ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /*
   * The same two ends, for a runtime that has no start and stop of its own.
   *
   * A machine on such a runtime is charged to the host, because nobody here
   * made it and so no owner was recorded for it.
   */
  const metered = listingMeter({ open, close }, host.hostName);

  /*
   * A node's own moments, which are the ones no listing has to be asked for.
   *
   * A node is up from the hello it dialled this host with until the socket it
   * is on closes, so those two moments are what a stretch is, and here they
   * are rather than at a listing. What the watch says when it is taken is where
   * each node already is, so a node that joined before this plugin applied is
   * charged from now rather than not at all.
   *
   * The ids are spelled the way a listing spells them, because the book is
   * keyed by what a caller holds: a node's row from its own runtime carries the
   * name alone, and this is the one place the runtime key is written into it.
   */
  const watching = joined?.watch((change) => {
    const id = spellMachineId(NODE_RUNTIME, change.id);
    if (change.joined) metered.reachable(id);
    else void metered.unreachable(id);
  });
  if (watching !== undefined) host.registerClose(() => { watching.close(); });

  /**
   * The `x-ahpd-computers://` channel, refreshed after each change this plugin
   * makes to a machine, and read again every five minutes for the changes made
   * outside it, VS Code's periodic pass over a catalogue whose source changes
   * without telling it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostCatalogReconciliationService.ts#L22
   */
  const catalogue = computerCatalogue(computerRouter, (line: string, level?: LogLevel) => { host.log(`${name}: ${line}`, level); });
  catalogue.bind(host.registerChannel(COMPUTERS_SCHEME, catalogue.channel));
  // A reader whose grants changed is sent what they gained and lost.
  host.on('users_changed', () => { void catalogue.refresh(); });
  const reconciling = setInterval(() => { void catalogue.refresh(); }, CATALOGUE_PASS_MS);
  reconciling.unref?.();
  host.registerClose(() => { clearInterval(reconciling); });

  /*
   * The part volumes of versions the versions file does not name, removed
   * from each Docker this plugin makes machines on once no machine has used
   * them for a week, half a minute after the plugin starts, as VS Code cleans
   * its SDK cache once startup's own work is out of the way. A file that
   * cannot be read names nothing to keep, so nothing is removed.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSdkDownloader.ts#L241-L242
   */
  const sweeping = setTimeout(() => {
    let named: Part[];
    try { named = readParts(); }
    catch { return; }
    for (const docker of [dockered, ...Object.values(farDockers)]) {
      docker.removeUnusedPartVolumes?.((volume) => requestedVolume(volume, named)).catch(() => { /* the next start sweeps again */ });
    }
  }, PART_VOLUME_SWEEP_DELAY_MS);
  sweeping.unref?.();
  host.registerClose(() => { clearTimeout(sweeping); });

  /**
   * The runtime, with a stretch around every change of state, and the computer
   * channel refreshed after each.
   *
   * One wrapper rather than one per caller, because a machine can be started,
   * stopped and destroyed by three different things - the `state` leaf a client
   * writes, the tools a model calls, and the timer that takes a disposable away
   * - and up time is the same however it ended.
   */
  /*
   * The rows of a listing, with the up time of the runtimes that only list read
   * from them.
   *
   * A machine on such a runtime is never started or stopped by this host, so the
   * only moment that says it is up is a listing that found it reachable,
   * read the other way round: nobody here made it, so the host pays. Every
   * listing feeds the book rather than only the one at startup, because a
   * stretch is what the time between two listings is, and a host whose only
   * listing is its startup would never write one down.
   *
   * Two listings in a row that see a box up are one stretch, and the one that
   * finds it gone is what closes it: the book ignores a stretch already open
   * and one that is not there.
   *
   * The ids here are the ones a caller was given, because the book is keyed by
   * them: a box's row from its own runtime carries the box's name alone, and
   * whoever listed it is the one that spells the runtime into it.
   */
  const meterRows = async (found: Machine[]): Promise<Machine[]> => {
    for (const one of found) {
      if (makesMachines(computerRouter.runtimeFor(one.id))) continue;
      if (isRunning(one)) metered.reachable(one.id);
      else await metered.unreachable(one.id);
    }
    return found;
  };

  const made: Routed = {
    ...computerRouter,
    list: async () => meterRows(await computerRouter.list()),
    run: async (asked: MachineSpec, progress?: (message: string) => void) => {
      /*
       * A machine made on a box waits for the box to have what makes it, a
       * Docker or KVM with libvirt, that this account can reach, and is
       * refused with the fix lines when not.
       */
      const key = asked.disposable?.profile ?? asked.profile;
      const server = key === undefined || farValues[key] === undefined ? undefined : profiles?.[key]?.server;
      const vm = key !== undefined && (vmProfiles[key] !== undefined || proxmoxProfiles[key] !== undefined);
      // A Proxmox profile's server is only the way to its VMs, and the node is not checked over ssh.
      const proxmox = key !== undefined && proxmoxProfiles[key] !== undefined;
      if (!proxmox && server !== undefined && gate !== undefined) await gate.requireOn(server, vm ? ['kvm', 'libvirt', 'libvirtAccess'] : ['docker', 'dockerAccess']);
      /*
       * The parts the machine asks for, loaded before it is made. One that will
       * not load is left out with a line naming it and the load's reason,
       * and the machine is made with the rest: only a session needing the part
       * is refused, by the label that does not name it. A machine made for one
       * session whose own agent needs the part is not made at all, as
       * `refusedWithout` decides.
       *
       * Loaded on the Docker that mounts them: a machine on a box's Docker
       * mounts a part by its image there, which this host's Docker cannot give.
       */
      let spec = asked;
      // A VM's parts are what its template carries, and none is loaded for one.
      if (!vm && asked.partsAsked !== undefined && asked.partsAsked.length > 0) {
        const far = key === undefined ? undefined : farValues[key];
        const builder = far === undefined ? dockered : computerRouter.runtimes[far] ?? dockered;
        const built = await ensureParts(asked.partsAsked, { runtime: builder, log: noted, image });
        /*
         * A failed part whose need names a fallback has that host mount in its
         * place, and the machine counts it as had: its `ahpd.parts` label names
         * it at the version `host`, and no session needing it is refused.
         */
        const standIns = built.failed.flatMap((one) => {
          const stand = asked.partFallbacks?.find((held) => held.part === one.id);
          return stand === undefined ? [] : [{ ...stand, reason: one.reason }];
        });
        const failed = built.failed.filter((one) => !standIns.some((held) => held.part === one.id));
        const refused = refusedWithout(asked, failed.map((one) => one.id));
        if (refused.length > 0) {
          const said = failed.filter((one) => refused.includes(one.id)).map((one) => `${one.id}: ${one.reason}`).join('; ');
          throw new Error(`${asked.name} is not made, because ${refused.length === 1 ? 'the part' : 'the parts'} ${refused.join(', ')} this session's agent needs could not be loaded (${said})`);
        }
        for (const one of failed) noted(`${asked.name} is made without the part ${one.id}: ${one.reason}`);
        for (const one of standIns) noted(`${asked.name} is made with ${one.source} mounted at ${one.target} in place of the part ${one.part}, which could not be loaded: ${one.reason}`);
        spec = {
          ...asked,
          parts: built.made,
          ...(standIns.length === 0 ? {} : {
            mounts: [...asked.mounts ?? [], ...standIns.map((one) => one.mount)],
            hostParts: standIns.map((one) => one.part),
          }),
        };
      }
      /*
       * Each state directory's volume, named by the machine's profile, its
       * owner as `claimOf` answers it, and the provider that declared it.
       */
      if (asked.statesAsked !== undefined && asked.statesAsked.length > 0) {
        const owner = asked.owner ?? `root:${host.hostName}`;
        spec = {
          ...spec,
          states: asked.statesAsked.map((one) => ({
            ...one,
            volume: stateVolumeOf({
              ...(asked.profile === undefined ? {} : { profile: asked.profile }),
              owner,
              id: asked.name,
              ...(asked.stateScope === undefined ? {} : { scope: asked.stateScope }),
            }, one.provider),
          })),
        };
      }
      // Through the router, which is what spells the id a machine on any
      // runtime is listed and addressed by. The progress goes with it: this
      // wrapper is the one place between the port and the runtime.
      const machine = await computerRouter.run(spec, progress);
      // What the vault gave, which the runtime left off the make: held for
      // every command into the machine from now on, and its references
      // recorded beside the configuration for a daemon started afterwards.
      const named = new Set((spec.named ?? []).map((one) => one.variable));
      vaulted.set(machine.id, {
        env: Object.fromEntries(Object.entries(spec.env ?? {}).filter(([key]) => named.has(key))),
        owners: Object.fromEntries((spec.named ?? []).flatMap((one) => (one.providers === undefined ? [] : [[one.variable, one.providers]]))),
      });
      if (spec.named !== undefined && spec.named.length > 0) keepMadeNeeds(host.configDir, machine.id, spec.named, noted);
      /*
       * Whose a machine the Dev Container CLI made belongs to, in the file.
       *
       * A `docker run` machine has it on a label and the runtime put it there;
       * this one the CLI could only be asked to identify, so the record is
       * written here, under the id the listing answers it by - decision
       * `a-dev-container-owner-is-kept-beside-the-config`.
       */
      if (spec.devcontainer !== undefined && spec.owner !== undefined) {
        claimOwned(host.configDir, machine.id, {
          owner: spec.owner,
          ...(spec.team === undefined ? {} : { team: spec.team }),
          ...(spec.project === undefined ? {} : { project: spec.project }),
        }, noted);
      }
      open(machine.id);
      void catalogue.refresh();
      return machine;
    },
    start: async (id) => {
      await computerRouter.start(id);
      open(id);
      void catalogue.refresh();
    },
    restart: async (id) => {
      await close(id, await claimOf(id));
      await computerRouter.restart(id);
      open(id);
      void catalogue.refresh();
    },
    stop: async (id) => {
      await computerRouter.stop(id);
      void catalogue.refresh();
      await close(id, await claimOf(id));
    },
    // A suspended machine is not up: holding one closes its stretch, and
    // letting it go on opens a new one.
    suspend: async (id) => {
      await computerRouter.suspend(id);
      void catalogue.refresh();
      await close(id, await claimOf(id));
    },
    resume: async (id) => {
      await computerRouter.resume(id);
      open(id);
      void catalogue.refresh();
    },
    // A command a tool runs is a command in the machine like any other, so it
    // is given the machine's vault-named variables too, under its own: the
    // calling session's agent's alone, and every agent's for a caller with none.
    exec: async (id, command, env, provider) => {
      const named = await namedFor(id, undefined, provider);
      noVaultInline(id, named);
      return computerRouter.exec(id, command, { ...named, ...(env ?? {}) });
    },
    remove: async (id) => {
      const claimed = await claimOf(id);
      await computerRouter.remove(id);
      vaulted.delete(id);
      // The machine is gone, and so is the record kept beside the config: an
      // entry for an id nothing holds is a claim on a machine that may be made
      // again.
      forgetOwned(host.configDir, id, noted);
      void catalogue.refresh();
      await close(id, claimed);
    },
  };

  /*
   * The daemon is stopping, so this is the last moment every machine still up
   * can say how long it has been. A crash does not get here, and loses the
   * stretch that was open: a machine up across one is charged nothing until it
   * is next stopped.
   *
   * Each stretch is closed on its own, so a runtime that does not answer for
   * one machine does not keep every other stretch open: a runtime that is down
   * is exactly the one a daemon is stopping with machines on it, and it is the
   * one whose record cannot be read to see who pays.
   */
  host.on('stopping', async () => {
    for (const id of [...stretches.keys()]) {
      try {
        await close(id, await claimOf(id));
      }
      catch (error) {
        host.log.error(`${name}: could not close the up time of ${id}: ${error instanceof Error ? error.message : String(error)}`);
        stretches.delete(id);
      }
    }
  });

  /*
   * The disposable machines this plugin made, and the daemon before it left.
   *
   * A disposable machine is made for a session rather than ahead of time and
   * goes a delay after the last session using it is disposed. Nothing in a
   * listing says who is inside, so the host says when a session enters and
   * when one leaves, and this is the book that keeps score.
   */
  const disposables = new Map<string, Disposable>();

  /*
   * Whether the daemon has been told to stop.
   *
   * Set before anything else the closer does, because the startup scan arms a
   * leftover machine when it finds one and a timer armed into a daemon that is
   * going is the timer this exists to prevent. Everything that arms work reads
   * it, so what is left is a machine waiting for whoever starts next.
   */
  let closed = false;

  /** Every removal this plugin started and has not seen settle. */
  const removals = new Set<Promise<unknown>>();

  /**
   * The timer that checks every box, where the operator asked for one.
   *
   * A box is reached only when something reaches it, so a box's up time would
   * otherwise be the time between the listings a client asked for, and a client
   * that stops listing would leave a stretch open for as long as the daemon
   * runs. `ssh.pollSeconds` is how the operator says how often to look instead -
   * a row of the plugin's `ssh` option, not a decision of its own.
   *
   * The plugin owns the timer and not the runtime, because a runtime is never
   * told that the host is closing: this is the object with the close hook, and
   * the same one that clears the disposal timers clears this.
   *
   * Only the boxes are listed, and not every runtime: a `docker ps` every
   * interval is work on a daemon that nothing asked for, and a Docker machine's
   * up time is opened and closed by the start and the stop this host performs.
   */
  let polling: ReturnType<typeof setInterval> | undefined;
  if (sshed !== undefined && ssh?.pollSeconds !== undefined) {
    const boxes = sshed.kind;
    polling = setInterval(() => {
      void sshed.list()
        .then((found) => meterRows(found.map((one) => ({ ...one, id: spellMachineId(boxes, one.id) }))))
        .catch((error: unknown) => {
          noted(`the ssh machines were not checked, so their up time is unchanged: ${error instanceof Error ? error.message : String(error)}`);
        });
    }, ssh.pollSeconds * 1000);
    // A timer nobody is waiting on is not a reason for the process to stay up.
    (polling as { unref?: () => void }).unref?.();
  }

  /** What each agent this machine is made for declares it needs, by provider. */
  const needsFor = (asked: MachineSource) =>
    (provider: string): Record<string, MachineNeed> | undefined =>
      provider === asked.provider
        ? (asked.needs ?? host.machineNeeds(provider))
        : host.machineNeeds(provider);

  /**
   * Give a machine the delay again, once nothing is using it.
   *
   * Called with the set empty - at create, and when the last session leaves -
   * and harmless when a session arrived first: a machine with somebody in it
   * never loses its timer and immediately re-arms, which would be a removal
   * racing the session that just picked it.
   */
  const arm = (id: string): void => {
    if (closed) return;
    const held = disposables.get(id);
    if (held === undefined || held.sessions.size > 0) return;
    if (held.timer !== undefined) clearTimeout(held.timer);
    const timer = setTimeout(() => {
      const removing = made.remove(id).then(
        () => {
          disposables.delete(id);
          host.log(`${name}: removed the disposable machine ${id}, ${held.delay}ms after its last session`);
        },
        (error: unknown) => {
          /*
           * A removal that refused kept the machine, so it is still this
           * plugin's to watch and the delay is given again: a machine nobody
           * arms any more is one that stays for the rest of the daemon's life.
           * A daemon that is stopping arms nothing, so it is left for whoever
           * starts next.
           */
          host.log.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
          arm(id);
        },
      );
      /*
       * Kept while it runs, so the closer can wait for it: a removal halfway
       * through is a machine being taken apart, and a daemon that goes while
       * one is running leaves the work of it to nobody.
       */
      removals.add(removing);
      void removing.then(() => { removals.delete(removing); });
    }, held.delay);
    // A timer nobody is waiting on is not a reason for the process to stay up.
    (timer as { unref?: () => void }).unref?.();
    held.timer = timer;
  };

  /**
   * Start watching a machine, whether this daemon made it or found it.
   *
   * `first` is the session an adopted machine starts with already in it, so
   * that it is not given the delay for a session that is running in it: the
   * session it was made for is the one that decides, and it may well be.
   */
  const watch = (id: string, profile: string, delay: number, first?: string): void => {
    if (closed || disposables.has(id)) return;
    const sessions = new Set<string>();
    if (first !== undefined) sessions.add(first);
    disposables.set(id, { profile, delay, sessions });
    arm(id);
  };

  /*
   * What is said about a machine made with the host's git directory writable.
   *
   * Such a machine wrote its commits into the host's own git directory, so
   * there is nothing in it to bring back - and it is a machine this daemon's
   * guard would never make, because that directory is one the host's own git
   * writes links and refs into. It is removed rather than adopted or entered,
   * and the session is told, in the one sentence both roads say - decision
   * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
   *
   * The id is whatever the caller holds, as every other sentence about a
   * machine spells it, so the session reads the machine it asked for.
   */
  const underBindSaid = (id: string): string =>
    `computer://${id} was made with the host's git directory writable, so it was removed; the next turn makes a new one`;

  /**
   * Remove such a machine, and answer whether it went.
   *
   * Another daemon's machine is left where it is, with one line saying so: a
   * daemon neither enters another's machine nor removes it, which is the rule
   * every disposable machine already follows. One
   * with no daemon label at all is nobody's, and goes.
   *
   * A removal Docker refuses costs the removal and not the answer: the line
   * says why the machine is still there, the sentence is still the truth about
   * what it is, and the caller still treats it as a machine not to use.
   */
  const dropUnderBind = async (found: Record<string, unknown>, id: string): Promise<boolean> => {
    const theirs = hostOf(found);
    if (theirs !== undefined && theirs !== host.hostId) {
      host.log(`${name}: left the machine ${id} alone; it was made with the host's git directory writable, and it is another daemon's machine`);
      return false;
    }
    host.log(`${name}: ${underBindSaid(id)}`);
    try {
      await made.remove(id);
    }
    catch (error) {
      host.log.error(`${name}: could not remove ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return true;
  };

  /*
   * The machines a daemon before this one left behind.
   *
   * The timers died with it, so a labelled disposable machine found at startup
   * is given the delay again. Its profile may be gone from the options, and the
   * default stands then. A machine the listing cannot reach is answered for
   * where a listing is asked for, so nothing is said here.
   *
   * The book below is not complete until this is over, so a session that enters
   * or leaves one of these machines waits for it rather than being counted
   * against a machine this daemon has not found yet: an `enter` that arrived
   * first would be dropped, and the machine armed by this listing would then
   * be removed out from under the session running in it.
   */
  const adopt = async (found: Machine[]): Promise<void> => {
    for (const one of found) {
      /*
       * A machine made under the guard this plan replaced, which `madeUnderBind`
       * reads from the record: no label saying which guard made it, and a
       * read-only bind of a path in a git directory, which is where the old
       * guard pinned what git writes and laid its writable binds over. It goes
       * here rather than being adopted, and it is never armed: `dropUnderBind`
       * says what is written down about it.
       *
       * The record is read rather than the row, because `Mounts` is what says
       * this and a listing carries none. A machine this daemon cannot read is
       * one that is not there, and its row stands.
       */
      const record = await made.inspect(one.id);
      if (record !== undefined && madeUnderBind(record)) {
        await dropUnderBind(record, one.id);
        continue;
      }
      /*
       * A disposable machine names the session it was made for, and only the
       * daemon that made it and keeps that session adopts it: a session id is
       * the client's to choose and two daemons on the same Docker keep
       * sessions under the same ones, so the machine's own `ahpd.host` is what
       * says whose it is.
       */
      const mine = one.host === host.hostId;
      const adopted = one.disposable !== undefined && one.session !== undefined && mine && await host.sessionKept(one.session);
      if (one.disposable !== undefined && one.session !== undefined && !adopted) {
        if (!mine) {
          host.log(`${name}: left the disposable machine ${one.id} alone; it is another daemon's machine`);
          continue;
        }
        // Only a machine that names this daemon is removed: one that names no
        // daemon matches a loader with no id, and nothing says it is this one's.
        if (one.host === undefined) {
          host.log(`${name}: left the disposable machine ${one.id} alone; it names no daemon`);
          continue;
        }
        /*
         * This daemon's own machine, for a session it does not keep: nothing
         * will ever run in it, so it goes with the volume its git directory is
         * in rather than staying up for the rest of the daemon's life. A
         * removal Docker refuses is said and not thrown: the listing is what
         * finds the machine, and the next one finds it again.
         */
        try {
          await made.remove(one.id);
          host.log(`${name}: removed the disposable machine ${one.id}; ${one.session} is not a session this daemon keeps`);
        }
        catch (error) {
          host.log.error(`${name}: could not remove ${one.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
        continue;
      }
      /*
       * A runtime that only lists has no start of its own to open a stretch at,
       * so what a listing sees is the whole of it: one found up has a stretch
       * from now, and one found down has none. Nothing below is its business
       * either - a disposable machine is one this daemon made, and this daemon
       * makes machines only on a runtime that has a `create`.
       */
      if (!makesMachines(made.runtimeFor(one.id))) {
        if (isRunning(one)) metered.reachable(one.id);
        else await metered.unreachable(one.id);
        continue;
      }
      // Up before this daemon was watching, and still up: its stretch starts
      // now, because the stretch a daemon before this one was keeping is one
      // that daemon's to write. A machine that is stopped is not up, and a
      // stretch for it would be a stretch that only ever ends.
      if (isRunning(one)) open(one.id);
      if (one.disposable === undefined) continue;
      const delay = profiles?.[one.disposable.profile]?.disposableDelay ?? defaults.disposableDelay;
      watch(one.id, one.disposable.profile, delay, one.session);
      // Said out loud because a machine nobody remembers making, and that a
      // timer may be about to remove, is the sort of thing a person looks for.
      // An adopted one is not going anywhere yet: it is waiting on its session.
      host.log(adopted
        ? `${name}: found the disposable machine ${one.id} left behind; it is held for ${one.session}`
        : `${name}: found the disposable machine ${one.id} left behind; it goes ${delay}ms from now`);
    }
  };
  const listing = made.list().then(adopt).catch(() => {}).then(() => {
    adoptLate = adopt;
    return catalogue.refresh();
  });

  const scheme = computerProvider(made, {
    image,
    max,
    label,
    // Every value this host serves, so a body naming one of them is refused for
    // what it is rather than for not existing.
    runtimes: Object.keys(runtimes),
    ...(cpus === undefined ? {} : { cpus }),
    ...(memory === undefined ? {} : { memory }),
    ...(mounts === undefined ? {} : { mounts }),
    ...(profiles === undefined ? {} : { profiles }),
    ...(images === undefined ? {} : { images }),
    bodyMounts,
    // The same check the three session routes make, so a create body is
    // refused a folder the operator's list does not name.
    folderFor,
    // Whether this host makes one at all, so a client draws no source field for
    // a route `folderFor` refuses.
    ...(container === false ? { devcontainer: false } : {}),
    // Read when a body picks an agent-naming profile, never here: the plugin
    // that registers that agent may apply after this one.
    needsOf: (provider) => host.machineNeeds(provider),
    ...(needValues === undefined ? {} : { needValues }),
    secret,
  });
  host.registerResourceProvider('computer', scheme);
  for (const [command, method] of Object.entries(computerMethods(scheme, catalogue.refresh))) {
    host.registerMethod(command, method);
  }

  /*
   * What a machine made for a session takes of the repository its folder is
   * in: the git directory, the tree's root, the profile's guard, and the host
   * user its commands run as where the guard says - so git accepts the
   * repository as its owner's and every file it writes stays the host user's.
   * `root` is the folder the machine is given, and nothing where the folder
   * does not reach the machine.
   */
  const withGit = (
    asked: MachineSource,
    root: string | undefined,
    guard: GitGuard = 'fetch',
    repository = false,
    tree: SessionTree = 'shared',
  ): Pick<MachineSpec, 'gitDir' | 'repository' | 'user' | 'gitGuard' | 'sessionTree'> => {
    if (root === undefined) return {};
    /*
     * Under `copy` the machine works in a checkout of its own, so a folder the
     * machine would be given with no git directory beside it has nothing to
     * copy. Both ways out are wrong - binding the host's folder breaks what
     * `copy` promises, and a volume with nothing seeded in it loses everything
     * the agent writes, since there is no git to keep it - so the machine is
     * refused, saying which folder had nothing in it.
     */
    if (tree === 'copy' && (asked.gitDir === undefined || (asked.repository !== undefined && !repository))) {
      throw new Error(`the profile says sessionTree copy, and ${asked.repository ?? root} is not a repository a machine for this session may be given, so there is no checkout to work in; set sessionTree shared, or give the session a folder with a repository in it`);
    }
    /*
     * The folder is below a repository's root, and that root is not the
     * session's folder: a session working in `~/.config/nvim` would otherwise
     * mount the whole of `$HOME` read-write, because the root is what the
     * runtime mounts in place of the folder. It reaches the machine only where
     * the profile says `sessionRepository`, and without it neither the root nor
     * the git directory beside it does - that directory is not under the folder
     * either, so mounting it alone would put part of a repository the session
     * cannot see inside the machine. The folder itself still reaches the
     * machine where the profile says `sessionFolder`.
     */
    if (asked.repository !== undefined && !repository) {
      noted(`the profile does not say sessionRepository, so ${asked.folder} is mounted without ${asked.repository}, the repository it is in, and without its git directory`);
      return {};
    }
    const at = asked.repository ?? root;
    if (asked.gitDir === undefined) return asked.repository === undefined ? {} : { repository: asked.repository };
    /*
     * The guard the machine is made with, which under `copy` is `fetch`: the
     * machine commits in a git directory of its own and nothing of the host's
     * git directory is mounted but the objects, read-only. Everything that
     * reads the guard - the user's commands run as, the label a later daemon
     * reads back - reads this one.
     */
    const held = guardFor(guard, tree);
    const user = runsAsHost(asked.gitDir, at, held) ? hostUser() : undefined;
    return {
      gitDir: asked.gitDir,
      gitGuard: held,
      sessionTree: tree,
      ...(asked.repository === undefined ? {} : { repository: asked.repository }),
      ...(user === undefined ? {} : { user }),
    };
  };

  /**
   * Whether one id names a machine off this host.
   *
   * The runtime that serves the id answers, and a runtime this host does not
   * serve answers nothing here: `false` is "this host can reach it", and a
   * machine of a runtime nobody serves is refused by `how` rather than run
   * anywhere.
   */
  const offHost = (id: string): boolean => made.runtimeFor(id)?.remote === true;

  /** Whether a command into this machine carries its variables in its command line. */
  const inCommand = (id: string): boolean => made.runtimeFor(id)?.envInCommand === true;

  /**
   * A value read from the vault, refused for a machine this host reaches over ssh.
   *
   * On a machine this host made, a vault-named value is never in the command:
   * the docker runtime passes it in the program's own environment and a dev
   * container is given it on each reach, so the machine's record, the CLI's log
   * and a process list hold the name alone. A command over ssh carries its
   * variables inside the remote command string, which the box's own `ps`, its
   * shells and its history all read - so a value from the vault is refused
   * rather than written there. A variable the operator wrote in the clear is
   * still written inline, which is what `how` does for a machine on this host.
   *
   * One check for both roads, because both write the same variables: the port's
   * `how`, and the `exec` a tool runs a command through. It is asked before the
   * merge, so nothing is written and the sentence names the need rather than
   * what it holds.
   */
  const noVaultInline = (id: string, named: Record<string, string>): void => {
    const variables = Object.keys(named);
    if (variables.length === 0 || !inCommand(id)) return;
    throw new Error(`${id} is off this host, and ${variables.join(', ')} comes from the vault: a command over ssh carries its variables in the remote command, where the box reads them; give the box a value of its own, or run this command on the host`);
  };

  /*
   * How a backend reaches one of these machines.
   *
   * A descriptor rather than a running process: the backend owns the spawn and
   * its stdio, and this only says what to spawn. What to spawn is the routed
   * runtime's own answer, because what reaches a machine is a property of what
   * made it: a `docker exec` here, an `ssh` there.
   *
   * The machine's vault-named variables are laid into what the caller asked
   * for, under the agent the command runs for, so the runtime that spells them
   * into its own flags never has to know the vault.
   */
  const reach: ComputerPort['how'] = async (id, asked) => {
    const held = await made.inspect(id);
    if (held === undefined) return undefined;
    /*
     * A machine made with the host's git directory writable, asked for by a
     * session now: removed, and refused in the sentence that says why - this is
     * the road a session is told on, since the port's `enter` is a call the
     * host makes and swallows, and the sentence has to reach whoever started
     * the session rather than the log alone. A machine the startup listing
     * already removed is not here to be asked about, and a session's next turn
     * makes a new one from the source it named.
     */
    if (madeUnderBind(held)) {
      const gone = await dropUnderBind(held, id);
      throw new Error(gone
        ? underBindSaid(id)
        : `computer://${id} was made with the host's git directory writable, and it is another daemon's machine; make a machine of your own for this session or run it on the host`);
    }
    const named = await namedFor(id, held, asked.provider);
    noVaultInline(id, named);
    const values = { ...named, ...(asked.env ?? {}) };
    return made.how(id, { ...asked, env: values });
  };

  /*
   * A whole host inside a machine, in stdio mode.
   *
   * What a backend that cannot move its own process asks for: the machine's
   * own recipe says how its host is started, and this runs
   * `<host> --stdio --plugin <each>` by the same `how` a backend's own command
   * takes - so a dev container is reached through its CLI, an image through
   * Docker, and a box over ssh, without any of them being spelled twice. The
   * recipe is read back from the machine, so a machine found by a daemon that
   * did not make it still starts its own host.
   */
  const nestedHost: NonNullable<ComputerPort['nested']> = async (id, asked) => {
    const held = await made.inspect(id);
    if (held === undefined) return undefined;
    const host = await made.hostCommand(id) ?? hostDefault;
    const [program, ...before] = host;
    const away = inCommand(id);
    /*
     * The record of an agent made from a record, which the host inside serves.
     * It goes in the environment, which the runtime gives by name; a box over
     * ssh gets the copy with no secret field, for the reason below.
     */
    const record = asked.record === undefined ? undefined : away ? asked.record.bare : asked.record.whole;
    const startWith = {
      command: program ?? hostDefault[0],
      // `--no-plugins` leaves the box's own list out, and one `--plugin` per spec
      // names what loads; the box's file still sets up each one it lists.
      args: [
        ...before, '--stdio',
        ...(asked.plugins.length > 0 ? ['--no-plugins'] : []),
        ...asked.plugins.flatMap((plugin) => ['--plugin', plugin]),
      ],
      ...(asked.cwd === undefined ? {} : { cwd: asked.cwd }),
      ...(asked.provider === undefined ? {} : { provider: asked.provider }),
      ...(record === undefined ? {} : { env: { [AGENT_RECORD_VARIABLE]: JSON.stringify(record) } }),
    };
    /*
     * A box reached over ssh is handed nothing of this host's vault: the ahpd
     * on the box holds what it was given by hand there, and a value read from
     * the vault would be written into the remote command that starts it, which
     * also keeps a session in such a machine clear of the refusal above, since
     * it never reaches it. A machine on another box's Docker is given its
     * values by name, as one on this host's is.
     */
    const spawn = away ? await made.how(id, startWith) : await reach(id, startWith);
    if (spawn === undefined) return undefined;
    /*
     * Where the session works inside: the caller's folder read through the
     * machine's mounts, as `-w` is, or the machine's own directory. The inner
     * session is created there, since the host inside knows only its own paths.
     */
    const inside = (asked.cwd === undefined || offHost(id) ? undefined : within(held, asked.cwd)) ?? machineDirectory(held);
    return { ...spawn, ...(inside === undefined ? {} : { workingDirectory: inside }) };
  };

  /*
   * What deleting one of its machines' sessions when it is not running does to
   * the copy inside, read from the same label `nestedHost` reads its `host`
   * from.
   *
   * Undefined for a machine that is not there, which is the same answer a
   * machine whose profile says nothing gives - the host reads both as
   * `inside`, and a machine that has gone is a copy that went with it.
   */
  const nestedDelete: NonNullable<ComputerPort['nestedDelete']> = async (id) => {
    const held = await made.inspect(id);
    if (held === undefined) return undefined;
    const key = profileOf(held);
    return key === undefined ? undefined : profiles?.[key]?.nestedDelete;
  };

  /**
   * What a machine committed, brought back into the host's repository.
   *
   * The runtime's own call, under the id a caller holds: the runtime reads the
   * machine, its mounts and its git, so there is nothing here for the port to
   * decide - a machine of another provider is another provider's to answer for,
   * and `undefined` is that answer.
   */
  const bringBack: NonNullable<ComputerPort['bringBack']> = async (id) => made.bringBack(id);

  /**
   * The host's branch, handed to a machine before its next turn reads it.
   *
   * The runtime's own call too, under the id a caller holds, and for the same
   * reason: it is the runtime that reads the machine, its mounts and both
   * repositories, so there is nothing here for the port to decide.
   */
  const follow: NonNullable<ComputerPort['follow']> = async (id) => made.follow(id);

  /**
   * The paths a machine is reached with, and a line for each that is not one.
   *
   * The port is asked with paths the host built, and this is what keeps it that
   * way: a path outside a session's own folder reaches no machine, so nothing
   * else on this host is written into one or removed from one.
   */
  const onlyAttachments = (paths: string[], refusing: (one: string) => string): string[] =>
    paths.filter((one) => {
      if (underAttachments(one)) return true;
      host.log.warn(refusing(one));
      return false;
    });

  /**
   * A message's files, written into the machine its session runs in.
   *
   * The runtime's own call, under the id a caller holds: a file arriving on a
   * command's input, as root, and read-only once it is there is the runtime's
   * business. Two sessions
   * in one machine each get their own, because the paths are the ones this host
   * wrote and they are per session.
   */
  const putIn: NonNullable<ComputerPort['putIn']> = async (id, paths) => {
    const wanted = onlyAttachments(paths, (one) => `${name}: not writing ${one} into ${id}: it is not a session's attachments path`);
    if (wanted.length > 0) await made.putIn(id, wanted);
  };

  /** The same paths taken back out, which is a removal and nothing more. */
  const takeOut: NonNullable<ComputerPort['takeOut']> = async (id, paths) => {
    const wanted = onlyAttachments(paths, (one) => `${name}: not removing ${one} from ${id}: it is not a session's attachments path`);
    if (wanted.length > 0) await made.takeOut(id, wanted);
  };

  /*
   * A folder inside a machine, copied out through the machine's runtime into a
   * scratch folder of this host's and read there, as VS Code reads a plugin's
   * parts where the plugin lives: the copy is gone once `read` is done, read or
   * thrown, and a machine that is not there or a folder it does not hold reads
   * as nothing.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L54-L91
   */
  const readFolder: NonNullable<ComputerPort['readFolder']> = async (id, folder, read) => {
    if (await made.inspect(id) === undefined) return undefined;
    const into = mkdtempSync(join(tmpdir(), 'ahpd-machine-folder-'));
    try {
      if (!await made.copyOut(id, folder, into)) return undefined;
      return await read(join(into, posix.basename(folder)));
    }
    finally {
      rmSync(into, { recursive: true, force: true });
    }
  };

  /**
   * What a command in a machine printed and how it ended, run by the
   * descriptor the machine's runtime answers for it.
   */
  const ranIn = async (id: string, asked: SpawnOptions): Promise<{ code: number; out: string }> => {
    const how = await reach(id, asked);
    if (how === undefined) return { code: 1, out: `There is no computer called ${id}` };
    return await new Promise((done) => {
      execFile(how.command, how.args, {
        encoding: 'utf8',
        timeout: 60_000,
        ...(how.cwd === undefined ? {} : { cwd: how.cwd }),
        ...(how.env === undefined ? {} : { env: { ...process.env, ...how.env } }),
      }, (error, stdout, stderr) => {
        done({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, out: `${stdout}${stderr}`.trim() });
      });
    });
  };

  /** Each machine's home, as the sandbox check inside it read it, which a sandboxed command does not read. */
  const homes = new Map<string, string>();

  /*
   * Whether a computer can host the sandbox runtime, each kind for itself: this
   * host by the runtime's own dependency check and VS Code's bubblewrap probe;
   * a container by its real Docker settings, as VS Code checks a dev container
   * before it treats it as able to host the sandbox, and then by the runtime's
   * own start run inside it; a box or a VM by that start alone.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostService.ts#L498-L504
   */
  const sandboxSupport: NonNullable<ComputerPort['sandboxSupport']> = async (id) => {
    if (id === undefined) return await hostSandboxRefusal();
    const held = await made.inspect(id);
    if (held === undefined) return `There is no computer called ${id}`;
    if (typeof held['HostConfig'] === 'object' && held['HostConfig'] !== null && !isSandboxSupported(JSON.stringify(held))) {
      return `computer://${id} was not made to host the sandbox: its container runs with seccomp, AppArmor or its system paths confined, or without /dev/net/tun`;
    }
    const probed = await ranIn(id, { command: 'sh', args: ['-c', MACHINE_SANDBOX_CHECK] });
    if (probed.code !== 0) return probed.out === '' ? `The sandbox runtime cannot run in computer://${id}` : probed.out;
    homes.set(id, probed.out);
    return undefined;
  };

  /*
   * A command or an MCP server inside the sandbox runtime, with the chat's
   * settings: on this host, the runtime this plugin depends on run with the
   * daemon's Node and its settings written beside it; inside a machine, the
   * runtime's `srt` there, its settings written into the machine by the same
   * command that starts it, which the machine's own runtime reaches.
   */
  const sandboxed: NonNullable<ComputerPort['sandboxed']> = async (id, asked) => {
    const sandbox = asked.sandbox ?? {};
    const { chat, server, unsandboxed, sandbox: _sandbox, ...options } = asked;
    const outside = unsandboxed === true && sandbox.allowUnsandboxedCommands === true;
    if (id === undefined) {
      const place = hostSandboxPlace(chat ?? '', host.configDir);
      const configPath = writeSandboxSettings(place, (path) => sandboxSettingsOf(sandbox, place, options.cwd, path));
      return server === true ? sandboxedServer(place, configPath, options) : sandboxedCommand(place, configPath, options, outside);
    }
    if (!homes.has(id)) {
      const refused = await sandboxSupport(id);
      if (refused !== undefined) throw new Error(refused);
    }
    const home = homes.get(id);
    const place = { execPath: 'node', ...(home === undefined ? {} : { home }), tempDir: sandboxTempDir('/tmp/ahpd-sandbox', chat ?? ''), platform: 'linux' as const };
    const configPath = `${place.tempDir}/settings.json`;
    const settings = JSON.stringify(sandboxSettingsOf(sandbox, place, options.cwd, configPath));
    const inner = server === true ? sandboxedServer(place, configPath, options) : sandboxedCommand(place, configPath, options, outside);
    const how = await reach(id, {
      command: 'sh',
      args: ['-c', MACHINE_SANDBOX_START, 'sh', place.tempDir, settings, inner.command, ...inner.args],
      ...(inner.env === undefined ? {} : { env: inner.env }),
      ...(asked.provider === undefined ? {} : { provider: asked.provider }),
    });
    if (how === undefined) throw new Error(`There is no computer called ${id}`);
    return how;
  };

  host.registerComputers({
    how: reach,
    /*
     * The socket a session in a node runs on, which the node dialled.
     *
     * Only a node's id is this port's to answer: a docker machine or an ssh box
     * is one the proxy starts the old way, and `undefined` is the port's answer
     * for a machine it does not serve - which is what falls back to that start.
     * Nothing of this host's is handed over with it: the node runs its own ahpd
     * and its own harness, in its own folder.
     */
    connect: async (id, asked) => {
      const { runtime: which, name: box } = parseMachineId(id);
      if (joined === undefined || which !== NODE_RUNTIME) return undefined;
      return await joined.connect(box, asked);
    },
    /*
     * Whether the machine is off this host, which its runtime's own answer is.
     *
     * The host asks this before it starts any backend, so a session in a box
     * another host reaches runs nested whatever its backend declared: what
     * cannot be reached is not the agent's to know. The
     * router answers for the id's prefix, so a machine of a runtime this host
     * does not serve is the fallback runtime's answer rather than a throw.
     */
    remote: offHost,
    nested: nestedHost,
    nestedDelete,
    bringBack,
    follow,
    putIn,
    takeOut,
    readFolder,
    sandboxSupport,
    sandboxed,
    /*
     * What a machine is doing, asked before anything is spawned in it.
     *
     * The runtime's own answer, as `agents` below is: a stopped container is
     * still found by the listing the runtime reads, so its state is
     * `stopped` rather than a spawn that fails, and a machine that is gone is
     * `undefined`, which is the answer `how` gives for one.
     */
    state: async (id) => made.state(id),
    /*
     * The agents one was prepared for, read back from its own runtime.
     *
     * The host checks this before a session enters, so an agent is never run
     * in a machine that was made for another; the picker reads the same answer
     * from the listing. Undefined for a machine that is not there, which the
     * `how` above already answers for.
     */
    agents: async (id) => made.agents(id),
    /*
     * And the parts the asking agent needs that the machine was made without,
     * from its runtime's own answer. A runtime that mounts no parts, an ssh
     * box among them, answers nothing, and nothing is checked.
     *
     * Each part need is named as it was for the machine: the value its profile
     * or this plugin's option gives it, else the agent's own. A need whose value
     * is not a part id is refused when a machine is made, and is named here as
     * the agent wrote it.
     */
    partsMissing: async (id, provider) => {
      const has = await made.parts(id);
      const held = await made.inspect(id);
      const needs = host.machineNeeds(provider);
      if (has === undefined || held === undefined || needs === undefined) return undefined;
      const key = profileOf(held);
      const profile = key === undefined ? undefined : profiles?.[key];
      const plain = (values: Record<string, string | SecretRef> | undefined): Record<string, string> =>
        Object.fromEntries(Object.entries(values ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
      const wanted: string[] = [];
      for (const [need, one] of Object.entries(needs)) {
        if (!('part' in one)) continue;
        try {
          wanted.push(...resolveNeeds({ [need]: one }, { profile: plain(profile?.needs), option: plain(needValues) }, undefined, profile?.state ?? 'volume').map((part) => part.source));
        }
        catch {
          wanted.push(one.part);
        }
      }
      return [...new Set(wanted)].filter((part) => !has.includes(part));
    },
    /*
     * And the session a machine is kept for alone, read from the same record.
     *
     * Three halves are needed: a machine is only alone because its profile
     * said so, the session it is alone for is on its own label, and the owner
     * it was built for is on another - a channel is the client's to choose, so
     * a session opened under a disposed one's id spells the same URI and the
     * owner is what tells the two apart. A machine made before either label
     * existed answers nothing, so its own session may still be resumed into it.
     *
     * The daemon that made it is the fourth, and it is said rather than kept
     * quiet: a machine another daemon made is still alone for its own session,
     * and a machine this daemon neither made nor removes is not one to hand out,
     * for the daemon label: a machine made alone for one session refuses another.
     */
    keptFor: async (id) => {
      const held = await made.inspect(id);
      if (held === undefined || disposableOf(held)?.alone !== true) return undefined;
      if (hostOf(held) !== host.hostId) {
        /*
         * Somebody else's, and said so rather than said nothing: a machine made
         * by another daemon is still alone for its own session, and answering
         * nothing would let any session onto a machine built for one.
         */
        return { session: sessionOf(held) ?? '', mine: false };
      }
      const said = await made.owner(id) ?? {};
      return {
        session: sessionOf(held) ?? '',
        ...(said.owner === undefined ? {} : { owner: said.owner }),
      };
    },
    /*
     * And the machine a session starts in, made from what its setting named.
     *
     * The profile says what the machine is; the session says which harness it
     * must run and where it works. `manifestOf` is the one place either is
     * read, so a disposable machine carries the same mounts, the same refused
     * host path and the same `ahpd.agents` label as one made from the form -
     * with `for` standing in for the agents a disposable profile cannot name.
     */
    create: async (asked) => {
      /**
       * What a session is told when its machine cannot be made: the source it
       * asked for, and what stopped it.
       */
      const making = async <T>(work: () => T | Promise<T>): Promise<T> => {
        try { return await work(); }
        catch (error) {
          throw new Error(`The machine for ${asked.source} could not be made: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      /*
       * A folder's own dev container, made when the session starts.
       *
       * The source is `devcontainer://<folder>` and the folder is the whole of
       * what it names; the machine's recipe is the runtime's, so the CLI reads
       * the file. What the session's harness needs is resolved by `manifestOf`
       * exactly as it is for a profile, and the runtime hands the result to the
       * CLI: a mount as `--mount`, a read-only one and an environment need
       * through the override config's own `mounts` and `containerEnv`.
       */
      const devPrefix = 'devcontainer://';
      if (asked.source.startsWith(devPrefix)) {
        const folder = asked.source.slice(devPrefix.length).trim();
        if (!absoluteOnHost(folder)) {
          throw new Error(`devcontainer:// names a folder on this host, and ${folder} is not an absolute path`);
        }
        const answer = folderFor(folder);
        if (typeof answer !== 'string') throw new Error(answer.refusal);
        if (!hasDefinition(answer)) {
          throw new Error(`${answer} has no devcontainer.json or .devcontainer/devcontainer.json, so there is no dev container to make`);
        }
        const id = `${prefix}-${randomUUID().slice(0, 8)}`;
        const work: SecretWork = {
          ...(asked.owner === undefined ? {} : { owner: asked.owner }),
          ...(asked.team === undefined ? {} : { team: asked.team }),
        };
        // No profile stands behind this one, so the machine is made for the
        // session's own harness and for nothing else's needs.
        const forSession = needsFor(asked);
        // The option's values, and under them any secret the harness names as
        // its own default, read for the session's owner the same way.
        const values = await revealed(withDefaults(needValues, [asked.provider], forSession), [asked.provider], forSession, work, secret);
        const spec = manifestOf(id, { data: JSON.stringify({}), encoding: 'utf-8' }, {
          runtime,
          runtimes: Object.keys(runtimes),
          image,
          ...(cpus === undefined ? {} : { cpus }),
          ...(memory === undefined ? {} : { memory }),
          ...(mounts === undefined ? {} : { mounts }),
          bodyMounts,
          ...(images === undefined ? {} : { images }),
          ...(values === undefined ? {} : { needValues: values.values }),
          named: vaultNamed(undefined, values),
          needsOf: forSession,
          for: asked.provider,
          devcontainer: answer,
          // Whose it is, which this machine cannot carry as a label: the record
          // is in the file beside the configuration, keyed by the id the CLI
          // made.
          ...(asked.owner === undefined ? {} : { owner: asked.owner }),
          ...(asked.team === undefined ? {} : { team: asked.team }),
          ...(asked.project === undefined ? {} : { project: asked.project }),
        });
        // One create at a time per runtime, as VS Code queues a source's dev
        // container operations; a session's machine is made as a client's is,
        // with `max` capping the agent's tool alone.
        return queue(made, async () => {
          try {
            // The CLI decides the container's name, so the id is the one it made
            // rather than the one this host suggested.
            return (await made.run({ ...spec, label, ...withGit(asked, answer), ...(asked.sandbox === true ? { sandbox: true } : {}) }, asked.progress)).id;
          }
          catch (error) {
            throw new Error(`The machine for ${asked.source} could not be made: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
      }
      const prefixOf = 'disposable:';
      if (!asked.source.startsWith(prefixOf)) return undefined;
      const key = asked.source.slice(prefixOf.length).trim();
      const known = profiles ?? {};
      const profile = known[key];
      if (profile === undefined) {
        throw new Error(`This host has no profile called ${key}; it has ${Object.keys(known).join(', ') || 'none'}`);
      }
      if (profile.disposable !== true) {
        throw new Error(`profile ${key} is not disposable, so no machine is made from it when a session starts; pick a running computer://<id> or make one from the form`);
      }
      const delay = profile.disposableDelay ?? defaults.disposableDelay;
      const work: SecretWork = {
        ...(asked.owner === undefined ? {} : { owner: asked.owner }),
        ...(asked.team === undefined ? {} : { team: asked.team }),
      };
      // The agents this machine is made for: the profile's own, and the
      // harness the session runs. Their declared needs are the whole of what a
      // value here can land on, so a need only another harness declares is left
      // for the machines that harness is in; a secret one of them names as its
      // own default is read under the option's values.
      const forSession = needsFor(asked);
      const agents = [...(profile.agents ?? []), asked.provider];
      const values = await revealed(withDefaults(needValues, agents, forSession), agents, forSession, work, secret);
      /*
       * Only this profile's needs are read, because only this profile is being
       * made into a machine: a reference in a profile nobody picked is not
       * this machine's to resolve.
       */
      const own = await revealed(profile.needs, agents, forSession, work, secret);
      /*
       * The session's folder wins over the profile's, and is written into the
       * profile rather than the body: a body's `folder` is the deployment's to
       * allow, and this one is the operator's own source plus the host's own
       * session folder.
       *
       * Only where the profile says `sessionFolder`. The folder is the client's
       * and this is the host's filesystem inside a machine, so it reaches one
       * machine the profile opted in. A
       * profile's own `folder` is the operator's and is untouched either way.
       */
      const chosen: Profile = {
        ...profile,
        ...(asked.folder === undefined || profile.sessionFolder !== true ? {} : { folder: asked.folder }),
        ...(own === undefined ? {} : { needs: own.values }),
      };
      /*
       * What of the repository the folder sits in this machine is given, read
       * before the manifest because the manifest folds in the path the runtime
       * mounts for the folder, and that path is what this decides: the
       * repository's root behind `sessionRepository`, and the tree behind
       * `sessionTree`.
       */
      const git = await making(() => withGit(
        asked,
        profile.sessionFolder === true ? asked.folder : undefined,
        profile.gitGuard,
        profile.sessionRepository === true,
        profile.sessionTree,
      ));
      const id = `${prefix}-${randomUUID().slice(0, 8)}`;
      const spec = manifestOf(id, { data: JSON.stringify({ profile: key }), encoding: 'utf-8' }, {
        runtime,
        runtimes: Object.keys(runtimes),
        image,
        ...(cpus === undefined ? {} : { cpus }),
        ...(memory === undefined ? {} : { memory }),
        ...(mounts === undefined ? {} : { mounts }),
        profiles: { ...known, [key]: chosen },
        bodyMounts,
        ...(images === undefined ? {} : { images }),
        ...(values === undefined ? {} : { needValues: values.values }),
        named: vaultNamed(own, values),
        needsOf: forSession,
        for: asked.provider,
        /*
         * Whose the machine is, which the host hands down from the session that
         * asked for it and the machine keeps as a label.
         */
        ...(asked.owner === undefined ? {} : { owner: asked.owner }),
        ...(asked.team === undefined ? {} : { team: asked.team }),
        ...(asked.project === undefined ? {} : { project: asked.project }),
        // The path the runtime mounts for the folder, which is this machine's
        // git: the repository's root where it is given one, and nothing of the
        // folder's under `copy`.
        ...(git.repository === undefined ? {} : { repository: git.repository }),
        ...(git.sessionTree === undefined ? {} : { sessionTree: git.sessionTree }),
      });
      // One create at a time per runtime, as VS Code queues a source's dev
      // container operations; a session's machine is made as a client's is,
      // with `max` capping the agent's tool alone.
      // The id the router spells, which names the runtime a machine made on a
      // box's Docker is on: the name alone would be this host's Docker's.
      const machine = await queue(made, async () => {
        // The runtime's own sentence is kept: it is the only thing that says
        // what Docker refused, and the session reads it as its creation error.
        return making(async () => made.run({
          ...spec,
          label,
          // The repository the session's folder belongs to, behind a gate of
          // its own: `sessionRepository` for the root it sits below and the
          // git directory beside it, `sessionFolder` for the folder.
          ...git,
          disposable: { profile: key, ...(profile.disposableAlone === true ? { alone: true } : {}) },
          // The session this machine is made for, which is what a daemon
          // restarting finds it by, and the daemon making it, which is what
          // keeps it out of a daemon that keeps the same session ids.
          session: asked.session,
          ...(host.hostId === undefined ? {} : { host: host.hostId }),
          // Made to host the sandbox runtime where the session's sandbox is on.
          ...(asked.sandbox === true ? { sandbox: true } : {}),
        }, asked.progress));
      });
      // Watched before the host says the session entered, so a session that
      // never starts still leaves a machine that goes.
      watch(machine.id, key, delay);
      return machine.id;
    },
    /*
     * The count, which only a session starting or a session gone moves.
     *
     * A set of sessions rather than a number, so the same one entering twice -
     * a restart before its first turn, which the host reports as a start like
     * any other - is one user. A session leaving is what starts the delay; one
     * arriving again, the same session after such a restart or another that
     * picked the machine, cancels it.
     *
     * Both wait for the startup listing, which is what fills the book they
     * count in: a session that enters a machine this daemon has not found yet
     * would otherwise be counted against nothing, and the listing would then
     * arm that machine's delay under the session running in it.
     */
    enter: async (id, session) => {
      await listing;
      const held = disposables.get(id);
      if (held === undefined) return;
      held.sessions.add(session);
      if (held.timer !== undefined) {
        clearTimeout(held.timer);
        delete held.timer;
      }
    },
    leave: async (id, session) => {
      await listing;
      const held = disposables.get(id);
      /*
       * A session this machine is not counting is a session saying nothing:
       * the host tells the port about a session that entered one, and a signal
       * that arrives twice or from a machine another daemon owns must not start
       * the delay over a session that is still in there.
       */
      if (held === undefined || !held.sessions.delete(session)) return;
      if (held.sessions.size === 0) arm(id);
    },
  });

  for (const tool of computerTools(made, {
    image,
    max,
    label,
    prefix,
    // The same set the manifest is held to: this path makes a machine without
    // a manifest anywhere near it, which is how the flag check was missed.
    ...(images === undefined ? {} : { images }),
    ...(cpus === undefined ? {} : { cpus }),
    ...(memory === undefined ? {} : { memory }),
  })) {
    host.registerTool(tool);
  }

  /*
   * The dev container launcher.
   *
   * On unless the option says otherwise, because whether a container can be
   * made is a question with an answer rather than a setting: the host asks
   * `available()` before it advertises the capability, so a host with this
   * loaded and no Docker is a host no client offers the flow against. Every
   * part of it is an option, because the program, the image's own host and the
   * plugins that host loads are deployment facts - decision
   * `a-dev-container-is-reached-by-docker-exec`.
   */
  /*
   * The launcher this plugin registered, when it registered one.
   *
   * Held outside the block below because the closer has to end the nested
   * hosts this launcher started, and whether there is a launcher at all is
   * what that block decides.
   */
  let relay: ContainerPort | undefined;

  if (container !== false) {
    /*
     * The computer a folder already is, and whether it is up, so a relay finds
     * rather than makes.
     *
     * The runtime is the only thing that knows what is listed, and the launcher
     * cannot ask it without owning a Docker command of its own - which would be
     * a second place the label is spelled. The same answer names the container
     * a relay just brought up, which is what the launcher's own result calls a
     * container id rather than a machine. A container that is stopped is no
     * computer a command can be run in, so the state is answered too.
     */
    const machineFor = async (folder: string): Promise<{ id: string; running: boolean } | undefined> => {
      const found = (await made.list()).find((one) => one.folder === folder);
      return found === undefined ? undefined : { id: found.id, running: isRunning(found) };
    };

    const launcher = devContainer({
      ...cliOptions,
      ...(hostCommand === undefined ? {} : { host: hostCommand }),
      // The same Docker the listing reads, and not a program named beside it:
      // every command inside the container is a `docker exec` against this one,
      // so a wrapper or a context an operator configured once is in force for
      // the computer as well as for the listing.
      docker: {
        command: held.docker === undefined ? command : held.docker as string,
        args: args ?? [],
        ...(env === undefined ? {} : { env }),
      },
      ...(held.install === undefined || held.install === true ? {} : { install: held.install as string | false }),
      ...(containerPlugins === undefined ? {} : { plugins: containerPlugins }),
      // The same label the computers carry, so the CLI finds the folder's own
      // container rather than making a second one beside it.
      label,
      // The daemon's version, which the server installed inside is pinned to.
      version: host.version,
      existing: machineFor,
      // A container the CLI made for this folder before the labels above were
      // on it, which a listing cannot answer for because the listing is what
      // they are read from.
      adopted: (folder) => adoptedDevContainer(dockeredOptions, folder),
      // An adopted container carries no label this host could find it by, so
      // the record beside the configuration is what makes it a computer: it is
      // listed from there, inspected from there, metered from there and
      // forgotten from there when it is removed.
      onAdopted: (one, id) => {
        claimAdopted(host.configDir, id, one.owner === undefined ? {} : { owner: one.owner }, noted);
      },
      // The computer's vault-named variables, which `up` was never given, so
      // the relay's commands carry them as every other `docker exec` does.
      named: (machine) => namedFor(machine),
      // The probe store, which is the daemon's own file: read for the container
      // a `connect` is about, written when it is one this daemon has not seen.
      probes: {
        of: (id) => probeOf(host.configDir, id, noted),
        keep: (id, probe) => keepProbe(host.configDir, id, probe, noted),
      },
    });

    relay = launcher;
    /*
     * One container operation at a time for each folder: a connect, a stop and
     * a remove of one folder's computer are queued behind each other, as VS
     * Code's dev container host queues them by the folder
     * (devContainerAgentHostService.ts L224, L246, L988-L994 at 6b68d3fe).
     */
    const folders = new SequencerByKey<string>();
    host.registerContainers({
      ...launcher,
      /*
       * The container a connection brought up, as a machine of this host.
       *
       * A relay container is a computer like any other: the host fills the
       * connection's owner into the ask, and the first creator pays, so a
       * container a session made earlier keeps the owner it was made with. Its stretch
       * opens here rather than at the next listing, so a container this
       * connection started is metered from now.
       */
      connect: async (asked, sink) => {
        const answer = folderFor(asked.workspaceFolder);
        if (typeof answer !== 'string') throw new Error(answer.refusal);
        return await folders.queue(answer, async () => {
          const result = await launcher.connect({ ...asked, workspaceFolder: answer }, sink);
          const machine = await machineFor(answer);
          if (machine === undefined) return result;
          if (asked.owner !== undefined) {
            claimOwned(host.configDir, machine.id, { owner: asked.owner }, noted);
          }
          open(machine.id);
          return result;
        });
      },
      /*
       * VS Code's `stop` and `remove`, on the computer a folder is.
       *
       * The folder is resolved the way every other road resolves it, so the
       * machine a folder already is is the one found rather than a second one
       * made beside it. No container of that folder is `true`: there is nothing
       * of this client's running and nothing to take away, which is what the
       * reference host answers for a folder it holds no container for.
       *
       * Both go through `made`'s wrapped `stop` and `remove` rather than the
       * Docker runtime's, so a machine that goes this way closes its stretch and
       * its `computers.json` entry exactly as one destroyed by a `computer://`
       * delete does.
       */
      stop: async (folder) => {
        const at = resolved(folder);
        return await folders.queue(at, async () => {
          const found = await machineFor(at);
          if (found === undefined) return true;
          await made.stop(found.id);
          return true;
        });
      },
      remove: async (folder) => {
        const at = resolved(folder);
        return await folders.queue(at, async () => {
          const found = await machineFor(at);
          if (found === undefined) return true;
          await made.remove(found.id);
          return true;
        });
      },
    });
  }

  /*
   * The root `sandbox` property, VS Code's own: a window forwards its sandbox
   * settings to a host whose root config declares the property, and the
   * switch a chat sets is each backend's own session key.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/agentHostSandboxForwarder.ts#L118-L136
   */
  host.registerProviderConfiguration(sandboxConfiguration);

  if (sessionSetting) {
    if (sessionDefault !== '' && !/^computer:\/\/[^/\s]+$/.test(sessionDefault)) {
      throw new Error(`plugin ${name}: sessionDefault is a computer://<id> URI, and ${sessionDefault} is not one`);
    }
    /*
     * And the machines themselves, as the answers to that key.
     *
     * Without this the key reached every client as a text box: a property with
     * no `enum` is a fact somebody types, so a person had to know a machine's
     * name and spell it. The plugin that named the key is the only thing that
     * knows what is running, and answering here means every client gets the
     * picker rather than the one that wrote code for `computer` by name.
     *
     * Empty is offered first and always, because it is the default and it is
     * the way back: a session with no machine runs on this host.
     *
     * And only the machines prepared for the agent being chosen: the ask
     * carries the `provider`, and a machine made for another one would fail
     * when the session tried to enter it. A machine with no label is one made
     * before this existed and stays offered to every agent, so nothing
     * disappears from a host that has been running for a while.
     */
    host.registerSessionConfig('computer', {
      type: 'string',
      title: 'Computer',
      description: 'The computer://<id> this session runs in. Empty runs it on this host.',
      // Fixed once the session runs: the machine is opened when the backend
      // starts, and a value taken after that would say something the session
      // is not doing. Before the first turn it is still the session being
      // created differently, and the host starts the backend again for it.
      sessionMutable: false,
      ...(sessionDefault === '' ? {} : { default: sessionDefault }),
    }, async (ask) => {
      const running = await made.list();
      const found = running
        .filter((one) => ask.provider === undefined
          || (one.agents ?? []).length === 0
          || (one.agents ?? []).includes(ask.provider))
        // A machine nobody else may run in is not offered: `disposableAlone`
        // is the profile saying this machine belongs to the session it was
        // made for, and a row for it would be a way into somebody's machine.
        .filter((one) => one.disposable?.alone !== true)
        .map((one) => ({
          value: `computer://${one.id}`,
          label: one.id,
          // A dev container's own record is its folder, which is what a person
          // recognises; a machine made from an image has that instead.
          description: [one.folder ?? one.image, one.status].filter((word) => word !== '').join(' · '),
        }))
        .filter((one) => one.value.toLowerCase().includes(ask.query.toLowerCase())
          || one.label.toLowerCase().includes(ask.query.toLowerCase()));
      /*
       * And the session folder's own dev container, when it has one.
       *
       * A folder carrying a `devcontainer.json` may run in the container that
       * file defines, made when the session starts. The row is offered only
       * while no computer is labelled with the folder, so a person who already
       * made it picks the ordinary `computer://` row and nothing is made
       * twice.
       */
      /*
       * The folder the session would work in, which a client sends as a URI.
       *
       * Decoded rather than stripped of a `file://` prefix: a folder with a
       * space in it is written as `%20`, and a strip leaves the escape in the
       * path, which is not the folder's name and is on no allowlist.
       *
       * A URI no path can be read out of - another host's, or one whose name
       * carries a `/` - is not a folder this machine can offer a row for, so it
       * answers no folder rather than taking the whole picker down with it.
       */
      const decoded = (uri: string): string | undefined => {
        try { return fileURLToPath(uri); }
        catch { return undefined; }
      };
      const where = ask.workingDirectory === undefined
        ? undefined
        : ask.workingDirectory.startsWith('file:')
          ? decoded(ask.workingDirectory)
          : ask.workingDirectory;
      const answer = where === undefined || where === '' ? undefined : folderFor(where);
      const fromFolder = answer === undefined || typeof answer !== 'string'
        || !hasDefinition(answer) || running.some((one) => one.folder === answer)
        ? []
        : [{
          value: `devcontainer://${answer}`,
          label: 'Dev container',
          description: `The development container ${answer} defines.`,
        }].filter((one) => one.value.toLowerCase().includes(ask.query.toLowerCase())
          || one.label.toLowerCase().includes(ask.query.toLowerCase()));
      /*
       * And the profiles a session may make a machine from.
       *
       * A disposable profile has no machine yet, so it is offered as the source
       * `disposable:<key>` and the machine is made when the session starts,
       * with that session's harness needs. The label is the profile's title,
       * which is what a person picked in the operator's configuration.
       */
      const sources = Object.entries(profiles ?? {})
        .filter(([, one]) => one.disposable === true)
        .map(([key, one]) => ({
          value: `disposable:${key}`,
          label: one.title ?? key,
          description: one.description ?? `A machine made from ${key} when this session starts.`,
        }))
        .filter((one) => one.value.toLowerCase().includes(ask.query.toLowerCase())
          || one.label.toLowerCase().includes(ask.query.toLowerCase()));
      return [
        ...(ask.query === '' ? [{ value: '', label: 'This host', description: 'Run the session here, in no machine.' }] : []),
        ...found,
        ...fromFolder,
        ...sources,
      ];
    });
  }

  /*
   * What this plugin still owns when the daemon stops.
   *
   * A disposal timer and a nested host child are this plugin's own, and nothing
   * else knows about them: left running they run for the rest of the process's
   * life, which is a machine removed long after anybody asked and a `docker
   * exec` holding the pipes of a container nobody is talking to.
   *
   * The timers are cleared rather than fired. A machine whose delay is cut
   * short is one removed out from under a session that may be resumed when this
   * daemon starts again, and the startup scan hands a machine it finds the
   * delay back. The removals
   * already running are waited for, because half a removal is worse than none:
   * a machine with its work fetched out and its volume still there.
   */
  host.registerClose(async () => {
    closed = true;
    // The scan arms a leftover machine as it finds one, so it has to be over
    // before the timers below are cleared.
    await listing;
    // The check of the boxes goes with the disposal timers: a daemon on its way
    // out is not one whose next check is worth waiting for.
    if (polling !== undefined) {
      clearInterval(polling);
      polling = undefined;
    }
    for (const held of disposables.values()) {
      if (held.timer === undefined) continue;
      clearTimeout(held.timer);
      delete held.timer;
    }
    await Promise.all([...removals]);
    await relay?.close?.();
  });
};

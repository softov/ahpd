import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ComputerPort, MachineNeed, MachineSource, Owner, Plugin, PluginSpec, SecretRef, SecretWork } from '@ahpd/sdk';
import { resolveNeeds, secretRef } from '@ahpd/sdk';
import { cliOf, devContainer, execArgv, hasDefinition, idLabels } from './devcontainer.js';
import type { CliOptions } from './devcontainer.js';
import { computerProvider } from './provider.js';
import { patternOf } from './reference.js';
import { madeAgain, namedAgain, revealed, vaultNamed, withDefaults } from './secrets.js';
import { manifestOf } from './manifest.js';
import { ensureParts, readParts, refusedWithout } from './parts.js';
import type { FolderAnswer, Profile } from './manifest.js';
import { adoptedDevContainer, byName, claimedOf, devcontainerFolder, disposableOf, dockerRuntime, hostOf, inTurn, isRunning, partsHeld, preparedFor, profileOf, reachedDevContainer, roomFor, sessionOf, stateVolumeOf } from './runtime.js';
import type { ComputerRuntime, DockerOptions, MachineSpec } from './runtime.js';
import { claimAdopted, claimOwned, forgetOwned, keepMadeNeeds, keepProbe, madeNeedsOf, ownedOf, probeOf } from './owners.js';
import { computerTools } from './tools.js';
import { hostUser, runsAsHost, userLabelOf } from './gitdir.js';
import type { GitGuard } from './gitdir.js';

/**
 * The package as a plugin.
 *
 * One runtime, one provider for the `computer:` scheme and three tools, all
 * built from the options and registered before the host exists. The runtime is
 * an option rather than a package of its own because a host serves one provider
 * per scheme - decision `one-computer-provider-with-runtimes-as-options`.
 *
 * The options are checked against `optionsSchema` before `apply` runs. The
 * values of a map - `env`, `needs`, a profile - are what the schema cannot
 * describe, so an entry there that cannot be used is dropped rather than fatal.
 */

/** The plugin's id, unique among the plugins a daemon loads. */
export const name = 'ahpd-computer';

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

/** A string field. */
const text = { type: 'string' } as const;

/** A list of strings. */
const list = { type: 'array', items: { type: 'string' } } as const;

/**
 * One machine need's value: the value itself, or the name of a secret it is.
 *
 * `secretAtUse` leaves what was written whole, so a `team:` or a `user:` name
 * survives the loader to reach the machine it is read for. The check still runs
 * against a string, which is what the name is.
 *
 * `writeOnly` because a need's value is the same variable the `env` option
 * holds: a plain value answers `<set>` wherever the options are read back, and
 * a `$secret` reference answers as written, since it is a name and not a value.
 */
const needValue = { type: 'string', secretAtUse: true, writeOnly: true } as const;

/** A set of machine needs, by need name. */
const needValues = { type: 'object', additionalProperties: needValue } as const;

/**
 * The options `apply` receives, as a JSON Schema the daemon checks them against
 * before `apply` runs.
 */
export const optionsSchema = {
  type: 'object',
  properties: {
    runtime: { type: 'string', enum: ['docker'], description: 'Which runtime to use. docker, the only one.' },
    command: { ...text, description: 'The program to run. docker.' },
    args: { ...list, description: 'Arguments before its own, for a wrapper or a context.' },
    env: { type: 'object', additionalProperties: { type: 'string', writeOnly: true }, description: "Environment variables merged over the daemon's. A variable is a credential wherever the image keeps one, so each answers <set>." },
    image: { ...text, description: 'The image a machine is made from when a call names none.' },
    cpus: { ...text, description: 'A CPU limit for every machine this host makes.' },
    memory: { ...text, description: 'A memory limit for every machine this host makes.' },
    max: { type: 'integer', minimum: 1, description: 'How many may exist at once.' },
    label: { ...text, description: 'The label every machine carries.' },
    prefix: { ...text, description: 'What the name of every machine this host makes starts with.' },
    sessionSetting: { type: 'boolean', description: 'Whether a session setting names the machine a session runs in.' },
    sessionDefault: { ...text, description: "That setting's default." },
    needs: { ...needValues, description: "Values for any agent's machine needs, by need name." },
    mounts: { ...list, description: 'What every machine this plugin makes can see.' },
    profiles: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          needs: needValues,
          parts: { ...list, description: 'The parts every machine from this profile carries, by their ids in the versions file.' },
          secretUnreadable: {
            type: 'string',
            enum: ['fail', 'drop'],
            description: 'When a need value named from the vault cannot be read again after a restart: fail every command into the machine, or drop that variable and log it. fail when absent.',
          },
          state: {
            type: 'string',
            enum: ['volume', 'host'],
            description: "Where its agents keep their state: volume, a named volume per provider seeded from this host, or host, this host's own configuration mounted. volume when absent.",
          },
          stateScope: {
            type: 'string',
            enum: ['owner', 'shared'],
            description: 'Who shares a state volume: owner, one per owner of the machine, or shared, one for every owner of the profile. owner when absent.',
          },
          gitGuard: {
            type: 'string',
            enum: ['bind', 'open'],
            description: "How a git directory in a session's machine is guarded: bind, what git on the host runs read-only and every command as the host user, or open, all of it writable. bind when absent.",
          },
        },
      },
      description: 'The named sets a person picks from when making a machine.',
    },
    bodyMounts: { type: 'boolean', description: 'Whether a person making a machine may name mounts of their own.' },
    imageMounts: { type: 'boolean', description: 'Whether a part may be mounted from its own image. false mounts every part from a volume filled once from it.' },
    images: { ...list, description: 'The image patterns a machine may be made from.' },
    devcontainer: {
      type: ['object', 'boolean'],
      properties: {
        command: text,
        args: list,
        host: list,
        env: { type: 'object', additionalProperties: { type: 'string', writeOnly: true } },
        plugins: { type: 'array' },
        docker: text,
        install: { type: ['string', 'boolean'] },
        folders: list,
      },
      description: 'The Dev Container CLI, as a launcher and as a machine maker, and the folders it may make one from; false switches every dev container route off.',
    },
  },
};

const words = (value: unknown): string[] | undefined =>
  (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : undefined);

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
const profilesOf = (value: unknown): Record<string, Profile> | undefined => {
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
      // somewhere else - decision
      // `a-session-folder-reaches-a-machine-only-where-its-profile-allows`.
      ...(said.sessionFolder === true ? { sessionFolder: true } : {}),
      // What a command into one of its machines does when a vault-named value
      // cannot be read again. Absent is `fail`.
      ...(said.secretUnreadable === 'fail' || said.secretUnreadable === 'drop' ? { secretUnreadable: said.secretUnreadable } : {}),
      // Where its agents' state lives, and who shares a state volume. Absent
      // is `volume` and `owner`.
      ...(said.state === 'volume' || said.state === 'host' ? { state: said.state } : {}),
      ...(said.stateScope === 'owner' || said.stateScope === 'shared' ? { stateScope: said.stateScope } : {}),
      // How a git directory in its machines is guarded. Absent is `bind`.
      ...(said.gitGuard === 'bind' || said.gitGuard === 'open' ? { gitGuard: said.gitGuard } : {}),
    };
  }
  return Object.keys(held).length === 0 ? undefined : held;
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
interface Claim {
  /** The owner as the machine carried it, or the host where it carried none. */
  owner: Owner;
  team?: string;
  project?: string;
}

/**
 * The pools a stretch is charged to.
 *
 * The owner as written, the team and the project within it, each only when the
 * record has it - decision
 * `agent-usage-is-charged-to-owner-team-and-project-pools`.
 */
const poolsOf = (claimed: Claim): string[] => [
  claimed.owner,
  ...(claimed.team === undefined ? [] : [`team:${claimed.team}`]),
  ...(claimed.team === undefined || claimed.project === undefined
    ? []
    : [`project:${claimed.team}:${claimed.project}`]),
];

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
 */
const within = (held: Record<string, unknown>, path: string): string | undefined => {
  const mounts = Array.isArray(held.Mounts) ? held.Mounts : [];
  let best: { source: string; target: string } | undefined;
  for (const mount of mounts) {
    if (typeof mount !== 'object' || mount === null) continue;
    const { Source: source, Destination: target } = mount as Record<string, unknown>;
    if (typeof source !== 'string' || typeof target !== 'string' || source === '' || target === '') continue;
    if (path !== source && !path.startsWith(source.endsWith('/') ? source : `${source}/`)) continue;
    if (best === undefined || source.length > best.source.length) best = { source, target };
  }
  if (best === undefined) return undefined;
  const rest = path.slice(best.source.length);
  if (rest === '') return best.target;
  return `${best.target.endsWith('/') ? best.target.slice(0, -1) : best.target}${rest}`;
};

export const apply: Plugin['apply'] = (host, options) => {
  const runtime = options.runtime as 'docker' | undefined ?? defaults.runtime;
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
   * The session setting, which is how a person names the machine a session
   * runs in. Contributed unless the option switches it off, and its default is
   * one machine the operator chose rather than every session sharing one -
   * decision `a-plugin-may-contribute-a-session-key`.
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
      host.log(`${name}: profiles.${key}.parts names ${id}, which the versions file does not, so its machines are made without it`);
    }
    one.parts = one.parts.filter((part) => partIds.has(part));
  }
  /*
   * A `secretUnreadable`, `state`, `stateScope` or `gitGuard` that is neither of its two
   * answers is fatal here rather than dropped: the loader's check does not
   * reach into a profile, and a value read as the default would make a machine
   * other than the one its operator asked for.
   */
  const answers: [field: string, values: [string, string]][] = [
    ['secretUnreadable', ['fail', 'drop']],
    ['state', ['volume', 'host']],
    ['stateScope', ['owner', 'shared']],
    ['gitGuard', ['bind', 'open']],
  ];
  for (const [key, one] of Object.entries(options.profiles as Record<string, unknown> | undefined ?? {})) {
    for (const [field, values] of answers) {
      const said = typeof one === 'object' && one !== null ? (one as Record<string, unknown>)[field] : undefined;
      if (said !== undefined && !values.includes(said as string)) {
        throw new Error(`plugin ${name}: profiles.${key}.${field} is ${values.join(' or ')}, and ${String(said)} is neither`);
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
   * The images a machine may be made from.
   *
   * Absent, any image is allowed, which is what every host did before this
   * existed: naming a set is the operator opting in. A pattern the matcher
   * will not read is fatal here rather than a rule that silently matches
   * nothing - an operator who wrote one meant something by it.
   */
  const images = options.images as string[] | undefined;
  for (const one of images ?? []) {
    try { patternOf(one); }
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
   * nothing to narrow. Naming a set is the opting in.
   */
  const containerFolders = words(held.folders);
  for (const one of containerFolders ?? []) {
    if (!one.startsWith('/')) {
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
   * folder is the whole of what a definition can reach - decision
   * `a-dev-container-is-made-only-from-a-folder-the-operator-allows`.
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
    if (containerFolders === undefined) return here;
    if (containerFolders.some((one) => resolved(one) === here)) return here;
    return { refusal: `This host makes dev containers from ${containerFolders.join(', ')}, and ${here} is not one of them` };
  };

  /** What the daemon's own record said, in this plugin's own log. */
  const noted = (line: string): void => { host.log(`${name}: ${line}`); };

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
    ...(options.imageMounts === false ? { imageMounts: false } : {}),
  };
  const dockered = dockerRuntime(dockeredOptions);

  /*
   * Read one need's value when it names a secret.
   *
   * Handed the host's own `secret` and nothing of this plugin's: the vault is
   * the host's, and a need is read for the machine's owner and team rather than
   * for whoever loaded the option - decision
   * `a-secret-is-named-in-a-host-team-or-user-scope`.
   */
  const secret = async (name: string, work: SecretWork): Promise<string> => host.secret(name, work);

  /*
   * One open stretch of up time per running machine.
   *
   * What a machine costs is known only once it has stopped, so a stretch
   * opens when a machine starts and is written whole when it stops: `at` is when
   * it began and `seconds` how long it ran - decision
   * `a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time`. The
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
   * in neither, and is the host's own. `held` is the machine's record when the
   * caller has already read it.
   */
  const claimOf = async (id: string, held?: Record<string, unknown>): Promise<Claim> => {
    const found = held ?? await dockered.inspect(id);
    const labels = found === undefined ? {} : claimedOf(found);
    const said = labels.owner === undefined ? ownedOf(host.configDir, id, noted) : labels;
    return {
      owner: said?.owner ?? `root:${host.hostName}`,
      ...(said?.team === undefined ? {} : { team: said.team }),
      ...(said?.project === undefined ? {} : { project: said.project }),
    };
  };

  /*
   * The variables each machine holds whose values were read from the vault.
   *
   * Never given when the machine was made, so they are not in its own record,
   * and never written to a file: they live here for as long as this daemon
   * does, and are passed by name on every command run in the machine.
   */
  const vaulted = new Map<string, Record<string, string>>();

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
   */
  const namedFor = async (id: string, found?: Record<string, unknown>): Promise<Record<string, string>> => {
    const known = vaulted.get(id);
    if (known !== undefined) return known;
    const held = found ?? await dockered.inspect(id);
    if (held === undefined) return {};
    const key = profileOf(held);
    const profile = key === undefined ? undefined : profiles?.[key];
    const claimed = await claimOf(id, held);
    const work: SecretWork = { owner: claimed.owner, ...(claimed.team === undefined ? {} : { team: claimed.team }) };
    const recorded = madeNeedsOf(host.configDir, id, noted);
    const read = recorded === undefined
      ? await namedAgain(profile?.needs, needValues, preparedFor(held), (provider) => host.machineNeeds(provider), work, secret)
      : await madeAgain(recorded, work, secret);
    if (read.unread.length === 0) {
      vaulted.set(id, read.env);
      return read.env;
    }
    if (profile?.secretUnreadable !== 'drop') {
      throw new Error(`${id} is not reached without what its vault-named needs give it: ${read.unread.map((one) => one.said).join('; ')}`);
    }
    for (const one of read.unread) noted(`${id} is reached without ${one.variable}: ${one.said}`);
    return read.env;
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
      host.log(`${name}: could not write the up time of ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * The runtime, with a stretch around every change of state.
   *
   * One wrapper rather than one per caller, because a machine can be started,
   * stopped and destroyed by three different things - the `state` leaf a client
   * writes, the tools a model calls, and the timer that takes a disposable away
   * - and up time is the same however it ended.
   */
  const made: ComputerRuntime = {
    ...dockered,
    run: async (asked: MachineSpec) => {
      /*
       * The parts the machine asks for, built before it is made. One that will
       * not build is left out with a line naming it and the build's reason,
       * and the machine is made with the rest: only a session needing the part
       * is refused, by the label that does not name it. A machine made for one
       * session whose own agent needs the part is not made at all, as
       * `refusedWithout` decides.
       */
      let spec = asked;
      if (asked.partsAsked !== undefined && asked.partsAsked.length > 0) {
        const built = await ensureParts(asked.partsAsked, { runtime: dockered });
        const refused = refusedWithout(asked, built.failed.map((one) => one.id));
        if (refused.length > 0) {
          const said = built.failed.filter((one) => refused.includes(one.id)).map((one) => `${one.id}: ${one.reason}`).join('; ');
          throw new Error(`${asked.name} is not made, because ${refused.length === 1 ? 'the part' : 'the parts'} ${refused.join(', ')} this session's agent needs could not be built (${said})`);
        }
        for (const one of built.failed) noted(`${asked.name} is made without the part ${one.id}: ${one.reason}`);
        spec = { ...asked, parts: built.made };
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
      const machine = await dockered.run(spec);
      // What the vault gave, which the runtime left off the make: held for
      // every command into the machine from now on, and its references
      // recorded beside the configuration for a daemon started afterwards.
      const named = new Set((spec.named ?? []).map((one) => one.variable));
      vaulted.set(machine.id, Object.fromEntries(Object.entries(spec.env ?? {}).filter(([key]) => named.has(key))));
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
      return machine;
    },
    start: async (id) => {
      await dockered.start(id);
      open(id);
    },
    restart: async (id) => {
      await close(id, await claimOf(id));
      await dockered.restart(id);
      open(id);
    },
    stop: async (id) => {
      await dockered.stop(id);
      await close(id, await claimOf(id));
    },
    // A command a tool runs is a command in the machine like any other, so it
    // is given the machine's vault-named variables too, under its own.
    exec: async (id, command, env) => dockered.exec(id, command, { ...await namedFor(id), ...(env ?? {}) }),
    remove: async (id) => {
      const claimed = await claimOf(id);
      await dockered.remove(id);
      vaulted.delete(id);
      // The machine is gone, and so is the record kept beside the config: an
      // entry for an id nothing holds is a claim on a machine that may be made
      // again.
      forgetOwned(host.configDir, id, noted);
      await close(id, claimed);
    },
  };

  // The daemon is stopping, so this is the last moment every machine still up
  // can say how long it has been. A crash does not get here, and loses the
  // stretch that was open: a machine up across one is charged nothing until it
  // is next stopped.
  host.on('stopping', async () => {
    for (const id of [...stretches.keys()]) await close(id, await claimOf(id));
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
    const held = disposables.get(id);
    if (held === undefined || held.sessions.size > 0) return;
    if (held.timer !== undefined) clearTimeout(held.timer);
    const timer = setTimeout(() => {
      disposables.delete(id);
      void made.remove(id).then(
        () => { host.log(`${name}: removed the disposable machine ${id}, ${held.delay}ms after its last session`); },
        (error: unknown) => {
          host.log(`${name}: could not remove ${id}: ${error instanceof Error ? error.message : String(error)}`);
        },
      );
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
    if (disposables.has(id)) return;
    const sessions = new Set<string>();
    if (first !== undefined) sessions.add(first);
    disposables.set(id, { profile, delay, sessions });
    arm(id);
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
  const listing = made.list().then(async (found) => {
    for (const one of found) {
      /*
       * A disposable machine names the session it was made for, and only the
       * daemon that made it and keeps that session adopts it: a session id is
       * the client's to choose and two daemons on the same Docker keep
       * sessions under the same ones, so the machine's own `ahpd.host` is what
       * says whose it is - decision
       * `a-daemon-adopts-only-the-disposable-machines-whose-session-it-keeps`.
       */
      const mine = one.host === host.hostId;
      const adopted = one.disposable !== undefined && one.session !== undefined && mine && await host.sessionKept(one.session);
      if (one.disposable !== undefined && one.session !== undefined && !adopted) {
        host.log(mine
          ? `${name}: left the disposable machine ${one.id} alone; ${one.session} is not a session this daemon keeps`
          : `${name}: left the disposable machine ${one.id} alone; it is another daemon's machine`);
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
  }).catch(() => {});

  host.registerResourceProvider('computer', computerProvider(made, {
    image,
    max,
    label,
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
  }));

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
    guard: GitGuard = 'bind',
  ): Pick<MachineSpec, 'gitDir' | 'repository' | 'user' | 'gitGuard'> => {
    if (root === undefined) return {};
    const tree = asked.repository ?? root;
    if (asked.gitDir === undefined) return asked.repository === undefined ? {} : { repository: asked.repository };
    const user = runsAsHost(asked.gitDir, tree, guard) ? hostUser() : undefined;
    return {
      gitDir: asked.gitDir,
      gitGuard: guard,
      ...(asked.repository === undefined ? {} : { repository: asked.repository }),
      ...(user === undefined ? {} : { user }),
    };
  };

  /*
   * How a backend reaches one of these machines.
   *
   * A descriptor rather than a running process: the backend owns the spawn and
   * its stdio, and this only says what to spawn. The machine's own environment
   * travels as `-e NAME` flags, and the descriptor's `env` is the docker
   * program's own with each value laid over it, so no value is in the argv a
   * process list shows - decision `a-backend-reaches-a-computer-through-a-port`.
   * The machine's vault-named variables are among them, under what the caller
   * asked for.
   */
  const reach: ComputerPort['how'] = async (id, asked) => {
    const held = await made.inspect(id);
    if (held === undefined) return undefined;
    const values = { ...await namedFor(id, held), ...(asked.env ?? {}) };
    /** The docker program's own environment, with the values `-e NAME` reads laid over it. */
    const spawnEnvOf = (over: Record<string, string>): Record<string, string> | undefined =>
      (env === undefined && Object.keys(over).length === 0 ? undefined : { ...(env ?? {}), ...over });
    /*
     * Where in the machine to start.
     *
     * A caller that names nowhere gets the machine's own working directory.
     * A caller that names a path names one on *this host*, so it is read
     * through the machine's mounts: covered by one, it is the same place
     * under another name and `-w` takes the inside path; covered by none,
     * there is no such directory in there and the machine's own stands.
     */
    const config = (typeof held.Config === 'object' && held.Config !== null ? held.Config : {}) as Record<string, unknown>;
    const workdir = typeof config.WorkingDir === 'string' && config.WorkingDir !== '' ? config.WorkingDir : undefined;
    const start = (asked.cwd === undefined ? undefined : within(held, asked.cwd)) ?? workdir;
    /*
     * The container Docker knows this machine by, which is not always the name
     * the caller gave: a dev container carries the name its create gave as a
     * label and the CLI named it after the folder, so the `docker exec` is
     * handed the latter - decision
     * `the-name-a-create-gives-a-dev-container-is-a-label-on-it`.
     */
    const at = typeof held.Id === 'string' && held.Id !== '' ? held.Id : id;
    /*
     * A dev container is reached the way the CLI reaches it, which is the same
     * `docker exec` as any other machine with the user and environment its own
     * definition asks for - decision `a-dev-container-is-reached-by-docker-exec`.
     */
    if (devcontainerFolder(held) !== undefined) {
      // Under the machine id the caller gave, which is what a create and the
      // relay keep their probe against, not the container id `held.Id` holds.
      const reached = await reachedDevContainer(dockeredOptions, id, held);
      const into = execArgv({ ...reached, id: at, ...(start === undefined ? {} : { workdir: start }) }, [asked.command, ...(asked.args ?? [])], values);
      const spawnEnv = spawnEnvOf(into.env);
      return {
        command,
        args: [...(args ?? []), ...into.argv],
        ...(spawnEnv === undefined ? {} : { env: spawnEnv }),
      };
    }
    const given = byName(values);
    const spawnEnv = spawnEnvOf(given.env);
    // The user its label names, which a machine with a git directory carries.
    const user = userLabelOf((typeof config.Labels === 'object' && config.Labels !== null ? config.Labels : {}) as Record<string, unknown>);
    return {
      command,
      args: [
        ...(args ?? []),
        'exec', '-i',
        ...(user === undefined ? [] : ['--user', user]),
        ...(start === undefined ? [] : ['-w', start]),
        ...given.flags,
        at,
        asked.command,
        ...(asked.args ?? []),
      ],
      ...(spawnEnv === undefined ? {} : { env: spawnEnv }),
    };
  };

  /*
   * A whole host inside a machine, in stdio mode.
   *
   * What a backend that cannot move its own process asks for: the machine's
   * profile says how its host is started (`host`, default `ahpd`), and this
   * runs `<host> --stdio --plugin <each>` by the same `how` a backend's own
   * command takes - so a dev container is reached through its CLI and an
   * image through Docker without either being spelled twice. The profile is
   * read back from the machine's own label, so a machine found by a daemon
   * that did not make it still starts its own host - decision
   * `a-cofold-session-in-a-computer-runs-in-a-nested-host`.
   */
  const nestedHost: NonNullable<ComputerPort['nested']> = async (id, asked) => {
    const held = await made.inspect(id);
    if (held === undefined) return undefined;
    const key = profileOf(held);
    const host = (key === undefined ? undefined : profiles?.[key]?.host) ?? defaults.host;
    const [program, ...before] = host;
    const spawn = await reach(id, {
      command: program ?? defaults.host[0],
      // One `--plugin` per spec, which is how the daemon's own flag repeats.
      args: [...before, '--stdio', ...asked.plugins.flatMap((plugin) => ['--plugin', plugin])],
      ...(asked.cwd === undefined ? {} : { cwd: asked.cwd }),
    });
    if (spawn === undefined) return undefined;
    /*
     * Where the session works inside: the caller's folder read through the
     * machine's mounts, as `-w` is, or the machine's own directory. The inner
     * session is created there, since the host inside knows only its own paths.
     */
    const config = (typeof held.Config === 'object' && held.Config !== null ? held.Config : {}) as Record<string, unknown>;
    const workdir = typeof config.WorkingDir === 'string' && config.WorkingDir !== '' ? config.WorkingDir : undefined;
    const inside = (asked.cwd === undefined ? undefined : within(held, asked.cwd)) ?? workdir;
    return { ...spawn, ...(inside === undefined ? {} : { workingDirectory: inside }) };
  };

  host.registerComputers({
    how: reach,
    nested: nestedHost,
    /*
     * The agents one was prepared for, read back from its own label.
     *
     * The host checks this before a session enters, so an agent is never run
     * in a machine that was made for another; the picker reads the same label
     * from the listing. Undefined for a machine that is not there, which the
     * `how` above already answers for.
     */
    agents: async (id) => {
      const held = await made.inspect(id);
      return held === undefined ? undefined : preparedFor(held);
    },
    /*
     * And the parts the asking agent needs that the machine was made without,
     * from its `ahpd.parts` label.
     *
     * Each part need is named as it was for the machine: the value its profile
     * or this plugin's option gives it, else the agent's own. A need whose value
     * is not a part id is refused when a machine is made, and is named here as
     * the agent wrote it.
     */
    partsMissing: async (id, provider) => {
      const held = await made.inspect(id);
      const needs = host.machineNeeds(provider);
      if (held === undefined || needs === undefined) return undefined;
      const key = profileOf(held);
      const profile = key === undefined ? undefined : profiles?.[key];
      const plain = (values: Record<string, string | SecretRef> | undefined): Record<string, string> =>
        Object.fromEntries(Object.entries(values ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
      const has = partsHeld(held);
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
     * and a machine this daemon neither made nor removes is not one to hand out
     * - decision
     * `a-daemon-adopts-only-the-disposable-machines-whose-session-it-keeps` for
     * the daemon label, `a-disposable-alone-machine-refuses-another-session`
     * for the refusal.
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
      const said = claimedOf(held);
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
      /*
       * A folder's own dev container, made when the session starts.
       *
       * The source is `devcontainer://<folder>` and the folder is the whole of
       * what it names; the machine's recipe is the runtime's, so the CLI reads
       * the file. What the session's harness needs is resolved by `manifestOf`
       * exactly as it is for a profile, and the runtime hands the result to the
       * CLI: a mount as `--mount`, a read-only one and an environment need
       * through the override config's own `mounts` and `containerEnv` - decision
       * `the-host-hands-an-agents-machine-needs-to-the-machine-maker`.
       */
      const devPrefix = 'devcontainer://';
      if (asked.source.startsWith(devPrefix)) {
        const folder = asked.source.slice(devPrefix.length).trim();
        if (!folder.startsWith('/')) {
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
        // Counted before it is made, and with the same count a write to
        // `computer://<name>` passes: a machine made for a session is a machine
        // this host holds - decision
        // `a-machine-made-for-a-session-counts-against-max-and-needs-computer-write`.
        // The count and the create are one turn, so a second session starting
        // while this one is making its machine counts the machine being made.
        return inTurn(made, async () => {
          const full = roomFor(await made.list(), max);
          if (full !== undefined) {
            throw new Error(`This host holds ${max} computers already, and ${id} would be one more`);
          }
          try {
            // The CLI decides the container's name, so the id is the one it made
            // rather than the one this host suggested.
            return (await made.run({ ...spec, label, ...withGit(asked, answer) })).id;
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
       * machine the profile opted in - decision
       * `a-session-folder-reaches-a-machine-only-where-its-profile-allows`. A
       * profile's own `folder` is the operator's and is untouched either way.
       */
      const chosen: Profile = {
        ...profile,
        ...(asked.folder === undefined || profile.sessionFolder !== true ? {} : { folder: asked.folder }),
        ...(own === undefined ? {} : { needs: own.values }),
      };
      const id = `${prefix}-${randomUUID().slice(0, 8)}`;
      const spec = manifestOf(id, { data: JSON.stringify({ profile: key }), encoding: 'utf-8' }, {
        runtime,
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
         * asked for it and the machine keeps as a label - decision
         * `a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time`.
         */
        ...(asked.owner === undefined ? {} : { owner: asked.owner }),
        ...(asked.team === undefined ? {} : { team: asked.team }),
        ...(asked.project === undefined ? {} : { project: asked.project }),
      });
      // Counted before it is made, and with the same count a write to
      // `computer://<name>` passes: a machine made for a session is a machine
      // this host holds - decision
      // `a-machine-made-for-a-session-counts-against-max-and-needs-computer-write`.
      // The count and the create are one turn, so a second session starting
      // while this one is making its machine counts the machine being made.
      await inTurn(made, async () => {
        const full = roomFor(await made.list(), max);
        if (full !== undefined) {
          throw new Error(`This host holds ${max} computers already, and ${id} would be one more`);
        }
        try {
          await made.run({
            ...spec,
            label,
            // The repository the session's folder belongs to, behind the same
            // gate as the folder.
            ...withGit(asked, profile.sessionFolder === true ? asked.folder : undefined, profile.gitGuard),
            disposable: { profile: key, ...(profile.disposableAlone === true ? { alone: true } : {}) },
            // The session this machine is made for, which is what a daemon
            // restarting finds it by, and the daemon making it, which is what
            // keeps it out of a daemon that keeps the same session ids.
            session: asked.session,
            ...(host.hostId === undefined ? {} : { host: host.hostId }),
          });
        }
        catch (error) {
          // The runtime's own sentence, kept: it is the only thing that says
          // what Docker refused, and the session reads it as its creation error.
          throw new Error(`The machine for ${asked.source} could not be made: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      // Watched before the host says the session entered, so a session that
      // never starts still leaves a machine that goes.
      watch(id, key, delay);
      return id;
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

    const relay = devContainer({
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
      // forgotten from there when it is removed - decision
      // `a-relay-container-is-owned-by-who-connected`.
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

    host.registerContainers({
      ...relay,
      /*
       * The container a connection brought up, as a machine of this host.
       *
       * A relay container is a computer like any other: the host fills the
       * connection's owner into the ask, and the first creator pays, so a
       * container a session made earlier keeps the owner it was made with -
       * decision `a-relay-container-is-owned-by-who-connected`. Its stretch
       * opens here rather than at the next listing, so a container this
       * connection started is metered from now.
       */
      connect: async (asked, sink) => {
        const answer = folderFor(asked.workspaceFolder);
        if (typeof answer !== 'string') throw new Error(answer.refusal);
        const here = { ...asked, workspaceFolder: answer };
        const result = await relay.connect(here, sink);
        const machine = await machineFor(answer);
        if (machine === undefined) return result;
        if (asked.owner !== undefined) {
          claimOwned(host.configDir, machine.id, { owner: asked.owner }, noted);
        }
        open(machine.id);
        return result;
      },
    });
  }

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
       * twice - decision
       * `a-dev-container-is-a-computer-made-from-its-devcontainer-json`.
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
};

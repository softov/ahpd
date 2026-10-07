import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { RpcError } from '@ahpd/sdk';
import { partTarget, resolveNeeds } from '@ahpd/sdk';
import { hasDefinition } from './devcontainer.js';
import { withRequires } from './parts.js';
import { allowedBy, patternOf } from './reference.js';
import type { Reference } from './reference.js';
import type { Write } from '@ahpd/sdk';
import type { MachineNeed, Owner, ResolvedNeed, SecretRef, StateMode } from '@ahpd/sdk';
import type { MachineSpec, PartFallback } from './runtime.js';
import type { SchemeDescription } from '@ahpd/sdk';

/**
 * What a create body says, and what this host does with it.
 *
 * A machine is made by writing to `computer://<name>`, and the body is the
 * manifest: the runtime it comes from, the image, the limits and, when a
 * session is going to live in it, the mounts and the working directory -
 * decision `the-computer-is-an-object-a-person-manages`.
 *
 * The URI names the machine and the body says what to make, which is why the
 * name is not a field: a client that writes to `computer://box` and says
 * `"name": "other"` has said two things and one of them is the address.
 */

/**
 * A named set of machine settings an operator wrote down once.
 *
 * The point is control over what a machine is given rather than convenience:
 * a `claude` profile shares this host's agent configuration, a `plain` one
 * shares nothing, and which a person picked is visible in the object. Every
 * field is what the body would otherwise have to say, so a profile is a
 * default and never a ceiling - a body that names a field overrides it.
 */
export interface Profile {
  /** What a client shows instead of the key. */
  title?: string;
  /** One line about what this profile is for, and what it shares. */
  description?: string;
  image?: string;
  cpus?: string;
  memory?: string;
  mounts?: string[];
  workdir?: string;
  /**
   * The agents this profile prepares the machine for.
   *
   * A machine made from this profile carries what each of them says it needs,
   * rather than the operator listing the same host paths by hand. The names are
   * the agents' `provider` ids, and they are recorded on the machine as its
   * `ahpd.agents` label, which is what the picker and the session check read.
   */
  agents?: string[];
  /**
   * The parts a machine made from this profile carries, by their ids in the
   * versions file, beside the ones its agents' needs name.
   *
   * Each is mounted read-only at `/opt/ahpd/<id>` with the parts it requires,
   * and the machine is labelled `ahpd.parts` with the ones it was made with. A
   * running machine never gains one, so a long-lived machine names here every
   * part a session in it will want.
   */
  parts?: string[];
  /**
   * Values this profile gives those agents' needs, by need name.
   *
   * A value may be the name of a secret rather than the value: whoever picks
   * this profile picks who it is read for, which is not known until the
   * machine is being made - decision
   * `a-secret-is-named-in-a-host-team-or-user-scope`.
   */
  needs?: Record<string, string | SecretRef>;
  /**
   * A host folder to mount at the same path in the machine.
   *
   * Where a session in it works; see `MachineSpec.folder`. Named here so an
   * operator's profile can set it once.
   */
  folder?: string;
  /**
   * How the host inside this machine is started, as a command and its
   * arguments.
   *
   * What a backend that runs nested asks the port for: `<host> --stdio
   * --plugin <each>` is run in the machine, so the image has to carry the
   * program - `ahpd` by default, or a checkout's own entry with `["node",
   * "/work/main.js"]`. The profile is where this belongs because it is the
   * machine's recipe: two profiles can differ in what host their image has.
   */
  host?: string[];
  /**
   * Whether a session that starts may make a machine from this profile.
   *
   * A disposable machine has no machine until a session starts, so the profile
   * is offered in the `computer` picker as `disposable:<profile>` rather than
   * made ahead of time, and it is made with the needs of the harness that
   * session runs - which is why a profile like this names no agents.
   */
  disposable?: boolean;
  /**
   * How long a disposable machine outlives the last session that used it, in
   * milliseconds.
   *
   * Read when the last session is disposed; a session that picks the machine
   * again before then cancels it. Absent means 300000, five minutes.
   */
  disposableDelay?: number;
  /**
   * Whether a machine made from this profile is kept out of the picker.
   *
   * Out of the picker means only the session it was made for runs there: the
   * machine is not listed as a `computer://` row, so no other session can pick
   * it while it is alive. The `disposable:<profile>` row is still offered, so a
   * session can still ask for a machine of its own.
   */
  disposableAlone?: boolean;
  /**
   * Whether a machine made for a session from this profile carries the folder
   * that session works in.
   *
   * Mounted read-write at the same path, so a harness keys its history the same
   * inside and out. It is the client's folder and this is the host's
   * filesystem inside a machine, so it takes the profile saying yes rather than
   * arriving by itself: decision
   * `a-session-folder-reaches-a-machine-only-where-its-profile-allows`. A
   * profile's own `folder` is the operator's and says nothing about this.
   */
  sessionFolder?: boolean;
  /**
   * Whether a machine made for a session from this profile works in the host's
   * tree or in a copy of it.
   *
   * `shared`, the default, binds the tree into the machine at its own path,
   * read-write, so the host sees the agent's edits as it makes them. `copy`
   * gives the machine a checkout of its own in the volume it commits into,
   * mounted at the tree's own path, with nothing of the host's tree bound: the
   * agent's work reaches the host only as the commits ahpd fetches back - so
   * what is still uncommitted when the machine goes is kept as a stash commit
   * under `refs/ahpd/machines/<machine>/uncommitted` - decision
   * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`. A folder
   * that is not a repository has nothing to copy, so a machine asked for one is
   * refused. Meaningless without `sessionFolder`, which is what puts a folder
   * there at all.
   */
  sessionTree?: 'shared' | 'copy';
  /**
   * Whether a machine made for a session from this profile carries the
   * repository that session's folder sits inside.
   *
   * A folder below a repository's root is one git tree, and git works on it
   * from the root: the root is mounted at its own path in place of the folder,
   * which for a session in `~/.config/nvim` is the whole of `$HOME`. That is
   * the host's filesystem inside a machine the same way the folder is, so it
   * takes a profile saying yes of its own rather than coming with the folder:
   * decision `a-session-folder-reaches-a-machine-only-where-its-profile-allows`.
   * Without it the folder alone is mounted, with no git directory, and the
   * daemon logs a line naming the repository that was left out. Meaningless
   * without `sessionFolder`, which is what puts a folder there at all.
   */
  sessionRepository?: boolean;
  /**
   * What a command in a machine from this profile does when a need value named
   * from the vault cannot be read again.
   *
   * Such a value is never kept with the machine on disk, so a daemon that
   * restarted reads it again the first time the machine is reached. `fail`
   * refuses every command into the machine with a sentence naming the need,
   * and the next command tries the read again; `drop` runs the command without
   * that variable and logs a line naming the need. Absent is `fail`, and so is
   * a machine made from no profile.
   */
  secretUnreadable?: 'fail' | 'drop';
  /**
   * Where the agents in a machine from this profile keep their state.
   *
   * `volume`, the default, gives each agent's state need a named volume of its
   * own, seeded from this host and kept across machines, and leaves out every
   * need marked `when: "host"`. `host` mounts this host's own configuration,
   * sign-in included, as the needs marked `when: "host"` say, and makes no
   * state volume.
   */
  state?: StateMode;
  /**
   * Who shares a state volume of this profile.
   *
   * `owner`, the default, gives each owner of a machine from this profile - a
   * person, a bot, an automation or a plugin - a volume of their own per
   * provider, `ahpd-state-<profile>-<owner>-<provider>`. `shared` gives every
   * owner one volume per provider, `ahpd-state-<profile>-<provider>`, for a
   * team that wants one shared bot state.
   */
  stateScope?: 'owner' | 'shared';
  /**
   * How a git directory in a session's machine is guarded: `fetch`, the
   * default, gives the machine a git directory of its own and mounts the
   * host's objects read-only, so the work comes back by fetch; `open` leaves
   * the host's git directory writable in the machine.
   */
  gitGuard?: 'fetch' | 'open';
  /**
   * What deleting a session that ran in a machine from this profile, and is not
   * running, does to the copy the machine keeps.
   *
   * A session no host is running has no close to dispose it, so the daemon
   * starts a host inside the machine for exactly that question - `inside`, the
   * default. `record` deletes the session here and leaves the copy where it is,
   * for a machine somebody works in by hand and comes back to.
   */
  nestedDelete?: 'inside' | 'record';
}

/** What the provider holds, and what a manifest may leave out. */
export interface ManifestDefaults {
  /** The runtime this provider is, which the body must agree with when it says one. */
  runtime: string;
  image: string;
  cpus?: string;
  memory?: string;
  /**
   * Mounts every machine this provider makes carries, before the body's own.
   *
   * The operator's, not the person's: a directory the deployment shares with
   * every machine, such as the agent configuration a harness inside one reads.
   * A body's own mounts are appended, so a machine can add to these; a target
   * two of them share is refused at create rather than resolved by order.
   */
  mounts?: string[];
  /** The named sets a body may pick from, by key. */
  profiles?: Record<string, Profile>;
  /**
   * Whether a create body may name mounts of its own. Off unless an operator
   * says otherwise.
   *
   * A mount is the one field in a body that reaches outside the machine: a
   * body that may name `/:/host` may read and write this host as root, so
   * `computer:write` would be the whole machine rather than a permission over
   * the machines this host makes. Off, what a machine can see is what the
   * deployment's own `mounts` and the profile it was made from say, which is
   * the operator deciding what is shareable and a person picking from it.
   *
   * On is the older behaviour and a reasonable setting for a host with one
   * person on it, where a machine is a convenience rather than a boundary.
   */
  bodyMounts?: boolean;
  /**
   * The images a machine may be made from, as patterns. Absent allows any.
   *
   * An image is code that runs on this host's Docker with whatever a profile
   * mounted into it, so on a deployment that shares an agent configuration
   * inwards the image is the thing being trusted. Absent, any image is
   * allowed, which is what every host did before this existed: naming a set is
   * the operator opting in - decision 1 of `only-the-images-an-operator-named`.
   *
   * The set an operator writes is not the whole set: the host's own default
   * image and every profile's image are allowed too, because a profile names
   * an image precisely so a machine can be made from it.
   */
  images?: string[];
  /**
   * Read one agent's machine needs, as the host knows them.
   *
   * The plugin is handed the host's `machineNeeds`, so a profile that names an
   * agent a host does not have is refused here rather than making a machine
   * with none of what it needed. Read when a body picks the profile, never at
   * load, because the agent may be registered after this plugin.
   */
  needsOf?: (provider: string) => Record<string, MachineNeed> | undefined;
  /**
   * Values the plugin option gives any agent's needs, by need name.
   *
   * Read for every machine this host makes, and so for whichever owner it is
   * made for; see `Profile.needs` for why a value here may be a reference.
   */
  needValues?: Record<string, string | SecretRef>;
  /**
   * The need names whose value, the profile's or the option's, was read from
   * the vault, with the secret each named.
   *
   * Such a need is marked `named` when it is resolved, and the machine's
   * `named` lists it with its variable and secret, so the value is never given
   * when the machine is made.
   */
  named?: ReadonlyMap<string, string>;
  /**
   * One agent whose needs this machine is made with, beside the profile's own.
   *
   * A disposable machine is made for a session, so the harness it must run is
   * the session's and not the profile's: the profile names no agents because
   * it does not know which one will pick it, and this is the one the host
   * named. The result is recorded in the `ahpd.agents` label like any other.
   */
  for?: string;
  /**
   * A folder whose `devcontainer.json` makes this machine.
   *
   * The maker's own source, beside a body's: a session started with a
   * `devcontainer://<folder>` names it here, the way a disposable profile's
   * session folder is written into the profile rather than the body - so the
   * operator's own route is not the gate a hand-written body passes through.
   */
  devcontainer?: string;
  /**
   * The folder a dev container is made from here, resolved, or the sentence for
   * one this host will not build from.
   *
   * The operator's list of folders is the plugin's, so the plugin answers and
   * this only reports it: a create body is a fourth route beside the session
   * setting, the picker's row and a relay's `connect`, and all four go through
   * this one check - decision
   * `a-dev-container-is-made-only-from-a-folder-the-operator-allows`.
   */
  folderFor?: (folder: string) => FolderAnswer;
  /**
   * Whose the machine is, as a typed reference, recorded on it.
   *
   * Whoever asked for it - the connection's owner on a body a person wrote, the
   * session's on one a session asked for - because a machine's up time is
   * charged to its owner and the owner has to outlive the daemon that made it -
   * decision `a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time`.
   * Not a body field: a manifest says what to make, and who asked is not
   * something a client chooses.
   */
  owner?: Owner;
  /**
   * The team and project the asking session's work is charged under, recorded
   * on it beside the owner.
   *
   * A machine made for a session carries the scope that session settled on, so
   * a total for a team says what that team's sessions spent the machines too.
   */
  team?: string;
  /** The project within `team`; team work has none. */
  project?: string;
}

/**
 * The folder a dev container is made from, as the CLI is handed it, or the
 * sentence for one this host will not build from.
 *
 * The maker's answer carries the resolved path rather than the one that was
 * typed, because that path is both the folder the CLI reads the file from and
 * the value of the `ahpd.devcontainer.folder` label it is found by: a symlink
 * and what it points at are one folder, and two spellings of it would give the
 * folder two containers.
 */
export type FolderAnswer = string | { refusal: string };

/**
 * The create body, as a schema a client draws a form from.
 *
 * One source with `manifestOf` below: a field this names is a field that is
 * read, and the default it names is the one the parser would use. The runtime
 * is a field a client sends back unchanged rather than a choice, because this
 * host runs one.
 */
export const MANIFEST_SCHEMA = (
  options: {
    runtime: string;
    image: string;
    profiles?: Record<string, Profile>;
    bodyMounts?: boolean;
    images?: string[];
    /**
     * Whether this host makes dev containers at all. Absent means it does.
     *
     * Off hides `source` and the folder beside it, because a control a client
     * draws and a host refuses is a form that cannot be filled in. The refusal
     * in `manifestOf` is still the gate, for a body written by hand.
     */
    devcontainer?: boolean;
  },
): Record<string, unknown> => {
  const names = Object.keys(options.profiles ?? {});
  /*
   * The images, as choices, but only where every one of them is a name.
   *
   * A set with a wildcard in it is not a list of choices: a client drawing a
   * picker from `node:*` would offer that string, and a machine made from it
   * would be refused by the runtime rather than by this host. So a wildcard
   * anywhere leaves the field a text box, and the refusal is what teaches.
   */
  const allowed = allowedImages(options);
  const choices = allowed === undefined || allowed.names.some((one) => one.includes('*'))
    ? undefined
    : allowed.names;
  return {
  type: 'object',
  properties: {
    /*
     * The profiles this host defines, as an `enum` a client draws a picker
     * from. Absent when the deployment named none, because a picker with no
     * choices is a control that only takes a screen up.
     */
    ...(names.length === 0 ? {} : {
      profile: {
        type: 'string',
        title: 'Profile',
        description: 'What this machine is made from, and what it is given.',
        enum: names,
        // What each one is, so a picker can say more than its key.
        'x-choices': names.map((name) => ({
          value: name,
          title: (options.profiles ?? {})[name]?.title ?? name,
          description: (options.profiles ?? {})[name]?.description,
        })),
      },
    }),
    runtime: {
      type: 'string',
      title: 'Runtime',
      description: 'What makes the machine. This host runs one.',
      enum: [options.runtime],
      default: options.runtime,
    },
    /*
     * The two recipes, as a choice and the two fields beside it, both always
     * drawn. Which of them is read is the host's answer and not the form's -
     * decision `the-computer-form-offers-a-folder-as-a-flat-source-choice`.
     */
    ...(options.devcontainer === false ? {} : {
      source: {
        type: 'string',
        title: 'Source',
        description: 'What the machine is made from.',
        enum: ['image', 'devcontainer'],
        'x-choices': [
          { value: 'image', title: 'Image', description: 'What to make it from.' },
          { value: 'devcontainer', title: 'Dev container', description: "A folder's own devcontainer.json makes it." },
        ],
        default: 'image',
      },
    }),
    image: {
      type: 'string',
      title: 'Image',
      description: 'What to make it from.',
      default: options.image,
      ...(choices === undefined ? {} : { enum: choices }),
    },
    /*
     * The folder, beside the image, as the one string the form sends.
     *
     * Not `folder`, which is a host path made visible inside the machine and is
     * the deployment's to allow; this one is the machine's recipe, and the CLI
     * reads the file it names.
     */
    ...(options.devcontainer === false ? {} : {
      devcontainer: {
        type: 'string',
        title: 'Dev container',
        description: 'A host folder whose devcontainer.json makes the machine.',
      },
    }),
    cpus: { type: 'string', title: 'CPUs', description: 'A number, such as 2.' },
    memory: { type: 'string', title: 'Memory', description: 'A size, such as 512m or 2g.' },
    /*
     * Absent where a body may not name them, so a client drawing a form from
     * this draws no field for something the host would refuse. The refusal in
     * `manifestOf` is the gate: a body written by hand, or by a client that
     * read an older schema, still has to be answered.
     */
    ...(options.bodyMounts !== true ? {} : {
      mounts: {
        type: 'array',
        title: 'Mounts',
        description: 'Host paths made visible in the machine, as "source:target".',
        items: { type: 'string' },
      },
    }),
    workdir: {
      type: 'string',
      title: 'Working directory',
      description: 'An absolute path inside the machine.',
    },
    /*
     * The folder, beside the mounts and gated the same way: it is the host's
     * filesystem inside the machine too, and a body free to name `/` would be
     * the whole host at the same path.
     */
    ...(options.bodyMounts !== true ? {} : {
      folder: {
        type: 'string',
        title: 'Folder',
        description: 'A host folder mounted at the same path inside the machine.',
      },
    }),
  },
  };
};

/**
 * Every image this host allows, as patterns, or nothing for "any".
 *
 * The operator's list plus the host default plus each profile's, deduped with
 * the order kept so a refusal reads in the order somebody wrote them. A
 * deployment that named no list gets `undefined` rather than an empty one:
 * empty would mean "allow nothing", and absent means "never asked".
 */
export const allowedImages = (
  defaults: { image: string; images?: string[]; profiles?: Record<string, Profile> },
): { names: string[]; patterns: Reference[] } | undefined => {
  if (defaults.images === undefined) return undefined;
  const said = [
    ...defaults.images,
    defaults.image,
    ...Object.values(defaults.profiles ?? {}).flatMap((one) => (one.image === undefined ? [] : [one.image])),
  ].filter((one) => one.trim() !== '');
  const names = [...new Set(said)];
  return { names, patterns: names.map((one) => patternOf(one)) };
};

/**
 * Whether a value would be read as a flag where the runtime puts the image.
 *
 * `docker run`'s image sits in the part of the argument list the flag parser
 * still reads, so a value beginning with a dash lands there as a flag and
 * pushes the real image along by one. Shared with the tools, which build a
 * machine without going through a manifest at all.
 */
export const isFlag = (value: string): boolean => value.startsWith('-');

/** A Docker CPU count: a number, optionally fractional. */
const CPUS = /^\d+(?:\.\d+)?$/;

/** A Docker memory limit: a number, optionally with a unit. */
const MEMORY = /^\d+(?:\.\d+)?\s?(?:[kmgt]b?)?$/i;

/** A bind mount, as `source:target` or `source:target:ro`. */
const MOUNT = /^[^:\s]+:[^:\s]+(?::ro)?$/;

/** One string field, or nothing when the body said nothing usable. */
const said = (held: Record<string, unknown>, key: string): string | undefined => {
  const value = held[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

/** Where a `source:target[:ro]` mount lands inside the machine. */
const targetOf = (mount: string): string => mount.split(':')[1] ?? '';

/**
 * The host side of a mount, which has to be an absolute path that is there.
 *
 * Checked at create rather than at load, so a folder made after the daemon
 * started is accepted, and refused with the mount's own words rather than left
 * to the runtime: a relative source is read by Docker as a named volume, and a
 * missing one becomes an empty directory the session finds out about by
 * exiting.
 */
const sourceOf = (mount: string, said: string): void => {
  const source = mount.split(':')[0] ?? '';
  if (!source.startsWith('/')) {
    throw new RpcError(-32602, `${said} names ${source}, which is not an absolute path on this host`);
  }
  if (!existsSync(source)) {
    throw new RpcError(-32602, `${said} names ${source}, and that path is not there`);
  }
};

/**
 * One mount the machine will carry, and the words a refusal about it uses.
 *
 * Every mount is collected before any flag is written, because a runtime's own
 * answer for two mounts at one target is that one of them is not used, and
 * which one is not something this host can see afterwards.
 */
interface Landed {
  /** The mount as the runtime is handed it, `source:target` or `source:target:ro`. */
  mount: string;
  /** Where it lands, which is the thing two of them may not share. */
  target: string;
  /** How this one is named in a sentence: `the profile's mount x`, or `need y`. */
  said: string;
}

/**
 * Refuse a target two mounts land at, unless the two are one statement.
 *
 * The same source, the same target and the same `ro` is one entry rather than a
 * clash: two variants of one plugin declare the same needs, and a profile that
 * mounts Claude's configuration by hand at the need's own target is the machine
 * it meant. What differs is refused with both named, since one of them would
 * silently lose.
 */
const oneMountEach = (landed: Landed[]): void => {
  const seen = new Map<string, Landed>();
  for (const one of landed) {
    const first = seen.get(one.target);
    if (first === undefined) {
      seen.set(one.target, one);
      continue;
    }
    if (first.mount !== one.mount) {
      throw new RpcError(-32602, `${first.said} and ${one.said} both land at ${one.target}`);
    }
  }
};

/**
 * Whether two resolved needs ask for one thing, so a machine carries it once.
 *
 * The one place what counts as the same need is decided. A need's name and
 * description are not compared, since two agents that ask for one thing name it
 * in their own words; everything that reaches the machine is - how it arrives,
 * where, from what, read-only or not, an env need's value, which is compared
 * here and never printed, and a state need's seeds and the provider its volume
 * is named by.
 */
export const sameNeed = (a: ResolvedNeed, b: ResolvedNeed): boolean =>
  a.kind === b.kind
  && a.target === b.target
  && a.source === b.source
  && (a.readOnly === true) === (b.readOnly === true)
  && a.provider === b.provider
  && JSON.stringify(a.seed ?? []) === JSON.stringify(b.seed ?? []);

/**
 * The resolved needs with each repeated one kept once, under the first name.
 *
 * An env need at a variable another already sets, or a state need at a
 * directory another already holds, is dropped when `sameNeed` says it is the
 * same, and refused with both named when it is not, since one of the two would
 * silently lose. Mounts are collapsed by `oneMountEach`, which sees the
 * profile's and the body's mounts beside them.
 */
const oneNeedEach = (resolved: ResolvedNeed[]): ResolvedNeed[] => {
  const kept: ResolvedNeed[] = [];
  for (const one of resolved) {
    if (one.kind !== 'env' && one.kind !== 'state') {
      kept.push(one);
      continue;
    }
    const first = kept.find((held) => held.kind === one.kind && held.target === one.target);
    if (first === undefined) {
      kept.push(one);
      continue;
    }
    if (sameNeed(first, one)) continue;
    throw new RpcError(-32602, one.kind === 'env'
      ? `need ${first.name} and need ${one.name} both set ${one.target}, to different values`
      : `need ${first.name} and need ${one.name} both land at ${one.target}`);
  }
  return kept;
};

/**
 * A write body as text, whatever encoding it arrived in.
 *
 * The one decoder both kinds of write share: a manifest is this parsed as
 * JSON, and a state is this as a word.
 */
export const bodyText = (content: Write): string =>
  (content.encoding === 'base64' ? Buffer.from(content.data, 'base64').toString('utf8') : content.data);

/** The body, decoded and parsed, or a refusal saying what a body is. */
const bodyOf = (content: Write): Record<string, unknown> => {
  const text = bodyText(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text === '' ? '{}' : text);
  }
  catch {
    throw new RpcError(-32602, 'A computer is made from a JSON object: {"image": "...", "cpus": "...", "memory": "...", "mounts": [...], "workdir": "..."}');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RpcError(-32602, 'A computer is made from a JSON object, and that body is not one');
  }
  return parsed as Record<string, unknown>;
};

/**
 * The profile a create body picks, before the body is made into a machine.
 *
 * For whoever has to know it earlier than `manifestOf` does: a need value that
 * names a secret is read for the machine's owner, and only the profile the
 * body picked is this machine's.
 */
export const pickedOf = (content: Write): string | undefined => said(bodyOf(content), 'profile');

/** The strings in an array, or nothing when the field is absent or not one. */
const list = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((one) => typeof one !== 'string')) {
    throw new RpcError(-32602, 'mounts is a list of "source:target" strings');
  }
  return (value as string[]).map((one) => one.trim()).filter((one) => one !== '');
};

/**
 * Which of the two recipes a body chose, when it says one at all.
 *
 * A form draws both fields and sends both, so the choice beside them is what
 * says which of them is read: `image` reads the image fields and ignores the
 * folder, `devcontainer` reads the folder and needs it. A body that names no
 * `source` is read the way it always was, from whichever field it filled in -
 * decision `the-computer-form-offers-a-folder-as-a-flat-source-choice`.
 */
const recipeOf = (held: Record<string, unknown>): 'image' | 'devcontainer' | undefined => {
  const raw = held.source;
  if (raw === undefined) return undefined;
  if (raw !== 'image' && raw !== 'devcontainer') {
    throw new RpcError(-32602, `source is "image" or "devcontainer", and that body says ${JSON.stringify(raw)}`);
  }
  return raw;
};

/**
 * The folder a machine is a dev container of, from the body or the maker.
 *
 * The body's `devcontainer` is the folder itself, as a string, which is what a
 * form sends, or an object naming one, as `{"devcontainer": {"folder":
 * "/path"}}`, which is what a body written by hand sends; a maker's own source
 * is the plain string it was configured with. A folder that is not there, is
 * not absolute, or carries no `devcontainer.json` is refused here, so a body
 * that names one is answered by this host rather than by a CLI a minute later.
 *
 * `required` is a body that chose this recipe rather than a maker configured
 * with a folder: it has to name one itself, because it said it wanted one and
 * saying so is not naming it.
 */
const devcontainerOf = (
  held: Record<string, unknown>,
  defaults: ManifestDefaults,
  required: boolean,
): string | undefined => {
  const raw = held.devcontainer;
  let fromBody: string | undefined;
  if (typeof raw === 'string') {
    // The form's own shape: one field, and blank when nobody filled it in.
    fromBody = said(held, 'devcontainer');
  }
  else if (raw !== undefined) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new RpcError(-32602, 'devcontainer is a folder path, or an object naming one as {"folder": "/path"}, and that body is not one');
    }
    fromBody = said(raw as Record<string, unknown>, 'folder');
    if (fromBody === undefined) {
      throw new RpcError(-32602, 'devcontainer names the folder whose devcontainer.json makes the machine, and that body names none');
    }
  }
  const folder = fromBody ?? defaults.devcontainer;
  if (folder === undefined) {
    if (!required) return undefined;
    throw new RpcError(-32602, 'source says a dev container, and that body names no folder to read a devcontainer.json from');
  }
  if (!folder.startsWith('/')) {
    throw new RpcError(-32602, `devcontainer names a folder on this host, and ${folder} is not an absolute path`);
  }
  const answer = defaults.folderFor?.(folder);
  if (answer !== undefined && typeof answer !== 'string') {
    throw new RpcError(-32602, answer.refusal);
  }
  const there = typeof answer === 'string' ? answer : folder;
  if (!existsSync(there)) {
    throw new RpcError(-32602, `devcontainer names ${there}, and that path is not there`);
  }
  if (!hasDefinition(there)) {
    throw new RpcError(-32602, `devcontainer names ${there}, and it has no devcontainer.json or .devcontainer/devcontainer.json`);
  }
  return there;
};

/**
 * A create body, as a machine to make.
 *
 * Every field is checked here rather than left for the runtime to reject:
 * a manifest that names no image, an image the runtime cannot use, or a limit
 * that is not a number is a sentence about the body, which is more use than
 * a `docker` error naming a flag.
 */
export const manifestOf = (name: string, content: Write, defaults: ManifestDefaults): Omit<MachineSpec, 'label'> => {
  const held = bodyOf(content);

  const runtime = said(held, 'runtime') ?? defaults.runtime;
  if (runtime !== defaults.runtime) {
    throw new RpcError(-32602, `This host runs ${defaults.runtime}, and that body asks for ${runtime}`);
  }

  /*
   * The profile the body picked, which stands behind every field below.
   *
   * Named and unknown is refused rather than ignored: a person who asked for
   * `claude` and silently got a machine with none of its mounts would find out
   * when the agent could not sign in, which is the failure this exists to
   * stop. The names are listed, because a client drawing the picker from the
   * schema and a body written by hand are both possible.
   */
  const picked = said(held, 'profile');
  const known = defaults.profiles ?? {};
  if (picked !== undefined && known[picked] === undefined) {
    const names = Object.keys(known);
    throw new RpcError(-32602, names.length === 0
      ? `This host defines no profiles, and that body asks for ${picked}`
      : `This host has no profile called ${picked}; it has ${names.join(', ')}`);
  }
  const profile: Profile = picked === undefined ? {} : known[picked] ?? {};

  /*
   * The folder whose `devcontainer.json` makes this machine, when that is the
   * recipe: the folder is the source, the CLI reads the file, and no image is
   * named at all - decision
   * `a-dev-container-is-a-computer-made-from-its-devcontainer-json`.
   *
   * The folder is checked here rather than left to the CLI, so a body naming
   * one that is not a dev container is a sentence about the body and no
   * process is spawned for it.
   */
  const source = recipeOf(held);
  const devcontainer = source === 'image' ? undefined : devcontainerOf(held, defaults, source === 'devcontainer');
  let image: string | undefined;
  if (devcontainer === undefined) {
    // Named and blank is a body saying the wrong thing; absent is the default.
    const named = held.image === undefined ? undefined : said(held, 'image');
    if (held.image !== undefined && named === undefined) {
      throw new RpcError(-32602, 'image is a non-empty string, and that body leaves it blank');
    }
    image = named ?? profile.image ?? defaults.image;
    if (image === '') {
      throw new RpcError(-32602, 'A computer is made from an image, and that body names none and this host has no default');
    }
    /*
     * An image is a name, not a flag.
     *
     * It goes into the runtime's argument list in the position where the image
     * belongs, and for `docker run` that position is still inside the part the
     * flag parser reads: a body naming `--privileged` as its image would put a
     * flag there and push the real image along by one. No legal reference
     * begins with a dash, so refusing one costs nothing and closes the position.
     */
    if (isFlag(image)) {
      throw new RpcError(-32602, `image is the name of an image, and ${image} is a flag`);
    }
    /*
     * And one the deployment allows, where it named a set at all.
     *
     * The names are listed, because a person who picked an image this host will
     * not run needs to know what it will. A profile's own image is in the set,
     * so picking a profile is never refused by this.
     */
    const allowed = allowedImages(defaults);
    if (allowed !== undefined && !allowedBy(allowed.patterns, image)) {
      throw new RpcError(-32602, `This host does not run ${image}; it runs ${allowed.names.join(', ')}`);
    }
  }
  else {
    /*
     * An image beside a folder is a body naming two sources, unless it is this
     * host's own default.
     *
     * A form sends every field it drew, filled in or not, so the image field
     * arrives carrying the default beside a folder that was chosen - which is
     * the form's untouched value and not a second choice. An image somebody
     * typed is still refused - decision
     * `the-computer-form-offers-a-folder-as-a-flat-source-choice`.
     */
    const both = said(held, 'image');
    if (both !== undefined && both !== defaults.image) {
      throw new RpcError(-32602, 'A computer is made from an image or from a folder\'s devcontainer.json, and that body names both');
    }
  }

  const cpus = said(held, 'cpus') ?? profile.cpus ?? defaults.cpus;
  if (cpus !== undefined && !CPUS.test(cpus)) {
    throw new RpcError(-32602, `cpus is a number, and ${cpus} is not one`);
  }
  const memory = said(held, 'memory') ?? profile.memory ?? defaults.memory;
  if (memory !== undefined && !MEMORY.test(memory)) {
    throw new RpcError(-32602, `memory is a size such as 512m or 2g, and ${memory} is not one`);
  }

  /*
   * A body's own mounts, where the deployment allows a body to name any.
   *
   * Refused rather than dropped: a person who asked for a directory and
   * silently got a machine without it would find out when whatever they meant
   * to work on was not in there, which is the failure this is here to stop.
   */
  const asked = list(held.mounts);
  if (asked !== undefined && asked.length > 0 && defaults.bodyMounts !== true) {
    const names = Object.keys(known);
    throw new RpcError(-32602, names.length === 0
      ? 'This host takes its mounts from its configuration, and that body names its own'
      : `This host takes its mounts from its profiles, and that body names its own; its profiles are ${names.join(', ')}`);
  }
  for (const mount of asked ?? []) {
    if (!MOUNT.test(mount)) throw new RpcError(-32602, `mounts are "source:target" or "source:target:ro", and ${mount} is neither`);
    sourceOf(mount, `the body's mount ${mount}`);
  }
  for (const mount of profile.mounts ?? []) {
    if (!MOUNT.test(mount)) {
      throw new RpcError(-32602, `profile ${picked ?? ''} names the mount ${mount}, which is not "source:target"`);
    }
    sourceOf(mount, `the profile's mount ${mount}`);
  }
  for (const mount of defaults.mounts ?? []) sourceOf(mount, `the plugin's mount ${mount}`);
  /*
   * The folder a session in this machine works in, mounted at the same path.
   *
   * A body's own is gated like its mounts, and for the same reason: the folder
   * is the host's filesystem inside the machine, and a body free to name `/`
   * would be the whole host at the same path. The profile's is the operator's,
   * so it is always allowed.
   */
  const askedFolder = held.folder === undefined ? undefined : said(held, 'folder');
  if (held.folder !== undefined && askedFolder === undefined) {
    throw new RpcError(-32602, 'folder is a non-empty string, and that body leaves it blank');
  }
  if (askedFolder !== undefined && defaults.bodyMounts !== true) {
    const names = Object.keys(known);
    throw new RpcError(-32602, names.length === 0
      ? 'This host takes its folders from its configuration, and that body names its own'
      : `This host takes its folders from its profiles, and that body names its own; its profiles are ${names.join(', ')}`);
  }
  const folder = askedFolder ?? profile.folder;
  if (folder !== undefined && !folder.startsWith('/')) {
    throw new RpcError(-32602, `folder is an absolute path on this host, and ${folder} is not one`);
  }
  if (folder !== undefined && !existsSync(folder)) {
    throw new RpcError(-32602, `folder names ${folder}, and that path is not there`);
  }

  /*
   * What the agents this profile prepares for say they need.
   *
   * The profile is what names them; each agent answers with its own `machine()`
   * through the host, and a profile's own `needs` and the plugin option's give
   * any of them another value. A name this host has no agent for is refused
   * rather than skipped: a machine made quietly without what it was prepared
   * for is the failure this plan exists to stop.
   *
   * `defaults.for` joins the list, which is how a machine made for a session
   * carries the needs of the harness that session runs rather than of a
   * profile that cannot know it.
   */
  const agents = [...new Set([
    ...(profile.agents ?? []),
    ...(defaults.for === undefined ? [] : [defaults.for]),
  ])];
  const declared: ResolvedNeed[] = [];
  // The agents that declared each variable, which a vault-filled value reaches.
  const variableOwners = new Map<string, Set<string>>();
  // The parts the session's own agent needs, for a machine made for a session.
  const sessionParts: string[] = [];
  for (const provider of agents) {
    const needs = defaults.needsOf?.(provider);
    if (needs === undefined) {
      throw new RpcError(-32602, `profile ${picked ?? ''} prepares a machine for ${provider}, and this host has no agent called ${provider}`);
    }
    try {
      const own = resolveNeeds(needs, {
        // What arrives here is what was written as a value; a value that named
        // a secret was read by the caller, for the machine's owner, and only
        // if an agent on this machine declares its need. So these are the
        // strings `resolveNeeds` works in.
        ...(profile.needs === undefined ? {} : { profile: profile.needs as Record<string, string> }),
        ...(defaults.needValues === undefined ? {} : { option: defaults.needValues as Record<string, string> }),
      }, homedir(), profile.state ?? 'volume');
      // A state need's volume is named by the agent that declared it.
      declared.push(...own.map((one) => (one.kind === 'state' ? { ...one, provider } : one)));
      for (const one of own.filter((need) => need.kind === 'env')) {
        variableOwners.set(one.target, (variableOwners.get(one.target) ?? new Set()).add(provider));
      }
      if (provider === defaults.for) sessionParts.push(...own.filter((one) => one.kind === 'part').map((one) => one.source));
    }
    catch (error) {
      throw new RpcError(-32602, error instanceof Error ? error.message : String(error));
    }
  }
  const resolved = oneNeedEach(declared);
  // A variable whose value the vault gave, which the runtime leaves off the
  // command that makes the machine.
  for (const one of resolved) {
    if (one.kind === 'env' && defaults.named?.has(one.name) === true) one.named = true;
  }
  const named = [...new Map(resolved.flatMap((one) => {
    const secret = one.named === true ? defaults.named?.get(one.name) : undefined;
    const providers = [...variableOwners.get(one.target) ?? []];
    return secret === undefined ? [] : [[one.target, { need: one.name, variable: one.target, secret, providers }] as const];
  })).values()];
  /*
   * The mounts each need becomes, and the two deliveries that are not mounts
   * here: a variable set in the machine, and a path copied into it.
   */
  const needMounts = resolved
    .filter((one) => one.kind === 'directory' || one.kind === 'file')
    .map((one) => `${one.source}:${one.target}${one.readOnly === true ? ':ro' : ''}`);
  const env = Object.fromEntries(
    resolved.filter((one) => one.kind === 'env').map((one) => [one.target, one.source]),
  );
  const copies = resolved
    .filter((one) => one.kind === 'copy')
    .map((one) => ({ source: one.source, target: one.target }));
  const mounts = [...new Set([...(defaults.mounts ?? []), ...(profile.mounts ?? []), ...(asked ?? []), ...needMounts])];
  // Each state directory, which whoever makes the machine gives a named volume.
  const states = resolved
    .filter((one) => one.kind === 'state')
    .map((one) => ({
      need: one.name,
      provider: one.provider ?? '',
      target: one.target,
      ...(one.seed === undefined ? {} : { seed: one.seed }),
    }));
  /*
   * The parts this machine asks for: the profile's own, then each agent's part
   * needs, then what each of those requires. Built by whoever makes the
   * machine, which may leave out one whose build fails.
   */
  const parts = withRequires([
    ...(profile.parts ?? []),
    ...resolved.filter((one) => one.kind === 'part').map((one) => one.source),
  ]);
  /*
   * The host mount a part need names in its place, for a part that will not
   * build: the first need to name one for a part is the one used.
   */
  const partFallbacks: PartFallback[] = [];
  for (const one of resolved) {
    const stand = one.kind === 'part' ? one.fallback : undefined;
    if (stand === undefined || (stand.kind !== 'file' && stand.kind !== 'directory')) continue;
    if (partFallbacks.some((held) => held.part === one.source)) continue;
    const mount = `${stand.source}:${stand.target}${stand.readOnly === true ? ':ro' : ''}`;
    partFallbacks.push({ part: one.source, need: one.name, source: stand.source, target: stand.target, mount });
  }
  /*
   * Every mount this machine will carry, in the order the runtime is given
   * them: the deployment's, the profile's, the body's, then what the agents
   * declared. The same mount is one entry however many say it, since a runtime
   * given `-v` twice for one target refuses the machine; a target two different
   * mounts share is refused here rather than left to the runtime, which answers
   * it by not using one of the two.
   */
  oneMountEach([
    ...(defaults.mounts ?? []).map((one) => ({ mount: one, target: targetOf(one), said: `the plugin's mount ${one}` })),
    ...(profile.mounts ?? []).map((one) => ({ mount: one, target: targetOf(one), said: `the profile's mount ${one}` })),
    ...(asked ?? []).map((one) => ({ mount: one, target: targetOf(one), said: `the body's mount ${one}` })),
    ...resolved
      .filter((one) => one.kind === 'directory' || one.kind === 'file')
      .map((one) => ({
        mount: `${one.source}:${one.target}${one.readOnly === true ? ':ro' : ''}`,
        target: one.target,
        said: `need ${one.name}`,
      })),
    // A copy-in is a `docker cp` on the Docker route and a bind on the CLI's,
    // which has no verb for it - so it joins the list on that route alone.
    ...(devcontainer === undefined
      ? []
      : copies.map((one) => ({ mount: `${one.source}:${one.target}`, target: one.target, said: `the copy from ${one.source}` }))),
    // And the session's folder, at the path it has here, which the Docker route
    // mounts and the CLI's does not: its own file already mounts the workspace.
    ...(devcontainer === undefined && folder !== undefined
      ? [{ mount: `${folder}:${folder}`, target: folder, said: `the folder ${folder}` }]
      : []),
    // And each part, at the one place a part lands; the same part asked twice
    // is one entry.
    ...parts.map((id) => ({ mount: `part:${id}`, target: partTarget(id), said: `the part ${id}` })),
    // And each state volume, already one per directory.
    ...states.map((one) => ({ mount: `state:${one.provider}`, target: one.target, said: `need ${one.need}` })),
    // And each part's fallback, which lands only when its part is left out
    // but is checked as if it always did, so a clash is refused at create.
    ...partFallbacks.map((one) => ({ mount: one.mount, target: one.target, said: `the fallback of need ${one.need}` })),
  ]);
  // A machine with a folder starts a session in it, so a host path inside the
  // folder is the same path in there.
  const workdir = said(held, 'workdir') ?? profile.workdir ?? folder;
  if (workdir !== undefined && !workdir.startsWith('/')) {
    throw new RpcError(-32602, `workdir is an absolute path inside the computer, and ${workdir} is not one`);
  }

  return {
    name,
    // Which profile this machine is, recorded on it: a `host` inside is the
    // profile's to say and cannot be read from the image.
    ...(picked === undefined ? {} : { profile: picked }),
    ...(devcontainer === undefined ? {} : { devcontainer }),
    ...(image === undefined ? {} : { image }),
    ...(cpus === undefined ? {} : { cpus }),
    ...(memory === undefined ? {} : { memory }),
    ...(mounts.length === 0 ? {} : { mounts }),
    ...(Object.keys(env).length === 0 ? {} : { env }),
    ...(named.length === 0 ? {} : { named }),
    ...(copies.length === 0 ? {} : { copies }),
    ...(parts.length === 0 ? {} : { partsAsked: parts }),
    ...(partFallbacks.length === 0 ? {} : { partFallbacks }),
    ...(states.length === 0 ? {} : { statesAsked: states }),
    ...(states.length === 0 || profile.stateScope === undefined ? {} : { stateScope: profile.stateScope }),
    ...(defaults.for === undefined ? {} : { sessionParts: [...new Set(sessionParts)] }),
    ...(agents.length === 0 ? {} : { agents }),
    ...(folder === undefined ? {} : { folder }),
    ...(workdir === undefined ? {} : { workdir }),
    // Who the machine is, which nothing in the body can say: the host hands it
    // down and the machine keeps it.
    ...(defaults.owner === undefined ? {} : { owner: defaults.owner }),
    ...(defaults.team === undefined ? {} : { team: defaults.team }),
    ...(defaults.project === undefined ? {} : { project: defaults.project }),
  };
};

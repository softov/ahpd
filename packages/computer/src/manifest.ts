import { RpcError } from '@ahpd/sdk';
import { allowedBy, patternOf } from './reference.js';
import type { Reference } from './reference.js';
import type { Write } from '@ahpd/sdk';
import type { MachineSpec } from './runtime.js';
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
   * A body's own mounts are appended, so a machine can add to these and the
   * later entry wins wherever a runtime resolves two at one target.
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
}

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
    image: {
      type: 'string',
      title: 'Image',
      description: 'What to make it from.',
      default: options.image,
      ...(choices === undefined ? {} : { enum: choices }),
    },
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

/** The strings in an array, or nothing when the field is absent or not one. */
const list = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((one) => typeof one !== 'string')) {
    throw new RpcError(-32602, 'mounts is a list of "source:target" strings');
  }
  return (value as string[]).map((one) => one.trim()).filter((one) => one !== '');
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

  // Named and blank is a body saying the wrong thing; absent is the default.
  const named = held.image === undefined ? undefined : said(held, 'image');
  if (held.image !== undefined && named === undefined) {
    throw new RpcError(-32602, 'image is a non-empty string, and that body leaves it blank');
  }
  const image = named ?? profile.image ?? defaults.image;
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
  }
  for (const mount of profile.mounts ?? []) {
    if (!MOUNT.test(mount)) {
      throw new RpcError(-32602, `profile ${picked ?? ''} names the mount ${mount}, which is not "source:target"`);
    }
  }
  /*
   * Widest first, so the narrower statement wins where two name one target:
   * the deployment's every machine, then the profile this one was made from,
   * then what this body itself asked for.
   */
  const mounts = [...(defaults.mounts ?? []), ...(profile.mounts ?? []), ...(asked ?? [])];
  const workdir = said(held, 'workdir') ?? profile.workdir;
  if (workdir !== undefined && !workdir.startsWith('/')) {
    throw new RpcError(-32602, `workdir is an absolute path inside the computer, and ${workdir} is not one`);
  }

  return {
    name,
    image,
    ...(cpus === undefined ? {} : { cpus }),
    ...(memory === undefined ? {} : { memory }),
    ...(mounts.length === 0 ? {} : { mounts }),
    ...(workdir === undefined ? {} : { workdir }),
  };
};

import { RpcError } from '@ahpd/sdk';
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

/** What the provider holds, and what a manifest may leave out. */
export interface ManifestDefaults {
  /** The runtime this provider is, which the body must agree with when it says one. */
  runtime: string;
  image: string;
  cpus?: string;
  memory?: string;
}

/**
 * The create body, as a schema a client draws a form from.
 *
 * One source with `manifestOf` below: a field this names is a field that is
 * read, and the default it names is the one the parser would use. The runtime
 * is a field a client sends back unchanged rather than a choice, because this
 * host runs one.
 */
export const MANIFEST_SCHEMA = (options: { runtime: string; image: string }): Record<string, unknown> => ({
  type: 'object',
  properties: {
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
    },
    cpus: { type: 'string', title: 'CPUs', description: 'A number, such as 2.' },
    memory: { type: 'string', title: 'Memory', description: 'A size, such as 512m or 2g.' },
    mounts: {
      type: 'array',
      title: 'Mounts',
      description: 'Host paths made visible in the machine, as "source:target".',
      items: { type: 'string' },
    },
    workdir: {
      type: 'string',
      title: 'Working directory',
      description: 'An absolute path inside the machine.',
    },
  },
});

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

/** The body, decoded and parsed, or a refusal saying what a body is. */
const bodyOf = (content: Write): Record<string, unknown> => {
  const text = content.encoding === 'base64'
    ? Buffer.from(content.data, 'base64').toString('utf8')
    : content.data;
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

  // Named and blank is a body saying the wrong thing; absent is the default.
  const named = held.image === undefined ? undefined : said(held, 'image');
  if (held.image !== undefined && named === undefined) {
    throw new RpcError(-32602, 'image is a non-empty string, and that body leaves it blank');
  }
  const image = named ?? defaults.image;
  if (image === '') {
    throw new RpcError(-32602, 'A computer is made from an image, and that body names none and this host has no default');
  }

  const cpus = said(held, 'cpus') ?? defaults.cpus;
  if (cpus !== undefined && !CPUS.test(cpus)) {
    throw new RpcError(-32602, `cpus is a number, and ${cpus} is not one`);
  }
  const memory = said(held, 'memory') ?? defaults.memory;
  if (memory !== undefined && !MEMORY.test(memory)) {
    throw new RpcError(-32602, `memory is a size such as 512m or 2g, and ${memory} is not one`);
  }

  const mounts = list(held.mounts);
  for (const mount of mounts ?? []) {
    if (!MOUNT.test(mount)) throw new RpcError(-32602, `mounts are "source:target" or "source:target:ro", and ${mount} is neither`);
  }
  const workdir = said(held, 'workdir');
  if (workdir !== undefined && !workdir.startsWith('/')) {
    throw new RpcError(-32602, `workdir is an absolute path inside the computer, and ${workdir} is not one`);
  }

  return {
    name,
    image,
    ...(cpus === undefined ? {} : { cpus }),
    ...(memory === undefined ? {} : { memory }),
    ...(mounts === undefined || mounts.length === 0 ? {} : { mounts }),
    ...(workdir === undefined ? {} : { workdir }),
  };
};

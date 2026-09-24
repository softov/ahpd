/**
 * An image reference, and the patterns an operator allows.
 *
 * A deployment that says which images a machine may be made from is saying
 * what a machine may *be*, next to what `bodyMounts` says it may *see*: an
 * image is code that runs on this host's Docker with whatever the profile
 * mounted into it, so on a host that shares an agent configuration inwards the
 * image is the thing being trusted.
 *
 * Matching is by component and never by string, because the string has traps
 * the grammar does not: `ghcr.io/acme` is a prefix of `ghcr.io/acme-evil` and
 * is not a prefix of anything under `acme`. Splitting on what the reference
 * actually is - a registry, a path, and a tag or a digest - makes the obvious
 * pattern the correct one.
 */

/** Docker Hub, under every name it answers to. */
const HUB = new Set(['docker.io', 'index.docker.io', 'registry-1.docker.io']);

/** What a reference is, once the spellings are folded together. */
export interface Reference {
  /** The registry, always named: an absent one is Docker Hub. */
  registry: string;
  /** The repository path, split on `/`. A bare name on the Hub gains `library`. */
  path: string[];
  /** The tag, or `undefined` for a reference pinned only by digest. */
  tag?: string;
  /** The digest, when one was named. */
  digest?: string;
}

/**
 * Whether the first component of a path is a registry rather than a name.
 *
 * Docker's own rule, and the reason `node/thing` is a Hub repository while
 * `example.com/thing` is not: a first component is a registry when it carries
 * a dot or a colon, or when it is exactly `localhost`.
 */
const isRegistry = (word: string): boolean =>
  word === 'localhost' || word.includes('.') || word.includes(':')
  // A pattern says "any registry" in the registry's own position, and no real
  // reference has a `*` in it, so reading one here costs nothing.
  || word === '*' || word === '**';

/**
 * One reference, parsed and normalised.
 *
 * `node:22`, `library/node:22`, `docker.io/library/node:22` and
 * `index.docker.io/library/node:22` are one image on a real daemon - same
 * digest - so they are one `Reference` here. Without that, a list allowing one
 * spelling refuses the others, which fails closed but teaches an operator that
 * the feature is broken.
 */
export const referenceOf = (said: string): Reference => {
  let rest = said;
  let digest: string | undefined;
  const at = rest.indexOf('@');
  if (at !== -1) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  const parts = rest.split('/');
  const first = parts[0] ?? '';
  const registry = parts.length > 1 && isRegistry(first) ? first : '';
  const path = registry === '' ? parts : parts.slice(1);
  /*
   * The tag is after the last colon of the last component, and only there: a
   * registry's port is a colon too, and it has already been taken off above.
   */
  const last = path[path.length - 1] ?? '';
  const colon = last.lastIndexOf(':');
  let tag: string | undefined;
  if (colon !== -1) {
    tag = last.slice(colon + 1);
    path[path.length - 1] = last.slice(0, colon);
  }
  const hub = registry === '' || HUB.has(registry);
  return {
    registry: hub ? 'docker.io' : registry,
    // A bare name on the Hub is an official image, which lives under `library`.
    path: hub && path.length === 1 ? ['library', ...path] : path,
    ...(tag === undefined ? {} : { tag }),
    ...(digest === undefined ? {} : { digest }),
  };
};

/**
 * A pattern an operator wrote, checked for the one shape that is a trap.
 *
 * A `*` inside a component - `node:22-*` - is partial matching within a name,
 * which is where the subtle holes live, and nothing has asked for it. Refused
 * here rather than read as a literal, so a bad option is a startup error and
 * not a rule that silently matches nothing.
 */
export const patternOf = (said: string): Reference => {
  /*
   * A bare star is everything, spelled the way somebody would guess.
   *
   * Without this it would parse as a name, and a one-component name on the Hub
   * is an official image - so `*` would quietly mean "any official image",
   * which is not what anybody writing it means. A star in the registry's own
   * position is the other half: a namespace wherever it is published.
   */
  if (said === '*' || said === '**') return { registry: '*', path: ['**'] };
  const held = referenceOf(said);
  const words = [held.registry, ...held.path, ...(held.tag === undefined ? [] : [held.tag])];
  for (const word of words) {
    if (word.includes('*') && word !== '*' && word !== '**') {
      throw new Error(`${said} has a * inside ${word}; a * stands for a whole part of a name, as in node:* or ghcr.io/acme/**`);
    }
  }
  return held;
};

/**
 * Whether a pattern's path covers a reference's, component by component.
 *
 * `*` is one component and `**` is any number of them, which matters because
 * registry paths nest: an operator who allows a namespace should not have to
 * know how deep the repositories under it go.
 */
const covers = (pattern: string[], path: string[]): boolean => {
  if (pattern.length === 0) return path.length === 0;
  const [head, ...tail] = pattern;
  if (head === '**') {
    // Every split, shortest first: `**` may stand for nothing at all.
    for (let at = 0; at <= path.length; at++) {
      if (covers(tail, path.slice(at))) return true;
    }
    return false;
  }
  if (path.length === 0) return false;
  if (head !== '*' && head !== path[0]) return false;
  return covers(tail, path.slice(1));
};

/**
 * Whether one pattern allows one image.
 *
 * A pattern that names no tag allows any of them: Docker reads a missing tag
 * as `latest`, but an operator who writes `node` means the image rather than
 * one tag of it. A reference pinned by digest alone is matched on its
 * repository for the same reason - the name is what the pattern governs.
 */
export const allows = (pattern: Reference, image: Reference): boolean => {
  if (pattern.registry !== '*' && pattern.registry !== image.registry) return false;
  if (!covers(pattern.path, image.path)) return false;
  if (pattern.tag === undefined || pattern.tag === '*') return true;
  return pattern.tag === image.tag;
};

/** Whether any of them allows it. An empty list allows nothing. */
export const allowedBy = (patterns: Reference[], said: string): boolean => {
  const image = referenceOf(said);
  return patterns.some((one) => allows(one, image));
};

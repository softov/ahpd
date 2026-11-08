/**
 * An image reference, and the scopes an operator allows.
 *
 * A deployment that says which images a machine may be made from is saying
 * what a machine may *be*, next to what `bodyMounts` says it may *see*: an
 * image is code that runs on this host's Docker with whatever the profile
 * mounted into it, so on a host that shares an agent configuration inwards the
 * image is the thing being trusted.
 *
 * Each entry is a scope of the image policy the containers tools read,
 * containers-policy.json's `docker:` transport: a named reference in its fully
 * expanded form with a tag or a digest is one image, and a prefix of one names
 * a repository, a namespace or a registry host, its port included; `*.` before
 * a domain names every subdomain of it.
 * https://github.com/containers/image/blob/main/docs/containers-policy.json.5.md
 *
 * An image is matched by its own scopes, as containers/image looks one up: its
 * identity, its repository, each namespace above it, its registry, and each
 * wildcard of the registry's domain. Matching whole scopes rather than string
 * prefixes is what keeps `ghcr.io/acme` from allowing `ghcr.io/acme-evil`.
 * https://github.com/containers/image/blob/main/docker/policyconfiguration/naming.go
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
  word === 'localhost' || word.includes('.') || word.includes(':');

/**
 * One reference, parsed and normalised.
 *
 * `node:22`, `library/node:22`, `docker.io/library/node:22` and
 * `index.docker.io/library/node:22` are one image on a real daemon - same
 * digest - so they are one `Reference` here, the fully expanded form the scopes
 * are written in.
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
 * One image's identity, the scope of that image alone: its expanded name with
 * its digest, or with its tag, `latest` where it names neither, as Docker
 * reads a missing tag.
 */
export const identityOf = (image: Reference): string => {
  const name = `${image.registry}/${image.path.join('/')}`;
  return image.digest === undefined ? `${name}:${image.tag ?? 'latest'}` : `${name}@${image.digest}`;
};

/**
 * Every scope one image is matched by, most specific first: its identity, its
 * repository and each namespace above it down to its registry, then `*.` and
 * each domain the registry's host is under, its port left off.
 */
const scopesOf = (image: Reference): string[] => {
  const scopes = [identityOf(image)];
  let name = `${image.registry}/${image.path.join('/')}`;
  for (;;) {
    scopes.push(name);
    const slash = name.lastIndexOf('/');
    if (slash === -1) break;
    name = name.slice(0, slash);
  }
  const colon = name.indexOf(':');
  let host = colon === -1 ? name : name.slice(0, colon);
  for (let dot = host.indexOf('.'); dot !== -1; dot = host.indexOf('.')) {
    host = host.slice(dot + 1);
    scopes.push(`*.${host}`);
  }
  return scopes;
};

/**
 * A scope an operator wrote, checked against the forms the policy reads.
 *
 * The policy names an image in its fully expanded form, so `busybox` and
 * `docker.io/busybox` scope nothing: `docker.io/library/busybox` does. A
 * registry alone is a host name, with a dot or `localhost`, and a port where
 * it has one: a lone `node:22` is an image's name and tag by Docker's
 * grammar, never a registry. A `*` is a scope only as the first label of a
 * domain, as `*.example.com`. A scope in any other form would match no image,
 * so it is refused here, and a bad option is a startup error rather than a
 * rule an operator meant something by that matches nothing.
 */
export const scopeOf = (said: string): string => {
  const refuse = (): never => {
    throw new Error(`${said} is not an image scope: name an image in its fully expanded form, such as docker.io/library/node:22, or a repository, a namespace or a registry of one, or every subdomain of a domain, as *.example.com`);
  };
  if (said.startsWith('*.')) {
    const domain = said.slice(2);
    if (domain === '' || domain.includes('*') || domain.includes('/') || domain.includes(':')) refuse();
    return said;
  }
  if (said.includes('*')) refuse();
  const slash = said.indexOf('/');
  const registry = slash === -1 ? said : said.slice(0, slash);
  const host = registry.split(':')[0] ?? '';
  if (!(host === 'localhost' || host.includes('.')) || (HUB.has(registry) && registry !== 'docker.io')) refuse();
  if (registry === 'docker.io' && slash !== -1 && !said.slice(slash + 1).includes('/')) refuse();
  return said;
};

/** Whether a scope names one image, by a tag or a digest, rather than a repository, a namespace, a registry or a domain. */
export const namesOneImage = (scope: string): boolean => {
  if (scope.startsWith('*.')) return false;
  if (scope.includes('@')) return true;
  const slash = scope.lastIndexOf('/');
  return slash !== -1 && scope.slice(slash + 1).includes(':');
};

/** Whether any of the scopes allows the image. An empty list allows nothing. */
export const allowedBy = (scopes: string[], said: string): boolean => {
  const mine = new Set(scopesOf(referenceOf(said)));
  return scopes.some((one) => mine.has(one));
};

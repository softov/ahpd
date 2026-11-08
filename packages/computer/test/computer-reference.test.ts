import { expect, it } from 'vitest';
import { allowedBy, identityOf, namesOneImage, referenceOf, scopeOf } from '../src/reference.js';

/*
 * What an operator's list of images means: each entry a scope of the image
 * policy the containers tools read, containers-policy.json's `docker:`
 * transport.
 *
 * The counterexamples are the point: a string prefix of `ghcr.io/acme` also
 * matches `ghcr.io/acme-evil`, and an image is looked up by its own scopes,
 * each a whole name. Both are questions about the grammar rather than about
 * the string, so both are asked here on the parser rather than through a
 * provider.
 */

const list = (...said: string[]) => said.map((one) => scopeOf(one));

it('folds the spellings of one image into one reference', () => {
  // Four names, one image: verified against a real daemon, same digest.
  const same = ['node:22', 'library/node:22', 'docker.io/library/node:22', 'index.docker.io/library/node:22']
    .map((one) => referenceOf(one));
  for (const one of same) expect(one).toEqual(same[0]);
  expect(same[0]).toEqual({ registry: 'docker.io', path: ['library', 'node'], tag: '22' });

  // A registry is a first component with a dot, a colon or the name localhost,
  // which is what makes `node/thing` a Hub repository and not a registry.
  expect(referenceOf('registry.example:5000/team/box:1.2')).toEqual({
    registry: 'registry.example:5000', path: ['team', 'box'], tag: '1.2',
  });
  expect(referenceOf('localhost:5000/box')).toMatchObject({ registry: 'localhost:5000', path: ['box'] });
  expect(referenceOf('acme/box')).toMatchObject({ registry: 'docker.io', path: ['acme', 'box'] });

  // A digest is not a tag, and a reference may carry one without the other.
  expect(referenceOf('node@sha256:abc')).toEqual({
    registry: 'docker.io', path: ['library', 'node'], digest: 'sha256:abc',
  });
});

it('names one image by its fully expanded identity, latest where it names no tag', () => {
  expect(identityOf(referenceOf('node'))).toBe('docker.io/library/node:latest');
  expect(identityOf(referenceOf('ghcr.io/acme/box:1'))).toBe('ghcr.io/acme/box:1');
  expect(identityOf(referenceOf('node@sha256:abc'))).toBe('docker.io/library/node@sha256:abc');
});

it('matches an image by a repository, a namespace or a registry above it, never by a string prefix', () => {
  // A namespace covers every repository under it, at any depth.
  expect(allowedBy(list('ghcr.io/acme'), 'ghcr.io/acme/box:1')).toBe(true);
  expect(allowedBy(list('ghcr.io/acme'), 'ghcr.io/acme/team/box:1')).toBe(true);
  // The counterexample: `acme-evil` is a prefix of the string and not a scope.
  expect(allowedBy(list('ghcr.io/acme'), 'ghcr.io/acme-evil/backdoor:1')).toBe(false);
  // A registry covers everything on it, and only on it.
  expect(allowedBy(list('ghcr.io'), 'ghcr.io/box')).toBe(true);
  expect(allowedBy(list('ghcr.io/acme'), 'evil.example/acme/box')).toBe(false);
  // A repository covers each of its tags and digests.
  expect(allowedBy(list('docker.io/library/node'), 'node:18-alpine')).toBe(true);
  expect(allowedBy(list('docker.io/library/node'), 'node@sha256:abc')).toBe(true);
  expect(allowedBy(list('docker.io/library/node'), 'nodejs/node:22')).toBe(false);
});

it('matches one image by its identity alone, whichever way it is spelled', () => {
  expect(allowedBy(list('docker.io/library/node:22'), 'node:22')).toBe(true);
  expect(allowedBy(list('docker.io/library/node:22'), 'index.docker.io/library/node:22')).toBe(true);
  expect(allowedBy(list('docker.io/library/node:22'), 'node:18')).toBe(false);
  // A missing tag is `latest`, as Docker reads one.
  expect(allowedBy(list('docker.io/library/node:latest'), 'node')).toBe(true);
  // A digest is its own identity, apart from any tag.
  expect(allowedBy(list('docker.io/library/node:22'), 'node@sha256:abc')).toBe(false);
  expect(allowedBy(list('docker.io/library/node@sha256:abc'), 'node@sha256:abc')).toBe(true);
});

it('matches every subdomain of a domain by *., the port left off, and allows nothing when empty', () => {
  expect(allowedBy(list('*.example.com'), 'registry.example.com/team/box:1')).toBe(true);
  expect(allowedBy(list('*.example.com'), 'a.b.example.com:5000/box:1')).toBe(true);
  // The domain itself is no subdomain of it.
  expect(allowedBy(list('*.example.com'), 'example.com/box:1')).toBe(false);
  expect(allowedBy([], 'debian:bookworm-slim')).toBe(false);
});

it('refuses a scope the policy does not read, naming the forms it does', () => {
  // Short forms scope nothing: the policy names images fully expanded.
  for (const one of ['node:22', 'docker.io/node', 'index.docker.io/library/node', 'node:*', 'ghcr.io/acme/**', 'example*.*.com', '*.']) {
    expect(() => scopeOf(one)).toThrow(/is not an image scope: name an image in its fully expanded form/);
  }
  for (const one of ['docker.io/library/node:22', 'docker.io/library/node', 'ghcr.io/acme', 'localhost:5000', '*.example.com']) {
    expect(scopeOf(one)).toBe(one);
  }
});

it('tells a scope of one image from a wider one', () => {
  expect(namesOneImage('docker.io/library/node:22')).toBe(true);
  expect(namesOneImage('docker.io/library/node@sha256:abc')).toBe(true);
  expect(namesOneImage('docker.io/library/node')).toBe(false);
  expect(namesOneImage('localhost:5000')).toBe(false);
  expect(namesOneImage('*.example.com')).toBe(false);
});

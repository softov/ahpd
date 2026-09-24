import { expect, it } from 'vitest';
import { allowedBy, patternOf, referenceOf } from '../packages/computer/src/reference.js';

/*
 * What an operator's list of images means.
 *
 * The counterexamples are the point: a string prefix of `ghcr.io/acme` also
 * matches `ghcr.io/acme-evil`, and a list that allows one spelling of an image
 * while refusing three others is a feature an operator turns off. Both are
 * questions about the grammar rather than about the string, so both are asked
 * here on the parser rather than through a provider.
 */

const list = (...said: string[]) => said.map((one) => patternOf(one));

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

it('matches by component, which is what a string prefix gets wrong', () => {
  // The counterexample: `acme-evil` is a prefix match and not a component one.
  expect(allowedBy(list('ghcr.io/acme/*:*'), 'ghcr.io/acme/box:1')).toBe(true);
  expect(allowedBy(list('ghcr.io/acme/*:*'), 'ghcr.io/acme-evil/backdoor:1')).toBe(false);
  // And one `*` is one component, so it does not reach down a level.
  expect(allowedBy(list('ghcr.io/acme/*:*'), 'ghcr.io/acme/team/box:1')).toBe(false);
  expect(allowedBy(list('ghcr.io/acme/**'), 'ghcr.io/acme/team/box:1')).toBe(true);
  // `**` may stand for nothing, and it does not escape the namespace.
  expect(allowedBy(list('ghcr.io/**'), 'ghcr.io/box')).toBe(true);
  expect(allowedBy(list('ghcr.io/acme/**'), 'ghcr.io/other/box')).toBe(false);
  // A registry is matched too: the same path elsewhere is a different image.
  expect(allowedBy(list('ghcr.io/acme/**'), 'evil.example/acme/box')).toBe(false);
});

it('reads a tag the way an operator means it', () => {
  // No tag in the pattern is any tag, not `latest`.
  expect(allowedBy(list('node'), 'node:22')).toBe(true);
  expect(allowedBy(list('node:*'), 'node:18-alpine')).toBe(true);
  expect(allowedBy(list('node:22'), 'node:18')).toBe(false);
  // A name is still a name: a tag pattern does not open the repository up.
  expect(allowedBy(list('node:*'), 'node-evil/x:1')).toBe(false);
  expect(allowedBy(list('node:*'), 'nodejs/node:22')).toBe(false);
  // A digest reference is matched on its repository.
  expect(allowedBy(list('node:*'), 'node@sha256:abc')).toBe(true);
  expect(allowedBy(list('node:22'), 'node@sha256:abc')).toBe(false);
  // The spellings again, through the whole match this time.
  expect(allowedBy(list('node:22'), 'docker.io/library/node:22')).toBe(true);
  expect(allowedBy(list('docker.io/library/node:22'), 'node:22')).toBe(true);
});

it('behaves as an exact match with no wildcard in it, and allows nothing when empty', () => {
  expect(allowedBy(list('debian:bookworm-slim'), 'debian:bookworm-slim')).toBe(true);
  expect(allowedBy(list('debian:bookworm-slim'), 'debian:bookworm')).toBe(false);
  expect(allowedBy([], 'debian:bookworm-slim')).toBe(false);
  // And the ones that allow everything, for a deployment that wants the option
  // present and open. A bare star is not "any official image".
  expect(allowedBy(list('*'), 'anything.example/a/b/c:1')).toBe(true);
  expect(allowedBy(list('*'), 'node:22')).toBe(true);
  expect(allowedBy(list('*/**'), 'anything.example/a/b/c:1')).toBe(true);
  // A namespace wherever it is published, which is the registry star's use.
  expect(allowedBy(list('*/acme/**'), 'ghcr.io/acme/box')).toBe(true);
  expect(allowedBy(list('*/acme/**'), 'ghcr.io/other/box')).toBe(false);
});

it('refuses a pattern with a star inside a name, rather than reading it as one', () => {
  expect(() => patternOf('node:22-*')).toThrow(/has a \* inside 22-\*/);
  expect(() => patternOf('ghcr.io/acme-*/box')).toThrow(/a \* stands for a whole part/);
  // The two legal ones are not refused.
  expect(() => patternOf('node:*')).not.toThrow();
  expect(() => patternOf('ghcr.io/acme/**')).not.toThrow();
});

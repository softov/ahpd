import { expect, it } from 'vitest';
import type { Start } from '../../sdk/src/types/index.js';
import { opened, settled } from './fake-pi.js';

/*
 * Whether pi is told to trust the project it was started in.
 *
 * pi's `projectTrusted` is what lets a folder's own `.pi/extensions` and
 * `.pi/settings.json` load, which is code and configuration a person who did
 * not write the folder has never read. The host answers for a folder and never
 * the folder for itself, so the host's answer is what narrows the session's
 * own `projectTrust` - and an absent answer is untrusted, decision
 * `a-folder-is-untrusted-until-a-client-says-otherwise`.
 */

/** What the backend was opened with, once the session has started a turn. */
const openedWith = async (over: Partial<Start>, projectTrust?: 'trust' | 'deny') => {
  const { session, pi } = opened(over, projectTrust === undefined ? {} : { projectTrust });
  session.begin('t1', 'hello');
  await settled();
  return pi.opens[0];
};

it('does not trust a folder the host did not vouch for, whatever the session says', async () => {
  const backend = await openedWith({ trusted: () => false });
  expect(backend?.trustProject).toBe(false);
});

it('trusts a folder the host vouched for, when the session has no say', async () => {
  const backend = await openedWith({ trusted: () => true });
  expect(backend?.trustProject).toBe(true);
});

it('keeps a denied project denied in a folder the host vouched for', async () => {
  const backend = await openedWith({ trusted: () => true }, 'deny');
  expect(backend?.trustProject).toBe(false);
});

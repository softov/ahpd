/**
 * A plugin that asks its host for a key naming one person.
 *
 * The key is a secret and this fixture does nothing with it but hand it back to
 * the test that loaded the plugin: it is left on `globalThis`, in the daemon's
 * memory and nowhere else, so the test compares it by reference rather than
 * writing it to a file, a log or a snapshot.
 *
 * `person` is the plugin's own option, declared in its manifest, so a test can
 * name somebody the directory has and somebody it does not. The second case
 * throws out of `apply`, which is how a refusal from the host is seen: the
 * loader reports it and the plugin does not load.
 */

import type { Plugin } from '@ahpd/sdk';

export const name = 'person-key';

/** Where the key this run minted is left for the test, in the daemon's memory. */
interface Keys {
  __personKey?: { person: string; key: string };
}

export const apply: Plugin['apply'] = async (host, options) => {
  const person = typeof options['person'] === 'string' ? options['person'] : '';
  const key = await host.personKey(person);
  if (key !== undefined) (globalThis as typeof globalThis & Keys).__personKey = { person, key };
};

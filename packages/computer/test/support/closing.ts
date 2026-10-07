import type { HostOptions } from '../../../sdk/src/types/host.js';

/*
 * What a test made, closed before the folders it wrote into are removed.
 *
 * A host owns work that outlives the call that made it: a session still
 * running, and a plugin's own timers and nested host children, which nothing
 * but the plugin knows about. A test that removes its folder while any of that
 * is alive is the `ENOTEMPTY` this file exists to stop, and the failure lands
 * on whichever test runs next.
 *
 * A load is kept whether or not a host was made from it, because a load on its
 * own has already started work: it reads what is out there and arms what it
 * finds. A load a host was made from is closed through that host, which runs
 * the load's closers itself.
 */

/** Anything with a close: a host, as `createHost` answers one. */
interface Host {
  close: () => Promise<void>;
}

/** A launcher, or anything else with a close that owns no sessions. */
interface Port {
  close?: () => Promise<void>;
}

/** A load, and the host made from it when one was. */
interface Kept {
  load: HostOptions;
  host?: Host;
}

const kept: Kept[] = [];
const ports: Port[] = [];

/**
 * Keep a load, and the host a test made from it.
 *
 * Called once where the load is made, and again with the host when one is made
 * from it. The host's options may be a spread of the load's, which shares the
 * closers between the two, so a load whose closers ran with its host is not
 * run a second time.
 */
export const keeping = (load: HostOptions, host?: Host): void => {
  kept.push(host === undefined ? { load } : { load, host });
};

/**
 * Keep a launcher that no host was given.
 *
 * Closed after every host and every load, because the closer of a plugin whose
 * host ran may end the same one.
 */
export const keepingPort = (port: Port): void => {
  ports.push(port);
};

/** Close everything kept: every host, then every load no host closed, then the launchers. */
export const closeAll = async (): Promise<void> => {
  const going = kept.splice(0);
  const launchers = ports.splice(0);
  const closed = new Set<readonly unknown[]>();
  for (const one of going) {
    if (one.host === undefined) continue;
    if (one.load.closers !== undefined) closed.add(one.load.closers);
    await one.host.close();
  }
  for (const one of going) {
    const closers = one.load.closers;
    if (one.host !== undefined || closers === undefined || closed.has(closers)) continue;
    for (const { close } of closers) await close();
  }
  for (const one of launchers) await one.close?.();
};

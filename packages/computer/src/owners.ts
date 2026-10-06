import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Owner } from '@ahpd/sdk';
import type { Probe } from './devcontainer.js';
import { ownerSaid } from './runtime.js';

/**
 * The halves of a machine that live beside the daemon's own configuration.
 *
 * A `docker run` machine carries its creator as a label, so the label is the
 * whole of that record. The Dev Container CLI labels a container only through
 * `--id-label`, which is also how it finds the container a folder already has:
 * an owner among them would give a folder a second container and leave the
 * folder's lookup matching two - decision
 * `a-dev-container-owner-is-kept-beside-the-config`.
 *
 * The probed environment is here for the same reason and one more: the CLI
 * keeps no probe its own `exec` could read back, so a container made before
 * this, or by a daemon that lost the file, is only reachable with its user's
 * shell run in there again.
 *
 * The vault-named needs a machine was made with are here as references, so a
 * daemon started afterwards reads the same secrets again for it: the values
 * are never kept, and the needs a session's harness declared are not
 * necessarily the ones the host's agents declare now.
 *
 * So this is where the other halves live, one file beside the daemon's own
 * configuration keyed by machine id. A machine this file has no entry for is
 * charged to the host and probed on its first reach, which is what a container
 * made outside ahpd has always been.
 */

/** The file, in the folder the daemon keeps its own configuration in. */
export const OWNERS_FILE = 'computers.json';

/** Who a machine belongs to, and what its work is charged under. */
export interface Owned {
  owner: Owner;
  team?: string;
  project?: string;
}

/** One need a machine was made with whose value the vault gave, as a reference. */
export interface MadeNeed {
  /** The need's name. */
  need: string;
  /** The variable it sets in the machine. */
  variable: string;
  /** The secret it names, never the value read. */
  secret: string;
}

/** What one machine's entry holds, any part of which may be absent. */
interface Entry {
  owner?: Owner;
  team?: string;
  project?: string;
  probe?: Probe;
  adopted?: true;
  needs?: MadeNeed[];
}

/** One line, for a file that could not be read or written. */
const complain = (log: (line: string) => void, what: string, why: unknown): void =>
  log(`${what} ${OWNERS_FILE}: ${why instanceof Error ? why.message : String(why)}`);

/** The file itself. */
const at = (configDir: string): string => join(configDir, OWNERS_FILE);

/**
 * What one entry holds, or nothing when it is neither half.
 *
 * The owner is held to the spelling a reference has everywhere else, so a file
 * a person has edited by hand is read as what it says rather than charged to
 * somebody the usage rules do not know.
 */
const entry = (said: unknown): Entry | undefined => {
  if (typeof said !== 'object' || said === null || Array.isArray(said)) return undefined;
  const one = said as Record<string, unknown>;
  const owner = ownerSaid(one.owner);
  const team = one.team;
  const project = one.project;
  const adopted = one.adopted === true;
  const probe = ((): Probe | undefined => {
    if (typeof one.probe !== 'object' || one.probe === null || Array.isArray(one.probe)) return undefined;
    const held = one.probe as Record<string, unknown>;
    if (typeof held.container !== 'string' || typeof held.env !== 'object' || held.env === null || Array.isArray(held.env)) {
      return undefined;
    }
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(held.env as Record<string, unknown>)) {
      if (typeof value === 'string') env[key] = value;
    }
    return { container: held.container, env };
  })();
  const needs = Array.isArray(one.needs)
    ? one.needs.flatMap((held: unknown): MadeNeed[] => {
      if (typeof held !== 'object' || held === null) return [];
      const { need, variable, secret } = held as Record<string, unknown>;
      return typeof need === 'string' && typeof variable === 'string' && typeof secret === 'string'
        ? [{ need, variable, secret }]
        : [];
    })
    : undefined;
  if (owner === undefined && probe === undefined && !adopted && needs === undefined) return undefined;
  return {
    ...(owner === undefined ? {} : { owner }),
    ...(typeof team === 'string' && team !== '' ? { team } : {}),
    ...(typeof project === 'string' && project !== '' ? { project } : {}),
    ...(probe === undefined ? {} : { probe }),
    ...(adopted ? { adopted } : {}),
    ...(needs === undefined ? {} : { needs }),
  };
};

/** Every machine this file says something about. */
const read = (configDir: string, log: (line: string) => void): Record<string, Entry> => {
  let text: string;
  try { text = readFileSync(at(configDir), 'utf8'); }
  catch (error) {
    // No file is a file with no entries, which is every host that has not
    // written one yet.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    // Said rather than thrown: a file that is missing, unreadable or is not
    // JSON leaves no owner to name, and a meter that stopped over it would
    // lose the stretches of every machine it still has.
    complain(log, 'could not read', error);
    return {};
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch (error) {
    complain(log, 'could not read', error);
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    complain(log, 'could not read', new Error('the top of it is not an object of machines'));
    return {};
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .flatMap(([id, one]) => {
        const held = entry(one);
        return held === undefined ? [] : [[id, held] as const];
      }),
  );
};

/**
 * Replace the file with these records.
 *
 * Written whole beside it and renamed over, so a reader - this daemon, or the
 * next one - never sees half a set of owners. A write refused is said and
 * dropped: the machine is already made, and failing the create over a record of
 * who made it would be worse than the record.
 */
const write = (configDir: string, held: Record<string, Entry>, log: (line: string) => void): void => {
  const path = at(configDir);
  try {
    mkdirSync(configDir, { recursive: true });
    // 0600, as the daemon's own records are: who owns a machine is not
    // everybody's business on a host with more than one person on it, and a
    // probed environment is what a user's shell was holding.
    const scratch = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(scratch, `${JSON.stringify(held, null, 2)}\n`, { mode: 0o600 });
    renameSync(scratch, path);
  }
  catch (error) {
    complain(log, 'could not write', error);
  }
};

/** Who a machine is recorded as belonging to, or nothing when it is not in the file. */
export const ownedOf = (configDir: string, id: string, log: (line: string) => void): Owned | undefined => {
  const held = read(configDir, log)[id];
  return held?.owner === undefined ? undefined : {
    owner: held.owner,
    ...(held.team === undefined ? {} : { team: held.team }),
    ...(held.project === undefined ? {} : { project: held.project }),
  };
};

/**
 * Record who a machine the Dev Container CLI made belongs to, unless it is
 * already recorded.
 *
 * The first creator pays: a folder keeps the one container it has, and whoever
 * brought it up first is the one whose time it is. A record already there is
 * left exactly as it is, which is what a machine a session made earlier is
 * charged to.
 */
export const claimOwned = (configDir: string, id: string, said: Owned, log: (line: string) => void): void => {
  const held = read(configDir, log);
  if (held[id]?.owner !== undefined) return;
  write(configDir, { ...held, [id]: { ...held[id], ...said } }, log);
};

/**
 * The containers a connect adopted, by the id each was found under.
 *
 * An adopted container carries no `ahpd.computer` label and never will: Docker
 * cannot add one to a container that already exists, and the CLI is not asked
 * again or it would make a second container beside it. The record here is what
 * makes it listed and inspected like any other machine, under the person whose
 * connect adopted it - decision `a-relay-container-is-owned-by-who-connected`.
 */
export const adoptedOf = (configDir: string, log: (line: string) => void): string[] =>
  Object.entries(read(configDir, log))
    .flatMap(([id, held]) => held.adopted === true ? [id] : []);

/**
 * Record a container a connect adopted, and who adopted it when the connect
 * carried anybody.
 *
 * Written under the container id, which is the machine id it has for the rest
 * of its life, and the record a listing and an up-time stretch read it from.
 * Recorded with no owner as well, as a relay container whose connect carried
 * none is: it is still a computer, listed and found again by its folder, and
 * its time is the host's. An owner already recorded is kept, so the first
 * person to adopt it is the one it is charged to.
 */
export const claimAdopted = (
  configDir: string,
  id: string,
  said: Partial<Owned>,
  log: (line: string) => void,
): void => {
  const held = read(configDir, log);
  const was = held[id];
  if (was?.adopted === true && (was.owner !== undefined || said.owner === undefined)) return;
  write(configDir, { ...held, [id]: { ...was, ...(was?.owner === undefined ? said : {}), adopted: true } }, log);
};

/**
 * What one userEnvProbe run found for a machine, or nothing when this file has
 * none for it.
 */
export const probeOf = (configDir: string, id: string, log: (line: string) => void): Probe | undefined =>
  read(configDir, log)[id]?.probe;

/**
 * Keep what one userEnvProbe run found, against the container it was taken for.
 *
 * The container is recorded beside it so a container made again is probed
 * again: the probe is what the user's shell was holding when the container was
 * made, and a container the CLI has since replaced has a shell that has since
 * been started afresh.
 */
export const keepProbe = (
  configDir: string,
  id: string,
  probe: Probe,
  log: (line: string) => void,
): void => {
  const held = read(configDir, log);
  write(configDir, { ...held, [id]: { ...held[id], probe } }, log);
};

/**
 * The vault-named needs a machine was made with, or nothing when this file has
 * none for it: a machine made with none, or made before they were recorded.
 */
export const madeNeedsOf = (configDir: string, id: string, log: (line: string) => void): MadeNeed[] | undefined =>
  read(configDir, log)[id]?.needs;

/**
 * Record the vault-named needs a machine was made with, by need, variable and
 * the secret each names. The values read are never written here.
 */
export const keepMadeNeeds = (
  configDir: string,
  id: string,
  needs: readonly MadeNeed[],
  log: (line: string) => void,
): void => {
  const held = read(configDir, log);
  write(configDir, { ...held, [id]: { ...held[id], needs: needs.map(({ need, variable, secret }) => ({ need, variable, secret })) } }, log);
};

/** Forget a machine, which is what its being removed means. */
export const forgetOwned = (configDir: string, id: string, log: (line: string) => void): void => {
  const held = read(configDir, log);
  if (held[id] === undefined) return;
  const rest = { ...held };
  delete rest[id];
  write(configDir, rest, log);
};
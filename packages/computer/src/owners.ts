import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Owner } from '@ahpd/sdk';
import { ownerSaid } from './runtime.js';

/**
 * The owners of the machines whose owner is not on the machine.
 *
 * A `docker run` machine carries its creator as a label, so the label is the
 * whole of that record. The Dev Container CLI labels a container only through
 * `--id-label`, which is also how it finds the container a folder already has:
 * an owner among them would give a folder a second container and leave the
 * folder's lookup matching two - decision
 * `a-dev-container-owner-is-kept-beside-the-config`.
 *
 * So this is where the other half lives, one file beside the daemon's own
 * configuration keyed by machine id. A machine this file has no entry for is
 * charged to the host, which is what a container made outside ahpd has always
 * been.
 */

/** The file, in the folder the daemon keeps its own configuration in. */
export const OWNERS_FILE = 'computers.json';

/** Who a machine belongs to, and what its work is charged under. */
export interface Owned {
  owner: Owner;
  team?: string;
  project?: string;
}

/** One line, for a file that could not be read or written. */
const complain = (log: (line: string) => void, what: string, why: unknown): void =>
  log(`${what} ${OWNERS_FILE}: ${why instanceof Error ? why.message : String(why)}`);

/** The file itself. */
const at = (configDir: string): string => join(configDir, OWNERS_FILE);

/**
 * What one entry holds, or nothing when it is not an entry.
 *
 * The owner is held to the spelling a reference has everywhere else, so a file
 * a person has edited by hand is read as what it says rather than charged to
 * somebody the usage rules do not know.
 */
const owned = (said: unknown): Owned | undefined => {
  if (typeof said !== 'object' || said === null || Array.isArray(said)) return undefined;
  const one = said as Record<string, unknown>;
  const owner = ownerSaid(one.owner);
  if (owner === undefined) return undefined;
  const team = one.team;
  const project = one.project;
  return {
    owner,
    ...(typeof team === 'string' && team !== '' ? { team } : {}),
    ...(typeof project === 'string' && project !== '' ? { project } : {}),
  };
};

/** Every machine this file says something about. */
const read = (configDir: string, log: (line: string) => void): Record<string, Owned> => {
  let text: string;
  try { text = readFileSync(at(configDir), 'utf8'); }
  catch (error) {
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
        const held = owned(one);
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
const write = (configDir: string, held: Record<string, Owned>, log: (line: string) => void): void => {
  const path = at(configDir);
  try {
    mkdirSync(configDir, { recursive: true });
    // 0600, as the daemon's own records are: who owns a machine is not
    // everybody's business on a host with more than one person on it.
    const scratch = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(scratch, `${JSON.stringify(held, null, 2)}\n`, { mode: 0o600 });
    renameSync(scratch, path);
  }
  catch (error) {
    complain(log, 'could not write', error);
  }
};

/** Who a machine is recorded as belonging to, or nothing when it is not in the file. */
export const ownedOf = (configDir: string, id: string, log: (line: string) => void): Owned | undefined =>
  read(configDir, log)[id];

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
  if (held[id] !== undefined) return;
  write(configDir, { ...held, [id]: said }, log);
};

/** Forget a machine, which is what its being removed means. */
export const forgetOwned = (configDir: string, id: string, log: (line: string) => void): void => {
  const held = read(configDir, log);
  if (held[id] === undefined) return;
  const rest = { ...held };
  delete rest[id];
  write(configDir, rest, log);
};

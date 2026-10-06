/**
 * The daemon's own vault: one plain JSON file in the configuration directory.
 *
 * The store decision `the-local-vault-is-a-plain-file-until-it-is-encrypted`
 * settled - the fallback a `vault` port is read through until a plugin registers
 * one of its own, in the same shape the host's other files are written. It is
 * not encrypted; encrypting it, and the key a daemon is started with, is the
 * idea `the-local-vault-is-encrypted`.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { scopeOf } from '@ahpd/sdk';
import type { Vault } from '@ahpd/sdk';

/** What one file holds, so a file written by hand or by a later version is said and not guessed at. */
interface Saved {
  version: number;
  secrets: Record<string, string>;
}

/**
 * What the file is made at, and left at.
 *
 * Set on create and never left to the umask, because what this file holds is
 * everybody's credentials and 0644 is a mode that gives them to the machine.
 */
const OWNER_ONLY = 0o600;

/** What the file was written as, or why it is not something this can read. */
const readSaved = (file: string): Saved => {
  let text: string;
  try { text = readFileSync(file, 'utf8'); }
  catch (error) {
    // A file that is not there is a vault holding nothing yet, which is where a
    // daemon starts before anybody has set a secret.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { version: 1, secrets: {} };
    // The code and nothing else: what a system call says about a file this one
    // holds can be a line of it, and every refusal here reaches the log.
    throw new Error(`${file} could not be read as a vault: ${code ?? 'the file could not be opened'}`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch {
    // A fixed sentence, never the parser's: `JSON.parse` quotes the source it
    // choked on, which is the secret the file was holding.
    throw new Error(`${file} is not a vault: it is not JSON`);
  }
  const body = parsed as Partial<Saved> | null;
  const secrets = body === null || typeof body !== 'object' ? undefined : body.secrets;
  if (body === null || typeof body !== 'object' || typeof secrets !== 'object' || secrets === null
    || Array.isArray(secrets) || Object.values(secrets).some((one) => typeof one !== 'string')) {
    throw new Error(`${file} is not a vault: it holds no secrets map of strings`);
  }
  // Only this version, and never a later one rewritten as this one: a file a
  // newer version wrote carries keys this one would drop, so it is refused and
  // left as it is rather than read as a vault holding less than it does.
  if (body.version !== 1) throw new Error(`${file} is not a vault: it is not version 1`);
  return { version: 1, secrets: secrets as Record<string, string> };
};

/**
 * The vault over one file, read on every call.
 *
 * The file is read again each time rather than kept in memory, so a write from
 * the terminal's `ahpd vault set` lands in a daemon that is already running at
 * the next read. Two writers at once is last-rename-wins, which is what one
 * whole-file store is.
 */
export function fileVault(options: { file: string }): Vault {
  const { file } = options;
  return {
    get: async (name) => readSaved(file).secrets[name],
    set: async (name, value) => {
      scopeOf(name);
      const body = readSaved(file);
      writeSaved(file, { ...body.secrets, [name]: value });
    },
    delete: async (name) => {
      // Checked as `set` checks it, so a name nothing may write is not a name a
      // caller may take a stored value out of either.
      scopeOf(name);
      const body = readSaved(file);
      if (body.secrets[name] === undefined) return false;
      const { [name]: _gone, ...rest } = body.secrets;
      writeSaved(file, rest);
      return true;
    },
    list: async () => Object.keys(readSaved(file).secrets).sort(),
  };
}

/**
 * The whole map, written beside the file and moved over it.
 *
 * Temporary file and rename so a daemon killed mid-write leaves the last good
 * file rather than half of this one, which matters more here than anywhere else
 * in the daemon: half a vault is a secret nobody can read back.
 */
const writeSaved = (file: string, secrets: Record<string, string>): void => {
  const body: Saved = { version: 1, secrets };
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  // Removed before it is written, because `mode` is applied when a file is
  // *created*: a temp this pid left readable - one of ours killed between the
  // write and the rename, and this process given its pid back - would keep its
  // 0644, and the rename would put that on the vault, which holds everybody's
  // credentials.
  rmSync(temporary, { force: true });
  writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: OWNER_ONLY });
  renameSync(temporary, file);
};
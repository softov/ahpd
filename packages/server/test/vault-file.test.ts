/*
 * The daemon's own vault: one plain JSON file, read on every call.
 *
 * The store decision `the-local-vault-is-a-plain-file-until-it-is-encrypted`
 * settled. What it is checked for here is what a plain file has to get right:
 * a second reader sees what the first wrote, nothing is written before there
 * is something to write, the file is made at a mode that gives a credential to
 * nobody else, and a file that is not a vault is refused rather than replaced.
 */

import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fileVault } from '../src/vault.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-vault-file-'));
  file = join(dir, 'vault.json');
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

it('is an empty vault with no file, and writes nothing until there is something to write', async () => {
  const vault = fileVault({ file });
  await expect(vault.get('host:x')).resolves.toBeUndefined();
  await expect(vault.list()).resolves.toEqual([]);
  await expect(vault.delete('host:x')).resolves.toBe(false);
  expect(() => statSync(file)).toThrow();

  await vault.set('host:x', 'a-token');
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, secrets: { 'host:x': 'a-token' } });
});

it('is read again on every call, so a second vault over the same file sees what the first wrote', async () => {
  const one = fileVault({ file });
  const two = fileVault({ file });
  await one.set('host:x', 'first');
  await one.set('host:y', 'second');

  await expect(two.get('host:x')).resolves.toBe('first');
  await expect(two.list()).resolves.toEqual(['host:x', 'host:y']);
});

it('makes the file at a mode only its owner may read', async () => {
  await fileVault({ file }).set('host:x', 'a-token');
  expect(statSync(file).mode & 0o777).toBe(0o600);

  // And it stays there across a rewrite, which a rename over an existing file
  // would otherwise take from whatever mode that file had.
  writeFileSync(file, JSON.stringify({ version: 1, secrets: {} }), { mode: 0o644 });
  await fileVault({ file }).set('host:x', 'a-token');
  expect(statSync(file).mode & 0o777).toBe(0o600);
});

it('writes the file private even when a readable temp at its own name was left behind', async () => {
  await fileVault({ file }).set('host:x', 'a-token');
  // What a process that had this pid before left world-readable. `mode` is
  // applied when a file is created and not when one is opened, so a write that
  // opened this temp would keep its 0644 - and the rename puts that on the
  // vault, which holds everybody's credentials.
  const temporary = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, '{}');
  chmodSync(temporary, 0o644);
  await fileVault({ file }).set('host:y', 'another-token');

  expect(statSync(file).mode & 0o777).toBe(0o600);
});

it('deletes a name and says whether it was there, keeping the rest', async () => {
  const vault = fileVault({ file });
  await vault.set('host:x', 'first');
  await vault.set('host:y', 'second');

  await expect(vault.delete('host:absent')).resolves.toBe(false);
  await expect(vault.delete('host:x')).resolves.toBe(true);
  await expect(vault.list()).resolves.toEqual(['host:y']);
  await expect(vault.get('host:x')).resolves.toBeUndefined();
});

it('refuses a name that is not a secret at set, and writes nothing', async () => {
  const vault = fileVault({ file });
  await expect(vault.set('plain-name', 'a-token')).rejects.toThrow(/host:<name>/);
  await expect(vault.set('host:', 'a-token')).rejects.toThrow(/host:<name>/);
  expect(() => statSync(file)).toThrow();
});

it('refuses a name that is not a secret at delete too, and takes nothing out', async () => {
  const vault = fileVault({ file });
  await vault.set('host:x', 'a-token');

  // A name `set` would refuse must not be one a caller can take a stored value
  // out of, however the call arrives.
  await expect(vault.delete('plain-name')).rejects.toThrow(/host:<name>/);
  await expect(vault.delete('host:x\n')).rejects.toThrow(/host:<name>/);
  await expect(vault.list()).resolves.toEqual(['host:x']);
});

it('never says what a broken file held, because the parser would quote it', async () => {
  // `JSON.parse` quotes the source it choked on, which is the secret. Every
  // refusal below reaches a problem line, a log and a terminal.
  const held = '{"version":1,"secrets":{"host:x":"ghp_thevalueweleaked"';
  writeFileSync(file, held);
  const vault = fileVault({ file });

  for (const call of [() => vault.get('host:x'), () => vault.list(), () => vault.set('host:y', 'a-token'), () => vault.delete('host:x')]) {
    const said = await call().then(() => 'it resolved', (error: Error) => error.message);
    expect(said).toContain(`${file} is not a vault`);
    expect(said).not.toContain('ghp_thevalueweleaked');
  }
  expect(readFileSync(file, 'utf8')).toBe(held);
});

it('says nothing about the secret a file that is not JSON was in the middle of holding', async () => {
  // The reader answers a file it could not parse with the parser's own error,
  // and that error quotes the source it choked on - here, a token cut in half.
  // What a caller is told instead is the vault's fixed sentence.
  const held = '{"secrets": {"a": "hunter2"';
  writeFileSync(file, held);
  const vault = fileVault({ file });

  const said = await vault.get('a').then(() => 'it resolved', (error: Error) => error.message);
  expect(said).toBe(`${file} is not a vault: it is not JSON`);
  expect(said).not.toContain('hunter2');
  expect(readFileSync(file, 'utf8')).toBe(held);
});

it('says only the code when a file could not be read at all', async () => {
  // A directory is the case a system call refuses with a message, and that
  // message is about the path rather than the content; only the code is kept so
  // a path held in a variable cannot smuggle anything else into a refusal.
  const vault = fileVault({ file: dir });
  const said = await vault.list().then(() => 'it resolved', (error: Error) => error.message);
  expect(said).toBe(`${dir} could not be read as a vault: EISDIR`);
});

it('refuses a version it does not know, and never rewrites it as version 1', async () => {
  const held = JSON.stringify({ version: 2, secrets: { 'host:x': 'a-token' }, encryptedWith: 'a key a later version knows' }, null, 2);
  writeFileSync(file, held);
  const vault = fileVault({ file });

  await expect(vault.get('host:x')).rejects.toThrow('it is not version 1');
  await expect(vault.set('host:y', 'another')).rejects.toThrow('it is not version 1');
  // Byte for byte, because a file a later version wrote holds keys this one
  // would drop on the floor by writing it out as its own version.
  expect(readFileSync(file, 'utf8')).toBe(held);
});

it('refuses a file that is not a vault, and leaves it as it was', async () => {
  for (const held of ['not json at all', JSON.stringify({ version: 1 }), JSON.stringify({ version: 2, secrets: [] }), JSON.stringify({ version: 1, secrets: { 'host:x': 3 } })]) {
    writeFileSync(file, held);
    const vault = fileVault({ file });
    await expect(vault.get('host:x')).rejects.toThrow(`${file} is not a vault`);
    await expect(vault.list()).rejects.toThrow(`${file} is not a vault`);
    await expect(vault.set('host:x', 'a-token')).rejects.toThrow(`${file} is not a vault`);
    expect(readFileSync(file, 'utf8')).toBe(held);
  }
});
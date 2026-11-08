import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ripgrepFiles } from '../src/resources/workspacefiles.js';

/*
 * VS Code's listing of a working directory, driven against a stand-in for
 * ripgrep that prints the files it is told to and writes down how it was run:
 * the arguments VS Code passes, the directory it runs in, the lines read back
 * as paths, and the listing calls share for 30 seconds.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostWorkspaceFiles.ts#L83-L238
 */

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const folder = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-rg-')));
  made.push(dir);
  return dir;
};

/** A stand-in for ripgrep that prints `lines` and writes down each run, as its directory and its arguments. */
const standIn = (lines: string[]): { command: string; runs: () => string[][] } => {
  const dir = folder();
  const log = join(dir, 'runs.jsonl');
  const command = join(dir, 'rg');
  writeFileSync(command, [
    `#!${process.execPath}`,
    `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify([process.cwd(), ...process.argv.slice(2)]) + '\\n');`,
    `process.stdout.write(${JSON.stringify(lines.join('\n'))});`,
    '',
  ].join('\n'));
  chmodSync(command, 0o755);
  const runs = (): string[][] => {
    try {
      return readFileSync(log, 'utf8').split('\n').filter((one) => one !== '').map((one) => JSON.parse(one) as string[]);
    }
    catch {
      return [];
    }
  };
  return { command, runs };
};

// A script with a shebang is what stands in for ripgrep, and Windows runs none.
describe.skipIf(process.platform === 'win32')('a listing by ripgrep', () => {
  it('lists the files ripgrep prints, run in the directory with VS Code\'s arguments', async () => {
    const work = folder();
    const rg = standIn(['a.txt', 'src/b.ts']);
    const listed = await ripgrepFiles(rg.command).getFiles(work);
    expect(listed).toEqual({ files: [join(work, 'a.txt'), join(work, 'src', 'b.ts')], isTruncated: false });
    expect(rg.runs()).toEqual([[work, '--files', '--hidden', '--no-require-git', '--follow', '--no-config', '--glob', '!.git']]);
  });

  it('shares one listing between the calls of the 30 seconds after it', async () => {
    const work = folder();
    const rg = standIn(['a.txt']);
    const files = ripgrepFiles(rg.command);
    const [one, two] = await Promise.all([files.getFiles(work), files.getFiles(work)]);
    await files.getFiles(work);
    expect(one).toEqual(two);
    expect(rg.runs()).toHaveLength(1);
  });

  it('lists nothing once it is closed', async () => {
    const work = folder();
    const rg = standIn(['a.txt']);
    const files = ripgrepFiles(rg.command);
    files.close?.();
    expect(await files.getFiles(work)).toEqual({ files: [], isTruncated: false });
    expect(rg.runs()).toEqual([]);
  });
});

it('fails a listing where the binary is not there, and tries again at the next call', async () => {
  const work = folder();
  const files = ripgrepFiles(join(work, 'no-such-rg'));
  await expect(files.getFiles(work)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(files.getFiles(work)).rejects.toMatchObject({ code: 'ENOENT' });
});

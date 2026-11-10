/*
 * Whether this machine lets the run make a symbolic link to a file.
 *
 * A folder links as a junction on Windows, which needs no privilege, so a case
 * that links a folder runs everywhere with `posix ? 'dir' : 'junction'`. A
 * file cannot be a junction: a file link there needs Developer Mode or an
 * administrator, which a CI runner has and a person's own machine often does
 * not. A case that links a file is `it.skipIf(!fileLinks)`, so it runs
 * wherever the link can be made and is skipped, not failed, where it cannot.
 */

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const probe = (): boolean => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-links-'));
  try {
    writeFileSync(join(dir, 'target'), '');
    symlinkSync(join(dir, 'target'), join(dir, 'link'), 'file');
    return true;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  }
  finally { rmSync(dir, { recursive: true, force: true }); }
};

export const fileLinks: boolean = probe();

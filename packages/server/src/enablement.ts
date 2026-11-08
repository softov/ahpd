/**
 * The daemon's on/off decisions about customizations, in one state file.
 *
 * The other implementation of `EnablementStore`, and the one the port was
 * written for: `memoryEnablement` holds the decisions and the rules about them,
 * and everything added here is the file. Composed rather than copied, so there
 * is still one answer to what a decision is.
 *
 * The file is read once, when the store is built, and written whole after every
 * change. Nothing else writes it, so a second reader would be a second writer,
 * and what is read is seeded through the store's own setters - which is what
 * drops a decision that says what it inherits, and what applies the cap to a
 * file somebody edited by hand.
 */

import { bag, memoryEnablement, readJson, reason, writeJsonAtomic } from '@ahpd/sdk';
import type { EnablementStore } from '@ahpd/sdk';

/** What this store is built over. */
export interface FileEnablementOptions {
  /** The file every decision is written to and read from. */
  file: string;
  /** Somewhere to say that the file could not be read or written. */
  onProblem?(message: string): void;
}

/**
 * What the state file holds: the global decisions and the decisions of each
 * working directory, named as VS Code's agent host persists its own.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostCustomizationEnablementService.ts#L29-L32
 *
 * Versioned, so a later shape is recognised rather than guessed at: version 2
 * names the directories' record `workingDirectories`, and version 1, which
 * named it `folders`, is read as the same record. A decision that equals what
 * it inherits is not written, so both records hold decisions and nothing that
 * only repeats another one - which is what makes an empty file and a file that
 * is not there the same answer.
 */
interface StateFile {
  version: 2;
  global: Record<string, boolean>;
  workingDirectories: Record<string, Record<string, boolean>>;
}

/** One record of booleans, with everything that is not one dropped. */
const decisionsIn = (value: unknown): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  for (const [key, on] of Object.entries(bag(value))) {
    if (typeof on === 'boolean') out[key] = on;
  }
  return out;
};

export function fileEnablement(options: FileEnablementOptions): EnablementStore {
  const store = memoryEnablement();
  const told = (message: string): void => { options.onProblem?.(message); };

  /** What the store holds now, written whole: a file is replaced, never patched. */
  const save = (): void => {
    const held = store.held();
    const file: StateFile = { version: 2, global: held.global, workingDirectories: held.folders };
    try {
      writeJsonAtomic(options.file, file);
    }
    catch (error) {
      told(`Could not write ${options.file}: ${reason(error)}`);
    }
  };

  /*
   * Read once, at the start, and seed what it holds through the setters.
   *
   * Nothing is said about a file that is not there: this is a daemon's first
   * start, and a store with no decisions in it is exactly what that is. A file
   * that is there and could not be read is said out loud and left alone, and
   * one this version does not understand is left alone with a word about it -
   * guessing at what somebody's decisions were is worse than starting over.
   */
  const read = readJson(options.file);
  if (!read.ok && read.kind !== 'missing') {
    told(`Could not read ${options.file}: ${reason(read.error)}`);
  }
  else if (read.ok) {
    const held = bag(read.value);
    if (held.version !== 1 && held.version !== 2) {
      told(`${options.file} is not a customization state this version can read, and was left alone`);
    }
    else {
      for (const [key, on] of Object.entries(decisionsIn(held.global))) store.setGlobal(key, on);
      for (const [dir, decisions] of Object.entries(bag(held.version === 1 ? held.folders : held.workingDirectories))) {
        for (const [key, on] of Object.entries(decisionsIn(decisions))) store.setFolder(dir, key, on);
      }
    }
  }

  return {
    global: (key) => store.global(key),
    folder: (dir, key) => store.folder(dir, key),
    setGlobal: (key, on) => { store.setGlobal(key, on); save(); },
    setFolder: (dir, key, on) => { store.setFolder(dir, key, on); save(); },
  };
}

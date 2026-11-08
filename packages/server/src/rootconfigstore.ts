/**
 * The root config a client pushed, in one state file between starts.
 *
 * The daemon's `RootConfigStore`: read once, when the store is built, and
 * written whole at each change, beside the file and renamed over it, as VS
 * Code's host writes its own root config file.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1297-L1312
 *
 * What a start takes back from it is the host's to decide, against the root
 * config's schema; the file holds what the host gave it.
 */

import { bag, readJson, reason, writeJsonAtomic } from '@ahpd/sdk';
import type { RootConfigStore } from '@ahpd/sdk';

/** What this store is built over. */
export interface FileRootConfigStoreOptions {
  /** The file the root config is written to and read from. */
  file: string;
  /** Somewhere to say that the file could not be read or written. */
  onProblem?(message: string): void;
}

/** What the state file holds, versioned so a later shape is known by its number. */
interface StateFile {
  version: 1;
  values: Record<string, unknown>;
}

export function fileRootConfigStore(options: FileRootConfigStoreOptions): RootConfigStore {
  const told = (message: string): void => { options.onProblem?.(message); };

  /*
   * Read once, at the start.
   *
   * A file that is not there is a daemon's first start, and says nothing. One
   * that could not be read, or that this version does not understand, is said
   * and left until the next change writes it, and the host starts as if
   * nothing was kept, as VS Code's host warns and starts from its defaults.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1392-L1398
   */
  let kept: Record<string, unknown> = {};
  const read = readJson(options.file);
  if (!read.ok && read.kind !== 'missing') {
    told(`Could not read ${options.file}: ${reason(read.error)}`);
  }
  else if (read.ok) {
    const held = bag(read.value) as Partial<StateFile>;
    if (held.version === 1) kept = bag(held.values);
    else told(`${options.file} is not a root config this version can read, and was left alone`);
  }

  return {
    read: () => kept,
    write: (values) => {
      kept = values;
      const file: StateFile = { version: 1, values };
      try {
        writeJsonAtomic(options.file, file);
      }
      catch (error) {
        told(`Could not write ${options.file}: ${reason(error)}`);
      }
    },
  };
}

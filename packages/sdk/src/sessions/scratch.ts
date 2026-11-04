/** The folder a session with no folder of its own works in. */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { idOf } from './catalog.js';

/**
 * The folder a session the client gave no folder works in, made where it is
 * missing.
 *
 * `<home>/.copilot/chats/<session id>`, as VS Code's agents give a session
 * with no workspace: one folder per session, the same one whichever agent runs
 * it, under the root VS Code names for chats with no workspace. The id is one
 * path segment, whatever it holds.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/workspacelessScratchDir.ts#L9-L20
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/workspacelessScratchDir.ts#L10-L15
 */
export const ensureWorkspacelessScratchDir = (session: string, home: string = homedir()): string => {
  const folder = join(home, '.copilot', 'chats', encodeURIComponent(idOf(session)));
  mkdirSync(folder, { recursive: true });
  return folder;
};

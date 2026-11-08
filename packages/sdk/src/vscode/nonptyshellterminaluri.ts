/**
 * The link a tool result gives a shell terminal whose process is gone: VS
 * Code's retained terminal link, `agenthost-terminal://shell/<session id>/<tool
 * call id>` with the storage, the session, the chat and the tool call in a JSON
 * query, which VS Code's clients read a terminal's chat from.
 *
 * Vendored from VS Code's `nonPtyShellTerminalUri.ts` as VS Code has it. The
 * adaptation is this package's: `AgentSession.id`, a session URI's id, is read
 * here as VS Code's `agent.ts` reads it, the URI's path less its leading slash.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/nonPtyShellTerminalUri.ts
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1647-L1650
 */

import { Schemas } from './network.js';
import { URI } from './uri.js';

export interface INonPtyShellTerminalUri {
  readonly storage: URI;
  readonly session: URI;
  readonly chat: URI;
  readonly toolCallId: string;
}

export function buildNonPtyShellTerminalUri(storage: URI | string, session: URI | string, chat: URI | string, toolCallId: string): string {
  const parsed = typeof session === 'string' ? URI.parse(session) : session;
  return URI.from({
    scheme: Schemas.agentHostTerminal,
    authority: 'shell',
    path: `/${parsed.path.substring(1)}/${toolCallId}`,
    query: JSON.stringify({
      storage: storage.toString(),
      session: session.toString(),
      chat: chat.toString(),
      toolCallId,
    }),
  }).toString();
}

export function parseNonPtyShellTerminalUri(resource: URI): INonPtyShellTerminalUri | undefined {
  if (resource.scheme !== Schemas.agentHostTerminal || resource.authority !== 'shell' || !resource.query) {
    return undefined;
  }
  let fields: { readonly storage?: string; readonly session?: string; readonly chat?: string; readonly toolCallId?: string };
  try {
    fields = JSON.parse(resource.query);
  } catch {
    return undefined;
  }
  const { storage, session, chat, toolCallId } = fields;
  if (!storage || !session || !chat || !toolCallId) {
    return undefined;
  }
  try {
    return {
      storage: URI.parse(storage),
      session: URI.parse(session),
      chat: URI.parse(chat),
      toolCallId,
    };
  } catch {
    return undefined;
  }
}

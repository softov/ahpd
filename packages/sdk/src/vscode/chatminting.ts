/**
 * How a chat's URI is minted, as VS Code mints one.
 *
 * Vendored from VS Code's `agentHostChatMinting.ts` (`ChatUriFormat`,
 * `chatUriFormatOf`, `mintDefaultChatUri`, `mintPeerChatUri`,
 * `subagentChatUri`), its `agentHostChatIdentity.ts` (`isShapedChatUri`,
 * `uuidFromSha1`) and the shaped builders of its `sessionState.ts`
 * (`buildChatUri`, `buildDefaultChatUri`, `buildSubagentChatUri`). The
 * adaptations are this package's: a UUID is node's `randomUUID` where VS Code
 * calls its `generateUuid`, the SHA-1 is node's `createHash` over the UTF-8
 * bytes VS Code's `StringSHA1` hashes, and a session is written in node's
 * `base64url`, the unpadded URL-safe base64 VS Code's `encodeBase64` writes.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMinting.ts#L10-L46
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatIdentity.ts#L10-L26
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L870-L892
 */

import { createHash, randomUUID } from 'node:crypto';
import { AHP_CHAT_SCHEME, DEFAULT_CHAT_ID, parseChatUri } from './chatid.js';

const SUBAGENT_CHAT_ID = 'subagent';

export function buildChatUri(session: string, chatId: string): string {
  return `${AHP_CHAT_SCHEME}://${chatId}/${Buffer.from(session, 'utf8').toString('base64url')}`;
}

/** Mints the URI of a new session's default chat, shaped. */
export function buildDefaultChatUri(session: string): string {
  return buildChatUri(session, DEFAULT_CHAT_ID);
}

export function buildSubagentChatUri(session: string, toolCallId: string): string {
  return `${AHP_CHAT_SCHEME}://${SUBAGENT_CHAT_ID}/${Buffer.from(session, 'utf8').toString('base64url')}/${encodeURIComponent(toolCallId)}`;
}

/** Whether `resource` has the legacy shape that encodes its minting session (`ahp-chat://<chatId>/<base64(session)>`). */
export function isShapedChatUri(resource: string): boolean {
  return parseChatUri(resource) !== undefined;
}

/**
 * Formats a name-based (version 5, RFC 4122 variant) UUID from the SHA-1 of
 * `name`, so the same name always yields the same UUID.
 */
export function uuidFromSha1(name: string): string {
  const hex = createHash('sha1').update(name, 'utf8').digest('hex');
  const timeHighAndVersion = ((parseInt(hex.slice(12, 16), 16) & 0x0fff) | 0x5000).toString(16).padStart(4, '0');
  const clockSequenceAndVariant = ((parseInt(hex.slice(16, 20), 16) & 0x3fff) | 0x8000).toString(16).padStart(4, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${timeHighAndVersion}-${clockSequenceAndVariant}-${hex.slice(20, 32)}`;
}

/**
 * The spelling new chats of a session use. It follows the session's recorded
 * default chat so every chat of a session is addressable by the same clients.
 */
export type ChatUriFormat = 'opaque' | 'shaped';

/** The format new chats follow for a session whose recorded default chat is `defaultChat`. */
export function chatUriFormatOf(defaultChat: string | undefined): ChatUriFormat {
  return defaultChat !== undefined && !isShapedChatUri(defaultChat) ? 'opaque' : 'shaped';
}

function opaqueChatUri(uuid: string): string {
  return `${AHP_CHAT_SCHEME}:/${uuid}`;
}

/** Mints the default chat of a new (or recreated) session. `generation` only distinguishes a shaped default of a reused session id. */
export function mintDefaultChatUri(format: ChatUriFormat, session: string, generation: string | undefined): string {
  return format === 'opaque'
    ? opaqueChatUri(randomUUID())
    : buildDefaultChatUri(session) + (generation === undefined ? '' : `?generation=${generation}`);
}

/** Mints an additional chat of `session`. */
export function mintPeerChatUri(format: ChatUriFormat, session: string): string {
  const uuid = randomUUID();
  return format === 'opaque' ? opaqueChatUri(uuid) : buildChatUri(session, uuid);
}

/**
 * The id of the chat that runs a subagent. Opaque ids derive from the root
 * conversation chat that issued the tool call, so the same call always yields
 * the same chat and distinct chats never collide on a tool call id.
 */
export function subagentChatUri(format: ChatUriFormat, session: string, rootConversationChat: string, toolCallId: string): string {
  return format === 'opaque'
    ? opaqueChatUri(uuidFromSha1(`${rootConversationChat}\0${toolCallId}`))
    : buildSubagentChatUri(session, toolCallId);
}

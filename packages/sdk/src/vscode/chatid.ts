/**
 * A chat's client chat id, read from its URI, as VS Code reads one.
 *
 * Vendored from VS Code's `sessionState.ts` (`AHP_CHAT_SCHEME`,
 * `DEFAULT_CHAT_ID`, `parseChatUri`, `getCanonicalOpaqueChatUuid`,
 * `getAgentHostChatId`), with the `isUUID` of its `uuid.ts` and the
 * `decodeBase64` of its `buffer.ts`, as VS Code has them. The adaptations are
 * this package's: `decodeBase64` answers the bytes as a `Uint8Array` where VS
 * Code wraps them in its `VSBuffer`, since the bytes are only checked here, its
 * comments on speed and on each character range left out, and a URI is parsed
 * with this package's vendored `URI`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L856-L960
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/uuid.ts#L7-L11
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/buffer.ts#L365-L424
 */

import { URI } from './uri.js';

export const AHP_CHAT_SCHEME = 'ahp-chat';

export const DEFAULT_CHAT_ID = 'default';

const SUBAGENT_CHAT_ID = 'subagent';

const _UUIDPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: string): boolean {
  return _UUIDPattern.test(value);
}

/** Decodes base64 to a uint8 array. URL-encoded and unpadded base64 is allowed. */
export function decodeBase64(encoded: string): Uint8Array {
  let building = 0;
  let remainder = 0;
  let bufi = 0;

  const buffer = new Uint8Array(Math.floor(encoded.length / 4 * 3));
  const append = (value: number) => {
    switch (remainder) {
      case 3:
        buffer[bufi++] = building | value;
        remainder = 0;
        break;
      case 2:
        buffer[bufi++] = building | (value >>> 2);
        building = value << 6;
        remainder = 3;
        break;
      case 1:
        buffer[bufi++] = building | (value >>> 4);
        building = value << 4;
        remainder = 2;
        break;
      default:
        building = value << 2;
        remainder = 1;
    }
  };

  for (let i = 0; i < encoded.length; i++) {
    const code = encoded.charCodeAt(i);
    // See https://datatracker.ietf.org/doc/html/rfc4648#section-4
    if (code >= 65 && code <= 90) {
      append(code - 65);
    } else if (code >= 97 && code <= 122) {
      append(code - 97 + 26);
    } else if (code >= 48 && code <= 57) {
      append(code - 48 + 52);
    } else if (code === 43 || code === 45) {
      append(62);
    } else if (code === 47 || code === 95) {
      append(63);
    } else if (code === 61) {
      break;
    } else {
      throw new SyntaxError(`Unexpected base64 character ${encoded[i]}`);
    }
  }

  const unpadded = bufi;
  while (remainder > 0) {
    append(0);
  }

  return buffer.slice(0, unpadded);
}

/**
 * Recovers the chat id of a chat channel URI. Returns `undefined` when `uri`
 * is not a well-formed chat URI. The session a chat URI was minted for is not
 * exposed: a chat's owner and storage come from the records that contain it.
 */
export function parseChatUri(uri: string): { chatId: string } | undefined {
  let parsed: URI;
  try {
    parsed = URI.parse(uri);
  } catch {
    return undefined;
  }
  if (parsed.scheme !== AHP_CHAT_SCHEME || !parsed.authority) {
    return undefined;
  }
  const encoded = parsed.path.replace(/^\//, '');
  if (!encoded) {
    return undefined;
  }
  try {
    if (parsed.authority === SUBAGENT_CHAT_ID) {
      const [sessionPart, ...toolCallIdParts] = encoded.split('/');
      const toolCallId = toolCallIdParts.join('/');
      if (!sessionPart || !toolCallId) {
        return undefined;
      }
      // Validates the minted segment without exposing it.
      decodeBase64(sessionPart);
      return { chatId: `${SUBAGENT_CHAT_ID}/${decodeURIComponent(toolCallId)}` };
    }
    decodeBase64(encoded);
    return { chatId: parsed.authority };
  } catch {
    return undefined;
  }
}

const canonicalOpaqueChatPrefix = `${AHP_CHAT_SCHEME}:/`;

/**
 * The uuid of a canonical opaque chat URI (`ahp-chat:/<uuid>` with nothing
 * else), or `undefined` for any other resource.
 */
export function getCanonicalOpaqueChatUuid(resource: string): string | undefined {
  const value = resource.toString();
  if (!value.startsWith(canonicalOpaqueChatPrefix)) {
    return undefined;
  }
  const uuid = value.slice(canonicalOpaqueChatPrefix.length);
  return isUUID(uuid) ? uuid : undefined;
}

/**
 * The client chat id (a chat resource fragment) of a chat. Deterministic per
 * URI so persisted fragments never change: the short uuid of a canonical
 * opaque chat, the parsed id of a shaped chat other than `default`, and the
 * full URI for everything else.
 */
export function getAgentHostChatId(resource: string): string {
  const uuid = getCanonicalOpaqueChatUuid(resource);
  if (uuid !== undefined) {
    return uuid;
  }
  const chatId = parseChatUri(resource)?.chatId;
  return chatId !== undefined && chatId !== DEFAULT_CHAT_ID ? chatId : resource.toString();
}

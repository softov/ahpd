/**
 * Content an agent's tool result or message carries inline, kept in its
 * session's folder and read back by a `session-db-resource` URI.
 *
 * As VS Code's host keeps a tool result's embedded resources in the session's
 * database and answers each with a reference to large content stored outside
 * the state tree: the URI's path is a display name only, its query names the
 * session, the call and the content's place among the result's, and a read of
 * it is served by the provider for the scheme.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L148-L183
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/resourceProviders/toolResultResourceProvider.ts
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L1047-L1053
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AhpErrorCodes } from '@microsoft/agent-host-protocol';
import { RpcError } from '../rpc.js';
import type { ToolResultResource } from '../types/agent.js';
import type { ContentRef } from '../types/changes.js';
import type { Read, ResourceProvider } from '../types/resources.js';

/** The scheme the host answers kept content under, VS Code's. */
export const TOOL_RESULT_RESOURCE_SCHEME = 'session-db-resource';

/**
 * The most bytes one content is kept at, where the host was given no
 * `toolResultResourceLimitBytes`: VS Code's.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionDataService.ts#L21
 */
export const TOOL_RESULT_RESOURCE_LIMIT = 8 * 1024 * 1024;

/** What a `session-db-resource` URI identifies: the session, the call, and the content's place. */
export interface ToolResultResourceFields {
  sessionUri: string;
  toolCallId: string;
  ordinal: number;
}

/**
 * A reference whose path is only a display name, never a filesystem path, as
 * VS Code builds one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/mcpResourceUri.ts#L19-L26
 */
export const buildToolResultResourceUri = (sessionUri: string, toolCallId: string, ordinal: number, name: string): string =>
  `${TOOL_RESULT_RESOURCE_SCHEME}:/${encodeURIComponent(name.replace(/[\\/]/g, '_') || 'resource')}`
  + `?${encodeURIComponent(JSON.stringify({ sessionUri, toolCallId, ordinal }))}`;

/**
 * The identity a reference names, read from its query whatever its path, as
 * VS Code parses one; nothing for a URI that is no such reference.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/mcpResourceUri.ts#L28-L44
 */
export function parseToolResultResourceUri(uri: string): ToolResultResourceFields | undefined {
  let parsed: URL;
  try { parsed = new URL(uri); }
  catch { return undefined; }
  if (parsed.protocol !== `${TOOL_RESULT_RESOURCE_SCHEME}:`) return undefined;
  try {
    const fields = JSON.parse(decodeURIComponent(parsed.search.slice(1))) as Partial<ToolResultResourceFields> | null;
    if (fields && typeof fields.sessionUri === 'string' && fields.sessionUri !== ''
      && typeof fields.toolCallId === 'string' && fields.toolCallId !== ''
      && typeof fields.ordinal === 'number' && Number.isSafeInteger(fields.ordinal) && fields.ordinal >= 0) {
      return { sessionUri: fields.sessionUri, toolCallId: fields.toolCallId, ordinal: fields.ordinal };
    }
  }
  catch { /* a query that is no identity is no reference */ }
  return undefined;
}

/**
 * Where one call's content is kept in its session's folder: a folder named by
 * the call's id hashed, so any id is a name every filesystem takes.
 */
const callFolder = (dir: string, toolCallId: string): string =>
  join(dir, 'tool-results', createHash('sha256').update(toolCallId).digest('hex'));

/** What is kept beside one content's bytes. */
interface Kept {
  turnId: string;
  name: string;
  contentType: string;
  size: number;
}

/** The host's store of kept content, and the provider a client reads it back through. */
export interface ToolResultResources {
  store(sessionUri: string, resource: ToolResultResource): Promise<ContentRef | undefined>;
  /** The reference one content was kept under, read back, or nothing for content kept nowhere. */
  kept(sessionUri: string, toolCallId: string, ordinal: number): Promise<ContentRef | undefined>;
  provider: ResourceProvider;
}

/**
 * The host's store of kept content: a backend hands it bytes and is answered
 * the reference a part names them by, and a client reads them back through the
 * provider for the scheme.
 *
 * `folderOf` is a session's own folder, nothing where the session store keeps
 * none, and `limit` the most bytes one content is kept at, zero for no limit.
 */
export function toolResultResources(
  folderOf: (sessionUri: string) => string | undefined,
  limit: () => number,
): ToolResultResources {
  return {
    /**
     * Keep one content and answer its reference, or nothing: content over the
     * limit is left out, as VS Code keeps nothing over its bound, and so is
     * content of a session with no folder or whose write failed, which the
     * backend then leaves out as VS Code's host does a resource it could not
     * keep.
     */
    store: async (sessionUri, resource) => {
      const most = limit();
      if (most !== 0 && resource.bytes.byteLength > most) return undefined;
      const dir = folderOf(sessionUri);
      if (dir === undefined) return undefined;
      const folder = callFolder(dir, resource.toolCallId);
      const kept: Kept = { turnId: resource.turnId, name: resource.name, contentType: resource.contentType, size: resource.bytes.byteLength };
      try {
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, String(resource.ordinal)), resource.bytes);
        await writeFile(join(folder, `${resource.ordinal}.json`), JSON.stringify(kept));
      }
      catch { return undefined; }
      return {
        uri: buildToolResultResourceUri(sessionUri, resource.toolCallId, resource.ordinal, resource.name),
        contentType: resource.contentType,
        sizeHint: resource.bytes.byteLength,
      };
    },
    /**
     * The reference one content was kept under, read back from what was kept
     * beside its bytes, as VS Code's replay reads the resources its session's
     * database holds for the calls it maps and names each by the reference it
     * was kept under. Nothing for content kept nowhere.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L617-L623
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1353-L1363
     */
    kept: async (sessionUri, toolCallId, ordinal) => {
      const dir = folderOf(sessionUri);
      if (dir === undefined) return undefined;
      let held: Partial<Kept>;
      try { held = JSON.parse(await readFile(join(callFolder(dir, toolCallId), `${ordinal}.json`), 'utf8')) as Partial<Kept>; }
      catch { return undefined; }
      if (typeof held.name !== 'string') return undefined;
      return {
        uri: buildToolResultResourceUri(sessionUri, toolCallId, ordinal, held.name),
        ...(typeof held.contentType === 'string' ? { contentType: held.contentType } : {}),
        ...(typeof held.size === 'number' ? { sizeHint: held.size } : {}),
      };
    },
    provider: {
      /**
       * One kept content, refused in VS Code's words where the URI names none.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/resourceProviders/toolResultResourceProvider.ts
       */
      read: async (uri: string, wanted?: string): Promise<Read> => {
        const fields = parseToolResultResourceUri(uri);
        if (fields === undefined) throw new RpcError(AhpErrorCodes.NotFound, `Content not found: ${uri}`);
        const missing = (): RpcError => new RpcError(
          AhpErrorCodes.NotFound,
          `Tool result resource not found: toolCallId=${fields.toolCallId}, ordinal=${String(fields.ordinal)}`,
        );
        const dir = folderOf(fields.sessionUri);
        if (dir === undefined) throw missing();
        const folder = callFolder(dir, fields.toolCallId);
        const [bytes, kept] = await Promise.all([
          readFile(join(folder, String(fields.ordinal))),
          readFile(join(folder, `${fields.ordinal}.json`), 'utf8').then((text) => JSON.parse(text) as Partial<Kept>),
        ]).catch(() => { throw missing(); });
        const contentType = typeof kept.contentType === 'string' ? kept.contentType : 'application/octet-stream';
        return wanted === 'base64'
          ? { data: bytes.toString('base64'), encoding: 'base64', contentType }
          : { data: bytes.toString('utf8'), encoding: 'utf-8', contentType };
      },
    },
  };
}

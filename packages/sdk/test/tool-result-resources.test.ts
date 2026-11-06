import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileSessions } from '../src/sessions/sessions.js';
import { buildToolResultResourceUri, parseToolResultResourceUri } from '../src/resources/toolresults.js';
import { createHost, echo, hello, peer } from './support/host.js';
import type { Start } from '../src/types/agent.js';

/*
 * Content a tool result or an agent's message carries inline, which a backend
 * hands the host to keep and names by reference, as VS Code's host keeps a
 * tool result's embedded resources in its session's database and serves each
 * at a `session-db-resource` URI.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L148-L183
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/resourceProviders/toolResultResourceProvider.ts
 */

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A host whose sessions keep a folder, one session open, and the start its backend was handed. */
const keeping = async (limit?: number) => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-tool-results-'));
  made.push(dir);
  let started: Start | undefined;
  const base = echo({ path: dir, pace: 0 });
  const host = createHost({
    path: dir,
    agents: [{ ...base, create: (start) => { started = start; return base.create(start); } }],
    sessions: fileSessions({ dir }),
    ...(limit === undefined ? {} : { toolResultResourceLimitBytes: limit }),
  });
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0']));
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/kept', provider: 'echo' } });
  return { host, client, start: started as Start };
};

const content = (bytes: Uint8Array, ordinal = 0) => ({
  turnId: 't1', toolCallId: 'call-1', ordinal, name: 'shot.png', contentType: 'image/png', bytes,
});

describe('content a backend hands the host to keep', () => {
  it('is answered by a session-db-resource reference a client reads back', async () => {
    const { host, client, start } = await keeping();
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]);
    const ref = await start.storeToolResultResource?.(content(bytes, 2));
    expect(ref).toEqual({
      uri: buildToolResultResourceUri('ahp-session:/kept', 'call-1', 2, 'shot.png'),
      contentType: 'image/png',
      sizeHint: 8,
    });
    expect(ref?.uri.startsWith('session-db-resource:/shot.png?')).toBe(true);
    expect(parseToolResultResourceUri(ref?.uri ?? '')).toEqual({ sessionUri: 'ahp-session:/kept', toolCallId: 'call-1', ordinal: 2 });

    const read = await client.handle({ method: 'resourceRead', params: { uri: ref?.uri, encoding: 'base64' } });
    expect(read).toEqual({ data: Buffer.from(bytes).toString('base64'), encoding: 'base64', contentType: 'image/png' });
    await host.close();
  });

  it('is read as text where no encoding is asked, as VS Code reads it', async () => {
    const { host, client, start } = await keeping();
    const ref = await start.storeToolResultResource?.({ ...content(new TextEncoder().encode('one\ntwo\n')), name: 'notes.txt', contentType: 'text/plain' });
    expect(await client.handle({ method: 'resourceRead', params: { uri: ref?.uri } }))
      .toEqual({ data: 'one\ntwo\n', encoding: 'utf-8', contentType: 'text/plain' });
    await host.close();
  });

  it('keeps nothing over the limit, and anything where the limit is zero', async () => {
    const small = await keeping(4);
    expect(await small.start.storeToolResultResource?.(content(new Uint8Array(5)))).toBeUndefined();
    expect(await small.start.storeToolResultResource?.(content(new Uint8Array(4)))).toMatchObject({ sizeHint: 4 });
    await small.host.close();
    const any = await keeping(0);
    expect(await any.start.storeToolResultResource?.(content(new Uint8Array(64)))).toMatchObject({ sizeHint: 64 });
    await any.host.close();
  });

  it('refuses a read that names nothing kept, in VS Code\'s words', async () => {
    const { host, client } = await keeping();
    await expect(client.handle({
      method: 'resourceRead',
      params: { uri: buildToolResultResourceUri('ahp-session:/kept', 'call-9', 0, 'gone.png') },
    })).rejects.toMatchObject({ code: -32008, message: 'Tool result resource not found: toolCallId=call-9, ordinal=0' });
    await expect(client.handle({ method: 'resourceRead', params: { uri: 'session-db-resource:/x?nothing' } }))
      .rejects.toMatchObject({ code: -32008, message: 'Content not found: session-db-resource:/x?nothing' });
    await host.close();
  });
});

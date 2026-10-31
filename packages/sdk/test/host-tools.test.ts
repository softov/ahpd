import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionReducer } from '@microsoft/agent-host-protocol';
import { clientPluginsIn } from '../src/plugins/clientplugins.js';
import { enablementKeyOf, memoryEnablement } from '../src/plugins/enablement.js';
import type { EnablementStore } from '../src/plugins/enablement.js';
import { uriOf } from '../src/resources/fileuri.js';
import { createClientCalls, DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../src/tools/clientcalls.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { sdkVersion } from '../src/version.js';
import type { Agent, BoundTool, McpServer, Start } from '../src/types/agent.js';
import type { ClientCalls } from '../src/tools/clientcalls.js';
import type { Bag } from '../src/types/common.js';
import type { HostEvent } from '../src/types/events.js';
import type { HostOptions, HostTool, ToolCall } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { PlanUpdate, Session } from '../src/types/session.js';
import type { SessionAction, SessionInputRequest, SessionState } from '@microsoft/agent-host-protocol';
import type { Grant, Principal, Users } from '../src/types/users.js';
import { ROOT } from '../src/host.js';
import {
  resetSdk, actions, claude, createHost, echo, emit, hello, hostTools,
  machine, peer, sdk, serving, sessionQueries, settle, running,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/**
 * This test's own folder, as the host's.
 *
 * A summary names only a folder that is there, so the host has to run in one
 * that exists on whichever machine runs the test.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

describe('tools the host contributes', () => {
  const withTools = async (tools = hostTools()) => {
    const host = createHost({
      path: HERE, agents: [claude({ paths: [HERE] })], ...machine(), tools,
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/served';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
    // The name the session is held and listed by, which is the one a tool
    // answers with and is asked by.
    const held = 'ahp-session:/served';
    return { host, client, peer: p, uri, held };
  };

  it('reports them on the session, and says nothing when it has none', async () => {
    const { client, uri } = await withTools();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { serverTools?: { name: string }[] } };
    }).snapshot.state;
    expect(state.serverTools?.map((one) => one.name)).toEqual([
      'list_sessions', 'get_current_session', 'set_workspace', 'create_session', 'create_chat',
      'rename_chat', 'send_message', 'get_session_context', 'delete_session',
      'add_artifact_or_reference', 'remove_artifact_or_reference', 'list_artifacts_and_references',
      'ahp_resource', 'ahp_terminals', 'schedule_wakeup',
    ]);

    // A host given none contributes none, and the field is absent rather than
    // an empty list - which is the difference between "no tools" and "a host
    // that has not said".
    const { client: bare, uri: other } = await (async () => {
      const host = serving('/home/softov');
      const client_ = host.accept(peer());
      await client_.handle(hello(['0.9.0']));
      await client_.handle({ method: 'createSession', params: { channel: 'ahp-session:/bare', provider: 'claude' } });
      return { client: client_, uri: 'ahp-session:/bare' };
    })();
    const empty = (await bare.handle({ method: 'subscribe', params: { channel: other } }) as {
      snapshot: { state: { serverTools?: unknown } };
    }).snapshot.state;
    expect(empty.serverTools).toBeUndefined();
  });

  it('withholds a tool that declares it needs advanced permission', async () => {
    const tool = (name: string, advancedPermission?: boolean) => ({
      definition: { name, description: name, inputSchema: { type: 'object' as const, properties: {} } },
      ...(advancedPermission === undefined ? {} : { advancedPermission }),
      run: () => `${name} ran`,
    });
    const names = async (advancedTools: boolean) => {
      const host = createHost({
        path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(),
        tools: [tool('launch_rocket', true), tool('peek')],
        advancedTools,
      });
      const client = host.accept(peer());
      await client.handle(hello(['0.9.0']));
      await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/marked', provider: 'claude' } });
      const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/marked' } }) as {
        snapshot: { state: { serverTools?: { name: string }[] } };
      }).snapshot.state;
      return state.serverTools?.map((one) => one.name);
    };

    // Absent, not refused: a model is never offered a tool the host did not permit.
    expect(await names(false)).toEqual(['peek']);
    expect(await names(true)).toEqual(['launch_rocket', 'peek']);
  });

  it('hands them to the backend as a server it can call', async () => {
    const { held } = await withTools();
    const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: {
      name: string; description: string; handler: (input: unknown) => Promise<{ content: { text: string }[] }>;
    }[] }>;
    // Under a name of this host's, beside whatever the settings files declared.
    expect(Object.keys(servers)).toContain('ahp');
    const listing = servers.ahp?.tools.find((one) => one.name === 'list_sessions');
    expect(listing?.description).toContain('List sessions');

    // And calling one answers about this host, which is the whole reason a
    // tool is the host's rather than the backend's: the row is the catalogue's
    // own, with the link the reference window opens.
    const answered = await listing?.handler({});
    const said = JSON.parse(answered?.content[0]?.text ?? '{}') as { sessions: { session: string; openLink: string; status: string }[] };
    expect(said.sessions.map((one) => one.session)).toEqual([held]);
    expect(said.sessions[0]?.openLink).toBe('agent-host-session://claude/served');
    expect(said.sessions[0]?.status).toBe('idle');
  });

  /**
   * The session tools, driven the way the model drives them.
   *
   * Each is the same operation a client has - a command or a dispatch - reached
   * from inside a turn, so what is checked is that the host side actually
   * moves: a message becomes a turn, a session appears in the catalogue, a
   * title changes on the wire.
   */
  describe('the session tools', () => {
    type Tool = { name: string; handler: (input: unknown) => Promise<{ content: { text: string }[] }> };
    const toolsOf = (index = -1): Record<string, Tool> => {
      const servers = sessionQueries().at(index)?.options.mcpServers as Record<string, { tools: Tool[] }> | undefined;
      return Object.fromEntries((servers?.ahp?.tools ?? []).map((one) => [one.name, one]));
    };
    // A refusal is a tool result too: the backend hands the model the message
    // as text, marked as an error, which is how a model learns what it got wrong.
    const call = async (name: string, input: unknown, index = -1): Promise<string> => {
      const tool = toolsOf(index)[name];
      if (!tool) throw new Error(`no ${name}`);
      return (await tool.handler(input)).content[0]?.text ?? '';
    };

    it('says which session it is running in, with the row and the link', async () => {
      const { held } = await withTools();
      const said = JSON.parse(await call('get_current_session', {})) as Record<string, unknown>;
      expect(said.session).toBe(held);
      expect(said.openLink).toBe('agent-host-session://claude/served');
      expect(said.status).toBe('idle');
      expect(said.workingDirectory).toBe(uriOf(HERE));
    });

    it('sends a message into another session, and it starts a turn there as the agent\'s', async () => {
      const { client, peer: p } = await withTools();
      await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/other', provider: 'claude' } });
      const chatUri = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/other' } }) as {
        snapshot: { state: { defaultChat: string } };
      }).snapshot.state.defaultChat;
      await client.handle({ method: 'subscribe', params: { channel: chatUri } });
      // From the first session's tools, at the second, by its link.
      const said = await call('send_message', { session: 'agent-host-session://claude/other', message: 'check the makefile' }, 0);
      expect(said).toBe('Message sent (agent-host-session://claude/other).');
      await settle();
      const started = actions(p, chatUri).find((one) => one.action.type === 'chat/turnStarted');
      expect(started?.action.message).toMatchObject({
        text: 'check the makefile',
        origin: { kind: 'agent' },
        _meta: { 'vscode.chat.delegation': { sourceSession: 'ahp-session:/served' } },
      });
    });

    it('queues the message when the other chat is busy, and refuses its own chat', async () => {
      const { client, peer: p, held } = await withTools();
      await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/busy', provider: 'claude' } });
      const chatUri = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/busy' } }) as {
        snapshot: { state: { defaultChat: string } };
      }).snapshot.state.defaultChat;
      await client.handle({ method: 'subscribe', params: { channel: chatUri } });
      client.handle({
        method: 'dispatchAction',
        params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'first' } } },
      });
      await settle();
      const said = await call('send_message', { session: 'ahp-session:/busy', message: 'and then this' }, 0);
      expect(said).toBe('Message queued (agent-host-session://claude/busy).');
      await settle();
      const queued = actions(p, chatUri).find((one) => one.action.type === 'chat/pendingMessageSet');
      expect(queued?.action).toMatchObject({ kind: 'queued', message: { text: 'and then this', origin: { kind: 'agent' } } });

      expect(await call('send_message', { session: held, message: 'to myself' }, 0)).toContain('refusing to send a message to the current chat');
      expect(await call('send_message', { session: 'ahp-session:/nobody', message: 'x' }, 0)).toContain('session must match the URI of a known session');
    });

    it('creates an independent session in a directory, titled, with its first prompt', async () => {
      const { client, peer: p } = await withTools();
      await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
      const said = await call('create_session', {
        relationship: 'independent', workspace: HERE, title: 'Port the makefile', prompt: 'port it', worktree: false,
      });
      expect(said).toMatch(/^New session created \(agent-host-session:\/\/claude\/[0-9a-f-]+\)\.$/);
      await settle();
      const added = p.notes.find((one) => one.method === 'root/sessionAdded');
      const summary = (added?.params as { summary?: { resource: string; title: string; workingDirectories: string[] } } | undefined)?.summary;
      expect(summary?.title).toBe('Port the makefile');
      // Held under its provider's name, as a client's `createSession` is.
      expect(summary?.resource).toMatch(/^ahp-session:\/[0-9a-f-]+$/);
      expect(summary?.workingDirectories).toEqual([uriOf(HERE)]);
      // Its first turn, as the creating agent's.
      const chat = (await client.handle({ method: 'subscribe', params: { channel: summary?.resource } }) as {
        snapshot: { state: { defaultChat: string } };
      }).snapshot.state.defaultChat;
      const state = (await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
        snapshot: { state: { activeTurn?: { message: unknown }; turns: { message: unknown }[] } };
      }).snapshot.state;
      const first = state.activeTurn ?? state.turns[0];
      expect(first?.message).toMatchObject({ text: 'port it', origin: { kind: 'agent' } });
      // And a second session's own tools answer about both.
      const rows = JSON.parse(await call('list_sessions', {})) as { sessions: { session: string }[] };
      expect(rows.sessions.map((one) => one.session)).toContain(summary?.resource);
      expect(rows.sessions.map((one) => one.session)).toContain('ahp-session:/served');
    });

    it('creates a chat in the current session for currentSession work, and refuses a workspace with it', async () => {
      const { client, peer: p, uri } = await withTools();
      await client.handle({ method: 'subscribe', params: { channel: uri } });
      const said = await call('create_session', { relationship: 'currentSession', title: 'Tests', prompt: 'write the tests' }, 0);
      expect(said).toMatch(/^Chat created in the current session \(agent-host-session:\/\/claude\/served\?chat=[0-9a-f-]+\)\.$/);
      await settle();
      const added = actions(p, uri).find((one) => one.action.type === 'session/chatAdded');
      expect((added?.action.summary as { title?: string } | undefined)?.title).toBe('Tests');
      expect(await call('create_session', { relationship: 'currentSession', title: 'x', prompt: 'y', workspace: '/tmp' }, 0)).toContain('only valid with relationship "independent"');
      expect(await call('create_session', { relationship: 'sideways', title: 'x', prompt: 'y' }, 0)).toContain('relationship must be');
    });

    it('renames the calling chat, which is the session when it is the default one', async () => {
      const { client, peer: p, uri, held } = await withTools();
      await client.handle({ method: 'subscribe', params: { channel: uri } });
      expect(await call('rename_chat', { title: '  Kqueue   port ' })).toBe('Renamed chat to "Kqueue port".');
      expect(actions(p, uri).find((one) => one.action.type === 'session/titleChanged')?.action.title).toBe('Kqueue port');
      const rows = JSON.parse(await call('list_sessions', { session: held })) as { sessions: { title: string }[] };
      expect(rows.sessions[0]?.title).toBe('Kqueue port');
      expect(await call('rename_chat', { title: 'Auto', automatic: true })).toBe('Renaming chat.');
      expect(await call('rename_chat', { title: '   ' })).toContain('title must be a non-empty string');
    });

    it('renames a peer chat as a chat, by its link', async () => {
      const { client, peer: p, uri } = await withTools();
      await client.handle({ method: 'subscribe', params: { channel: uri } });
      const made = await call('create_chat', { prompt: 'look at the tests' }, 0);
      const link = /\((agent-host-session:[^)]+)\)/.exec(made)?.[1] as string;
      expect(link).toContain('?chat=');
      p.notes.length = 0;
      expect(await call('rename_chat', { chat: link, title: 'Tests' }, 0)).toBe('Renamed chat to "Tests".');
      const updated = actions(p, uri).find((one) => one.action.type === 'session/chatUpdated');
      expect(updated?.action.changes).toEqual({ title: 'Tests' });
      expect(actions(p, uri).some((one) => one.action.type === 'session/titleChanged')).toBe(false);
    });

    it('gives a session rename_chat without the automatic argument, deferred, and still runs an explicit rename', async () => {
      const { client, uri } = await withTools();
      const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { serverTools?: { name: string; description?: string; inputSchema?: { properties?: Record<string, unknown> } }[] } };
      }).snapshot.state;
      const rename = state.serverTools?.find((one) => one.name === 'rename_chat');
      expect(rename).toBeDefined();
      expect(rename?.inputSchema?.properties).not.toHaveProperty('automatic');
      expect(rename?.description).toContain('Automatic naming is handled by the host');
      // Deferred is the strategy a session runs under whatever was pushed, and
      // the hint that says so is the host's own: the backend turns it into the
      // eager flag a harness reads, and the published definition never carries it.
      const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: { name: string; _meta?: Record<string, unknown> }[] }>;
      expect(servers.ahp?.tools.find((one) => one.name === 'rename_chat')?._meta).toEqual({ 'anthropic/alwaysLoad': false });
      // Every other tool is offered, the artifact one included: the strategy
      // shapes rename_chat alone.
      expect(state.serverTools?.map((one) => one.name)).toContain('add_artifact_or_reference');
      // And the model can still rename when the user asks, without `automatic`.
      expect(await call('rename_chat', { title: 'Kqueue port' })).toBe('Renamed chat to "Kqueue port".');
    });

    it('deletes another session and refuses its own', async () => {
      const { client, peer: p, held } = await withTools();
      await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
      await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/doomed', provider: 'claude' } });
      expect(await call('delete_session', { session: held }, 0)).toContain('refusing to delete the current session');
      expect(await call('delete_session', { session: 'ahp-session:/doomed' }, 0))
        .toBe('Deleted session ahp-session:/doomed. Reply with one short sentence confirming the session was deleted.');
      expect(p.notes.some((one) => one.method === 'root/sessionRemoved'
        && (one.params as { session?: string }).session === 'ahp-session:/doomed')).toBe(true);
      const rows = JSON.parse(await call('list_sessions', {}, 0)) as { sessions: { session: string }[] };
      expect(rows.sessions.map((one) => one.session)).not.toContain('ahp-session:/doomed');
    });

    it('reads another chat\'s turns, cut to the detail asked for', async () => {
      const { client, chatUri: mine } = await (async () => {
        const made = await withTools();
        const chat = (await made.client.handle({ method: 'subscribe', params: { channel: made.uri } }) as {
          snapshot: { state: { defaultChat: string } };
        }).snapshot.state.defaultChat;
        return { ...made, chatUri: chat };
      })();
      await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/reader', provider: 'claude' } });
      // A turn in the first session, said and answered.
      client.handle({
        method: 'dispatchAction',
        params: { channel: mine, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'what is in this directory' } } },
      });
      await settle();
      const first = sessionQueries()[0];
      if (!first) throw new Error('no first session');
      first.frames.push(
        { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Four files.' }] } },
        { type: 'result', subtype: 'success', is_error: false, duration_ms: 4 },
      );
      first.wake?.();
      first.wake = undefined;
      await settle(8);
      // Read from the second session's tools.
      const said = JSON.parse(await call('get_session_context', { session: 'ahp-session:/served', detail: 'digest' })) as {
        openLink: string; transcript: { turn: number; state: string; user?: string; assistant?: string }[];
      };
      expect(said.openLink).toBe('agent-host-session://claude/served');
      expect(said.transcript).toEqual([{ turn: 1, state: 'complete', user: 'what is in this directory', assistant: 'Four files.' }]);
      expect(await call('get_session_context', { session: 'ahp-session:/served', detail: 'everything' })).toContain('detail must be');
    });

    it('moves the session once the turn that asked is over, and tells the agent where it is', async () => {
      const { client, peer: p, uri, chatUri } = await (async () => {
        const host = createHost({
          path: '/home/softov', agents: [claude({ paths: ['/home/softov', '/tmp'] })], ...machine(), tools: hostTools(),
        });
        const p_ = peer();
        // The window vouches for the folder it is moving into, which is asked
        // about before the session is started there.
        p_.request = async () => ({ trusted: true });
        const client_ = host.accept(p_);
        await client_.handle(hello(['0.9.0']));
        const uri_ = 'ahp-session:/mover';
        await client_.handle({ method: 'createSession', params: { channel: uri_, provider: 'claude' } });
        const chat = (await client_.handle({ method: 'subscribe', params: { channel: uri_ } }) as {
          snapshot: { state: { defaultChat: string } };
        }).snapshot.state.defaultChat;
        await client_.handle({ method: 'subscribe', params: { channel: chat } });
        return { client: client_, peer: p_, uri: uri_, chatUri: chat };
      })();
      // Not from outside a turn: there is nothing to wait for the end of.
      expect(await call('set_workspace', { workspaceFolder: '/tmp', isolation: false })).toContain('must run from an active chat turn');
      client.handle({
        method: 'dispatchAction',
        params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'work in /tmp' } } },
      });
      await settle();
      const said = await call('set_workspace', { workspaceFolder: 'file:///tmp', isolation: false });
      expect(said).toContain(`Workspace will be set to ${uriOf('/tmp')} after this turn ends`);
      // Nothing moved yet: the turn is still running.
      expect(actions(p, uri).some((one) => one.action.type === 'session/workingDirectoryReplaced')).toBe(false);
      await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
      await settle(8);
      const moved = actions(p, uri).find((one) => one.action.type === 'session/workingDirectoryReplaced');
      expect(moved?.action).toMatchObject({ directory: uriOf('/home/softov'), replacement: uriOf('/tmp') });
      // Restarted there, resumed, and told so in a turn the window will not
      // draw as somebody's request, will list under a label rather than the
      // prompt, and will still credit with the file changes made in it: the
      // reference host's own continuation turn, key for key.
      const restarted = sessionQueries().at(-1);
      expect(restarted?.options.cwd).toBe(resolve('/tmp'));
      const notice = actions(p, chatUri).filter((one) => one.action.type === 'chat/turnStarted').at(-1);
      expect(notice?.action.message).toMatchObject({
        origin: { kind: 'systemNotification' },
        _meta: {
          'vscode.chat.requestHiddenFromTranscript': true,
          'vscode.chat.systemInitiatedLabel': 'Continue in Requested Workspace',
          'vscode.chat.workspaceContinuation': true,
        },
      });
      expect(String((notice?.action.message as { text: string }).text)).toContain(resolve('/tmp'));
    });

    it('names a folder with a # in the worktree message as a valid URI', async () => {
      /*
       * The answer names the folder as a URI, and a `#` in a path is where a
       * URI's fragment begins: `file:///home/softov/a#b` is the folder `a`
       * with a fragment, and a client that opens it opens the wrong place.
       * The folder is signed in with the trust port either way, which is why
       * only the words of the answer are under test here.
       */
      const host = createHost({
        path: '/home/softov', agents: [claude({ paths: ['/home/softov', '/tmp'] })], ...machine(), tools: hostTools(),
      });
      const p = peer();
      p.request = async () => ({ trusted: true });
      const client = host.accept(p);
      await client.handle(hello(['0.9.0']));
      const uri = 'ahp-session:/hashed';
      await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
      const chat = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { defaultChat: string } };
      }).snapshot.state.defaultChat;
      await client.handle({ method: 'subscribe', params: { channel: chat } });
      client.handle({
        method: 'dispatchAction',
        params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'work in the hashed folder' } } },
      });
      await settle();
      const worktree = await call('set_workspace', { workspaceFolder: 'file:///home/softov/a%23b', isolation: true });
      expect(worktree).toContain(`An isolated worktree will be created from ${uriOf('/home/softov/a#b')} and set as the workspace`);
      const direct = await call('set_workspace', { workspaceFolder: '/home/softov/a#b', isolation: false });
      expect(direct).toContain(`Workspace will be set to ${uriOf('/home/softov/a#b')} after this turn ends`);
    });
  });

  it('replaces the set whole, and tells every running session', async () => {
    const { host, client, peer: p, uri } = await withTools();
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    host.setTools([]);
    const said = p.notes
      .map((one) => one.params as { channel?: string; action?: { type?: string; tools?: unknown[] } })
      .filter((one) => one.action?.type === 'session/serverToolsChanged');
    expect(said).toHaveLength(1);
    // Full replacement: the action carries the new set, not the difference.
    expect(said[0]?.channel).toBe(uri);
    expect(said[0]?.action?.tools).toEqual([]);
  });

  it('reads what a client published, which is the only thing that can', async () => {
    const served = createHost({
      path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), tools: hostTools(),
    });
    /*
     * A second client, publishing something this machine has no copy of.
     *
     * `<scheme>://<clientId>/…` is how a client-served resource is addressed,
     * and answering one is what the reverse `resource*` direction exists for:
     * a plugin's virtual files, an editor's unsaved buffers. The agent inside
     * a session cannot open any of it, so the host's own tool asks the client.
     */
    const publisher = peer();
    publisher.request = async () => ({ data: 'ZG9uZQ==', encoding: 'base64' });
    const other = served.accept(publisher);
    await other.handle({ method: 'initialize', params: { clientId: 'plugin', protocolVersions: ['0.9.0'] } });

    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/reads', provider: 'claude' } });
    const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: {
      name: string; handler: (input: unknown) => Promise<{ content: { text: string }[] }>;
    }[] }>;
    const said = await servers.ahp?.tools.find((one) => one.name === 'ahp_resource')
      ?.handler({ uri: 'virtual://plugin/notes.md' });
    // Decoded, because a tool result is text and the model reads it.
    expect(said?.content[0]?.text).toBe('done');
  });

  it('lists the terminals this host has open', async () => {
    const { client } = await withTools();
    await client.handle({
      method: 'createTerminal',
      // `echo` is a command a POSIX shell and PowerShell both run; `true` is a
      // program only the first has.
      params: { channel: 'ahp-terminal:/t1', cwd: 'file:///home/softov', command: 'echo' },
    });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/asks', provider: 'claude' } });
    const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: {
      name: string; handler: (input: unknown) => Promise<{ content: { text: string }[] }>;
    }[] }>;
    const said = await servers.ahp?.tools.find((one) => one.name === 'ahp_terminals')?.handler({});
    expect(said?.content[0]?.text).toContain('ahp-terminal:/t1');
  });

  it('names the person behind a call, the session owner when no turn runs, and the host when neither', async () => {
    const who = {
      definition: { name: 'who', description: 'who', inputSchema: { type: 'object' as const, properties: {} } },
      run: (_input: Record<string, unknown>, at: ToolCall) => at.person() ?? 'nobody',
    };
    const ana: Principal = { id: 'ana', roles: [], can: () => true };
    const users = {
      resource: { resource: 'ahpd://users', resource_name: 'ahpd users', authorization_servers: [], required: false },
      verify: async () => ana,
    } as unknown as Users;

    /** A host with the `who` tool, and one session of it, with somebody where `people` says so. */
    const opened = async (people: boolean) => {
      const host = createHost({
        path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), tools: [who],
        ...(people ? { users } : {}),
      });
      const client = host.accept(peer(), people ? ana : undefined);
      await client.handle(hello(['0.9.0']));
      await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/who', provider: 'claude' } });
      await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/who' } });
      const person = async (): Promise<string | undefined> => {
        const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, {
          tools: { name: string; handler: (input: unknown) => Promise<{ content: { text: string }[] }> }[];
        }> | undefined;
        const tool = servers?.ahp?.tools.find((one) => one.name === 'who');
        return (await tool?.handler({}))?.content[0]?.text;
      };
      return { client, person };
    };

    // No turn runs yet, so the session's owner answers.
    const plenty = await opened(true);
    expect(await plenty.person()).toBe('user:ana');

    // A turn sent by her gives the person the host knows behind that owner.
    await plenty.client.handle({ method: 'dispatchAction', params: {
      channel: 'ahp-chat:/who',
      action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'who am I' } },
    } });
    await settle();
    expect(await plenty.person()).toBe('ana');

    // A host with no users directory has nobody to name but itself.
    const bare = await opened(false);
    expect(await bare.person()).toBe('host');
  });
});

/*
 * Which sessions are offered the session tools.
 *
 * The nine that read and move the sessions running beside this one are what a
 * daemon's `sessionTools` covers - decision
 * `a-session-tool-acts-as-the-person-it-works-for` - and the switch the person
 * asked for on top of it. It is two keys, because one key cannot be both a
 * boolean and a list: `sessionTools` is the on/off, and `sessionToolsProviders`
 * narrows it to the providers it names. Nothing else this host contributes is
 * affected, and a case below holds that the artifact tools and
 * `schedule_wakeup` are offered whatever the two say.
 */
describe('the session tools, which an install may switch off', () => {
  type SessionClient = ReturnType<ReturnType<typeof createHost>['accept']>;

  /** The six the option never covers: this host's own, in the order they are offered. */
  const HOST_OWN = [
    'add_artifact_or_reference', 'remove_artifact_or_reference', 'list_artifacts_and_references',
    'ahp_resource', 'ahp_terminals', 'schedule_wakeup',
  ];

  /** The tool names one session's state carries, as a client reads them. */
  const offered = async (client: SessionClient, uri: string): Promise<string[]> => {
    const { snapshot } = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { serverTools?: { name: string }[] } };
    };
    return snapshot.state.serverTools?.map((one) => one.name) ?? [];
  };

  /**
   * The example backend, keeping the `Start` it was handed.
   *
   * `Start.tools` is what a backend is given to call, so this is the half that
   * is not the wire: a tool left out of it is one a model is never offered
   * rather than one it is refused at call time.
   */
  const recording = () => {
    const base = echo({ path: '/home/softov', pace: 0 });
    const seen: Start[] = [];
    const agent: Agent = {
      ...base,
      create: (start: Start) => {
        seen.push(start);
        return base.create(start);
      },
    };
    return { seen, agent };
  };

  const boundNames = (seen: Start[], at = 0): string[] =>
    (seen.at(at)?.tools ?? []).map((one) => one.definition.name);

  it('are all left out when the option is false, and the host\'s own still offered', async () => {
    const { seen, agent } = recording();
    const host = createHost({
      path: '/home/softov', agents: [agent], ...machine(), tools: hostTools(), sessionTools: false,
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/off';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });

    // Neither reported nor bound: what a client draws and what a model is
    // handed say the same thing.
    expect(await offered(client, uri)).toEqual(HOST_OWN);
    expect(boundNames(seen)).toEqual(HOST_OWN);
  });

  it('are offered to the providers a list names and to no others', async () => {
    const { seen, agent } = recording();
    const host = createHost({
      path: '/home/softov', agents: [claude({ paths: ['/home/softov'] }), agent], ...machine(),
      tools: hostTools(), sessionToolsProviders: ['claude'],
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/mine', provider: 'claude' } });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/other', provider: 'echo' } });

    expect(await offered(client, 'ahp-session:/mine')).toContain('list_sessions');
    // The provider it was not named for is offered the host's own and nothing
    // of the session tools, on the wire and in the binding both.
    expect(await offered(client, 'ahp-session:/other')).toEqual(HOST_OWN);
    // Only the echo agent is recorded, so the one `Start` kept is its own: the
    // session whose provider the list does not name is handed the same six.
    expect(boundNames(seen)).toEqual(HOST_OWN);
  });

  it('are rebuilt on a session already running when either daemon key is written', async () => {
    // A port holding the two keys, so what the daemon holds is what a write left.
    const held: Record<string, unknown> = {};
    const rootConfig: NonNullable<HostOptions['rootConfig']> = {
      schema: () => ({
        type: 'object',
        properties: {
          sessionTools: { type: 'boolean', title: 'Session tools', description: 'Offer the session tools.' },
          sessionToolsProviders: {
            type: 'array', items: { type: 'string' },
            title: 'Session tool providers', description: 'Offer them to these providers alone.',
          },
        },
      }),
      values: async () => ({ ...held }),
      write: async (values) => {
        for (const [key, one] of Object.entries(values)) {
          if (one === null || one === undefined) delete held[key];
          else held[key] = one;
        }
        return {};
      },
    };
    const host = createHost({
      path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), tools: hostTools(), rootConfig,
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: [ROOT] }));
    const uri = 'ahp-session:/live';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
    expect(await offered(client, uri)).toContain('list_sessions');

    /** One push, and the sessions told of it, kept apart from the last. */
    const push = async (config: Record<string, unknown>): Promise<{ name: string }[]> => {
      p.notes.length = 0;
      await client.handle({ method: 'dispatchAction', params: { channel: ROOT, action: { type: 'root/configChanged', config } } });
      await settle();
      const told = actions(p, uri).filter((one) => one.action.type === 'session/serverToolsChanged');
      expect(told).toHaveLength(1);
      return (told[0]?.action.tools ?? []) as { name: string }[];
    };

    // Off, told whole - the action carries the new set rather than the
    // difference - and the session's own state follows it.
    expect((await push({ sessionTools: false })).map((one) => one.name)).toEqual(HOST_OWN);
    expect(await offered(client, uri)).toEqual(HOST_OWN);

    // On again, by taking the key away: a null is how a client says so, and
    // the daemon then holds no value at all, which is the `true` default.
    expect((await push({ sessionTools: null })).map((one) => one.name)).toContain('list_sessions');
    expect(await offered(client, uri)).toContain('list_sessions');

    // The second key narrows rather than switches, and this session runs the
    // provider it names, so it keeps them.
    expect((await push({ sessionToolsProviders: ['claude'] })).map((one) => one.name)).toContain('list_sessions');
    // One it does not name loses them, on the wire and on the session's state.
    expect((await push({ sessionToolsProviders: ['echo'] })).map((one) => one.name)).toEqual(HOST_OWN);
    expect(await offered(client, uri)).toEqual(HOST_OWN);

    // The switch beats the list: the list names this session's provider and
    // the session is offered none all the same.
    expect((await push({ sessionTools: false })).map((one) => one.name)).toEqual(HOST_OWN);
    expect(await offered(client, uri)).toEqual(HOST_OWN);

    // Back to every provider takes both keys cleared, and neither on its own
    // is the default: the list alone leaves the switch off, and the switch
    // alone leaves a list that does not name this session's provider.
    expect((await push({ sessionToolsProviders: null })).map((one) => one.name)).toEqual(HOST_OWN);
    expect((await push({ sessionTools: null })).map((one) => one.name)).toContain('list_sessions');
    expect(await offered(client, uri)).toContain('list_sessions');
  });

  it('stay off as the line set them when a push names neither key', async () => {
    // The file holds no session tool key, so only the host's option says off.
    const held: Record<string, unknown> = {};
    const rootConfig: NonNullable<HostOptions['rootConfig']> = {
      schema: () => ({
        type: 'object',
        properties: {
          sessionTools: { type: 'boolean', title: 'Session tools', description: 'Offer the session tools.' },
          closedChats: { type: 'string', enum: ['hidden', 'delete'], title: 'Closed chats', description: 'What closing a chat does.' },
        },
      }),
      values: async () => ({ ...held }),
      write: async (values) => {
        for (const [key, one] of Object.entries(values)) held[key] = one;
        return {};
      },
    };
    const host = createHost({
      path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), tools: hostTools(),
      rootConfig, sessionTools: false,
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: [ROOT] }));
    const uri = 'ahp-session:/line';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
    expect(await offered(client, uri)).toEqual(HOST_OWN);

    p.notes.length = 0;
    await client.handle({ method: 'dispatchAction', params: { channel: ROOT, action: { type: 'root/configChanged', config: { closedChats: 'delete' } } } });
    await settle();
    expect(actions(p, uri).filter((one) => one.action.type === 'session/serverToolsChanged')).toHaveLength(0);
    expect(await offered(client, uri)).toEqual(HOST_OWN);
  });
});

describe('the MCP servers a session is offered', () => {
  /**
   * The example backend, keeping every `Start` it was handed.
   *
   * `Start` is the one place a session's servers reach a backend, so what is
   * read here is what the host decided rather than what a harness went on to
   * declare with them.
   */
  const recording = (pace = 0) => {
    const base = echo({ path: '/home/softov', pace });
    const seen: Start[] = [];
    const agent: Agent = {
      ...base,
      create: (start: Start) => {
        seen.push(start);
        return base.create(start);
      },
    };
    return { seen, agent };
  };

  /** What one session's backend was given, on a host holding these servers. */
  const offered = async (mcpServers: Record<string, McpServer> | undefined) => {
    const { seen, agent } = recording();
    const host = createHost({
      path: '/home/softov',
      agents: [agent],
      ...machine(),
      ...(mcpServers === undefined ? {} : { mcpServers }),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/served', provider: 'echo' } });
    return seen.at(0)?.mcpServers;
  };

  it('are the host\'s own, in both shapes and under the names they were given', async () => {
    const files: McpServer = { type: 'stdio', command: 'mcp-files', args: ['--root', '/home/softov'] };
    const api: McpServer = { type: 'http', url: 'https://example.test/mcp', headers: { authorization: 'Bearer k' } };
    expect(await offered({ files, api })).toEqual({ files, api });
  });

  /*
   * Nothing where the host configured none.
   *
   * Absent rather than an empty map, because a backend that reads the field has
   * no other way to tell a host with no servers from a host that never heard of
   * them, and the answer to either is the same. A client plugin's servers are
   * merged into this one, and there is nothing to merge yet - the half of the
   * merge that is a plugin's comes with the first one.
   */
  it('are absent on a host that was given none', async () => {
    expect(await offered(undefined)).toBeUndefined();
    expect(await offered({})).toBeUndefined();
  });

  it('are read when the session starts, so an edit reaches the next one', async () => {
    const files: Record<string, McpServer> = { files: { type: 'stdio', command: 'mcp-files' } };
    const api: Record<string, McpServer> = { api: { type: 'http', url: 'https://example.test/mcp' } };
    const { seen, agent } = recording();
    // A host on a map a client can edit over root config, which is what the
    // daemon hands: the key is read at the start rather than held at the boot.
    let held: Record<string, McpServer> = files;
    const host = createHost({
      path: '/home/softov',
      agents: [agent],
      ...machine(),
      get mcpServers() { return held; },
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
    held = api;
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/two', provider: 'echo' } });
    expect(seen.map((one) => one.mcpServers)).toEqual([files, api]);
  });

  /*
   * A client plugin, from the client that holds one to the backend that runs
   * on it.
   *
   * The plugin is a tree held in memory by a second connection, and the copy
   * is a real directory - so what these check is the whole path: the client's
   * files over `resourceList` and `resourceRead`, the copy this host makes, and
   * what the next spawn is handed.
   */

  const PLUGIN = 'virtual://plugin/one';
  /** The plugin's own tree, with a server named `a` - which the host names too. */
  const PLUGIN_TREE: Record<string, string> = {
    [`${PLUGIN}/.mcp.json`]: JSON.stringify({
      mcpServers: { a: { type: 'stdio', command: 'bin/server', args: ['--root', '.'] } },
    }),
  };
  /**
   * The same plugin in a format this host reads, so it has parts to switch.
   *
   * `two` is the one a test switches: `a` is the host's name as well, and a
   * case about a server of a plugin being left out is not about the clash.
   */
  const PARTED_TREE: Record<string, string> = {
    [`${PLUGIN}/.claude-plugin/plugin.json`]: '{"name":"one"}',
    [`${PLUGIN}/.mcp.json`]: JSON.stringify({
      mcpServers: {
        a: { type: 'stdio', command: 'bin/server', args: ['--root', '.'] },
        two: { type: 'stdio', command: 'bin/two' },
      },
    }),
  };

  const dirs: string[] = [];
  // Awaited, with retries: on Windows a process the case started can hold the folder a moment longer.
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  /** Settle until something is true, giving it real time to happen. */
  const until = async (ready: () => boolean, ms = 2000): Promise<void> => {
    const end = Date.now() + ms;
    while (!ready() && Date.now() < end) await new Promise((r) => { setTimeout(r, 5); });
  };

  /**
   * A client whose plugin is a tree held in memory.
   *
   * The two `resource*` methods a copy is made of, answered from a map: that
   * is the whole of what a client has to do for a plugin of its own to reach a
   * session here.
   */
  const pluginPeer = (tree: Record<string, string>): ReturnType<typeof peer> => {
    const entriesOf = (uri: string): { name: string; type: string }[] => {
      const prefix = uri.endsWith('/') ? uri : `${uri}/`;
      const found: { name: string; type: string }[] = [];
      for (const path of Object.keys(tree)) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (!found.some((one) => one.name === name)) found.push({ name, type: slash === -1 ? 'file' : 'directory' });
      }
      return found;
    };
    return {
      ...peer(),
      request: async (method: string, params: unknown) => {
        const uri = String((params as { uri?: unknown }).uri ?? '');
        if (method === 'resourceList') return { entries: entriesOf(uri) };
        if (method === 'resourceRead') {
          const data = tree[uri];
          if (data === undefined) throw new Error(`${uri} is not there`);
          return { data, encoding: 'utf-8' };
        }
        return {};
      },
    };
  };

  /**
   * A session, a client holding a plugin, and every `Start` the backend took.
   *
   * The plugin is announced by a second connection, which is what a client
   * with plugins of its own is - and the host's own servers are named so that
   * one of them clashes with the plugin's.
   */
  async function withClientPlugin(pace = 0, tree: Record<string, string> = PLUGIN_TREE) {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-host-plugins-'));
    dirs.push(dir);
    const base = echo({ path: dir, pace });
    const seen: Start[] = [];
    const agent: Agent = {
      ...base,
      create: (start: Start) => { seen.push(start); return base.create(start); },
    };
    let host: ReturnType<typeof createHost>;
    host = createHost({
      path: dir,
      agents: [agent],
      ...machine(),
      mcpServers: { a: { type: 'stdio', command: 'host-a' }, b: { type: 'stdio', command: 'host-b' } },
      clientPlugins: clientPluginsIn(join(dir, 'copies'), () => host.clients),
    });
    const uri = 'ahp-session:/served';
    // The peer itself, because what a client was told is what it was *sent*.
    const watching = peer();
    const watch = host.accept(watching);
    await watch.handle(hello(['0.9.0']));
    await watch.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
    const opened = await watch.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    const chat = opened.snapshot.state.defaultChat;
    await watch.handle({ method: 'subscribe', params: { channel: chat } });

    const holderPeer = pluginPeer(tree);
    const holder = host.accept(holderPeer);
    await holder.handle(hello(['0.9.0'], { clientId: 'holder' }));
    await holder.handle({ method: 'subscribe', params: { channel: uri } });

    /** Whether the plugin has been reported on the session, and settled. */
    const loaded = (): boolean => actions(watching, uri)
      .filter((one) => one.action.type === 'session/customizationsChanged')
      .some((one) => ((one.action.customizations as Record<string, unknown>[]) ?? [])
        .some((one) => one.uri === PLUGIN && (one.load as { kind: string }).kind === 'loaded'));
    /** How many turns have been watched to their end. */
    const finished = (): number => actions(watching, chat)
      .filter((one) => one.action.type === 'chat/turnComplete').length;
    /** The id the host published the plugin under, which is what a toggle names. */
    const pluginId = (): string => String(actions(watching, uri)
      .filter((one) => one.action.type === 'session/customizationUpdated')
      .map((one) => one.action.customization as Record<string, unknown>)
      .findLast((one) => one.uri === PLUGIN)?.id ?? '');
    /** The id the host published one of its parts under, which is what a toggle names. */
    const partId = (name: string): string => {
      const last = actions(watching, uri)
        .filter((one) => one.action.type === 'session/customizationUpdated')
        .map((one) => (one.action.customization as { children?: { id?: unknown; name?: unknown }[] }).children)
        .filter((list) => list !== undefined)
        .at(-1) ?? [];
      return String(last.find((one) => one.name === name)?.id ?? '');
    };

    return {
      dir, seen, loaded, finished,
      /** Everything this host said back to the client that asked, as a refusal. */
      refused: (): string[] => actions(holderPeer, uri)
        .map((one) => one.rejectionReason)
        .filter((one) => one !== undefined),
      /** A turn, which is the moment a chat is handed the set its session has. */
      send: (turnId: string, text = 'hi') => watch.handle({
        method: 'dispatchAction',
        params: { channel: chat, action: { type: 'chat/turnStarted', turnId, message: { text } } },
      }),
      /** The plugin, as the client holding it announces it. */
      announce: (extra: Record<string, unknown> = {}) => holder.handle({
        method: 'dispatchAction',
        params: {
          channel: uri,
          action: {
            type: 'session/activeClientSet',
            activeClient: { customizations: [{ type: 'plugin', uri: PLUGIN, nonce: 'n1', ...extra }], tools: [] },
          },
        },
      }),
      /** One client's decision about it, named as the host published it. */
      toggle: (enabled: boolean, id = pluginId()) => holder.handle({
        method: 'dispatchAction',
        params: {
          channel: uri,
          action: {
            type: 'session/customizationToggled',
            id,
            enablement: [{ kind: 'session', enabled }],
          },
        },
      }),
      /** One client's decision about a server of it. */
      togglePart: (name: string, enabled: boolean) => holder.handle({
        method: 'dispatchAction',
        params: {
          channel: uri,
          action: {
            type: 'session/customizationToggled',
            id: partId(name),
            enablement: [{ kind: 'session', enabled }],
          },
        },
      }),
    };
  }

  it('hand a session its client plugin\'s copy, over the plugin\'s server', async () => {
    const held = await withClientPlugin();
    // The session started before anything was announced, so it was handed the
    // host's own two servers and no plugin directory at all.
    expect(held.seen.at(0)?.plugins).toBeUndefined();

    await held.announce();
    await until(() => held.loaded());
    await held.send('t1');
    await settle();

    // A send is where the set reaches the chat: it was started without one, so
    // it is started again with it.
    expect(held.seen).toHaveLength(2);
    const last = held.seen.at(-1);
    const at = last?.plugins?.[0]?.path ?? '';
    expect(at.startsWith(join(held.dir, 'copies'))).toBe(true);
    // `a` is the plugin's, which is what a client's server winning a clash
    // means; `b` is the host's and is untouched. The plugin's command is
    // written relative to the plugin, so it is resolved against the copy.
    expect(last?.mcpServers).toEqual({
      a: { type: 'stdio', command: join(at, 'bin', 'server'), args: ['--root', '.'] },
      b: { type: 'stdio', command: 'host-b' },
    });
  });

  it('start the chat again only when the set of plugins has moved', async () => {
    const held = await withClientPlugin();
    await held.announce();
    await until(() => held.loaded());
    await held.send('t1');
    await settle();
    expect(held.seen).toHaveLength(2);

    // The same set, still: a send on an idle chat that already has it is not a
    // reason to start anything again.
    await held.send('t2');
    await settle();
    expect(held.seen).toHaveLength(2);
  });

  it('start the chat again without the plugin a client switched off', async () => {
    const held = await withClientPlugin();
    await held.announce();
    await until(() => held.loaded());
    await held.send('t1');
    await settle();

    await held.toggle(false);
    await settle();
    await held.send('t2');
    await settle();

    // Started again, and back to the host's own two: the plugin's `a` went
    // with the plugin, and the host's `a` is under that name again.
    expect(held.seen).toHaveLength(3);
    expect(held.seen.at(-1)?.plugins).toBeUndefined();
    expect(held.seen.at(-1)?.mcpServers).toEqual({
      a: { type: 'stdio', command: 'host-a' },
      b: { type: 'stdio', command: 'host-b' },
    });
  });

  it('leave a server a client switched off out of what the agent is given', async () => {
    const held = await withClientPlugin(0, PARTED_TREE);
    await held.announce();
    await until(() => held.loaded());
    await held.send('t1');
    await settle();

    const at = held.seen.at(-1)?.plugins?.[0]?.path ?? '';
    // Both of the plugin's servers, one of them over the host's own of that
    // name, and nothing held back.
    const pluginServers = {
      a: { type: 'stdio', command: join(at, 'bin', 'server'), args: ['--root', '.'] },
      two: { type: 'stdio', command: join(at, 'bin', 'two') },
    };
    expect(held.seen.at(-1)?.mcpServers).toEqual({ ...pluginServers, b: { type: 'stdio', command: 'host-b' } });
    expect(held.seen.at(-1)?.deniedMcpServers).toBeUndefined();

    await held.togglePart('two', false);
    await settle();
    await held.send('t2');
    await settle();

    // Started again without it, because what the agent may run moved even
    // though the directories did not - and it is named as well, so the CLI is
    // told not to run one however else it might find one.
    expect(held.seen.at(-1)?.mcpServers).toEqual({ a: pluginServers.a, b: { type: 'stdio', command: 'host-b' } });
    expect(held.seen.at(-1)?.deniedMcpServers).toEqual(['two']);

    await held.togglePart('two', true);
    await settle();
    await held.send('t3');
    await settle();

    // Switched back on, and both halves move back with it.
    expect(held.seen.at(-1)?.mcpServers).toEqual({ ...pluginServers, b: { type: 'stdio', command: 'host-b' } });
    expect(held.seen.at(-1)?.deniedMcpServers).toBeUndefined();
  });

  it('take a part toggle on a backend with no runtime switch without refusing it', async () => {
    const held = await withClientPlugin(0, PARTED_TREE);
    await held.announce();
    await until(() => held.loaded());
    await held.send('t1');
    await settle();

    // This backend answers every switch with no. The decision is the host's
    // either way, so nothing is said back, and the send after it is where the
    // switch takes effect.
    await held.togglePart('two', false);
    await settle();
    expect(held.refused()).toEqual([]);

    await held.send('t2');
    await settle();
    expect(held.seen.at(-1)?.deniedMcpServers).toEqual(['two']);
    expect(held.seen.at(-1)?.mcpServers).not.toHaveProperty('two');
  });

  it('leave a server out that a client had already switched off when it announced the plugin', async () => {
    const held = await withClientPlugin(0, PARTED_TREE);
    // A decision the plugin arrived with, which is the same answer as a toggle
    // and the other half of what a client says about a server of its own.
    await held.announce({ childEnablement: { two: [{ kind: 'global', enabled: false }] } });
    await until(() => held.loaded());
    await held.send('t1');
    await settle();

    const at = held.seen.at(-1)?.plugins?.[0]?.path ?? '';
    expect(held.seen.at(-1)?.mcpServers).toEqual({
      a: { type: 'stdio', command: join(at, 'bin', 'server'), args: ['--root', '.'] },
      b: { type: 'stdio', command: 'host-b' },
    });
    expect(held.seen.at(-1)?.deniedMcpServers).toEqual(['two']);
  });

  it('find none of a plugin\'s servers once a client switches the plugin off', async () => {
    const held = await withClientPlugin(0, PARTED_TREE);
    await held.announce();
    await until(() => held.loaded());
    await held.send('t1');
    await settle();

    await held.toggle(false);
    await settle();
    await held.send('t2');
    await settle();

    // The plugin is not handed over at all, so both of its servers go with it
    // and neither needs naming: there is no directory left to find one in.
    expect(held.seen.at(-1)?.plugins).toBeUndefined();
    expect(held.seen.at(-1)?.mcpServers).toEqual({
      a: { type: 'stdio', command: 'host-a' },
      b: { type: 'stdio', command: 'host-b' },
    });
    expect(held.seen.at(-1)?.deniedMcpServers).toBeUndefined();
  });

  it('leave a running turn alone, and start the chat again at the send after it', async () => {
    // A paced backend, so there is a turn left running while the set moves
    // under it.
    const held = await withClientPlugin(10);
    await held.announce();
    await until(() => held.loaded());
    await held.send('t1', 'one two three four five six seven eight nine ten');
    await settle();
    expect(held.seen).toHaveLength(2);

    // Switched off mid-answer: the set has moved, and the chat the turn is
    // running in is not replaced under it.
    await held.toggle(false);
    await settle();
    expect(held.seen).toHaveLength(2);

    // The turn ran to its end, which a chat started again mid-answer would
    // have thrown away - the reply is the one it was already writing.
    await until(() => held.finished() >= 1);
    expect(held.finished()).toBe(1);

    // And the send that finds the chat idle is the one that hands it the set
    // the session has now.
    await held.send('t2');
    await settle();
    expect(held.seen).toHaveLength(3);
    expect(held.seen.at(-1)?.plugins).toBeUndefined();
  });
});

describe('tools a client contributes', () => {
  const OPEN_FILE = {
    name: 'openFile',
    description: 'Open a file in the editor',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  };

  /** A running session with one client that says it can run `openFile`. */
  async function providing(tools: unknown[] = [OPEN_FILE], clientToolTimeoutMs?: number) {
    const held = await running(clientToolTimeoutMs === undefined ? {} : { clientToolTimeoutMs });
    held.client.handle({
      method: 'dispatchAction',
      params: {
        channel: held.uri,
        action: { type: 'session/activeClientSet', activeClient: { name: 'VS Code', tools } },
      },
    });
    await settle();
    return held;
  }

  /** The tools the session is offering the model right now. */
  const offered = () => (sessionQueries().at(-1)?.options.mcpServers as Record<string, {
    tools: {
      name: string; description: string;
      handler: (input: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
    }[];
  }> | undefined)?.ahp?.tools ?? [];

  it('offers what a client announced to the model, under a name of its own', async () => {
    await providing();
    // Re-declared on the running session rather than only at creation: a
    // client announces what it provides when it opens the session, which is
    // after the agent has started.
    expect(sdk.mcpDeclared).toHaveLength(1);
    // Named for the client as well as the tool. Two clients in one session may
    // both provide `openFile`, and the model is offered one list.
    const one = offered().find((tool) => tool.name === 'probe__openFile');
    expect(one?.description).toBe('Open a file in the editor');
  });

  it('reports the call against the client that provides it, and waits for it', async () => {
    const { client, peer: p, uri, chatUri } = await providing();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'open it' } } },
    });
    await settle();
    await emit({
      type: 'assistant',
      uuid: 'reply-1',
      message: {
        id: 'm1',
        content: [{
          type: 'tool_use', id: 'call-1',
          name: 'mcp__ahp__probe__openFile', input: { path: '/a.txt' },
        }],
      },
    });

    /*
     * A client contributor, not this host's MCP server.
     *
     * The tools a client provides ride this host's own in-process server, so
     * by name they all look like `mcp__ahp__*` - and reporting one as this
     * host's contribution would tell every client that the call is nobody's
     * to answer, including the one whose call it is.
     */
    const started = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallStart');
    expect(started?.action.contributor).toEqual({ kind: 'client', clientId: 'probe' });

    // The model's call reaches the client as a promise that does not settle
    // until the client says what happened.
    const call = offered().find((tool) => tool.name === 'probe__openFile');
    let done = false;
    const answering = call?.handler({ path: '/a.txt' }).then((answer) => { done = true; return answer; });
    await settle();
    expect(done).toBe(false);

    client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        action: {
          type: 'chat/toolCallComplete',
          toolCallId: 'call-1',
          result: { success: true, pastTenseMessage: 'Opened it', content: [{ type: 'text', text: 'opened /a.txt' }] },
        },
      },
    });
    expect((await answering)?.content[0]?.text).toBe('opened /a.txt');
    expect(uri).toBeTruthy();
  });

  it('says a failed call failed, in the words the client used', async () => {
    const { client, chatUri } = await providing();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'open it' } } },
    });
    await settle();
    await emit({
      type: 'assistant',
      uuid: 'reply-1',
      message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 'call-1', name: 'mcp__ahp__probe__openFile', input: { path: '/gone' } }],
      },
    });
    const answering = offered().find((tool) => tool.name === 'probe__openFile')?.handler({ path: '/gone' });
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        action: {
          type: 'chat/toolCallComplete',
          toolCallId: 'call-1',
          result: { success: false, pastTenseMessage: 'Could not open it', error: { message: 'no such file' } },
        },
      },
    });
    // An MCP tool that rejects is a transport failure; one that could not do
    // the thing is an answer, and the model reads the reason.
    const answer = await answering;
    expect(answer?.isError).toBe(true);
    expect(answer?.content[0]?.text).toBe('no such file');
  });

  it('refuses a result from a client whose call it is not', async () => {
    const { host, client, chatUri } = await providing();
    const theirs = peer();
    const other = host.accept(theirs);
    await other.handle({
      method: 'initialize',
      params: { channel: 'ahp-root://', clientId: 'someone-else', protocolVersions: ['0.9.0'] },
    });
    await other.handle({ method: 'subscribe', params: { channel: chatUri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'open it' } } },
    });
    await settle();
    await emit({
      type: 'assistant',
      uuid: 'reply-1',
      message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 'call-1', name: 'mcp__ahp__probe__openFile', input: { path: '/a.txt' } }],
      },
    });
    void offered().find((tool) => tool.name === 'probe__openFile')?.handler({ path: '/a.txt' });
    await settle();

    other.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        action: { type: 'chat/toolCallComplete', toolCallId: 'call-1', result: { success: true } },
      },
    });
    await settle();
    // A result from anybody else is a client answering for work it did not do.
    const refused = actions(theirs).filter((e) => e.rejectionReason !== undefined).at(-1);
    expect(refused?.rejectionReason).toContain('is not a call someone-else is running here');

    // And the same for writing into the call while it runs, which the protocol
    // says is the contributor's alone.
    other.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        action: { type: 'chat/toolCallContentChanged', toolCallId: 'call-1', content: [] },
      },
    });
    await settle();
    expect(actions(theirs).filter((e) => e.rejectionReason !== undefined).at(-1)?.rejectionReason)
      .toContain('is probe\'s call');
  });

  it('relays what the owning client writes into its own call', async () => {
    const { host, client, chatUri } = await providing();
    const watching = peer();
    const other = host.accept(watching);
    await other.handle({
      method: 'initialize',
      params: { channel: 'ahp-root://', clientId: 'watcher', protocolVersions: ['0.9.0'] },
    });
    await other.handle({ method: 'subscribe', params: { channel: chatUri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'open it' } } },
    });
    await settle();
    await emit({
      type: 'assistant',
      uuid: 'reply-1',
      message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 'call-1', name: 'mcp__ahp__probe__openFile', input: { path: '/a.txt' } }],
      },
    });
    void offered().find((tool) => tool.name === 'probe__openFile')?.handler({ path: '/a.txt' });
    await settle();

    client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        clientSeq: 4,
        action: {
          type: 'chat/toolCallContentChanged',
          toolCallId: 'call-1',
          content: [{ type: 'text', text: 'reading…' }],
        },
      },
    });
    await settle();
    // Passed through rather than reduced: what a tool is printing as it runs
    // is the running client's to say, and this host holds none of it.
    const said = actions(watching, chatUri).find((e) => e.action.type === 'chat/toolCallContentChanged');
    expect(said?.action.toolCallId).toBe('call-1');
    expect(said?.origin).toEqual({ clientId: 'probe', clientSeq: 4 });
  });

  it('fails the calls of a client that goes, rather than leaving the turn hanging', async () => {
    const { client, uri, chatUri } = await providing();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'open it' } } },
    });
    await settle();
    await emit({
      type: 'assistant',
      uuid: 'reply-1',
      message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 'call-1', name: 'mcp__ahp__probe__openFile', input: { path: '/a.txt' } }],
      },
    });
    const answering = offered().find((tool) => tool.name === 'probe__openFile')?.handler({ path: '/a.txt' });
    await settle();

    // Unsubscribing is one of the three ways the protocol says a client stops
    // being active in a session.
    client.handle({ method: 'unsubscribe', params: { channel: uri } });
    await settle();
    const answer = await answering;
    expect(answer?.isError).toBe(true);
    expect(answer?.content[0]?.text).toContain('no longer here');

    // And the tool goes with the client: one whose provider has left is one
    // every call to would fail.
    expect(offered().some((tool) => tool.name === 'probe__openFile')).toBe(false);
  });

  /*
   * The same session, read the way a client that watches only the session does.
   *
   * The call a client runs is raised as the protocol's `toolClientExecution`
   * request, so a client that runs its tools from `session.inputNeeded` - VS
   * Code's does - picks this one up without subscribing to the chat. That is
   * the half of calling a client's tool that the chat's own tool call never
   * covered.
   */
  /** What the session's channel holds now. */
  const watched = async (client: { handle(message: unknown): Promise<unknown> }, uri: string): Promise<SessionState> =>
    ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
      snapshot: { state: SessionState };
    }).snapshot.state;

  /** One turn whose model calls the client's `openFile`. */
  const calling = async (client: { handle(message: unknown): Promise<unknown> }, chatUri: string): Promise<void> => {
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'open it' } } },
    });
    await settle();
    await emit({
      type: 'assistant',
      uuid: 'reply-1',
      message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 'call-1', name: 'mcp__ahp__probe__openFile', input: { path: '/a.txt' } }],
      },
    });
  };

  /** The client saying what its tool did, as `chat/toolCallComplete`. */
  const answers = (
    client: { handle(message: unknown): Promise<unknown> },
    chatUri: string,
    result: Bag,
    toolCallId = 'call-1',
  ): void => {
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/toolCallComplete', toolCallId, result } },
    });
  };

  /** The client's tool as the model reaches it, which is what runs it here. */
  const tool = () => offered().find((one) => one.name === 'probe__openFile');

  /** The model making a call of a client's tool, by the id the CLI knows it by. */
  const used = (id: string, input: Bag = { path: '/a.txt' }) => ({
    type: 'tool_use', id, name: 'mcp__ahp__probe__openFile', input,
  });

  it('raises the call on the session, and takes the entry down with the answer', async () => {
    const { client, uri, chatUri } = await providing();
    await calling(client, chatUri);

    const entry = (await watched(client, uri)).inputNeeded?.find((one) => one.kind === 'toolClientExecution');
    expect(entry).toMatchObject({
      kind: 'toolClientExecution',
      // The chat a client dispatches its answer to, and the turn the call is in.
      chat: chatUri,
      turnId: 't1',
      // The client that must run it, named on the entry and on the call.
      clientId: 'probe',
      toolCall: {
        toolCallId: 'call-1',
        // The name the client announced, not the one the model was offered.
        toolName: 'openFile',
        status: 'running',
        contributor: { kind: 'client', clientId: 'probe' },
      },
    });

    const answering = offered().find((tool) => tool.name === 'probe__openFile')?.handler({ path: '/a.txt' });
    await settle();
    answers(client, chatUri, { success: true, content: [{ type: 'text', text: 'opened /a.txt' }] });
    expect((await answering)?.content[0]?.text).toBe('opened /a.txt');

    // And the session says the work is done rather than that somebody is being
    // asked something: the entry goes when the call does.
    await settle();
    expect(((await watched(client, uri)).inputNeeded ?? []).some((one) => one.id === entry?.id)).toBe(false);
  });

  it('answers a client\'s result with the completion the session reports, under the client\'s origin', async () => {
    const { client, peer: p, chatUri } = await providing();
    await calling(client, chatUri);
    const answering = offered().find((tool) => tool.name === 'probe__openFile')?.handler({ path: '/a.txt' });
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        clientSeq: 9,
        action: { type: 'chat/toolCallComplete', turnId: 't1', toolCallId: 'call-1', result: { success: true, content: [{ type: 'text', text: 'opened /a.txt' }] } },
      },
    });
    await answering;
    // The CLI writes the tool's result, which is what the session reports the
    // call complete from.
    await emit({
      type: 'user',
      uuid: 'u1',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'opened /a.txt' }] },
    });
    await settle();

    // The client holds its result until an envelope with its origin answers
    // it, and the completion the session reports is that answer: said once,
    // from what the harness did.
    const answered = actions(p, chatUri).filter((e) => e.origin?.clientId === 'probe' && e.origin.clientSeq === 9);
    expect(answered.map((e) => [e.action.type, e.action.toolCallId, e.rejectionReason]))
      .toEqual([['chat/toolCallComplete', 'call-1', undefined]]);
  });

  it('keeps an answer that arrives before the CLI runs the tool', async () => {
    const { client, chatUri } = await providing();
    await calling(client, chatUri);
    /*
     * The call is reported running before the harness runs the tool, so the
     * owner's answer can land in the gap between the two. It used to be
     * refused as a call nobody was waiting on, which lost the answer.
     */
    answers(client, chatUri, { success: true, content: [{ type: 'text', text: 'early' }] });
    await settle();

    const answer = await offered().find((tool) => tool.name === 'probe__openFile')?.handler({ path: '/a.txt' });
    expect(answer?.isError).toBeUndefined();
    expect(answer?.content[0]?.text).toBe('early');
  });

  it('fails a call nobody answers, in the time the host allows', async () => {
    const { client, chatUri } = await providing(undefined, 30);
    await calling(client, chatUri);

    // A turn blocked on a client that has gone quiet is worse than a tool that
    // says so, so the limit the host resolved ends it.
    const answer = await offered().find((tool) => tool.name === 'probe__openFile')?.handler({ path: '/a.txt' });
    expect(answer?.isError).toBe(true);
    expect(answer?.content[0]?.text).toContain('no answer from probe');
  });

  it('tells two concurrent calls of one tool apart by the id the CLI hands the handler', async () => {
    const { client, chatUri } = await providing();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'open it twice' } } },
    });
    await settle();
    /*
     * The two calls carry the same arguments, and the CLI ran the second one
     * first - which is the order it hands its handlers out in, and the one
     * thing a match by name and input cannot know: the first handler to run
     * would take the other's call. The id the CLI names each call by in
     * `_meta` is what tells these two apart.
     */
    sdk.toolUseIds.push('call-2', 'call-1');
    await emit({
      type: 'assistant',
      uuid: 'reply-1',
      message: { id: 'm1', content: [used('call-1'), used('call-2')] },
    });

    const both = [tool()?.handler({ path: '/a.txt' }), tool()?.handler({ path: '/a.txt' })];
    await settle();
    // Answered out of order, so a result that reached the wrong call is not
    // hidden by the two having arrived in the order they were made.
    answers(client, chatUri, { success: true, content: [{ type: 'text', text: 'the second' }] }, 'call-2');
    answers(client, chatUri, { success: true, content: [{ type: 'text', text: 'the first' }] }, 'call-1');

    const [second, first] = await Promise.all(both);
    expect(second?.content[0]?.text).toBe('the second');
    expect(first?.content[0]?.text).toBe('the first');
  });

  it('waits on the id the CLI named when the frame has not been read yet', async () => {
    const { client, chatUri } = await providing();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'open it twice' } } },
    });
    await settle();
    /*
     * Both handlers run before either frame is read, and the frames then
     * arrive in the other order. With the id there is nothing to join and
     * nothing the handler needs from a frame that has not arrived: it waits
     * for its own call to be opened, whenever that happens.
     */
    sdk.toolUseIds.push('call-2', 'call-1');
    const both = [tool()?.handler({ path: '/a.txt' }), tool()?.handler({ path: '/a.txt' })];
    await settle();

    await emit({ type: 'assistant', uuid: 'reply-1', message: { id: 'm1', content: [used('call-1')] } });
    await emit({ type: 'assistant', uuid: 'reply-2', message: { id: 'm2', content: [used('call-2')] } });
    answers(client, chatUri, { success: true, content: [{ type: 'text', text: 'the first' }] }, 'call-1');
    answers(client, chatUri, { success: true, content: [{ type: 'text', text: 'the second' }] }, 'call-2');

    const [second, first] = await Promise.all(both);
    expect(second?.content[0]?.text).toBe('the second');
    expect(first?.content[0]?.text).toBe('the first');
  });

  it('still finds its call by name and input when no id is handed over', async () => {
    // A CLI that puts nothing in `_meta`, which is what the fallback is for and
    // is why it stays until a live run shows the key always arrives.
    sdk.sendsToolUseId = false;
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, chatUri } = await providing();
    await calling(client, chatUri);
    const answering = tool()?.handler({ path: '/a.txt' });
    await settle();
    answers(client, chatUri, { success: true, content: [{ type: 'text', text: 'by name' }] });

    const answer = await answering;
    expect(answer?.isError).toBeUndefined();
    expect(answer?.content[0]?.text).toBe('by name');
    // Said out loud, because whether the fallback is still needed is a question
    // about what a live CLI sends and nothing a test can answer.
    expect(warned.mock.calls.flat().join(' ')).toContain('claudecode/toolUseId');
    warned.mockRestore();
  });

  it('hands the model the client\'s image as an image, and its words as words', async () => {
    const { client, chatUri } = await providing();
    await calling(client, chatUri);
    const answering = offered().find((tool) => tool.name === 'probe__openFile')?.handler({ path: '/a.txt' });
    await settle();
    answers(client, chatUri, {
      success: true,
      content: [
        { type: 'text', text: 'here it is' },
        { type: 'embeddedResource', data: 'iVBORw0KGgo=', contentType: 'image/png' },
      ],
    });

    // An MCP result, which is the shape the CLI's in-process server answers in:
    // the client's image is an image and not a base64 string the model has to
    // be told about.
    const answer = await answering as { content: Bag[] };
    expect(answer.content).toEqual([
      { type: 'text', text: 'here it is' },
      { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
    ]);
  });

  /*
   * The same call, where the CLI asks a person about it first.
   *
   * A tool of a client's is not one this host's own lists settle, so the CLI's
   * permission callback is what runs before the tool does - and the callback
   * is the host's gate, so a person is asked. Whether the CLI's question comes
   * before or after the assistant frame that reports the call is the CLI's
   * business; both orders are one call, and a client is asked to run it only
   * once somebody has allowed it.
   */
  /** A turn under way, with the model yet to reach the client's tool. */
  const intoTurn = async (client: { handle(message: unknown): Promise<unknown> }, chatUri: string): Promise<void> => {
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'open it' } } },
    });
    await settle();
  };

  /** The person's answer, dispatched to the session the way a client dispatches it. */
  const decided = (
    client: { handle(message: unknown): Promise<unknown> },
    uri: string,
    approved: boolean,
  ): void => {
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/toolCallConfirmed', toolCallId: 'call-1', approved } },
    });
  };

  /** The calls of a client's the session is asking somebody to run right now. */
  const askedToRun = async (
    client: { handle(message: unknown): Promise<unknown> },
    uri: string,
  ): Promise<SessionInputRequest[]> =>
    ((await watched(client, uri)).inputNeeded ?? []).filter((one) => one.kind === 'toolClientExecution');

  it('opens a call the person allowed, and not before the question is answered', async () => {
    const { client, uri, chatUri } = await providing();
    await intoTurn(client, chatUri);
    /*
     * The callback first, which is the order `asking.ts` documents: the CLI
     * runs it as soon as the call's input is complete, before the canonical
     * assistant frame is read. Nothing has reported the call, so the approval
     * is the only thing that can raise the entry.
     */
    const gate = sdk.canUseTool?.('mcp__ahp__probe__openFile', { path: '/a.txt' }, { toolUseID: 'call-1' });
    await settle();
    expect(await askedToRun(client, uri)).toEqual([]);

    sdk.toolUseIds.push('call-1');
    const run = tool();
    let done = false;
    const answering = (run === undefined ? Promise.resolve(undefined) : run.handler({ path: '/a.txt' }))
      .then((answer) => { done = true; return answer; });
    await settle();
    // Parked on a call that does not exist yet, which is what the approval has
    // to get it out of: an opener that only runs for a frame leaves the tool
    // waiting for ever.
    expect(done).toBe(false);

    decided(client, uri, true);
    await settle();
    expect(await gate).toMatchObject({ behavior: 'allow' });
    // The client is asked to run it now, and once.
    const entries = await askedToRun(client, uri);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      clientId: 'probe',
      toolCall: { toolCallId: 'call-1', toolName: 'openFile', status: 'running' },
    });

    answers(client, chatUri, { success: true, content: [{ type: 'text', text: 'opened /a.txt' }] });
    expect((await answering)?.content[0]?.text).toBe('opened /a.txt');
    await settle();
    expect(await askedToRun(client, uri)).toEqual([]);
  });

  it('takes a reported call\'s entry down while the person is asked about it', async () => {
    const { client, uri, chatUri } = await providing();
    await intoTurn(client, chatUri);
    /*
     * The frame first, so the call is reported running and the client is asked
     * to run it - and the CLI then asks a person about it, which is a question
     * the client should not have been asked to act on at all.
     */
    await emit({
      type: 'assistant',
      uuid: 'reply-1',
      message: { id: 'm1', content: [used('call-1')] },
    });
    expect(await askedToRun(client, uri)).toHaveLength(1);

    sdk.toolUseIds.push('call-1');
    const answering = tool()?.handler({ path: '/a.txt' });
    await settle();
    const gate = sdk.canUseTool?.('mcp__ahp__probe__openFile', { path: '/a.txt' }, { toolUseID: 'call-1' });
    await settle();
    // The question takes it back: while a person decides, no client is being
    // asked to run the tool.
    expect(await askedToRun(client, uri)).toEqual([]);

    decided(client, uri, true);
    await settle();
    // Allowed, so it is the client's to run once more - one entry, not two.
    expect(await gate).toMatchObject({ behavior: 'allow' });
    expect(await askedToRun(client, uri)).toHaveLength(1);

    answers(client, chatUri, { success: true, content: [{ type: 'text', text: 'opened /a.txt' }] });
    expect((await answering)?.content[0]?.text).toBe('opened /a.txt');
    await settle();
    expect(await askedToRun(client, uri)).toEqual([]);
  });

  it('refuses a handler whose call the person declined, and asks nobody to run it', async () => {
    const { client, uri, chatUri } = await providing();
    await intoTurn(client, chatUri);
    sdk.toolUseIds.push('call-1');
    const answering = tool()?.handler({ path: '/a.txt' });
    await settle();
    void sdk.canUseTool?.('mcp__ahp__probe__openFile', { path: '/a.txt' }, { toolUseID: 'call-1' });
    await settle();

    decided(client, uri, false);
    await settle();
    /*
     * Settled, and with the refusal: a handler left waiting on a call nobody
     * will run is a tool call the model never gets back, and it would wait for
     * a call that no approval can ever open.
     */
    const answer = await answering;
    expect(answer?.isError).toBe(true);
    expect(answer?.content[0]?.text).toBe('The person declined this action');
    // And nothing asked a client to run it, before or after.
    expect(await askedToRun(client, uri)).toEqual([]);
  });

  it('settles a handler still waiting when the turn is stopped', async () => {
    // A CLI that names no call, so the handler waits on the tool's name and
    // input - the other half of the join, which a stopped turn has to end too.
    sdk.sendsToolUseId = false;
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, uri, chatUri } = await providing();
    await intoTurn(client, chatUri);
    const answering = tool()?.handler({ path: '/a.txt' });
    await settle();
    // A call a person is being asked about, and never answered: the turn is
    // stopped while both waits stand.
    const gate = sdk.canUseTool?.('mcp__ahp__probe__openFile', { path: '/a.txt' }, { toolUseID: 'call-1' });
    await settle();

    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1' } },
    });
    await settle();

    // The question with the stop, and the handler with a refusal rather than a
    // promise nothing will settle.
    expect(await gate).toMatchObject({ behavior: 'deny' });
    const answer = await answering;
    expect(answer?.isError).toBe(true);
    expect(answer?.content[0]?.text).toBe('The turn was stopped');
    expect(await askedToRun(client, uri)).toEqual([]);
    expect(warned.mock.calls.flat().join(' ')).toContain('claudecode/toolUseId');
    warned.mockRestore();
  });
});

/*
 * The same calls, held where every backend holds them.
 *
 * `packages/sdk/src/tools/clientcalls.ts` is the one place a call a client runs is
 * kept, and a backend spreads its three methods onto its `Session`. This drives
 * that backend through `createHost`: the entry on the session and what the
 * protocol's own reducer makes of it, who may answer, and every way a call ends.
 * There is no model in the example backend, so the test is the model - `open` is
 * the backend reporting a call the model made and `wait` is the harness blocking
 * on it, which is the whole of what p2-p4 do with this module.
 */
describe('a client\'s call, held by the backend', () => {
  const DIR = '/tmp/host-tools-held';

  const OPEN_FILE = {
    name: 'openFile',
    description: 'Open a file in the editor',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  };

  /**
   * `SessionStatus` bits, which the protocol types as a `const enum`.
   *
   * A `verbatimModuleSyntax` build cannot import one as a value, and the
   * protocol's own number is what is being checked rather than a spelling of it.
   */
  const IN_PROGRESS = 1 << 3;
  /** The bit that means a person is being asked, and not only that work runs. */
  const NEEDS_PERSON = 1 << 4;
  const INPUT_NEEDED = IN_PROGRESS | NEEDS_PERSON;

  /** A call as the backend reports it, before the holder marks it running. */
  const running = (toolCallId: string, name = 'openFile'): Bag => ({
    toolCallId,
    toolName: name,
    displayName: name,
    invocationMessage: `Run ${name}`,
    confirmed: 'not-needed',
  });

  type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

  /** What the holder and the start it was made from are, once a session exists. */
  interface Held {
    start: Start;
    calls: ClientCalls;
    tools: () => BoundTool[];
    session: Session;
  }

  const context = (): LoaderContext => ({
    path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: () => {}, say: () => {},
  });

  /** The example backend with the holder bolted on, and a listener on the events. */
  const holding = (over: Partial<HostOptions> = {}) => {
    const base = echo({ path: DIR, pace: 0 });
    const heard: HostEvent[] = [];
    let held: Held | undefined;
    const agent: Agent = {
      ...base,
      provider: 'holder',
      displayName: 'Holder',
      create: (start: Start) => {
        // The tools this session offers right now, which move as clients come
        // and go - not `start.tools`, which is the list it was born with.
        let current: BoundTool[] = start.tools ?? [];
        const calls = createClientCalls({
          chat: start.chatUri,
          emit: start.emit,
          timeoutMs: start.clientToolTimeoutMs,
          providers: (name) => current
            .filter((one) => one.owner !== undefined && one.definition.name.endsWith(`__${name}`))
            .map((one) => String(one.owner)),
        });
        const inner = base.create(start);
        held = { start, calls, tools: () => current, session: inner };
        return {
          ...inner,
          ...calls.methods,
          setTools: async (tools: BoundTool[]) => { current = tools; return true; },
          // A turn with a call out is a turn running, which is what a backend
          // reports - and the status the host serves the session under, since
          // it asks the chat rather than the snapshot.
          status: () => (calls.entries().length > 0 ? IN_PROGRESS : inner.status()),
          /*
           * What is still out with a client, on the snapshot.
           *
           * `entries()` is the holder's own list, and `inputNeeded` is where a
           * client watching only the session finds a call - which is the whole
           * reason the entry is raised at all.
           */
          sessionState: () => {
            const out = calls.entries();
            return {
              ...inner.sessionState(),
              ...(out.length === 0 ? {} : { inputNeeded: out }),
            };
          },
        };
      },
    };
    const { host: plugin, contribution } = pluginHost('probe', context());
    plugin.on('input_needed_set', (event) => { heard.push(event); });
    const { options } = foldHostOptions({ path: DIR, agents: [agent], ...machine(), ...over }, [contribution]);
    return {
      host: createHost(options),
      heard,
      /** The holder, once the host has started the session. */
      held: (): Held => {
        if (held === undefined) throw new Error('no session was started');
        return held;
      },
    };
  };

  /** One running session, with each of these clients announcing `openFile`. */
  const open = async (ids: string[], over: Partial<HostOptions> = {}) => {
    const { host, heard, held } = holding(over);
    const uri = 'ahp-session:/held';
    const peers = ids.map(() => peer());
    const clients = peers.map((one) => host.accept(one));
    const first = clients[0] as Client;
    await first.handle({ method: 'initialize', params: { channel: 'ahp-root://', clientId: ids[0], protocolVersions: ['0.9.0'] } });
    await first.handle({ method: 'createSession', params: { channel: uri, provider: 'holder' } });
    const opened = await first.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    const chatUri = opened.snapshot.state.defaultChat;
    await first.handle({ method: 'subscribe', params: { channel: chatUri } });

    // Everybody else joins and watches, so the session knows they are there
    // before any of them says what it can run.
    for (const [at, id] of ids.slice(1).entries()) {
      const client = clients[at + 1] as Client;
      await client.handle({ method: 'initialize', params: { channel: 'ahp-root://', clientId: id, protocolVersions: ['0.9.0'] } });
      await client.handle({ method: 'subscribe', params: { channel: uri } });
      await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    }
    for (const client of clients) {
      client.handle({
        method: 'dispatchAction',
        params: { channel: uri, action: { type: 'session/activeClientSet', activeClient: { name: 'Editor', tools: [OPEN_FILE] } } },
      });
    }
    await settle();
    return { host, heard, held, uri, chatUri, clients, peers };
  };

  // One case runs the holder's own clock forward, and a timer left faked is a
  // `settle` in the next one that never fires.
  afterEach(() => { vi.useRealTimers(); });

  /**
   * Raise one entry the way the host does, through the protocol's own reducer.
   *
   * The action's type is spelled as the string it is rather than as
   * `ActionType`: that enum is ambient and `const`, which a
   * `verbatimModuleSyntax` build cannot read, and the host's own emitters spell
   * these actions the same way.
   */
  const raised = (held_: SessionState, request: SessionInputRequest): SessionState =>
    sessionReducer(held_, { type: 'session/inputNeededSet', request } as SessionAction);

  /** What a session's channel holds right now. */
  const state = async (client: Client, uri: string): Promise<SessionState> =>
    ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
      snapshot: { state: SessionState };
    }).snapshot.state;

  it('raises the entry against the client that will answer it', async () => {
    const { held, clients, uri, chatUri } = await open(['a', 'b']);
    const { calls, tools, start } = held();
    // Two clients in one session both provide `openFile`, and the model is
    // offered both under a name of each client's own.
    expect(tools().map((one) => one.definition.name)).toEqual(['a__openFile', 'b__openFile']);

    const id = calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    await settle();
    // The entry id is the protocol's own spelling, built from the chat the
    // backend named - its own name for it, not the URI a client watches.
    expect(id).toBe(`toolClientExecution:${start.chatUri}:t1:call-1`);

    const held_ = await state(clients[0] as Client, uri);
    expect(held_.inputNeeded).toEqual([{
      id,
      kind: 'toolClientExecution',
      // Respelled for whoever reads it, because the chat on the entry is the
      // one a client dispatches its answer to.
      chat: chatUri,
      turnId: 't1',
      clientId: 'a',
      toolCall: {
        toolCallId: 'call-1',
        toolName: 'openFile',
        displayName: 'openFile',
        invocationMessage: 'Run openFile',
        confirmed: 'not-needed',
        status: 'running',
        contributor: { kind: 'client', clientId: 'a' },
      },
    }]);
  });

  it('keeps the session in progress while the call is out, not waiting on a person', async () => {
    const { held, clients, uri, chatUri } = await open(['a']);
    const { calls } = held();
    const id = calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    await settle();

    const held_ = await state(clients[0] as Client, uri);
    const entry = (held_.inputNeeded ?? []).find((one) => one.id === id);
    expect(entry).toBeDefined();
    expect(held_.status).toBe(IN_PROGRESS | 32);

    /*
     * The protocol's own reducer, on the state the host serves.
     *
     * `channels-session/reducer.ts` counts every entry that blocks on a person
     * and deliberately does not count a `toolClientExecution`: the call has
     * cleared its confirmation gate and is running somewhere else. Reducing
     * this entry must leave the session running, and a question must not -
     * which is what makes this an assertion rather than a tautology.
     */
    const again = raised(held_, entry as SessionInputRequest);
    expect(again.status & IN_PROGRESS).toBe(IN_PROGRESS);
    expect(again.status & NEEDS_PERSON).toBe(0);

    const asked = raised(again, { id: 'q-1', kind: 'chatInput', chat: chatUri } as SessionInputRequest);
    expect(asked.status).toBe(INPUT_NEEDED | 32);
  });

  it('settles the call for its own client, and refuses the other one', async () => {
    const { held, clients, chatUri } = await open(['a', 'b']);
    const { calls } = held();
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    const waiting = calls.wait('call-1');
    await settle();

    // `b` provides the same tool and does not own this call.
    clients[1]?.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/toolCallComplete', toolCallId: 'call-1', result: { success: true, content: [{ type: 'text', text: 'not mine' }] } } },
    });
    await settle();
    // Still open, and still the other client's to answer.
    expect(calls.owner('call-1')).toBe('a');

    clients[0]?.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/toolCallComplete', toolCallId: 'call-1', result: { success: true, content: [{ type: 'text', text: 'mine' }] } } },
    });
    expect((await waiting).text).toBe('mine');
  });

  it('hands the whole answer to the backend, content blocks and all', async () => {
    const { held, clients, chatUri } = await open(['a']);
    const { calls } = held();
    calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    const waiting = calls.wait('call-1');
    await settle();

    clients[0]?.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        action: {
          type: 'chat/toolCallComplete',
          toolCallId: 'call-1',
          result: {
            success: true,
            content: [
              { type: 'text', text: 'here it is' },
              { type: 'embeddedResource', data: 'iVBORw0KGgo=', contentType: 'image/png' },
            ],
          },
        },
      },
    });
    await settle();

    // The text alone is what a text-only harness reads; a harness that takes an
    // image takes the blocks, so both arrive.
    const answer = await waiting;
    expect(answer.ok).toBe(true);
    expect(answer.text).toBe('here it is');
    expect(answer.content).toEqual([
      { type: 'text', text: 'here it is' },
      { type: 'embeddedResource', data: 'iVBORw0KGgo=', contentType: 'image/png' },
    ]);
  });

  it('fails the call of a client that leaves, naming the other client\'s tool', async () => {
    const { held, clients, uri } = await open(['a', 'b']);
    const { calls } = held();
    const id = calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    const waiting = calls.wait('call-1');
    await settle();

    // Unsubscribing is one of the three ways the protocol says a client stops
    // being active in a session.
    clients[0]?.handle({ method: 'unsubscribe', params: { channel: uri } });
    await settle();

    const lost = await waiting;
    expect(lost.ok).toBe(false);
    expect(lost.text).toBe('The client a that was running openFile is no longer here. b__openFile provides the same tool');

    const held_ = await state(clients[1] as Client, uri);
    expect((held_.inputNeeded ?? []).some((one) => one.id === id)).toBe(false);
  });

  it('fails a call nobody answers in the time the host allows', async () => {
    const { held, clients, uri } = await open(['a'], { clientToolTimeoutMs: 50 });
    const { calls } = held();
    // The session is up first: `settle` waits on a real timer, and a fake one
    // would never fire it.
    vi.useFakeTimers();
    const id = calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    const waiting = calls.wait('call-1');
    vi.advanceTimersByTime(50);
    const lost = await waiting;
    vi.useRealTimers();

    expect(lost.ok).toBe(false);
    expect(lost.text).toBe('openFile got no answer from a in 0 s');
    await settle();
    const held_ = await state(clients[0] as Client, uri);
    expect((held_.inputNeeded ?? []).some((one) => one.id === id)).toBe(false);
  });

  it('fires input_needed_set with the kind a plugin has to read', async () => {
    const { held, heard } = await open(['a']);
    held().calls.open({ turnId: 't1', toolCall: running('call-1'), owner: 'a' });
    await settle();

    // Delegated work reads as an entry like any other, so the kind on the event
    // is what tells a plugin this is not somebody being asked something.
    const said = heard.filter((event) => event.type === 'input_needed_set');
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({
      session: 'ahp-session:/held',
      id: `toolClientExecution:${held().start.chatUri}:t1:call-1`,
      kind: 'toolClientExecution',
    });
  });

  it('gives every session ten minutes unless the host says otherwise', async () => {
    const seen: number[] = [];
    const base = echo({ path: DIR, pace: 0 });
    const agent: Agent = {
      ...base,
      provider: 'holder',
      displayName: 'Holder',
      create: (start: Start) => { seen.push(start.clientToolTimeoutMs); return base.create(start); },
    };
    for (const clientToolTimeoutMs of [undefined, 0, 1500]) {
      const host = createHost({
        path: DIR,
        agents: [agent],
        ...machine(),
        ...(clientToolTimeoutMs === undefined ? {} : { clientToolTimeoutMs }),
      });
      const client = host.accept(peer());
      await client.handle({ method: 'initialize', params: { channel: 'ahp-root://', clientId: 'probe', protocolVersions: ['0.9.0'] } });
      await client.handle({ method: 'createSession', params: { channel: `ahp-session:/t${seen.length}`, provider: 'holder' } });
    }
    // Ten minutes when nobody said, which is the same answer an absent option
    // gives the holder; a zero that means no limit at all; and a number through.
    expect(seen).toEqual([DEFAULT_CLIENT_TOOL_TIMEOUT_MS, 0, 1500]);
  });
});

describe('a customization switched for every session or a folder', () => {
  const PLUGIN = 'virtual://plugin/one';
  /** The plugin's own tree, with one server, in the format this host reads. */
  const TREE: Record<string, string> = {
    [`${PLUGIN}/.claude-plugin/plugin.json`]: '{"name":"one"}',
    [`${PLUGIN}/.mcp.json`]: JSON.stringify({ mcpServers: { two: { type: 'stdio', command: 'bin/two' } } }),
  };

  const dirs: string[] = [];
  // Awaited, with retries: on Windows a process the case started can hold the folder a moment longer.
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  /** Settle until something is true, giving it real time to happen. */
  const until = async (ready: () => boolean, ms = 2000): Promise<void> => {
    const end = Date.now() + ms;
    while (!ready() && Date.now() < end) await new Promise((r) => { setTimeout(r, 5); });
  };

  /**
   * A client whose plugin is a tree held in memory.
   *
   * The two `resource*` methods a copy is made of, answered from a map: that is
   * the whole of what a client has to do for a plugin of its own to reach a
   * session here.
   */
  const pluginPeer = (tree: Record<string, string>): ReturnType<typeof peer> => {
    const entriesOf = (uri: string): { name: string; type: string }[] => {
      const prefix = uri.endsWith('/') ? uri : `${uri}/`;
      const found: { name: string; type: string }[] = [];
      for (const path of Object.keys(tree)) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (!found.some((one) => one.name === name)) found.push({ name, type: slash === -1 ? 'file' : 'directory' });
      }
      return found;
    };
    return {
      ...peer(),
      request: async (method: string, params: unknown) => {
        const uri = String((params as { uri?: unknown }).uri ?? '');
        if (method === 'resourceList') return { entries: entriesOf(uri) };
        if (method === 'resourceRead') {
          const data = tree[uri];
          if (data === undefined) throw new Error(`${uri} is not there`);
          return { data, encoding: 'utf-8' };
        }
        return {};
      },
    };
  };

  /**
   * Two sessions in one host, each with a client holding the same plugin, and
   * the decisions they share.
   *
   * The store is handed in rather than held inside, because what a decision
   * outlives is a question about the store: a test reads it back to check that
   * a scope was written where it belongs.
   */
  async function twoSessions(
    folders: [string | undefined, string | undefined] = [undefined, undefined],
    people?: { users: Users; tokens: [string, string] },
  ) {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-enablement-'));
    dirs.push(dir);
    const decisions = memoryEnablement();
    const seen: Start[] = [];
    const base = echo({ path: dir, pace: 0 });
    const agent: Agent = {
      ...base,
      create: (start: Start) => { seen.push(start); return base.create(start); },
    };
    let host: ReturnType<typeof createHost>;
    host = createHost({
      path: dir,
      agents: [agent],
      ...machine(),
      enablement: decisions,
      clientPlugins: clientPluginsIn(join(dir, 'copies'), () => host.clients),
      ...(people === undefined ? {} : { users: people.users }),
    });

    /** Sign a client in as one of the people, where the host has any. */
    const signedIn = async (client: ReturnType<typeof host.accept>, token: string | undefined): Promise<void> => {
      if (people === undefined || token === undefined) return;
      await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: people.users.resource.resource, token } });
    };

    /** One session, its chat, the client watching it and the client holding its plugin. */
    const opened = async (name: string, folder: string | undefined, clientId: string, token?: string) => {
      const uri = `ahp-session:/${name}`;
      const watching = peer();
      const watch = host.accept(watching);
      await watch.handle(hello(['0.9.0'], token === undefined ? {} : { clientId: `watching-${name}` }));
      await signedIn(watch, token);
      await watch.handle({ method: 'createSession', params: {
        channel: uri,
        provider: 'echo',
        ...(folder === undefined ? {} : { workingDirectories: [folder] }),
      } });
      const answer = await watch.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { defaultChat: string } };
      };
      const chat = answer.snapshot.state.defaultChat;
      await watch.handle({ method: 'subscribe', params: { channel: chat } });
      const holder = host.accept(pluginPeer(TREE));
      await holder.handle(hello(['0.9.0'], { clientId }));
      await signedIn(holder, token);
      await holder.handle({ method: 'subscribe', params: { channel: uri } });
      return {
        name,
        uri,
        chat,
        /**
         * The plugin announced, which is the copy the session then has.
         *
         * A revision of its own, because two clients holding one plugin are
         * two copies of it: the plugin is the same and so is the decision
         * about it, which is what these cases are about.
         */
        announce: (nonce: string) => holder.handle({ method: 'dispatchAction', params: {
          channel: uri,
          action: {
            type: 'session/activeClientSet',
            activeClient: { customizations: [{ type: 'plugin', uri: PLUGIN, nonce }], tools: [] },
          },
        } }),
        /** Whether the plugin has been reported on this session, and settled. */
        loaded: (): boolean => actions(watching, uri)
          .filter((one) => one.action.type === 'session/customizationsChanged')
          .some((one) => ((one.action.customizations as Record<string, unknown>[]) ?? [])
            .some((custom) => custom.uri === PLUGIN && (custom.load as { kind: string }).kind === 'loaded')),
        /** The decision the client makes, scopes and all, as the protocol carries it. */
        decide: (enablement: Record<string, unknown>[]) => holder.handle({ method: 'dispatchAction', params: {
          channel: uri,
          action: {
            type: 'session/customizationToggled',
            id: String(actions(watching, uri)
              .filter((one) => one.action.type === 'session/customizationUpdated')
              .map((one) => one.action.customization as Record<string, unknown>)
              .findLast((custom) => custom.uri === PLUGIN)?.id ?? ''),
            enablement,
          },
        } }),
        /** A turn, which is the moment a chat is handed the set its session has. */
        turn: (turnId: string) => watch.handle({ method: 'dispatchAction', params: {
          channel: chat,
          action: { type: 'chat/turnStarted', turnId, message: { text: 'hi' } },
        } }),
      };
    };

    return {
      decisions,
      /** The plugin directories one session's chat was last started with. */
      handed: (name: string): unknown => seen.filter((one) => one.uri.endsWith(`/${name}`)).at(-1)?.plugins,
      first: await opened('one', folders[0], 'one', people?.tokens[0]),
      second: await opened('two', folders[1], 'two', people?.tokens[1]),
    };
  }

  it('switches it off in the session beside it when it is switched off for all of them', async () => {
    const { decisions, handed, first, second } = await twoSessions();
    await first.announce('n1');
    await second.announce('n2');
    await until(() => first.loaded() && second.loaded());
    await first.turn('t1');
    await second.turn('t1');
    await settle();

    // Both sessions have the plugin, so both are handed its copy.
    expect(handed(first.name)).toHaveLength(1);
    expect(handed(second.name)).toHaveLength(1);

    // Off for every session, said in the first one. The decision outlives the
    // session it was made in, so it is the store's from here.
    await first.decide([{ kind: 'global', enabled: false }]);
    await settle();
    expect(decisions.global(PLUGIN)).toBe(false);

    await first.turn('t2');
    await second.turn('t2');
    await settle();
    expect(handed(first.name)).toBeUndefined();
    // The session that made no decision of its own is switched all the same.
    expect(handed(second.name)).toBeUndefined();
  });

  it('switches only the session of a person who may not change the host for everybody', async () => {
    const person = (id: string, can: (grant: Grant) => boolean): Principal => ({ id, roles: ['r'], can });
    const people: Record<string, Principal> = {
      bea: person('bea', (grant) => grant !== 'config:change'),
      ana: person('ana', () => true),
    };
    const users = {
      resource: { resource: 'ahpd://users', resource_name: 'ahpd users', authorization_servers: ['https://example.test'], required: false },
      verify: async (token: string) => people[token],
    } as unknown as Users;
    const { decisions, handed, first, second } = await twoSessions([undefined, undefined], { users, tokens: ['bea', 'ana'] });
    await first.announce('n1');
    await second.announce('n2');
    await until(() => first.loaded() && second.loaded());

    // Off for every session, said by somebody who may only configure their own.
    await first.decide([{ kind: 'global', enabled: false }]);
    await settle();
    expect(decisions.global(PLUGIN)).toBeUndefined();

    await first.turn('t1');
    await second.turn('t1');
    await settle();
    // Her own session is switched, as a host with no store would switch it.
    expect(handed(first.name)).toBeUndefined();
    // Somebody else's is not.
    expect(handed(second.name)).toHaveLength(1);
  });

  it('switches it off in the folder it was switched off in, and not beside it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-enablement-folders-'));
    dirs.push(dir);
    const here = join(dir, 'here');
    const there = join(dir, 'there');
    mkdirSync(here);
    mkdirSync(there);
    const { decisions, handed, first, second } = await twoSessions([uriOf(here), uriOf(there)]);
    await first.announce('n1');
    await second.announce('n2');
    await until(() => first.loaded() && second.loaded());
    await first.turn('t1');
    await second.turn('t1');
    await settle();

    await first.decide([{ kind: 'workspace', uri: uriOf(here), enabled: false }]);
    await settle();
    // Written at the folder the entry names, which is the one the session works in.
    expect(decisions.folder(uriOf(here), PLUGIN)).toBe(false);
    expect(decisions.folder(uriOf(there), PLUGIN)).toBeUndefined();

    await first.turn('t2');
    await second.turn('t2');
    await settle();
    expect(handed(first.name)).toBeUndefined();
    expect(handed(second.name)).toHaveLength(1);
  });

  it('clears the decision for every session when the client stops sending it', async () => {
    const { decisions, first } = await twoSessions();
    await first.announce('n1');
    await until(() => first.loaded());

    await first.decide([{ kind: 'global', enabled: false }]);
    await settle();
    expect(decisions.global(PLUGIN)).toBe(false);

    // The array is a replacement, never a patch: the decision for every session
    // is one the client holds no longer, and only the session's own is left.
    await first.decide([{ kind: 'session', enabled: false }]);
    await settle();
    expect(decisions.held()).toEqual({ global: {}, folders: {} });

    await first.turn('t1');
    await settle();
    expect(decisions.global(PLUGIN)).toBeUndefined();
  });

  /** One MCP server this backend found for itself, and the key a decision about it is kept under. */
  const SERVER = { type: 'mcpServer', id: 'mcp:gmail', name: 'gmail', uri: 'gmail' };
  const SERVER_KEY = enablementKeyOf({ type: 'mcpServer', id: 'mcp:gmail', uri: 'gmail', name: 'gmail' }) ?? '';

  /**
   * Sessions in a host whose backend reports a server of its own.
   *
   * No client hands this session anything, which is the half these cases are
   * about: a customization the backend found for itself is what a decision
   * about every session or about a folder reaches with nothing to copy.
   *
   * The store is handed in rather than held, because the decision that matters
   * is one made before the session exists - the store being the only thing an
   * earlier run leaves behind.
   */
  async function backendSessions(decisions: EnablementStore) {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-enablement-backend-'));
    dirs.push(dir);
    const base = echo({ path: dir, pace: 0 });
    const agent: Agent = {
      ...base,
      // What the backend offers before any session exists, which is where a
      // session's own customizations come from.
      probe: async () => ({ models: [], commands: [], customizations: [SERVER] }),
    };
    const host = createHost({ path: dir, agents: [agent], ...machine(), enablement: decisions });

    /** One session, and what it says about itself the moment it is subscribed to. */
    const open = async (name: string, folder?: string) => {
      const uri = `ahp-session:/${name}`;
      const client = host.accept(peer());
      await client.handle(hello(['0.9.0']));
      await client.handle({ method: 'createSession', params: {
        channel: uri,
        provider: 'echo',
        ...(folder === undefined ? {} : { workingDirectories: [folder] }),
      } });
      const answer = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { customizations?: Record<string, unknown>[] } };
      };
      return {
        uri,
        client,
        /** What this session reports, which is what a client draws its switches from. */
        reported: (): Record<string, unknown>[] => answer.snapshot.state.customizations ?? [],
        /** The one server, as this session reports it. */
        server: (): Record<string, unknown> | undefined => (answer.snapshot.state.customizations ?? [])
          .find((one) => one.id === SERVER.id),
      };
    };
    return { host, open };
  }

  it('starts a session made after the decision with the customization off', async () => {
    const decisions = memoryEnablement();
    decisions.setGlobal(SERVER_KEY, false);
    const { open } = await backendSessions(decisions);
    const later = await open('one');

    // Read from the store when the session is read, so a session nobody has
    // told anything reports the decision all the same.
    expect(later.server()?.enablement).toEqual([{ kind: 'global', enabled: false }]);
  });

  it('says nothing about it when the store holds no decision', async () => {
    const { open } = await backendSessions(memoryEnablement());
    const made = await open('one');

    // Nothing decided anywhere is an absent field, not an empty list: a
    // customization with no entries is one every reader takes as on.
    expect(made.server()?.enablement).toBeUndefined();
  });

  it('reports a folder decision under the folder the session works in', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-enablement-where-'));
    dirs.push(dir);
    const here = join(dir, 'here');
    const there = join(dir, 'there');
    mkdirSync(here);
    mkdirSync(there);
    const decisions = memoryEnablement();
    decisions.setFolder(uriOf(here), SERVER_KEY, false);
    const { open } = await backendSessions(decisions);
    const inside = await open('one', uriOf(here));
    const beside = await open('two', uriOf(there));

    // The folder entry names the folder the session works in, which is the one
    // the decision was made in and the one a client compares.
    expect(inside.server()?.enablement).toEqual([{ kind: 'workspace', uri: uriOf(here), enabled: false }]);
    // A session in another folder inherits nothing, so nothing is said.
    expect(beside.server()?.enablement).toBeUndefined();
  });

  it('keeps the decision when the host is built again over the same store', async () => {
    const decisions = memoryEnablement();
    const before = await backendSessions(decisions);
    const made = await before.open('one');
    await made.client.handle({ method: 'dispatchAction', params: {
      channel: made.uri,
      action: {
        type: 'session/customizationToggled',
        id: SERVER.id,
        enablement: [{ kind: 'global', enabled: false }],
      },
    } });
    await settle();
    // The backend found this server for itself, so the decision goes where an
    // earlier run can read it and nowhere else.
    expect(decisions.global(SERVER_KEY)).toBe(false);

    // A host that has just started, over what the earlier one left behind.
    const after = await backendSessions(decisions);
    const later = await after.open('one');
    expect(later.server()?.enablement).toEqual([{ kind: 'global', enabled: false }]);
  });

  /**
   * A host whose backend reports what it found for itself, when it is asked to.
   *
   * The report is the moment a backend says what it has, which is the only
   * moment this host can say back which of them are off. A customization the
   * backend found on its own is one this host never handed over, and it has
   * nowhere to keep it out of the set the backend started with.
   */
  async function reporting(decisions: EnablementStore) {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-enablement-report-'));
    dirs.push(dir);
    const base = echo({ path: dir, pace: 0 });
    const told: [string, boolean][] = [];
    let report: () => void = () => {};
    const agent: Agent = {
      ...base,
      create: (start: Start) => {
        const session = base.create(start);
        // The report a backend makes about itself, and the switch it is told
        // back, recorded rather than performed: echo has no runtime switch.
        report = () => start.emit('session', { type: 'session/customizationsChanged', customizations: [SERVER] });
        return {
          ...session,
          setCustomizationEnabled: async (id: string, on: boolean) => { told.push([id, on]); return false; },
        };
      },
    };
    const host = createHost({ path: dir, agents: [agent], ...machine(), enablement: decisions });

    const open = async (name: string): Promise<string> => {
      const uri = `ahp-session:/${name}`;
      const client = host.accept(peer());
      await client.handle(hello(['0.9.0']));
      await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
      await client.handle({ method: 'subscribe', params: { channel: uri } });
      return uri;
    };
    return { told, report: () => report(), open };
  }

  it('tells the backend which of its own customizations are off, and says it once', async () => {
    const decisions = memoryEnablement();
    decisions.setGlobal(SERVER_KEY, false);
    const { told, report, open } = await reporting(decisions);
    await open('one');
    await settle();

    // Nothing yet: a backend is told where it says what it has, and this one
    // has said nothing.
    expect(told).toEqual([]);

    report();
    await settle();
    expect(told).toEqual([[SERVER.id, false]]);

    // Said once, because a backend that answers a switch by reporting again
    // would otherwise be told, and report, without end.
    report();
    await settle();
    expect(told).toEqual([[SERVER.id, false]]);
  });
});

describe('a customization switched for one session', () => {
  /** A plugin the backend found for itself, with a skill of the plugin's under it. */
  const PLUGIN: Bag = {
    type: 'plugin',
    id: 'plugin:cc-plugin-agents-md',
    uri: 'cc-plugin-agents-md@builtin',
    name: 'cc-plugin-agents-md',
    children: [{ type: 'skill', id: 'skill:agents-md', name: 'agents-md', uri: 'virtual://skill/agents-md', enabled: true }],
  };

  const dirs: string[] = [];
  // Awaited, with retries: on Windows a process the case started can hold the folder a moment longer.
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  /**
   * Sessions in a host whose backend reports a plugin of its own and switches it.
   *
   * The switch is taken and what the backend reports does not move: a backend
   * says whether a customization *can* be switched and never what it decided,
   * so a session reporting the switch as off is this host's answer rather than
   * the backend's. A skill of the plugin has no switch at all, which is what
   * the refusal is for.
   */
  async function switchable() {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-enablement-one-'));
    dirs.push(dir);
    const base = echo({ path: dir, pace: 0 });
    const told: [string, boolean][] = [];
    const said: string[] = [];
    const agent: Agent = {
      ...base,
      probe: async () => ({ models: [], commands: [], customizations: [PLUGIN] }),
      create: (start: Start) => ({
        ...base.create(start),
        setCustomizationEnabled: async (id: string, on: boolean) => {
          told.push([id, on]);
          return id === PLUGIN.id;
        },
      }),
    };
    const host = createHost({
      path: dir, agents: [agent], ...machine(), enablement: memoryEnablement(),
      onEvent: (message) => said.push(message),
    });

    const open = async (name: string, made = true) => {
      const uri = `ahp-session:/${name}`;
      const client = host.accept(peer());
      await client.handle(hello(['0.9.0']));
      if (made) await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
      /** What this session reports now, which is what a client's snapshot carries. */
      const reported = async (): Promise<Record<string, unknown>[]> => {
        const answer = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
          snapshot: { state: { customizations?: Record<string, unknown>[] } };
        };
        return answer.snapshot.state.customizations ?? [];
      };
      return {
        uri,
        /** The one plugin, as this session reports it right now. */
        plugin: async (): Promise<Record<string, unknown> | undefined> =>
          (await reported()).find((one) => one.id === PLUGIN.id),
        toggle: (id: string, enabled: boolean) => client.handle({ method: 'dispatchAction', params: {
          channel: uri,
          action: { type: 'session/customizationToggled', id, enablement: [{ kind: 'session', enabled }] },
        } }),
      };
    };
    return { host, told, said, open };
  }

  it('keeps the decision on the session that made it, and reports it off', async () => {
    const { told, open } = await switchable();
    const one = await open('one');
    // Nothing decided anywhere is an absent field, not an empty list.
    expect((await one.plugin())?.enablement).toBeUndefined();

    await one.toggle(PLUGIN.id as string, false);
    await settle();

    expect(told).toEqual([[PLUGIN.id, false]]);
    // The backend went on reporting the plugin as it found it, so this entry is
    // the decision this host kept rather than anything the backend said.
    expect((await one.plugin())?.enablement).toEqual([{ kind: 'session', enabled: false }]);
  });

  it('reports the same entry to a later snapshot, and keeps nothing in the store', async () => {
    const { open } = await switchable();
    const one = await open('one');
    await one.toggle(PLUGIN.id as string, false);
    await settle();

    // A session's own decision is about the session and outlives nothing, so
    // the store is where it is *not*: a later snapshot reads it off the host.
    const later = await open('one', false);
    expect((await later.plugin())?.enablement).toEqual([{ kind: 'session', enabled: false }]);
  });

  it('leaves another session with the plugin on', async () => {
    const { open } = await switchable();
    const one = await open('one');
    const two = await open('two');

    await one.toggle(PLUGIN.id as string, false);
    await settle();

    expect((await one.plugin())?.enablement).toEqual([{ kind: 'session', enabled: false }]);
    // The decision is keyed by the session it was made in, so the session
    // beside it has none - whatever the plugin's own `source` keys elsewhere.
    expect((await two.plugin())?.enablement).toBeUndefined();
  });

  it('refuses a skill of the plugin out loud, with the list sent again', async () => {
    const { said, told, open } = await switchable();
    const one = await open('one');

    await one.toggle('skill:agents-md', false);
    await settle();

    // The backend has no switch for a skill, and says so by refusing it: a
    // control that reports success and changes nothing is worse than one that
    // says it cannot.
    expect(said.some((line) => line.includes('skill:agents-md has no runtime switch'))).toBe(true);
    expect(told).toEqual([['skill:agents-md', false]]);
    // And nothing was kept, so the skill stays as the backend reports it.
    const plugin = await one.plugin();
    expect((plugin?.children as Record<string, unknown>[])[0]?.enablement).toBeUndefined();
  });
});

/*
 * A harness's own list, handed to the host by its backend.
 *
 * The backend sees the harness's task call and the host sees who made it, so
 * the event is the seam: a plugin hears the list once, with the session it
 * belongs to, without either side learning the other's format.
 */
describe('a harness list handed to the host', () => {
  const ana: Principal = { id: 'ana', roles: [], can: () => true };

  /** The example backend, with the start it was handed kept so a test can speak through it. */
  const speaking = (untitled = false) => {
    const base = echo({ path: '/home/softov', pace: 60 });
    const heard: HostEvent[] = [];
    let update: Start['planUpdate'];
    let backendChat = '';
    const agent: Agent = {
      ...base,
      provider: 'echo',
      displayName: 'Echo backend',
      create: (start: Start) => {
        update = start.planUpdate;
        backendChat = start.chatUri;
        const inner = base.create(start);
        // A backend that has nothing to call its session yet.
        return untitled ? { ...inner, title: () => '' } : inner;
      },
    };
    const context = (): LoaderContext => ({
      path: '/home/softov', paths: ['/home/softov'], version: sdkVersion(), hostName: 'test',
      configDir: '/home/softov', log: () => {}, say: () => {},
    });
    const { host: plugin, contribution } = pluginHost('probe', context());
    plugin.on('plan_update', (event) => { heard.push(event); });
    const { options } = foldHostOptions({
      path: '/home/softov',
      agents: [agent],
      // A directory, because `sender` is what the host knows and not the backend.
      users: {
        resource: { resource: 'ahpd://users', resource_name: 'ahpd users', authorization_servers: [], required: false },
        verify: async () => ana,
      } as unknown as Users,
    }, [contribution]);
    return {
      host: createHost(options),
      heard,
      /** The chat URI the backend itself was given. */
      backendChat: () => backendChat,
      /** Hand the host an update, once a session has started. */
      say: (said: PlanUpdate) => {
        if (update === undefined) throw new Error('no session was started');
        update(said);
      },
    };
  };

  /** One session, its chat, and one turn a person sent in it. */
  const opened = async (untitled = false) => {
    const { host, heard, say, backendChat } = speaking(untitled);
    const client = host.accept(peer(), ana);
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/list', provider: 'echo' } });
    // The chat a client addresses, which is the one the client named it by.
    const chat = 'ahp-chat:/list';
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'plan it' } } },
    });
    await settle();
    return { heard, say, chat: backendChat() };
  };

  it('hands a whole list with the session and the sender of the turn', async () => {
    const { heard, say, chat } = await opened();
    say({
      turn: 't1',
      tool: 'TodoWrite',
      entries: [
        { text: 'Read the plan', status: 'completed', priority: 'high' },
        { text: 'Write the tasks', status: 'in_progress' },
        { text: 'Leave the rest', status: 'pending', priority: 'low' },
      ],
    });
    await settle();

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({
      type: 'plan_update',
      session: 'ahp-session:/list',
      chat,
      turn: 't1',
      harness: 'echo',
      tool: 'TodoWrite',
      sender: 'user:ana',
      // The session took the turn's text as its title.
      title: 'plan it',
      entries: [
        { text: 'Read the plan', status: 'completed', priority: 'high' },
        { text: 'Write the tasks', status: 'in_progress' },
        { text: 'Leave the rest', status: 'pending', priority: 'low' },
      ],
    });
  });

  it('hands one change with the harness id', async () => {
    const { heard, say } = await opened();
    say({ turn: 't1', tool: 'TaskUpdate', change: { id: '3', status: 'completed', text: 'Ship it' } });
    await settle();

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({
      type: 'plan_update',
      session: 'ahp-session:/list',
      turn: 't1',
      harness: 'echo',
      tool: 'TaskUpdate',
      change: { id: '3', status: 'completed', text: 'Ship it' },
    });
    expect(heard[0]).not.toHaveProperty('entries');
  });

  it('leaves the title off a session that has none', async () => {
    const { heard, say } = await opened(true);
    say({ turn: 't1', tool: 'TodoWrite', entries: [{ text: 'One step', status: 'pending' }] });
    await settle();

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ type: 'plan_update', session: 'ahp-session:/list' });
    expect(heard[0]).not.toHaveProperty('title');
  });
});

describe('what a session brings to a tool', () => {
  /** A host with one tool that records every question `forSession` was asked. */
  const askedAt = async (over: Partial<HostOptions> = {}, config: Record<string, unknown> = {}) => {
    const seen: {
      titleStrategy: string;
      config?: Record<string, unknown> | undefined;
      bindings?: Record<string, string> | undefined;
    }[] = [];
    const tool: HostTool = {
      definition: { name: 'peek_bindings', description: 'peek', inputSchema: { type: 'object', properties: {} } },
      forSession: (session) => {
        seen.push(session);
        return undefined;
      },
      run: () => 'peeked',
    };
    const host = createHost({ path: HERE, agents: [claude({ paths: [HERE] })], ...machine(), tools: [tool], ...over });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/asked';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', config } });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    await settle();
    return { host, seen, client, uri, tool };
  };

  it('gives a session\'s tool the bindings its config names', async () => {
    const { seen } = await askedAt({}, { connectors: { work: 'connectors://webhook/a' } });
    expect(seen.at(-1)?.titleStrategy).toBe('deferred');
    expect(seen.at(-1)?.config?.connectors).toEqual({ work: 'connectors://webhook/a' });
    expect(seen.at(-1)?.bindings).toEqual({ work: 'connectors://webhook/a' });
  });

  it('takes a plugin\'s answer, and the session\'s own key over a shared alias', async () => {
    const { seen } = await askedAt(
      { bindings: [{ by: 'alpha', read: () => ({ work: 'connectors://webhook/a', personal: 'connectors://webhook/c' }) }] },
      { connectors: { work: 'connectors://webhook/b' } },
    );
    expect(seen.at(-1)?.bindings).toEqual({
      work: 'connectors://webhook/b',
      personal: 'connectors://webhook/c',
    });
  });

  it('reads a plugin again, so a new map reaches the next tool list', async () => {
    let map: Record<string, string> = { work: 'connectors://webhook/a' };
    const { host, seen, tool } = await askedAt({ bindings: [{ by: 'alpha', read: () => map }] });
    expect(seen.at(-1)?.bindings).toEqual({ work: 'connectors://webhook/a' });

    map = { work: 'connectors://webhook/b', mail: 'connectors://webhook/c' };
    host.setTools([tool]);
    await settle();
    expect(seen.at(-1)?.bindings).toEqual({ work: 'connectors://webhook/b', mail: 'connectors://webhook/c' });
  });
});

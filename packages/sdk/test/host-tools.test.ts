import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionReducer } from '@microsoft/agent-host-protocol';
import { createClientCalls, DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../src/clientcalls.js';
import { foldHostOptions, pluginHost } from '../src/plugins.js';
import { sdkVersion } from '../src/version.js';
import type { Agent, BoundTool, McpServer, Start } from '../src/types/agent.js';
import type { ClientCalls } from '../src/clientcalls.js';
import type { Bag } from '../src/types/common.js';
import type { HostEvent } from '../src/types/events.js';
import type { HostOptions } from '../src/types/host.js';
import type { PluginContext } from '../src/types/plugin.js';
import type { Session } from '../src/types/session.js';
import type { SessionAction, SessionInputRequest, SessionState } from '@microsoft/agent-host-protocol';
import {
  resetSdk, actions, claude, createHost, echo, emit, hello, hostTools,
  machine, peer, sdk, serving, sessionQueries, settle, running,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

describe('tools the host contributes', () => {
  const withTools = async (tools = hostTools()) => {
    const host = createHost({
      path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), tools,
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/served';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
    // The name the session is held and listed by, which is the one a tool
    // answers with and is asked by.
    const held = 'claude:/served';
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
      'ahp_resource', 'ahp_terminals',
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
      expect(said.workingDirectory).toBe('file:///home/softov');
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
        _meta: { 'vscode.chat.delegation': { sourceSession: 'claude:/served' } },
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
      const said = await call('send_message', { session: 'claude:/busy', message: 'and then this' }, 0);
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
        relationship: 'independent', workspace: '/home/softov', title: 'Port the makefile', prompt: 'port it', worktree: false,
      });
      expect(said).toMatch(/^New session created \(agent-host-session:\/\/claude\/[0-9a-f-]+\)\.$/);
      await settle();
      const added = p.notes.find((one) => one.method === 'root/sessionAdded');
      const summary = (added?.params as { summary?: { resource: string; title: string; workingDirectories: string[] } } | undefined)?.summary;
      expect(summary?.title).toBe('Port the makefile');
      // Held under its provider's name, as a client's `createSession` is.
      expect(summary?.resource).toMatch(/^claude:\/[0-9a-f-]+$/);
      expect(summary?.workingDirectories).toEqual(['file:///home/softov']);
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
      expect(rows.sessions.map((one) => one.session)).toContain('claude:/served');
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

    it('gives a deferred session rename_chat without the automatic argument, and still runs an explicit rename', async () => {
      const host = createHost({
        path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), tools: hostTools(),
      });
      const p = peer();
      const client = host.accept(p);
      await client.handle(hello(['0.9.0']));
      client.handle({
        method: 'dispatchAction',
        params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { deferredTitleGeneration: true } } },
      });
      await settle();
      const uri = 'ahp-session:/deferred';
      await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
      const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { serverTools?: { name: string; description?: string; inputSchema?: { properties?: Record<string, unknown> } }[] } };
      }).snapshot.state;
      const rename = state.serverTools?.find((one) => one.name === 'rename_chat');
      expect(rename).toBeDefined();
      expect(rename?.inputSchema?.properties).not.toHaveProperty('automatic');
      expect(rename?.description).toContain('Automatic naming is handled by the host');
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
      expect(await call('delete_session', { session: 'claude:/doomed' }, 0))
        .toBe('Deleted session claude:/doomed. Reply with one short sentence confirming the session was deleted.');
      expect(p.notes.some((one) => one.method === 'root/sessionRemoved'
        && (one.params as { session?: string }).session === 'claude:/doomed')).toBe(true);
      const rows = JSON.parse(await call('list_sessions', {}, 0)) as { sessions: { session: string }[] };
      expect(rows.sessions.map((one) => one.session)).not.toContain('claude:/doomed');
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
      const said = JSON.parse(await call('get_session_context', { session: 'claude:/served', detail: 'digest' })) as {
        openLink: string; transcript: { turn: number; state: string; user?: string; assistant?: string }[];
      };
      expect(said.openLink).toBe('agent-host-session://claude/served');
      expect(said.transcript).toEqual([{ turn: 1, state: 'complete', user: 'what is in this directory', assistant: 'Four files.' }]);
      expect(await call('get_session_context', { session: 'claude:/served', detail: 'everything' })).toContain('detail must be');
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
      expect(said).toContain('Workspace will be set to file:///tmp after this turn ends');
      // Nothing moved yet: the turn is still running.
      expect(actions(p, uri).some((one) => one.action.type === 'session/workingDirectoryReplaced')).toBe(false);
      await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
      await settle(8);
      const moved = actions(p, uri).find((one) => one.action.type === 'session/workingDirectoryReplaced');
      expect(moved?.action.directory).toBe('file:///tmp');
      // Restarted there, resumed, and told so in a turn the window will not
      // draw as somebody's request, will list under a label rather than the
      // prompt, and will still credit with the file changes made in it: the
      // reference host's own continuation turn, key for key.
      const restarted = sessionQueries().at(-1);
      expect(restarted?.options.cwd).toBe('/tmp');
      const notice = actions(p, chatUri).filter((one) => one.action.type === 'chat/turnStarted').at(-1);
      expect(notice?.action.message).toMatchObject({
        origin: { kind: 'systemNotification' },
        _meta: {
          'vscode.chat.requestHiddenFromTranscript': true,
          'vscode.chat.systemInitiatedLabel': 'Continue in Requested Workspace',
          'vscode.chat.workspaceContinuation': true,
        },
      });
      expect(String((notice?.action.message as { text: string }).text)).toContain('/tmp');
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
      expect(worktree).toContain('An isolated worktree will be created from file:///home/softov/a%23b and set as the workspace');
      const direct = await call('set_workspace', { workspaceFolder: '/home/softov/a#b', isolation: false });
      expect(direct).toContain('Workspace will be set to file:///home/softov/a%23b after this turn ends');
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
      params: { channel: 'ahp-terminal:/t1', cwd: 'file:///home/softov', command: 'true' },
    });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/asks', provider: 'claude' } });
    const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: {
      name: string; handler: (input: unknown) => Promise<{ content: { text: string }[] }>;
    }[] }>;
    const said = await servers.ahp?.tools.find((one) => one.name === 'ahp_terminals')?.handler({});
    expect(said?.content[0]?.text).toContain('ahp-terminal:/t1');
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
 * `packages/sdk/src/clientcalls.ts` is the one place a call a client runs is
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

  const context = (): PluginContext => ({
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
    expect(held_.status).toBe(IN_PROGRESS);

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
    expect(asked.status).toBe(INPUT_NEEDED);
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
      session: 'holder:/held',
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

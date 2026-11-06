import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, McpServer, Start } from '../src/types/agent.js';
import type { ConnectorRef } from '../src/types/connectors.js';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import { chatUriFor } from '../src/host/channels.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  actions, resetSdk, claude, createHost, hello, machine, open, peer,
 sdk, sendAnswered, sendTurn, sessionQueries, serving, settle, running,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

describe('choosing a model', () => {
  it('puts the schema where a client reads it', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    await settle(6);
    const cfg = await client.handle({ method: 'resolveSessionConfig', params: {} }) as {
      schema: { type?: string; properties: Record<string, { enum?: string[]; sessionMutable?: boolean }> };
      values: Record<string, string>;
    };
    // It is a JSON Schema and has to say so: `type` is required, and one
    // without it matches nothing a client validates against.
    expect(cfg.schema.type).toBe('object');
    // `schema.properties`, not `properties`. One level up draws no controls
    // at all. These are VS Code's Claude's keys, the platform's shell init
    // script beside them; the model and its effort are each message's.
    // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2273-L2309
    const keys = Object.keys(cfg.schema.properties);
    expect(keys.sort()).toEqual(['permissionMode', 'permissions', 'sensitiveEditLocations', 'shellInitScripts']);
    expect(cfg.schema.properties.permissionMode?.enum).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']);
    expect(cfg.values.permissionMode).toBe('default');
  });

  it('says which controls survive a running session and which do not', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    const cfg = await client.handle({ method: 'resolveSessionConfig', params: {} }) as {
      schema: { properties: Record<string, { sessionMutable?: boolean }> };
    };
    expect(cfg.schema.properties.permissionMode?.sessionMutable).toBe(true);
    expect(cfg.schema.properties.permissions?.sessionMutable).toBe(true);
  });

  it('answers back with what has already been chosen', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    const cfg = await client.handle({
      method: 'resolveSessionConfig',
      params: { config: { permissionMode: 'plan' } },
    }) as { values: Record<string, string> };
    // Iterative: a form that returned its defaults every time would quietly
    // undo a choice the moment anything re-asked. `permissions` is left unset
    // until a tool is approved, as VS Code's Claude leaves it.
    expect(cfg.values.permissionMode).toBe('plan');
    expect(cfg.values.permissions).toBeUndefined();
  });

  it('carries the schema and the values on the session itself', async () => {
    const { client, uri } = await running();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { config: { schema: { properties: Record<string, unknown> }; values: Record<string, string> } } };
    }).snapshot.state;
    // A session without this has no permission control.
    expect(Object.keys(state.config.schema.properties)).toContain('permissionMode');
    expect(state.config.values.permissionMode).toBe('default');
  });

  /*
   * A key VS Code's Claude does not declare is taken as it was set, as VS
   * Code's host takes any key but its own, and moves nothing in the CLI: the
   * effort is each turn's model's.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13606-L13610
   */
  it('holds a key it does not declare as it was set, and leaves the CLI\'s effort to each turn', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { effortLevel: 'max' } } },
    });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { config: { values: Record<string, string> } } };
    }).snapshot.state;
    expect(state.config.values.effortLevel).toBe('max');
    expect(sdk.effortsSet).toEqual([]);
  });

  it('runs each session on the variant its own agent was built with', async () => {
    const host = createHost({
      path: '/home/softov',
      agents: [
        claude({ paths: ['/home/softov'], preset: { thinking: 'disabled', sandbox: 'on' } }),
        claude({ paths: ['/home/softov'], provider: 'claude-test' }),
      ],
      ...machine(),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const made = async (channel: string, provider: string) => {
      await client.handle({ method: 'createSession', params: { channel, provider, config: {} } });
      // The CLI its first send starts.
      await sendTurn(client, channel);
      await settle();
      return sessionQueries().at(-1)?.options as Record<string, unknown>;
    };
    // What the operator wrote the variant down as, in the query the CLI runs.
    const onWork = await made('ahp-session:/onwork', 'claude');
    expect(onWork.thinking).toEqual({ type: 'disabled' });
    expect(onWork.settings).toEqual({ sandbox: { enabled: true } });
    // And a variant that says nothing is the empty one, which changes nothing.
    const onTest = await made('ahp-session:/ontest', 'claude-test');
    expect(onTest.thinking).toEqual({ type: 'adaptive' });
    expect(onTest.settings).toBeUndefined();
  });

  /*
   * The CLI's session environment file, `CLAUDE_ENV_FILE`, a script whose
   * contents the CLI runs before each Bash command, read once by each CLI.
   * https://code.claude.com/docs/en/hooks#persist-environment-variables
   */
  it('hands the CLI the client\'s shell init script as its session environment file, the CLI after a change taking the change', async () => {
    const { client, uri } = await running();
    await sendAnswered(client, uri);
    /** The session environment file the CLI that answered the last turn was handed. */
    const envFile = (): unknown => (sessionQueries().at(-1)?.options as { settings?: { env?: Record<string, unknown> } }).settings?.env?.CLAUDE_ENV_FILE;
    // Nothing in force: no file.
    expect(envFile()).toBeUndefined();
    const set = async (value: unknown) => {
      client.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'session/configChanged', config: { shellInitScripts: value } } } });
      await settle();
      return (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { config: { values: Record<string, unknown> } } };
      }).snapshot.state.config.values.shellInitScripts;
    };
    // The reference client's shape, declared `readOnly` in the schema so the
    // window sends it and draws no control for it. The turn after it is
    // answered by a CLI that reads it.
    expect(await set([{ shell: 'bash', script: 'export FOO=bar\n' }])).toEqual([{ shell: 'bash', script: 'export FOO=bar\n' }]);
    await sendAnswered(client, uri);
    const path = String(envFile());
    expect(path).toMatch(/ahpd-shell-init-.*\.sh$/);
    expect(readFileSync(path, 'utf8')).toBe('export FOO=bar\n');
    const started = sessionQueries().length;
    /*
     * A malformed value, a shell VS Code's list does not take or more than
     * its one entry, is held as it was set and leaves the last valid script
     * in force, as VS Code's Copilot ignores one.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L8469-L8473
     */
    const two = [{ shell: 'bash', script: 'export A=1\n' }, { shell: 'bash', script: 'export B=2\n' }];
    expect(await set(two)).toEqual(two);
    expect(await set([{ shell: 'zsh', script: 'x' }])).toEqual([{ shell: 'zsh', script: 'x' }]);
    await sendAnswered(client, uri);
    expect(sessionQueries()).toHaveLength(started);
    expect(readFileSync(path, 'utf8')).toBe('export FOO=bar\n');
    // A PowerShell script is nothing to a bash tool: no file, and none for the CLI after it.
    expect(await set([{ shell: 'powershell', script: '$x = 1' }])).toEqual([{ shell: 'powershell', script: '$x = 1' }]);
    expect(existsSync(path)).toBe(false);
    await sendAnswered(client, uri);
    expect(envFile()).toBeUndefined();
    // Cleared, and the file with it.
    expect(await set([{ shell: 'bash', script: 'export FOO=bar\n' }])).toEqual([{ shell: 'bash', script: 'export FOO=bar\n' }]);
    expect(existsSync(path)).toBe(true);
    expect(await set([])).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it('hands the allow and deny lists to the harness when the session starts', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/listed', provider: 'claude',
        config: { permissions: { allow: ['Read', 'Grep'], deny: ['Bash'] } },
      },
    });
    // The CLI its first send starts.
    await sendTurn(client, 'ahp-session:/listed');
    await settle();
    // The SDK takes both natively, which is what makes advertising the key
    // the smallest thing that works - and it is the half that only applies to
    // a session being built.
    const options = sessionQueries().at(-1)?.options;
    expect(options?.allowedTools).toEqual(['Read', 'Grep']);
    expect(options?.disallowedTools).toEqual(['Bash']);
  });

  it('answers a tool from the list instead of asking, once one is set', async () => {
    const { client, uri } = await running();
    await sendAnswered(client, uri);
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'session/configChanged', config: { permissions: { allow: ['Read'], deny: ['Bash'] } } },
      },
    });
    await settle();
    // Kept as an object, not stringified: this is the first config value that
    // is not a string, and the whole path used to be `Record<string, string>`.
    const values = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { config: { values: Record<string, unknown> } } };
    }).snapshot.state.config.values;
    expect(values.permissions).toEqual({ allow: ['Read'], deny: ['Bash'] });

    /*
     * The live half. The query was built before the list existed, so the SDK
     * cannot have been told - `canUseTool` is the only thing that can answer,
     * and a control that reported success and changed nothing is what this
     * would otherwise be.
     */
    expect(await sdk.canUseTool?.('Read', { path: 'x' }, { toolUseID: 'c1' }))
      .toMatchObject({ behavior: 'allow' });
    expect(await sdk.canUseTool?.('Bash', { command: 'ls' }, { toolUseID: 'c2' }))
      .toMatchObject({ behavior: 'deny' });
  });

  it('lets a denial win over an approval, because they answer different questions', async () => {
    const { client, uri } = await running();
    await sendAnswered(client, uri);
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'session/configChanged', config: { permissions: { allow: ['Bash'], deny: ['Bash'] } } },
      },
    });
    await settle();
    // Allow says "stop asking me" and deny says "never do this". A tool in
    // both is one somebody has forbidden and also, once, approved.
    expect(await sdk.canUseTool?.('Bash', {}, { toolUseID: 'c1' })).toMatchObject({ behavior: 'deny' });
  });

  it('refuses a permissions value that is not one, and takes one that is', async () => {
    const { client, peer: p, uri } = await running();
    const set = async (value: unknown) => {
      client.handle({
        method: 'dispatchAction',
        params: { channel: uri, action: { type: 'session/configChanged', config: { permissions: value } } },
      });
      await settle();
      return p.notes.filter((note) => note.method === 'action').at(-1)?.params as {
        rejectionReason?: string; action?: { config?: Record<string, unknown> };
      };
    };
    // A client sending a string where the schema says an object should hear
    // that the value was not taken, rather than have it quietly ignored.
    expect(await set('all')).toMatchObject({ rejectionReason: expect.stringContaining('permissions') });
    // And the good one is echoed rather than refused - asserted here so this
    // cannot pass in a world where every value is turned away.
    const took = await set({ allow: ['Read'], deny: [] });
    expect(took.rejectionReason).toBeUndefined();
    expect(took.action?.config).toEqual({ permissions: { allow: ['Read'], deny: [] } });
  });

  it('runs the turn on the model the turn named, and keeps it', async () => {
    const { client, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        // `ModelSelection`, which is an object. This test used to send a bare
        // string and the host used to read one, so the two agreed with each
        // other and with nothing a client sends.
        action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi', model: { id: 'haiku' } } },
      },
    });
    await settle();
    expect(sdk.modelsSet).toEqual(['haiku']);

    const chat = (await client.handle({ method: 'subscribe', params: { channel: chatUriFor('ahp-session:/live') } }) as {
      snapshot: { state: { activeTurn: { message: { model?: { id: string } } } } };
    }).snapshot.state;
    // Credited on the turn, because the transcript has to say what actually
    // ran it.
    expect(chat.activeTurn.message.model?.id).toBe('haiku');
  });

  it('puts the session\'s current model under _meta, where an extension belongs', async () => {
    const { client, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi', model: { id: 'haiku' } } },
      },
    });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { model?: string; _meta?: { 'ahpd.model'?: string } } };
    }).snapshot.state;
    /*
     * `SessionState` declares no `model`.
     *
     * It is the only place either implementation says what a session is on as
     * opposed to what a past turn used, and it is worth sending - but a bare
     * field beside the declared ones reads like one the specification forgot,
     * which is a mistake somebody has already made with this exact field.
     */
    expect(state._meta?.['ahpd.model']).toBe('haiku');
    expect(state.model).toBeUndefined();
  });

  /*
   * A model is each message's, as VS Code's Claude declares no model key: a
   * `model` a client sets as config is held and switches nothing.
   */
  it('switches no model for a model a client sets as config', async () => {
    const { client, uri } = await running();
    await sendAnswered(client, uri);
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { model: 'default' } } },
    });
    await settle();
    expect(sdk.modelsSet).toEqual([]);
  });

  it('refuses a permission mode the CLI does not know', async () => {
    const { client, uri } = await running();
    await sendAnswered(client, uri);
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { permissionMode: 'bypass' } } },
    });
    await settle();
    // `bypass` for `bypassPermissions` is the near-miss a client makes, and a
    // rejected promise nobody reads is not an answer.
    expect(sdk.modesSet).toEqual([]);

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { permissionMode: 'acceptEdits' } } },
    });
    await settle();
    expect(sdk.modesSet).toEqual(['acceptEdits']);
  });

  it('declares the connectors a session may use, and keeps the map it was started with', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/bound';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri,
        provider: 'claude',
        config: { connectors: { work: 'connectors://resend/account-123' } },
      },
    });
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { config: {
        schema: { properties: Record<string, Record<string, unknown> | undefined> };
        values: Record<string, unknown>;
      } } };
    }).snapshot.state;
    // The row a client would draw, and the one this host declares rather than
    // offers: there is no question a person answers here, and the map itself
    // is the value.
    expect(state.config.schema.properties.connectors).toEqual({
      type: 'object',
      title: 'Connectors',
      description: 'The connectors this session may use, by name.',
      additionalProperties: { type: 'string' },
      sessionMutable: false,
    });
    expect(state.config.values.connectors).toEqual({ work: 'connectors://resend/account-123' });
  });
});

describe('the connectors a session binds', () => {
  /** A host that serves one connector, of the owner the test names. */
  const bound = (refs: ConnectorRef[]) =>
    serving('/home/softov', [], { connectors: { refs: () => refs, run: async () => ({}) } }).accept(peer());

  const start = (uri: string) => ({
    method: 'createSession',
    params: {
      channel: uri,
      provider: 'claude',
      config: { connectors: { work: 'connectors://resend/account-123' } },
    },
  });

  it('refuses a start that names another person\'s connector', async () => {
    const client = bound([{ id: 'account-123', adapter: 'resend', owner: 'user:someone' }]);
    await client.handle(hello(['0.9.0']));
    // Refused at the start, where the person who set the binding is, rather
    // than left to fail at the first call the model makes.
    await expect(client.handle(start('ahp-session:/borrowed'))).rejects.toThrow(
      /work names account-123, which belongs to user:someone/u,
    );
  });

  it('refuses a start that names a connector this host does not serve', async () => {
    const client = bound([]);
    await client.handle(hello(['0.9.0']));
    await expect(client.handle(start('ahp-session:/gone'))).rejects.toThrow(
      /work names account-123, and this host serves no resend connector with that id/u,
    );
  });

  it('takes a binding to a connector the host serves for everyone', async () => {
    const client = bound([{ id: 'account-123', adapter: 'resend', owner: 'host' }]);
    await client.handle(hello(['0.9.0']));
    await client.handle(start('ahp-session:/shared'));
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/shared' } }) as {
      snapshot: { state: { config: { values: Record<string, unknown> } } };
    }).snapshot.state;
    expect(state.config.values.connectors).toEqual({ work: 'connectors://resend/account-123' });
  });
});

describe('a session\'s config across a restart', () => {
  /** A temporary `sessions/` folder, removed after the test. */
  let root: string;
  let dir: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ahpd-config-'));
    dir = join(root, 'sessions');
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  /** A host on the store folder, introduced. */
  const hostOnFile = async (sessionConfig?: Record<string, Record<string, unknown>>) => {
    const host = createHost({
      path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), sessions: fileSessions({ dir }),
      ...(sessionConfig === undefined ? {} : { sessionConfig }),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    return client;
  };

  /** The store written, which is coalesced onto the next tick. */
  const written = () => new Promise((tick) => { setTimeout(tick, 5); });

  /** A second host on the same file, which is what a restart is, with a turn sent to the session. */
  const resumed = async (id: string) => {
    await written();
    sdk.sessions.push({ sessionId: id, summary: 'Kept', lastModified: 1, cwd: '/home/softov' });
    const client = await hostOnFile();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUriFor(`ahp-session:/${id}`), action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'carry on' } } },
    });
    await settle(8);
    return sessionQueries().at(-1)?.options;
  };

  /** What the store folder holds for one session. */
  const stored = (id: string) => {
    try { return (JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as { config?: Record<string, unknown> }).config; }
    catch { return undefined; }
  };

  it('resumes a session with the config it was created with', async () => {
    const client = await hostOnFile();
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/made', provider: 'claude', config: { permissionMode: 'plan', permissions: { allow: ['Bash'] } } },
    });
    const options = await resumed('made');
    expect(options?.permissionMode).toBe('plan');
    expect(options?.allowedTools).toEqual(['Bash']);
  });

  it('resumes a session with a change made while it ran', async () => {
    const client = await hostOnFile();
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/moved', provider: 'claude' } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/moved', action: { type: 'session/configChanged', config: { permissionMode: 'acceptEdits' } } },
    });
    await settle();
    const options = await resumed('moved');
    expect(options?.permissionMode).toBe('acceptEdits');
  });

  it('keeps a change the backend refused out of the store', async () => {
    // A backend that refuses every key its schema does not declare.
    const { echo } = await import('../../../examples/echo/agent.js');
    const base = echo({ path: '/home/softov', pace: 0 });
    const refusing: Agent = {
      ...base,
      create: (start) => ({ ...base.create(start), setConfig: (key: string) => `${key} is not taken here` }),
    };
    const host = createHost({ path: '/home/softov', agents: [refusing], ...machine(), sessions: fileSessions({ dir }) });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/refused', provider: 'echo', config: { voice: 'shouty' } },
    });
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/refused', action: { type: 'session/configChanged', config: { effortLevel: 'enormous' } } },
    });
    await settle();
    await written();
    expect(stored('refused')).toEqual({ voice: 'shouty' });
  });

  it('keeps an array as an array, on a live session and on a row', async () => {
    const scripts = [{ shell: 'bash', script: 'export FOO=bar\n' }];
    const client = await hostOnFile();
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/live', action: { type: 'session/configChanged', config: { shellInitScripts: scripts } } },
    });
    // A row nothing is running, which is written to the store with no
    // backend to ask.
    sdk.sessions.push({ sessionId: 'row', summary: 'Row', lastModified: 1, cwd: '/home/softov' });
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/row', action: { type: 'session/configChanged', config: { shellInitScripts: scripts } } },
    });
    await settle();
    await written();
    expect(stored('live')?.shellInitScripts).toEqual(scripts);
    expect(stored('row')?.shellInitScripts).toEqual(scripts);
    const again = await hostOnFile();
    const opened = await again.handle({ method: 'subscribe', params: { channel: 'ahp-session:/row' } }) as {
      snapshot: { state: { config: { values: Record<string, unknown> } } };
    };
    expect(opened.snapshot.state.config.values.shellInitScripts).toEqual(scripts);
  });

  /** A key this host declares for one chat, which a plugin's setting is. */
  const CHAT_SCOPED = { depth: { scope: 'chat', type: 'string', title: 'Depth', sessionMutable: true } };

  it('keeps a key the schema scopes to one chat out of the session\'s store', async () => {
    const client = await hostOnFile(CHAT_SCOPED);
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/peers', provider: 'claude', config: { permissionMode: 'plan' } },
    });
    await client.handle({ method: 'createChat', params: { channel: 'ahp-session:/peers', chat: 'ahp-chat:/peer' } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/peer', action: { type: 'session/configChanged', config: { depth: 'low' } } },
    });
    await settle();
    await written();
    // Taken by the chat it was set on, and not what the session resumes with.
    expect(stored('peers')).toEqual({ permissionMode: 'plan' });
  });

  it('keeps a key the schema scopes to one chat when it was set on the lead chat', async () => {
    const client = await hostOnFile(CHAT_SCOPED);
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/lead', provider: 'claude' } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUriFor('ahp-session:/lead'), action: { type: 'session/configChanged', config: { depth: 'low' } } },
    });
    await settle();
    await written();
    // What a resume hands the lead chat.
    expect(stored('lead')).toEqual({ depth: 'low' });
  });

  it('writes nothing for a session disposed before its backend took the change, even under its name again', async () => {
    const { echo } = await import('../../../examples/echo/agent.js');
    const base = echo({ path: '/tmp', pace: 0 });
    let answer: (said: true) => void = () => {};
    const slow: Agent = {
      ...base,
      create: (start) => {
        const session = base.create(start);
        return { ...session, setConfig: () => new Promise<true>((resolve) => { answer = resolve; }) };
      },
    };
    const store = memorySessions();
    const host = createHost({ path: '/tmp', agents: [slow], ...machine(), sessions: store });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/gone', provider: 'echo' } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/gone', action: { type: 'session/configChanged', config: { voice: 'shouty' } } },
    });
    await settle();
    await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/gone' } });
    // A new session under the same name, which the late answer is not about.
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/gone', provider: 'echo' } });
    answer(true);
    await settle();
    expect(store.config('gone')).toBeUndefined();
  });

  /*
   * A change is said in the client's own keys, as VS Code's host says a
   * client's config action: an answer that is neither `true` nor a sentence
   * takes nothing, and no key of the backend's own goes out in its place.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4220-L4222
   */
  it('says a change in the client\'s own keys, and takes no answer under the backend\'s', async () => {
    const { echo } = await import('../../../examples/echo/agent.js');
    const base = echo({ path: '/tmp', pace: 0 });
    const renaming: Agent = {
      ...base,
      create: (start) => ({ ...base.create(start), setConfig: () => ({ permissionMode: 'plan' }) as never }),
    };
    const p = peer();
    const host = createHost({ path: '/tmp', agents: [renaming], ...machine(), sessions: memorySessions() });
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/renamed';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, clientSeq: 1, action: { type: 'session/configChanged', config: { mode: 'plan' } } },
    });
    await settle();
    const answered = actions(p, uri).filter((e) => e.origin?.clientSeq === 1);
    expect(answered.map((e) => [e.action.type, e.rejectionReason]))
      .toEqual([['session/configChanged', 'mode is not a config key this backend takes']]);
    expect(actions(p, uri).some((e) => Object.hasOwn((e.action.config ?? {}) as Record<string, unknown>, 'permissionMode'))).toBe(false);
  });

  /** A host over a store already holding a config for the session `stale`, as a restart finds it. */
  const staleHost = async (config: Record<string, unknown>, preset?: Record<string, unknown>) => {
    const store = memorySessions();
    store.setConfig('stale', config);
    store.setUri?.('stale', 'ahp-session:/stale');
    sdk.sessions.push({ sessionId: 'stale', summary: 'Stale', lastModified: 1, cwd: '/home/softov' });
    const said: string[] = [];
    const host = createHost({
      path: '/home/softov', agents: [claude({ paths: ['/home/softov'], ...(preset === undefined ? {} : { preset }) })], ...machine(), sessions: store,
      onEvent: (message) => said.push(message),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    return { client, said };
  };

  it('resumes a stored value the schema no longer offers as the default, and says so', async () => {
    const { client, said } = await staleHost({ permissionMode: 'nope', permissions: { allow: ['Bash'] } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUriFor('ahp-session:/stale'), action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'carry on' } } },
    });
    await settle(8);
    const options = sessionQueries().at(-1)?.options;
    expect(options?.permissionMode).toBe('default');
    // A value the schema still offers is passed as it was stored.
    expect(options?.allowedTools).toEqual(['Bash']);
    expect(said.filter((line) => line.includes('permissionMode'))).toEqual([
      expect.stringMatching(/stale.*permissionMode.*"nope"/),
    ]);
  });

  it('keeps a stored key the schema does not declare, and drops a declared one it refuses, saying so once', async () => {
    const { client, said } = await staleHost({ model: 'opus', sandboxEnabled: 'on', permissions: 'all' });
    const read = async () => (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/stale' } }) as {
      snapshot: { state: { config: { values: Record<string, unknown> } } };
    }).snapshot.state.config.values;
    const values = await read();
    // Kept: the store only holds what the backend took, declared or not.
    expect(values.model).toBe('opus');
    expect(values.sandboxEnabled).toBe('on');
    // The wrong JSON type is refused the same way an unknown value is, which
    // leaves the key unset, as VS Code's Claude resolves `permissions`.
    expect(values.permissions).toBeUndefined();
    await read();
    expect(said.filter((line) => /stale.*permissions.*"all"/.test(line))).toHaveLength(1);
    expect(said.some((line) => line.includes('stored model'))).toBe(false);
  });

  /** The `query()` options a turn on the stored session `stale` was built with. */
  const resumedQuery = async (config: Record<string, unknown>, preset?: Record<string, unknown>) => {
    const { client } = await staleHost(config, preset);
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUriFor('ahp-session:/stale'), action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'carry on' } } },
    });
    await settle(8);
    return sessionQueries().at(-1)?.options as { settings?: Record<string, unknown> } | undefined;
  };

  it('runs a resumed session in the sandbox its store holds, which its preset need not say', async () => {
    const options = await resumedQuery({ sandboxEnabled: 'on' });
    expect(options?.settings).toEqual({ sandbox: { enabled: true } });
  });

  it('lets a preset that says off turn off a stored sandbox on, in both spellings it was written in', async () => {
    // `'on'` is what the control the schema dropped actually wrote; `true` is
    // the same value in the shape a client could have sent it. A preset saying
    // off is somebody asking for no sandbox, so it wins over that stored value.
    expect((await resumedQuery({ sandboxEnabled: 'on' }, { sandbox: 'off' }))?.settings)
      .toEqual({ sandbox: { enabled: false } });
    expect((await resumedQuery({ sandboxEnabled: true }, { sandbox: 'off' }))?.settings)
      .toEqual({ sandbox: { enabled: false } });
  });

  it('lets a stored sandbox that is off, default or false leave the preset in charge', async () => {
    for (const held of ['off', 'default', false]) {
      expect((await resumedQuery({ sandboxEnabled: held }, { sandbox: 'on' }))?.settings, String(held))
        .toEqual({ sandbox: { enabled: true } });
      expect((await resumedQuery({ sandboxEnabled: held }))?.settings, String(held)).toBeUndefined();
    }
  });
});

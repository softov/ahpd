import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, McpServer, Start } from '../src/types/agent.js';
import { fileSessions, memorySessions } from '../src/sessions.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resetSdk, claude, createHost, hello, machine, open, peer,
 sdk, sessionQueries, settle, running,
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
    // at all - no permission mode, no model, no effort - which is what it did.
    const keys = Object.keys(cfg.schema.properties);
    expect(keys).toContain('permissionMode');
    expect(keys).toContain('effortLevel');
    // The three options an operator writes down as a preset are not controls a
    // session offers, so the chips a client would draw for them are gone.
    expect(keys).not.toContain('outputStyle');
    expect(keys).not.toContain('thinking');
    expect(keys).not.toContain('sandboxEnabled');
    expect(cfg.schema.properties.permissionMode?.enum).toContain('dontAsk');
    expect(cfg.values.permissionMode).toBe('default');
  });

  it('says which controls survive a running session and which do not', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    const cfg = await client.handle({ method: 'resolveSessionConfig', params: {} }) as {
      schema: { properties: Record<string, { sessionMutable?: boolean }> };
    };
    expect(cfg.schema.properties.permissionMode?.sessionMutable).toBe(true);
    expect(cfg.schema.properties.effortLevel?.sessionMutable).toBe(true);
  });

  it('answers back with what has already been chosen', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    const cfg = await client.handle({
      method: 'resolveSessionConfig',
      params: { config: { permissionMode: 'plan' } },
    }) as { values: Record<string, string> };
    // Iterative: a form that returned its defaults every time would quietly
    // undo a choice the moment anything re-asked.
    expect(cfg.values.permissionMode).toBe('plan');
    expect(cfg.values.effortLevel).toBe('high');
  });

  it('carries the schema and the values on the session itself', async () => {
    const { client, uri } = await running();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { config: { schema: { properties: Record<string, unknown> }; values: Record<string, string> } } };
    }).snapshot.state;
    // A session without this has no permission control, no model picker and
    // no effort control - which is what it had.
    expect(Object.keys(state.config.schema.properties)).toContain('permissionMode');
    expect(state.config.values.permissionMode).toBe('default');
    expect(state.config.values.effortLevel).toBe('high');
  });

  it('changes the effort level on the running session', async () => {
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
    // Told, not merely recorded: a control that updates the state a client
    // reads while the CLI keeps its old setting is the worst of both.
    expect(sdk.effortsSet).toEqual(['max']);
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

  it('sources the client\'s shell init script before every shell command, while one is in force', async () => {
    const { client, uri } = await running();
    const options = sessionQueries().at(-1)?.options as {
      hooks?: { PreToolUse?: { matcher?: string; hooks: ((input: unknown) => Promise<{ hookSpecificOutput?: { updatedInput?: { command?: string } } }>)[] }[] };
    };
    const matcher = options.hooks?.PreToolUse?.[0];
    expect(matcher?.matcher).toBe('Bash');
    const hook = matcher?.hooks[0];
    if (hook === undefined) throw new Error('no PreToolUse hook on Bash');
    const before = (command: string) => hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: 'x', session_id: 's', transcript_path: '', cwd: '' });
    // Nothing in force: the command runs as written.
    expect((await before('make')).hookSpecificOutput).toBeUndefined();
    const set = async (value: unknown) => {
      client.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'session/configChanged', config: { shellInitScripts: value } } } });
      await settle();
      return (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { config: { values: Record<string, unknown> } } };
      }).snapshot.state.config.values.shellInitScripts;
    };
    // The reference client's shape, declared `readOnly` in the schema so the
    // window sends it and draws no control for it.
    expect(await set([{ shell: 'bash', script: 'export FOO=bar\n' }])).toEqual([{ shell: 'bash', script: 'export FOO=bar\n' }]);
    const sourced = (await before('make')).hookSpecificOutput?.updatedInput?.command ?? '';
    expect(sourced).toMatch(/^\{ \. '.*ahpd-shell-init-.*\.sh'; \} 2>\/dev\/null \|\| printf 'shell init script exited %s\\n' "\$\?"\nmake$/);
    const path = /'([^']*)'/.exec(sourced)?.[1] ?? '';
    expect(readFileSync(path, 'utf8')).toBe('export FOO=bar\n');
    // A PowerShell script is nothing to a bash tool, and a malformed list is refused rather than written.
    expect(await set([{ shell: 'powershell', script: '$x = 1' }])).toEqual([{ shell: 'powershell', script: '$x = 1' }]);
    expect((await before('make')).hookSpecificOutput).toBeUndefined();
    expect(await set([{ shell: 'zsh', script: 'x' }])).toEqual([{ shell: 'powershell', script: '$x = 1' }]);
    // Cleared, and the file with it.
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

  it('refuses an effort level that is not one, rather than passing it on', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { effortLevel: 'enormous' } } },
    });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { config: { values: Record<string, string> } } };
    }).snapshot.state;
    expect(state.config.values.effortLevel).toBe('high');
    // A rejected promise nobody reads is not an answer.
    expect(sdk.effortsSet).toEqual([]);
  });

  it('runs the turn on the model the turn named, and keeps it', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        // `ModelSelection`, which is an object. This test used to send a bare
        // string and the host used to read one, so the two agreed with each
        // other and with nothing a client sends.
        action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi', model: { id: 'haiku' } } },
      },
    });
    await settle();
    expect(sdk.modelsSet).toEqual(['haiku']);

    const chat = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/live' } }) as {
      snapshot: { state: { activeTurn: { message: { model?: { id: string } } } } };
    }).snapshot.state;
    // Credited on the turn, because the transcript has to say what actually
    // ran it.
    expect(chat.activeTurn.message.model?.id).toBe('haiku');
  });

  it('puts the session\'s current model under _meta, where an extension belongs', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi', model: { id: 'haiku' } } },
      },
    });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { model?: string; _meta?: { model?: string } } };
    }).snapshot.state;
    /*
     * `SessionState` declares no `model`.
     *
     * It is the only place either implementation says what a session is on as
     * opposed to what a past turn used, and it is worth sending - but a bare
     * field beside the declared ones reads like one the specification forgot,
     * which is a mistake somebody has already made with this exact field.
     */
    expect(state._meta?.model).toBe('haiku');
    expect(state.model).toBeUndefined();
  });

  it('resolves the default alias at the CLI, not here', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { model: 'default' } } },
    });
    await settle();
    // `default` is a choice the CLI offers. Resolving it to a concrete id
    // before sending would be the host answering a question nobody asked.
    expect(sdk.modelsSet).toEqual([undefined]);
  });

  it('refuses a permission mode the CLI does not know', async () => {
    const { client, uri } = await running();
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
  const hostOnFile = async () => {
    const host = createHost({
      path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), sessions: fileSessions({ dir }),
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
      params: { channel: `ahp-chat:/${id}`, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'carry on' } } },
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
    const client = await hostOnFile();
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/refused', provider: 'claude', config: { permissionMode: 'plan' } },
    });
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/refused', action: { type: 'session/configChanged', config: { effortLevel: 'enormous' } } },
    });
    await settle();
    await written();
    expect(stored('refused')).toEqual({ permissionMode: 'plan' });
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
      params: { channel: 'claude:/row', action: { type: 'session/configChanged', config: { shellInitScripts: scripts } } },
    });
    await settle();
    await written();
    expect(stored('live')?.shellInitScripts).toEqual(scripts);
    expect(stored('row')?.shellInitScripts).toEqual(scripts);
    const again = await hostOnFile();
    const opened = await again.handle({ method: 'subscribe', params: { channel: 'claude:/row' } }) as {
      snapshot: { state: { config: { values: Record<string, unknown> } } };
    };
    expect(opened.snapshot.state.config.values.shellInitScripts).toEqual(scripts);
  });

  it('keeps a key the schema scopes to one chat out of the session\'s store', async () => {
    const client = await hostOnFile();
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/peers', provider: 'claude', config: { permissionMode: 'plan' } },
    });
    await client.handle({ method: 'createChat', params: { channel: 'ahp-session:/peers', chat: 'ahp-chat:/peer' } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/peer', action: { type: 'session/configChanged', config: { effortLevel: 'low' } } },
    });
    await settle();
    await written();
    // Taken by the chat it was set on, and not what the session resumes with.
    expect(sdk.effortsSet).toContain('low');
    expect(stored('peers')).toEqual({ permissionMode: 'plan' });
  });

  it('keeps a key the schema scopes to one chat when it was set on the lead chat', async () => {
    const client = await hostOnFile();
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/lead', provider: 'claude' } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/lead', action: { type: 'session/configChanged', config: { effortLevel: 'low' } } },
    });
    await settle();
    await written();
    // What a resume hands the lead chat.
    expect(stored('lead')).toEqual({ effortLevel: 'low' });
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
      params: { channel: 'echo:/gone', action: { type: 'session/configChanged', config: { voice: 'shouty' } } },
    });
    await settle();
    await client.handle({ method: 'disposeSession', params: { channel: 'echo:/gone' } });
    // A new session under the same name, which the late answer is not about.
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/gone', provider: 'echo' } });
    answer(true);
    await settle();
    expect(store.config('gone')).toBeUndefined();
  });

  /** A host over a store already holding a config for the session `stale`, as a restart finds it. */
  const staleHost = async (config: Record<string, unknown>, preset?: Record<string, unknown>) => {
    const store = memorySessions();
    store.setConfig('stale', config);
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
      params: { channel: 'ahp-chat:/stale', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'carry on' } } },
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
    const read = async () => (await client.handle({ method: 'subscribe', params: { channel: 'claude:/stale' } }) as {
      snapshot: { state: { config: { values: Record<string, unknown> } } };
    }).snapshot.state.config.values;
    const values = await read();
    // Kept: the store only holds what the backend took, declared or not.
    expect(values.model).toBe('opus');
    expect(values.sandboxEnabled).toBe('on');
    // The wrong JSON type is refused the same way an unknown value is.
    expect(values.permissions).toEqual({ allow: [], deny: [] });
    await read();
    expect(said.filter((line) => /stale.*permissions.*"all"/.test(line))).toHaveLength(1);
    expect(said.some((line) => line.includes('stored model'))).toBe(false);
  });

  /** The `query()` options a turn on the stored session `stale` was built with. */
  const resumedQuery = async (config: Record<string, unknown>, preset?: Record<string, unknown>) => {
    const { client } = await staleHost(config, preset);
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/stale', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'carry on' } } },
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

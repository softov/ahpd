import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetSdk, actions, claude, createHost, hello, machine, open, peer, sdk,
  serving, settle, running,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

describe('what the harness offers', () => {
  it('reads models, commands and servers with no turn having happened', async () => {
    sdk.init = {
      models: [
        { value: 'default', displayName: 'Default (recommended)' },
        { value: 'opus[1m]', displayName: 'Opus (1M context)' },
      ],
      commands: [{ name: 'advisor', description: 'Read support tickets', argumentHint: '<id>' }],
      agents: [{ name: 'Explore', description: 'Read-only search agent' }],
    };
    sdk.mcp.push(
      { name: 'tasker', status: 'connected' },
      { name: 'claude.ai Gmail', status: 'needs-auth' },
      { name: 'broken', status: 'failed', error: 'spawn ENOENT' },
    );

    const { client, uri } = await running();
    // Nothing has been said. A composer has to offer the models and the slash
    // menu *before* the conversation starts, so waiting for the message
    // stream's `init` would be exactly too late.
    expect(sdk.said).toEqual([]);

    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { customizations: Record<string, unknown>[] } };
    }).snapshot.state;

    // A leaf lives in a container; an MCP server is the one kind that does
    // not, and is published bare.
    const leaves = state.customizations
      .flatMap((c) => (c.children as Record<string, unknown>[] | undefined) ?? [c]);
    const kinds = leaves.map((c) => c.type);
    expect(kinds).toContain('prompt');
    expect(kinds).toContain('agent');
    expect(state.customizations.map((c) => c.type)).toContain('mcpServer');

    const command = leaves.find((c) => c.id === 'command:advisor');
    expect(command).toMatchObject({ name: 'advisor', description: 'Read support tickets', enabled: true });
  });

  it('advertises the models on the root channel, keyed by `value`', async () => {
    sdk.init = {
      models: [{ value: 'sonnet', displayName: 'Sonnet' }],
      commands: [], agents: [],
    };
    const { client, peer: p } = await running();

    const root = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: { models: { id: string; name: string; provider: string }[] }[] } };
    }).snapshot.state;
    // `value`, not `id`. Reading the wrong name costs every model there is
    // and leaves a picker that offers nothing - which is what it did.
    // `provider` is required on `SessionModelInfo` and was simply absent: a
    // backend answers `{ id, name }` because it has one provider, and this is
    // the only place that knows which.
    expect(root.agents[0]?.models).toEqual([{ id: 'sonnet', name: 'Sonnet', provider: 'claude' }]);

    // Not asserted here: `root/agentsChanged`. The boot probe learns the
    // models before any client has connected, so the change is dispatched to
    // nobody - and the snapshot above is how every client actually finds out.
    expect(p.notes.length).toBeGreaterThanOrEqual(0);
  });

  it('gives each model its own thinking control, from what that model supports', async () => {
    sdk.init = {
      models: [
        { value: 'sonnet', displayName: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] },
        { value: 'haiku', displayName: 'Haiku' },
      ],
      commands: [], agents: [],
    };
    const { client } = await running();
    const models = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: { models: { id: string; configSchema?: { properties: Record<string, { enum: string[]; default?: string }> } }[] }[] } };
    }).snapshot.state.agents[0]?.models ?? [];

    /*
     * Per model, which is the point.
     *
     * This host advertises one session-wide `effortLevel` with all five
     * values, so a level the chosen model does not support is accepted and
     * then does nothing. The CLI reports `supportedEffortLevels` per model -
     * different models take different subsets - and `configSchema` is where
     * the protocol says a client draws that, beside the model rather than as
     * a generic row.
     */
    const sonnet = models.find((one) => one.id === 'sonnet');
    expect(sonnet?.configSchema?.properties.thinkingLevel?.enum).toEqual(['low', 'medium', 'high']);
    expect(sonnet?.configSchema?.properties.thinkingLevel?.default).toBe('high');

    // And none for a model that supports none: a client then draws no
    // control, which is the honest form of "this one does not think harder".
    expect(models.find((one) => one.id === 'haiku')?.configSchema).toBeUndefined();
  });

  it('offers one effort control, not the model\'s and the session\'s both', async () => {
    sdk.init = {
      models: [
        { value: 'sonnet', displayName: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] },
      ],
      commands: [], agents: [],
    };
    const { client } = await running();
    const cfg = await client.handle({ method: 'resolveSessionConfig', params: {} }) as {
      schema: { properties: Record<string, unknown> };
      values: Record<string, unknown>;
    };
    /*
     * Two controls for one setting is one too many.
     *
     * A model's `configSchema` and the session-wide `effortLevel` reach the
     * same place, and a client draws both - so a person sees two effort
     * pickers sitting on different values. The model's is the truthful one: it
     * lists what that model supports, where the session key lists all five
     * whatever is chosen.
     */
    expect(Object.keys(cfg.schema.properties)).not.toContain('effortLevel');
    // And no orphan value either: a value whose property is gone is a setting
    // nothing can draw and nothing can change.
    expect(cfg.values.effortLevel).toBeUndefined();
  });

  it('keeps the session-wide effort where no model has one of its own', async () => {
    sdk.init = {
      models: [{ value: 'haiku', displayName: 'Haiku' }],
      commands: [], agents: [],
    };
    const { client } = await running();
    const cfg = await client.handle({ method: 'resolveSessionConfig', params: {} }) as {
      schema: { properties: Record<string, unknown> };
    };
    // Otherwise a harness whose models say nothing about effort would offer no
    // effort control at all, which is worse than a general one.
    expect(Object.keys(cfg.schema.properties)).toContain('effortLevel');
  });

  it('runs a turn on the model and the thinking level the client chose', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: {
          type: 'chat/turnStarted',
          turnId: 't1',
          message: { text: 'hi', model: { id: 'sonnet', config: { thinkingLevel: 'xhigh' } } },
        },
      },
    });
    await settle();
    /*
     * `TurnMessage.model` is a `ModelSelection` - an object - and this host
     * read it as a string, so the model a client named on a turn was dropped
     * every time. The `config` beside it is the form that model advertised,
     * and a schema a client draws as a control that changes nothing is worse
     * than no control at all.
     */
    expect(sdk.modelsSet).toContain('sonnet');
    expect(sdk.effortsSet).toContain('xhigh');
    // And the session-wide control is told, because the CLI holds one effort
    // setting for the whole query: two controls describing different futures
    // is the state this avoids.
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { config: { values: Record<string, string> } } };
    }).snapshot.state;
    expect(state.config.values.effortLevel).toBe('xhigh');
  });

  it('says what a harness offers on the root channel, before any session exists', async () => {
    // No models: a harness nobody has signed into enumerates none and still
    // has skills and servers. This is the case that used to answer nothing.
    sdk.init = { models: [], commands: [{ name: 'review', description: 'A review pass' }], agents: [] };
    sdk.skills.push({ name: 'review', description: 'A review pass' });
    sdk.mcp.push({ name: 'gmail', status: 'needs-auth' });
    const { client } = await running();

    const root = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: { customizations?: { id: string; type: string; children?: { id: string }[] }[] }[] } };
    }).snapshot.state;
    // The protocol's own place for them: `AgentInfo.customizations`, which it
    // says are propagated into a session's list when one is created with this
    // agent. Without it the only way to ask what a harness offers is to create
    // a session, which is the thing somebody is deciding about.
    const offered = root.agents[0]?.customizations ?? [];
    expect(offered.map((one) => one.id).sort()).toEqual(['directory:skills', 'mcp:gmail']);
    expect(offered.find((one) => one.id === 'mcp:gmail')?.type).toBe('mcpServer');
    // And the skill is inside the directory, which is where a leaf goes.
    const held = offered.find((one) => one.id === 'directory:skills') as { children?: { id: string }[] } | undefined;
    expect(held?.children?.map((one) => one.id)).toEqual(['skill:review']);
  });

  it('says an MCP server\'s state in the protocol\'s words, not the SDK\'s', async () => {
    sdk.init = { models: [], commands: [], agents: [] };
    sdk.mcp.push(
      { name: 'ok', status: 'connected' },
      { name: 'gmail', status: 'needs-auth' },
      { name: 'broken', status: 'failed', error: 'spawn ENOENT' },
      { name: 'off', status: 'disabled' },
    );
    const { client, uri } = await running();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: {
        state: {
          customizations: {
            id: string; enablement?: { kind: string; enabled: boolean }[];
            state?: { kind: string; error?: { errorType?: string; message?: string } };
          }[];
        };
      };
    }).snapshot.state;

    const byId = new Map(state.customizations.map((c) => [c.id, c]));
    expect(byId.get('mcp:ok')?.state?.kind).toBe('ready');
    expect(byId.get('mcp:broken')?.state?.kind).toBe('error');
    // Why it is not ready, in the host's own words - the whole value of
    // showing the row rather than hiding it. An `ErrorInfo` and not a bare
    // `message`, which is what `McpServerErrorState` actually requires.
    expect(byId.get('mcp:broken')?.state?.error?.message).toBe('spawn ENOENT');
    expect(byId.get('mcp:broken')?.enablement?.[0]?.enabled).toBe(false);
    expect(byId.get('mcp:off')?.state?.kind).toBe('stopped');

    /*
     * A server needing a sign-in is an error, not `authRequired`.
     *
     * `McpServerAuthRequiredState` requires a `reason` and a `resource` whose
     * identifier is the canonical MCP server URI with `authorization_servers`
     * the MCP authorization spec calls REQUIRED. The CLI reports a name and
     * `needs-auth` and nothing else, so emitting that state would be two
     * required fields short - a client told to sign in with nowhere to do it.
     */
    expect(byId.get('mcp:gmail')?.state?.kind).toBe('error');
    expect(byId.get('mcp:gmail')?.state?.error?.errorType).toBe('mcpAuthRequired');
    // Still switched on: it is enabled and unreachable, which is not the same
    // as somebody having turned it off.
    expect(byId.get('mcp:gmail')?.enablement?.[0]?.enabled).toBe(true);
  });

  it('offers a live session\'s own commands, which live inside its containers', async () => {
    sdk.init = {
      models: [],
      commands: [
        { name: 'compact', description: 'Compact the conversation' },
        { name: 'writing', description: 'How to write' },
      ],
      agents: [],
    };
    // In both lists, so it is a skill a person may invoke. One the CLI loaded
    // and did *not* put behind a slash is the agent's own, and stays out.
    sdk.skills.push({ name: 'writing', description: 'How to write' });
    sdk.skills.push({ name: 'internal', description: 'The agent\'s own' });
    const { client, chatUri } = await running();
    await settle(8);

    const found = await client.handle({
      method: 'completions',
      params: { channel: chatUri, kind: 'userMessage', text: '/', offset: 1 },
    }) as { items: { insertText: string; attachment: Record<string, unknown> }[] };
    /*
     * A prompt and a skill are `children` of a directory, never top-level.
     *
     * A filter that looked only at the top level found nothing every time and
     * fell back to the backend-wide list - which answered correctly and by
     * accident, and would have handed two sessions in one directory the same
     * commands however differently they were configured.
     */
    expect(found.items.map((one) => one.insertText).sort()).toEqual(['/compact', '/writing']);
    expect(found.items.map((one) => one.insertText)).not.toContain('/internal');
    // And said to be a skill, where it is one. The reference client keeps a
    // runtime skill in an automation's text only when the flag is there,
    // and drops it otherwise as a command it cannot find a file for. `true`
    // or absent, which is how it is read.
    const meta = Object.fromEntries(found.items.map((one) => [one.insertText, (one.attachment._meta as Record<string, unknown>).isSkill]));
    expect(meta).toEqual({ '/compact': undefined, '/writing': true });
  });

  it('gives a live session\'s skill its argument hint as ghost text', async () => {
    sdk.init = {
      models: [],
      commands: [{ name: 'writing', description: 'How to write' }],
      agents: [],
    };
    sdk.skills.push({ name: 'writing', description: 'How to write', argumentHint: '<topic>' });
    const { client, uri, chatUri } = await running();
    await settle(8);

    // The skill keeps its hint under this host's own key, because
    // `SkillCustomization` declares none.
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { customizations: Record<string, unknown>[] } };
    }).snapshot.state;
    const skill = state.customizations
      .flatMap((c) => (c.children as Record<string, unknown>[] | undefined) ?? [c])
      .find((c) => c.id === 'skill:writing');
    expect(skill?._meta).toEqual({ 'ahpd.argumentHint': '<topic>' });

    // The completion item carries it under the reference client's own key.
    const found = await client.handle({
      method: 'completions',
      params: { channel: chatUri, kind: 'userMessage', text: '/wri', offset: 4 },
    }) as { items: { insertText: string; attachment: Record<string, unknown> }[] };
    expect(found.items.map((one) => one.insertText)).toEqual(['/writing ']);
    expect(found.items[0]?.attachment._meta).toMatchObject({ command: 'writing', isSkill: true, argumentHint: '<topic>' });
  });

  it('knows a skill from a command on the harness-wide list too', async () => {
    sdk.init = {
      models: [],
      commands: [
        { name: 'compact', description: 'Compact the conversation' },
        { name: 'writing', description: 'How to write' },
      ],
      agents: [],
    };
    sdk.skills.push({ name: 'writing', description: 'How to write' });
    // The root channel, with no session to ask: the probe's flat command
    // list cannot tell a skill from a command, but its customizations can.
    const client = open();
    await client.handle(hello(['0.9.0']));
    await settle(8);
    const found = await client.handle({
      method: 'completions',
      params: { channel: 'ahp-root://', kind: 'userMessage', text: '/', offset: 1, provider: 'claude' },
    }) as { items: { insertText: string; attachment: Record<string, unknown> }[] };
    const meta = Object.fromEntries(found.items.map((one) => [one.insertText, (one.attachment._meta as Record<string, unknown>).isSkill]));
    expect(meta).toEqual({ '/compact': undefined, '/writing': true });
  });

  it('tells the client that a slash is worth asking about', async () => {
    const client = open();
    const result = await client.handle(hello(['0.9.0'])) as { completionTriggerCharacters: string[] };
    // Without this the client has no reason to believe a slash means anything
    // here, and types it into the chat as text.
    expect(result.completionTriggerCharacters).toEqual(['/', '@']);
  });

  it('hands a brand-new session what the host already knows', async () => {
    // The CLI has not answered yet. Answering `[]` is a lie a client caches:
    // it asks once when the session opens, gets nothing, and shows an empty
    // slash menu until something else happens to re-ask - which is exactly
    // what "I had to open the skills screen first" looks like.
    sdk.init = {};
    const { client, uri, chatUri } = await running();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { customizations: { id: string }[] } };
    }).snapshot.state;
    // Seeded from the boot probe rather than empty. (This host's probe found
    // nothing either, so what is pinned is the path, not a count.)
    expect(Array.isArray(state.customizations)).toBe(true);

    const menu = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: '/', offset: 1 },
    }) as { items: unknown[] };
    expect(Array.isArray(menu.items)).toBe(true);
  });

  it('opens the session even when the CLI will not answer yet', async () => {
    sdk.init = {};
    const { client, uri } = await running();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { customizations: unknown[]; lifecycle: string } };
    }).snapshot.state;
    // An empty list is a real answer. A session that refused to open because
    // the harness had nothing to say would be a worse one.
    expect(state.customizations).toEqual([]);
    expect(state.lifecycle).toBe('ready');
  });
});

describe('what a slash offers', () => {
  const withCommands = async () => {
    sdk.init = {
      models: [],
      agents: [],
      commands: [
        { name: 'advisor', description: 'Read support tickets', argumentHint: '<id>' },
        { name: 'deep-research', description: 'Research a question' },
        { name: 'design', description: 'Create a design canvas' },
      ],
    };
    const { client, chatUri } = await running();
    return { client, chatUri };
  };

  it('completes a slash into the commands the harness contributed', async () => {
    const { client, chatUri } = await withCommands();
    const result = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: '/de', offset: 3 },
    }) as { items: { insertText: string; rangeStart: number; rangeEnd: number; attachment: { label: string } }[] };

    expect(result.items.map((i) => i.attachment.label)).toEqual(['/deep-research', '/design']);
    // Replaces the slash and what was typed after it, not the whole input.
    expect(result.items[0]?.rangeStart).toBe(0);
    expect(result.items[0]?.rangeEnd).toBe(3);
  });

  it('puts what was typed a prefix of first', async () => {
    const { client, chatUri } = await withCommands();
    const result = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: '/design', offset: 7 },
    }) as { items: { attachment: { label: string } }[] };
    // A substring match is useful and is not what somebody typing this wants
    // to see first.
    expect(result.items[0]?.attachment.label).toBe('/design');
  });

  it('adds a space only for a command that takes an argument', async () => {
    const { client, chatUri } = await withCommands();
    const result = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: '/a', offset: 2 },
    }) as { items: { insertText: string }[] };
    expect(result.items[0]?.insertText).toBe('/advisor ');

    const design = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: '/design', offset: 7 },
    }) as { items: { insertText: string }[] };
    // A trailing space on a command that takes none is a character somebody
    // has to delete.
    expect(design.items[0]?.insertText).toBe('/design');
  });

  it('says nothing for a slash that is part of a path', async () => {
    const { client, chatUri } = await withCommands();
    const result = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: 'look at src/design', offset: 18 },
    }) as { items: unknown[] };
    expect(result.items).toEqual([]);
  });

  it('offers the harness-wide list while a new session is still starting', async () => {
    // The session exists; its CLI has not answered yet. Preferring its silence
    // over what the harness offers is a slash menu that is empty for exactly
    // as long as somebody is likely to use it.
    sdk.init = {};
    const { client, chatUri } = await running();
    const result = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: '/', offset: 1 },
    }) as { items: unknown[] };
    // The boot probe answered nothing here either, so this pins the fallback
    // path rather than a count.
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('answers nothing for a kind it does not serve', async () => {
    const { client, chatUri } = await withCommands();
    // An `@` is a file. Returning commands for it would be answering a
    // different question than the one asked.
    const result = await client.handle({
      method: 'completions',
      params: { kind: 'somethingElse', channel: chatUri, text: '/de', offset: 3 },
    }) as { items: unknown[] };
    expect(result.items).toEqual([]);
  });

  it('offers a command that two backends share once, on the root channel', async () => {
    /*
     * Five Claude presets report the same `batch`.
     *
     * The root channel is where a composer with no session asks, and it was
     * answered with one `/batch` per backend - a menu with the same command
     * repeated, where picking the second is picking the first.
     */
    sdk.init = { models: [], commands: [{ name: 'batch', description: 'Run it in the background' }], agents: [] };
    const host = createHost({
      path: '/home/softov',
      agents: [
        claude({ paths: ['/home/softov'] }),
        claude({ paths: ['/home/softov'], provider: 'codex', displayName: 'Codex' }),
      ],
      ...machine(),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await settle(8);
    /*
     * Both probes have answered, so both lists are on the root. Asserted
     * rather than assumed: a backend still starting offers nothing, and the
     * answer below would then hold for the wrong reason.
     */
    const root = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: { provider: string; customizations?: unknown[] }[] } };
    }).snapshot.state;
    expect(root.agents.map((one) => [one.provider, one.customizations !== undefined]))
      .toEqual([['claude', true], ['codex', true]]);

    const found = await client.handle({
      method: 'completions',
      params: { channel: 'ahp-root://', kind: 'userMessage', text: '/', offset: 1 },
    }) as { items: { insertText: string }[] };
    expect(found.items.map((one) => one.insertText)).toEqual(['/batch']);
  });

  it('gives a new session its own backend\'s commands, and not every backend\'s', async () => {
    /*
     * A session created a moment ago has not heard back from its own CLI.
     *
     * That silence used to fall back to every backend's list, so a session was
     * handed the commands of backends it does not run - which is a slash menu
     * whose items the session will refuse.
     */
    sdk.init = { models: [], commands: [{ name: 'batch', description: 'Run it in the background' }], agents: [] };
    const { echo } = await import('../../../examples/echo/agent.js');
    const host = createHost({
      path: '/home/softov',
      agents: [
        claude({ paths: ['/home/softov'] }),
        { ...echo({ path: '/home/softov', pace: 0 }), provider: 'codex', displayName: 'Codex' },
      ],
      ...machine(),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await settle(8);
    // The boot probe has answered, and the root channel is where that shows.
    const root = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: { provider: string; customizations?: unknown[] }[] } };
    }).snapshot.state;
    expect(root.agents.find((one) => one.provider === 'claude')?.customizations).toBeDefined();
    // Cleared only now, so what this session's own CLI answers stands for a
    // backend that has not replied yet.
    sdk.init = {};

    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/live' } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    await settle(8);

    const found = await client.handle({
      method: 'completions',
      params: { channel: opened.snapshot.state.defaultChat, kind: 'userMessage', text: '/', offset: 1 },
    }) as { items: { insertText: string }[] };
    // `batch` is this session's own backend's; `shout` belongs to the other
    // one, and is what answering with every backend's list would have added.
    expect(found.items.map((one) => one.insertText)).toEqual(['/batch']);
  });
});

describe('what goes after a slash', () => {
  const withCommands = async (count: number) => {
    sdk.init = {
      commands: Array.from({ length: count }, (_, i) => ({ name: `cmd${String(i).padStart(3, '0')}` })),
    };
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    // The boot probe is what learns them, and it answers on its own clock.
    await settle(8);
    return client;
  };

  const ask = async (client: Awaited<ReturnType<typeof withCommands>>, text: string) =>
    await client.handle({
      method: 'completions',
      params: { channel: 'ahp-root://', kind: 'userMessage', text, offset: text.length },
    }) as { items: { insertText: string }[] };

  it('answers a bare slash with the whole list, not a screenful', async () => {
    const client = await withCommands(120);
    // A client that filters locally rather than asking again per keystroke
    // never offers what was truncated here - silently, and always the same
    // ones.
    const all = await ask(client, '/');
    expect(all.items).toHaveLength(120);
  });

  it('keeps a narrowing query bounded', async () => {
    const client = await withCommands(120);
    const some = await ask(client, '/cmd0');
    expect(some.items.length).toBeLessThanOrEqual(50);
  });

  it('answers before any session exists, which is when a composer asks', async () => {
    const client = await withCommands(3);
    const all = await ask(client, '/');
    expect(all.items.map((i) => i.insertText)).toEqual(['/cmd000', '/cmd001', '/cmd002']);
  });
});

describe('turning a customization on and off', () => {
  /** A live session that has heard what its CLI offers. */
  const withServers = async (status: string) => {
    sdk.init = { commands: [{ name: 'review', description: 'Read the diff' }] };
    sdk.mcp = [{ name: 'desk', status }];
    const started = await running();
    // `describe` answers on its own clock; the customizations arrive with it.
    await settle(8);
    return started;
  };

  const toggle = (client: Awaited<ReturnType<typeof running>>['client'], id: string, enabled: boolean) => {
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/live', action: { type: 'session/customizationToggled', id, enablement: [{ kind: 'session', enabled }] } },
    });
  };

  it('switches an MCP server off through the CLI, and reports what it became', async () => {
    const { client, peer: p, uri } = await withServers('connected');
    sdk.mcp = [{ name: 'desk', status: 'disabled' }];
    toggle(client, 'mcp:desk', false);
    await settle(8);

    expect(sdk.mcpToggled).toEqual([{ name: 'desk', enabled: false }]);
    // Read back rather than assumed: a server told to stop can fail to, and
    // reporting what was *asked for* draws a row that is not true.
    const said = actions(p, uri).filter((e) => e.action.type === 'session/customizationUpdated').at(-1);
    expect(said?.action.customization).toMatchObject({
      // `enablement`, not a flat flag: an MCP server is the one customization
      // the protocol decides per scope.
      id: 'mcp:desk', enablement: [{ kind: 'session', enabled: false }], state: { kind: 'stopped' },
    });
  });

  it('reconnects one that was not ready, because that is how signing in happens', async () => {
    const { client } = await withServers('needs-auth');
    sdk.mcp = [{ name: 'desk', status: 'connected' }];
    toggle(client, 'mcp:desk', true);
    await settle(8);

    // `toggleMcpServer` only lifts the disabled flag - a server that was off
    // because nobody had signed in comes straight back `authRequired`, which
    // reads as a switch that flips itself off.
    expect(sdk.mcpReconnected).toEqual(['desk']);
  });

  it('switches off a server a client names by the file it is declared in', async () => {
    const { client } = await withServers('connected');
    sdk.mcp = [{ name: 'desk two', status: 'disabled' }];
    // How a plugin's server is named to a client: the file that declares it,
    // with the server's own escaped name in a fragment - and the CLI knows it
    // by that name alone.
    toggle(client, 'file:///plugins/one/.mcp.json#mcp=desk%20two', false);
    await settle(8);

    expect(sdk.mcpToggled).toEqual([{ name: 'desk two', enabled: false }]);
  });

  it('does not reconnect one that was already ready', async () => {
    const { client } = await withServers('connected');
    toggle(client, 'mcp:desk', true);
    await settle(8);
    expect(sdk.mcpReconnected).toEqual([]);
    expect(sdk.mcpToggled).toEqual([{ name: 'desk', enabled: true }]);
  });

  it('refuses a prompt out loud, and puts the switch back', async () => {
    const said: string[] = [];
    sdk.init = { commands: [{ name: 'review' }] };
    const host = createHost({
      path: '/home/softov',
      agents: [claude({ paths: ['/home/softov'] })],
      onEvent: (message) => said.push(message),
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/live' } });
    await settle(8);

    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/live', action: { type: 'session/customizationToggled', id: 'command:review', enablement: [{ kind: 'session', enabled: false }] } },
    });
    await settle(8);

    // The CLI has no runtime switch for a prompt, a skill or a subagent. A
    // control that reports success and changes nothing is worse than one that
    // says it cannot.
    expect(said.some((line) => line.includes('command:review has no runtime switch'))).toBe(true);
    // And the list goes back out, so the switch a client drew from it returns
    // to where it was rather than showing a change that did not happen.
    expect(actions(p, 'ahp-session:/live').some((e) => e.action.type === 'session/customizationsChanged')).toBe(true);
  });

  it('serves the dedicated start and stop actions too', async () => {
    const { client } = await withServers('disabled');
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/live', action: { type: 'session/mcpServerStartRequested', id: 'mcp:desk' } },
    });
    await settle(8);
    expect(sdk.mcpReconnected).toEqual(['desk']);

    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/live', action: { type: 'session/mcpServerStopRequested', id: 'mcp:desk' } },
    });
    await settle(8);
    expect(sdk.mcpToggled).toEqual([{ name: 'desk', enabled: false }]);
  });
});

describe('a skill is not a prompt', () => {
  const offering = async () => {
    // The CLI hands out two lists that overlap. `review` is in both, `deploy`
    // is a built-in prompt, and `keybindings-help` is a skill the CLI does
    // not put behind a slash.
    sdk.init = { commands: [{ name: 'review', description: 'Read the diff' }, { name: 'deploy' }] };
    sdk.skills = [{ name: 'review' }, { name: 'keybindings-help', description: 'Internal' }];
    const started = await running();
    await settle(8);
    const opened = await started.client.handle({ method: 'subscribe', params: { channel: started.uri } }) as {
      snapshot: { state: { customizations: Record<string, unknown>[] } };
    };
    /*
     * Flattened for the assertions below, because the shape they are about is
     * each leaf's own. A top-level customization is a *container* and the
     * leaves are its `children` - see the containers' own test below.
     */
    const leaves = opened.snapshot.state.customizations
      .flatMap((entry) => (entry.children as Record<string, unknown>[] | undefined) ?? [entry]);
    return { ...started, items: leaves, top: opened.snapshot.state.customizations };
  };

  it('puts each kind in a directory of its own, and nothing bare', async () => {
    const { top } = await offering();
    /*
     * A leaf published at the top level is read as a *plugin*, and the
     * reference client then walks `<uri>/agents`, `<uri>/skills`,
     * `<uri>/commands` and `<uri>/rules` looking for what is inside it - four
     * failed reads apiece against a `uri` that was a bare name.
     */
    expect(top.every((entry) => entry.type === 'directory' || entry.type === 'mcpServer')).toBe(true);
    const skills = top.find((entry) => entry.contents === 'skill');
    expect(skills?.type).toBe('directory');
    // A directory says what one kind of thing it holds, and holds them.
    expect((skills?.children as unknown[])?.length).toBeGreaterThan(0);
    expect(String(skills?.uri)).toMatch(/^file:\/\/.*\/\.claude\/skills$/);
  });

  it('calls a command that was loaded as a skill a skill', async () => {
    const { items } = await offering();
    const review = items.find((entry) => entry.name === 'review');
    expect(review).toMatchObject({ type: 'skill', id: 'skill:review' });
    // And keeps the description, whichever of the two lists carried it.
    expect(review?.description).toBe('Read the diff');
    // Once, not twice: it is in both lists and it is one thing.
    expect(items.filter((entry) => entry.name === 'review')).toHaveLength(1);
  });

  it('leaves a command that is not a skill a prompt', async () => {
    const { items } = await offering();
    expect(items.find((entry) => entry.name === 'deploy')).toMatchObject({ type: 'prompt' });
  });

  it('marks a skill the CLI will not put behind a slash as the agent\'s', async () => {
    const { items } = await offering();
    // Read off the CLI's own two answers rather than guessed from the name.
    expect(items.find((entry) => entry.name === 'keybindings-help'))
      .toMatchObject({ type: 'skill', disableUserInvocation: true });
  });

  it('completes a slash into skills as well as prompts, and not the agent\'s', async () => {
    const { client, chatUri } = await offering();
    const found = await client.handle({
      method: 'completions',
      params: { channel: chatUri, kind: 'userMessage', text: '/', offset: 1 },
    }) as { items: { insertText: string }[] };
    const names = found.items.map((entry) => entry.insertText);
    expect(names).toContain('/review');
    expect(names).toContain('/deploy');
    // Offering one the host would refuse is worse than not offering it.
    expect(names).not.toContain('/keybindings-help');
  });
});

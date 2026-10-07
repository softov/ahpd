import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@microsoft/agent-host-protocol';
import {
  resetSdk, actions, hello, open, peer, sdk, serving, sessionQueries,
  settle, running,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

describe('the handshake', () => {
  it('answers the highest version offered that it speaks, in whatever order they came', async () => {
    for (const offered of [['1.0.0'], ['0.9.0'], ['0.9.0', '1.0.0'], ['1.0.0', '0.9.0']]) {
      const result = await open().handle(hello(offered)) as { protocolVersion: string };
      expect(result.protocolVersion).toBe(offered.includes('1.0.0') ? '1.0.0' : '0.9.0');
    }
  });

  it('refuses with the versions it can speak, so the client can say why', async () => {
    for (const offered of [['0.8.0'], ['99.0.0']]) {
      await expect(open().handle(hello(offered))).rejects.toMatchObject({
        code: -32005,
        // `supportedVersions`, which is the name the protocol gives it. Under
        // any other one the client has read `undefined` and has no version to
        // retry with, which is the whole point of the field.
        data: { supportedVersions: ['1.0.0', '0.9.0'] },
      });
    }
  });

  it('refuses an entry that is not a version, naming it, rather than reading past it', async () => {
    // Not "unsupported" and not "skipped": a `MAJOR.MINOR.PATCH` that is not
    // one is a client that is wrong about what it speaks, and telling it so
    // is the only thing that can fix it.
    for (const offered of [['1.0'], [7]]) {
      await expect(open().handle(hello(offered))).rejects.toMatchObject({ code: -32602 });
    }
  });

  it('hands back the snapshots the client asked to start with', async () => {
    const client = open();
    const result = await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] })) as {
      snapshots: { resource: string; state: { agents: unknown[] }; fromSeq: number }[];
    };
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]?.resource).toBe('ahp-root://');
    expect(result.snapshots[0]?.state.agents).toHaveLength(1);
  });

  it('still connects when a channel it was asked for is gone', async () => {
    const client = open();
    // A handshake that fails because one requested session has no agent is a
    // client that cannot connect at all.
    const result = await client.handle(
      hello(['0.9.0'], { initialSubscriptions: ['ahp-root://', 'ahp-session:/vanished'] }),
    ) as { snapshots: unknown[] };
    expect(result.snapshots).toHaveLength(1);
  });

  it('answers a ping before it has been introduced', async () => {
    const client = open();
    // The spec says so in as many words: a server MUST answer `ping` whether
    // or not the client has completed `initialize`. It is how a client tells
    // a live socket from one an idle proxy quietly dropped, and a liveness
    // check that needs a handshake first cannot do that.
    expect(await client.handle({ method: 'ping', params: {} })).toBeNull();
  });

  it('serves nothing else until it has', async () => {
    const client = open();
    await expect(client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }))
      .rejects.toMatchObject({ code: -32601 });
  });

  it('hears a notification sent before the handshake and does nothing with it', async () => {
    const client = open();
    // No id, so there is nowhere to say no - and nothing to say it about: an
    // unintroduced client holds no subscriptions and has no `clientSeq` an
    // echo could be matched against.
    expect(await client.handle({ method: 'unsubscribe', params: { channel: 'ahp-root://' } }))
      .toBeUndefined();
    // And the connection is still usable afterwards.
    const result = await client.handle(hello([PROTOCOL_VERSION])) as { protocolVersion: string };
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('refuses a second introduction on the same connection', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    // Re-agreeing the version would re-key every subscription this connection
    // is holding, so the reference host does not serve `initialize` twice
    // either.
    await expect(client.handle(hello(['0.9.0']))).rejects.toMatchObject({ code: -32601 });
  });
});

describe('what it will not pretend', () => {
  it('says a method it does not serve rather than answering an empty success', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    // An empty success leaves the client waiting for state that is never
    // coming, which reads as a hang rather than as a missing feature.
    // `otlp` is telemetry export, which this daemon has no opinion about and
    // is unlikely ever to serve - so it stays a fair example.
    await expect(client.handle({ method: 'otlp', params: { channel: 'ahp-root://' } }))
      .rejects.toMatchObject({ code: -32601 });
  });

  it('refuses a provider it does not have', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    await expect(client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/x', provider: 'copilot' },
    })).rejects.toMatchObject({ code: -32002 });
  });

  it('refuses an action a client is not allowed to originate, and says which', async () => {
    const { client, peer: p, uri } = await running();
    // `chat/delta` is this host telling clients what it did. One arriving
    // *from* a client is a client lying about what happened - and it is told
    // so, because a dispatch dropped in silence leaves the client's
    // optimistic state diverged with nothing to reconcile against.
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/delta', turnId: 't1', partId: 'p', content: 'x' } },
    });
    expect(sdk.said).toEqual([]);
    const refused = p.notes.filter((note) => note.method === 'action').at(-1);
    expect(refused?.params).toMatchObject({
      rejectionReason: expect.stringContaining('not a client\'s'),
    });
  });

  it('tells a host-only action apart from one it has not got round to', async () => {
    const { client, peer: p, uri } = await running();
    const why = (action: Record<string, unknown>) => {
      client.handle({ method: 'dispatchAction', params: { channel: uri, action } });
      const refused = p.notes.filter((note) => note.method === 'action').at(-1);
      return String((refused?.params as { rejectionReason?: string }).rejectionReason);
    };
    // `session/ready` is the host's own to say, and a client sending one is
    // claiming something happened.
    expect(why({ type: 'session/ready' })).toContain('not a client\'s');
    // Every action a client *may* originate is served, so the other complaint
    // is now reachable only from a protocol newer than this host: an action
    // `IS_CLIENT_DISPATCHABLE` has never heard of is not a client lying, it is
    // one this host has not caught up with. Two different complaints, and they
    // used to be the same one.
    expect(why({ type: 'chat/somethingLater' })).toContain('not served yet');
  });

  it('says what is actually wrong with a dispatch, not only that it is unserved', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    const why = (action: Record<string, unknown>) => {
      client.handle({ method: 'dispatchAction', params: { channel: uri, action } });
      const refused = p.notes.filter((note) => note.method === 'action').at(-1);
      return String((refused?.params as { rejectionReason?: string }).rejectionReason);
    };
    // Refusals that used to read `is not served yet`, which is true and tells
    // a client nothing it can act on. Two of these are now served, so what
    // they refuse is the particular thing asked for rather than the action:
    // a turn that is not there, and a question nobody is waiting on.
    expect(why({ type: 'chat/truncated', turnId: 't1' })).toContain('not a completed turn');
    expect(why({ type: 'chat/inputAnswerChanged', requestId: 'r1', questionId: 'q1', answer: {} }))
      .toContain('not a question this chat is waiting on');
    expect(why({ type: 'chat/toolCallResultConfirmed', toolCallId: 'c1' }))
      .toContain('result to be confirmed');
    // Not the same complaint: this one is a *contributor's* to send, for a
    // tool the client itself provides, and no call by that name is one.
    expect(why({ type: 'chat/toolCallContentChanged', toolCallId: 'c1' }))
      .toContain('not a call a client is running here');
    expect(chatUri).toBeTruthy();
  });

  it('answers nothing at all to a notification', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    // `unsubscribe` and `dispatchAction` carry no id, and replying to one is a
    // protocol error rather than a harmless extra message.
    expect(await client.handle({ method: 'unsubscribe', params: { channel: 'ahp-root://' } }))
      .toBeUndefined();
    expect(await client.handle({ method: 'dispatchAction', params: { action: { type: 'chat/turnStarted' } } }))
      .toBeUndefined();
  });

  it('drops one connection\'s subscription without touching another\'s', async () => {
    const host = serving('/home/softov');
    const a = host.accept(peer());
    const b = host.accept(peer());
    await a.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await b.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    expect(host.connections()).toBe(2);

    // Channel-wide would kill the stream the other one is reading.
    a.handle({ method: 'unsubscribe', params: { channel: 'ahp-root://' } });
    a.close();
    expect(host.connections()).toBe(1);
  });
});

describe('a client that dropped, coming back', () => {
  it('replays what it missed, and nothing it already had', async () => {
    const host = serving('/home/softov');
    const first = peer();
    const a = host.accept(first);
    await a.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await a.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    await a.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/live' } });

    const seen = actions(first, 'ahp-chat:/live');
    const upTo = seen.at(-1)?.serverSeq ?? 0;

    // The socket goes. The host forgets this client's subscriptions with it,
    // which is why the client has to say what they were.
    a.close();
    a.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/live', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'while away' } } },
    });
    await settle();

    const back = host.accept(peer());
    await back.handle(hello(['0.9.0']));
    const result = await back.handle({
      method: 'reconnect',
      params: {
        channel: 'ahp-root://',
        clientId: 'probe',
        lastSeenServerSeq: upTo,
        subscriptions: ['ahp-root://', 'ahp-session:/live', 'ahp-chat:/live'],
      },
    }) as { type: string; actions: { serverSeq: number; action: { type: string } }[]; missing: string[] };

    expect(result.type).toBe('replay');
    expect(result.missing).toEqual([]);
    // Everything after what it saw, and nothing at or before it.
    expect(result.actions.every((held) => held.serverSeq > upTo)).toBe(true);
    expect(result.actions.map((held) => held.action.type)).toContain('chat/turnStarted');
  });

  it('names the channels it cannot resume rather than failing the whole thing', async () => {
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const result = await client.handle({
      method: 'reconnect',
      params: {
        channel: 'ahp-root://',
        clientId: 'probe',
        lastSeenServerSeq: 0,
        subscriptions: ['ahp-root://', 'ahp-session:/vanished'],
      },
    }) as { type: string; missing: string[] };
    // A session whose agent has gone. Said, so the client drops it rather
    // than waiting on a channel that will never speak again.
    expect(result.missing).toEqual(['ahp-session:/vanished']);
    expect(result.type).toBe('replay');
  });

  it('watches again, so what happens next arrives without a fresh subscribe', async () => {
    const host = serving('/home/softov');
    const setup = host.accept(peer());
    await setup.handle(hello(['0.9.0']));
    await setup.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });

    const p = peer();
    const back = host.accept(p);
    await back.handle(hello(['0.9.0']));
    await back.handle({
      method: 'reconnect',
      params: {
        channel: 'ahp-root://',
        clientId: 'probe',
        lastSeenServerSeq: 0,
        subscriptions: ['ahp-chat:/live'],
      },
    });
    back.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/live', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'after' } } },
    });
    await settle();
    expect(actions(p, 'ahp-chat:/live').some((e) => e.action.type === 'chat/turnStarted')).toBe(true);
  });

  it('hands back snapshots when the gap is longer than the buffer', async () => {
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    // A thousand and one actions later, the first is gone. Rather than
    // replaying a hole, the protocol has a second answer.
    for (let i = 0; i < 1100; i++) {
      client.handle({
        method: 'dispatchAction',
        params: { channel: 'ahp-session:/live', action: { type: 'session/isReadChanged', isRead: i % 2 === 0 } },
      });
    }
    await settle();
    const result = await client.handle({
      method: 'reconnect',
      params: {
        channel: 'ahp-root://',
        clientId: 'probe',
        lastSeenServerSeq: 1,
        subscriptions: ['ahp-session:/live'],
      },
    }) as { type: string; snapshots: { resource: string }[] };
    expect(result.type).toBe('snapshot');
    expect(result.snapshots.map((s) => s.resource)).toEqual(['ahp-session:/live']);
  });
});

/*
 * A token, pushed by the client that will spend it.
 *
 * `authenticate` was unserved here for a long time on the grounds that the SDK
 * had nowhere to put a credential. It does - `query()` takes `env` - and the
 * reason it was unreachable was this host advertising no protected resource,
 * which the protocol requires before a client may name one.
 */
describe('authenticating', () => {
  const ANTHROPIC = 'https://api.anthropic.com';
  const DIR = '/home/softov';

  /** A host serving one directory, and a client that has said hello. */
  const opened = async () => {
    const host = serving(DIR);
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    return { host, client };
  };

  it('advertises the resource a token would be for', async () => {
    const { client } = await opened();
    const root = await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: { provider: string; protectedResources?: { resource: string; required?: boolean }[] }[] } };
    };
    const found = root.snapshot.state.agents.find((one) => one.provider === 'claude');
    expect(found?.protectedResources?.[0]?.resource).toBe(ANTHROPIC);
    // Not required, and that is the truthful declaration: this daemon runs as
    // whoever started it and works with nothing pushed at all.
    expect(found?.protectedResources?.[0]?.required).toBe(false);
  });

  it('takes a token for it', async () => {
    const { client } = await opened();
    await expect(client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-test-1' },
    })).resolves.toEqual({});
  });

  it('refuses one for a resource it never advertised', async () => {
    const { client } = await opened();
    // -32602 and not -32007: it is a bad parameter, not a demand to
    // authenticate, and answering the latter sends a client round a loop it
    // cannot get out of.
    await expect(client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: 'https://api.github.com', token: 't' },
    })).rejects.toMatchObject({ code: -32602 });
  });

  it('takes an empty token as the credential being withdrawn', async () => {
    const { client } = await opened();
    await client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-lent' },
    });
    // The protocol's word for signing out, and the reference host's: an
    // empty token revokes. This host refused it as a bad parameter, which
    // left a client no way to take back what it had pushed.
    await expect(client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: ANTHROPIC, token: '' },
    })).resolves.toEqual({});
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/revoked', provider: 'claude', workingDirectories: [`file://${DIR}`] },
    });
    await settle();
    // Started on nothing, the way a session for a client that never pushed is.
    expect(sessionQueries().at(-1)?.options.env).toBeUndefined();
  });

  it('refuses a lifetime that is not a positive integer of seconds', async () => {
    const { client } = await opened();
    for (const expiresIn of [0, -1, 1.5, '3600', null]) {
      // A bad parameter rather than a token with no expiry: a client that
      // sent `0` meant something, and "forever" is the opposite of it.
      await expect(client.handle({
        method: 'authenticate',
        params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-t', expiresIn },
      })).rejects.toMatchObject({ code: -32602 });
    }
  });

  it('tells the client when its token runs out, and stops spending it', async () => {
    vi.useFakeTimers();
    try {
      const host = serving(DIR);
      const wire = peer();
      const client = host.accept(wire);
      await client.handle(hello(['0.9.0']));
      await client.handle({
        method: 'authenticate',
        params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-short', expiresIn: 60 },
      });
      await vi.advanceTimersByTimeAsync(59_000);
      expect(wire.notes.filter((one) => one.method === 'auth/required')).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1_000);
      // The protocol's own word for it, to the connection that pushed the
      // token and no other, carrying the record a client signs in against
      // rather than the bare identifier.
      expect(wire.notes.filter((one) => one.method === 'auth/required')).toEqual([{
        method: 'auth/required',
        params: {
          channel: 'ahp-root://',
          resource: expect.objectContaining({ resource: ANTHROPIC }),
          reason: 'expired',
        },
      }]);

      await client.handle({
        method: 'createSession',
        params: { channel: 'ahp-session:/expired', provider: 'claude', workingDirectories: [`file://${DIR}`] },
      });
      await vi.advanceTimersByTimeAsync(10);
      // Not spent: a session started on a credential its client was just told
      // is gone would fail saying so, later and less clearly.
      expect(sessionQueries().at(-1)?.options.env).toBeUndefined();
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('forgets the clock when the token is replaced or withdrawn', async () => {
    vi.useFakeTimers();
    try {
      const host = serving(DIR);
      const wire = peer();
      const client = host.accept(wire);
      await client.handle(hello(['0.9.0']));
      await client.handle({
        method: 'authenticate',
        params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-first', expiresIn: 60 },
      });
      // Replaced by one with no expiry the client knows of: the old clock
      // must not take the new token away when it strikes.
      await client.handle({
        method: 'authenticate',
        params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-second' },
      });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(wire.notes.filter((one) => one.method === 'auth/required')).toHaveLength(0);
      await client.handle({
        method: 'createSession',
        params: { channel: 'ahp-session:/kept', provider: 'claude', workingDirectories: [`file://${DIR}`] },
      });
      await vi.advanceTimersByTimeAsync(10);
      expect((sessionQueries().at(-1)?.options.env as Record<string, string> | undefined)?.ANTHROPIC_API_KEY).toBe('sk-second');

      // And withdrawn: nothing to expire, so nothing is said.
      await client.handle({
        method: 'authenticate',
        params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-third', expiresIn: 30 },
      });
      await client.handle({
        method: 'authenticate',
        params: { channel: 'ahp-root://', resource: ANTHROPIC, token: '' },
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(wire.notes.filter((one) => one.method === 'auth/required')).toHaveLength(0);
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('still refuses a withdrawal for a resource it never advertised', async () => {
    const { client } = await opened();
    await expect(client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: 'https://api.github.com', token: '' },
    })).rejects.toMatchObject({ code: -32602 });
  });

  it('spends it on the session that client then opens', async () => {
    const { client } = await opened();
    await client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-test-2' },
    });
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/authed', provider: 'claude', workingDirectories: [`file://${DIR}`] },
    });
    await settle();

    const env = sessionQueries().at(-1)?.options.env as Record<string, string> | undefined;
    expect(env?.ANTHROPIC_API_KEY).toBe('sk-test-2');
    // Over the daemon's environment rather than instead of it: the SDK's
    // `env` replaces the subprocess environment outright, so a lone
    // credential is a subprocess with no PATH.
    expect(env?.PATH).toBe(process.env.PATH);
  });

  it('leaves a session alone when nothing was pushed', async () => {
    const { client } = await opened();
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/plain', provider: 'claude', workingDirectories: [`file://${DIR}`] },
    });
    await settle();
    // Absent, so the subprocess inherits - which is how every session worked
    // before there was anything to push, and how an automation's still does.
    expect(sessionQueries().at(-1)?.options.env).toBeUndefined();
  });

  it('does not lend a token to a session another client asked for', async () => {
    const { host, client } = await opened();
    await client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-mine' },
    });

    // A second client on the same host, who pushed nothing.
    const other = host.accept(peer());
    await other.handle({
      method: 'initialize',
      params: { clientId: 'b', protocolVersions: ['0.9.0'] },
    });
    await other.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/theirs', provider: 'claude', workingDirectories: [`file://${DIR}`] },
    });
    await settle();

    // Per connection, which the specification is explicit about. A token one
    // client offered is theirs.
    expect(sessionQueries().at(-1)?.options.env).toBeUndefined();
  });
});

describe('telling a client how far along something is', () => {
  it('reports progress against the token the request carried, and stops at the total', async () => {
    const { client, peer: p } = await running();
    p.notes.length = 0;
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/slow', provider: 'claude', progressToken: 'tok-1' },
    });
    const along = p.notes
      .filter((one) => one.method === 'root/progress')
      .map((one) => one.params as { progressToken: string; progress: number; total?: number; message?: string });
    /*
     * Only when the client asked, and only to the client that asked.
     *
     * The token belongs to that request and means nothing to anybody else, so
     * this is the one thing here that is not broadcast.
     */
    expect(along.map((one) => one.progressToken)).toEqual(['tok-1', 'tok-1', 'tok-1']);
    expect(along.map((one) => one.progress)).toEqual([0, 1, 2]);
    // Complete is `progress === total`, which is how the protocol spells it.
    expect(along.at(-1)?.total).toBe(2);
    expect(typeof along[0]?.message).toBe('string');
  });

  it('says nothing when no token was given', async () => {
    const { client, peer: p } = await running();
    p.notes.length = 0;
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/quiet', provider: 'claude' } });
    expect(p.notes.some((one) => one.method === 'root/progress')).toBe(false);
  });
});

/*
 * Coming back to a host that never met you.
 *
 * `reconnect` is a question about this host's own sequence numbers, and a
 * client it has not handshaken with is asking about somebody else's. Answering
 * an empty replay to one is telling it that it has missed nothing, which is a
 * claim about a stream it was never reading - and the reference client believes
 * it, keeps the state it had, and never subscribes to anything again.
 */
describe('a client this host has not met', () => {
  it('is refused with the code its client reads as "forgotten"', async () => {
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await expect(client.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'never-said-hello', lastSeenServerSeq: 419, subscriptions: ['ahp-root://'] },
    })).rejects.toMatchObject({ code: -32008 });
  });

  it('is answered once it has handshaken', async () => {
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const back = host.accept(peer());
    const result = await back.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: 0, subscriptions: ['ahp-root://'] },
    }) as { type: string };
    expect(result.type).toBe('replay');
  });

  it('sends state, not a difference, to one that claims to be ahead', async () => {
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const back = host.accept(peer());
    const result = await back.handle({
      method: 'reconnect',
      // Counted against a previous run of this daemon. Whatever it saw, it was
      // not this stream, so there is no difference to send it.
      params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: 419, subscriptions: ['ahp-root://'] },
    }) as { type: string; snapshots: { resource: string }[] };
    expect(result.type).toBe('snapshot');
    expect(result.snapshots.map((one) => one.resource)).toEqual(['ahp-root://']);
  });
});

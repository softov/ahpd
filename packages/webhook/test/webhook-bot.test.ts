import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { botTarget, turnEnds } from '../src/bot.js';
import { botSeams, callBack, defaults, dispatcher } from '../src/plugin.js';
import { checkEndpoint } from '../src/record.js';
import type { AddressInfo } from 'node:net';
import type { ServerResponse } from 'node:http';
import type { PluginPeer } from '../../sdk/src/types/plugin.js';
import type { BotSeams, TurnEnd } from '../src/bot.js';
import type { Dispatched } from '../src/plugin.js';
import type { Call } from '../src/call.js';
import type { Endpoint } from '../src/record.js';
import manifest from '../package.json' with { type: 'json' };

/*
 * The bot target, over stub seams.
 *
 * The seams stand for the plugin's connection to its host: the chat a read of
 * the bot answers, a turn sent there, and that turn's end. What is checked is
 * the thread map the target keeps, and what each reply mode answers and posts.
 */

/** One turn the target sent, in the order it sent them. */
interface Sent { chat: string; turn: string; text: string }

/**
 * A target over stub seams, with what each seam was asked.
 *
 * A turn ends when the case says so with `finish`, or at once when `auto` is
 * set, with the text `echo: <what was sent>`.
 */
async function made(options: { auto?: boolean; sessions?: Record<string, string>; chatRefused?: boolean; timeout?: number; turnRefused?: string; unconfirmed?: boolean } = {}) {
  const threads = await memoryRecords().collection('webhook-threads');
  const sent: Sent[] = [];
  const posted: { url: string; id: string; body: Record<string, unknown> }[] = [];
  const problems: string[] = [];
  const opened: string[] = [];
  const waiting = new Map<string, (end: TurnEnd) => void>();
  const sessions = options.sessions ?? { 'bot://motion': 'bot-chat:/motion' };
  const seams: BotSeams = {
    threads,
    session: async (bot) => {
      // A yield, so two first calls of one thread overlap here.
      await new Promise((r) => { setTimeout(r, 5); });
      return sessions[bot];
    },
    // Each chat the host opened, in the order asked: `ahp-chat:/<n>`.
    openChat: async (session) => {
      if (options.chatRefused === true) return undefined;
      opened.push(session);
      return `ahp-chat:/${String(opened.length)}`;
    },
    send: async (chat, turn, text) => {
      sent.push({ chat, turn, text });
      if (options.turnRefused !== undefined) return { refused: options.turnRefused };
      if (options.unconfirmed === true) return { unconfirmed: true };
      if (options.auto === true) waiting.get(turn)?.({ status: 'complete', text: `echo: ${text}` });
      return { taken: true };
    },
    ended: (_chat, turn) => new Promise<TurnEnd>((resolve) => { waiting.set(turn, resolve); }),
    forget: (_chat, turn) => { waiting.delete(turn); },
    post: async (_endpoint, url, id, body) => { posted.push({ url, id, body }); },
    syncTimeoutSeconds: options.timeout ?? 60,
    problem: (line) => { problems.push(line); },
  };
  const target = botTarget(seams);
  /** End the turn the target sent `n`th, counted from 0. */
  const finish = (n: number, text: string, status: TurnEnd['status'] = 'complete', error?: string): void => {
    const turn = sent[n]?.turn ?? '';
    waiting.get(turn)?.({ status, text, ...(error === undefined ? {} : { error }) });
  };
  return { target, threads, sent, posted, problems, finish, waiting, opened };
}

/** An endpoint as the route hands it over: checked. */
const endpoint = (fields: Record<string, unknown> = {}): Endpoint => checkEndpoint({
  id: 'ci', bot: 'bot://motion', secret: 'host:ci-hook', reply: 'none', ...fields,
});

/** One call as the route hands it over: its body parsed, and its query read. */
const call = (body: unknown, query = ''): Call => ({
  raw: new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
  body,
  headers: {},
  query: Object.fromEntries(new URLSearchParams(query)),
  method: 'POST',
});

/** Let what the target does after it answered run, such as a callback. */
const settle = () => new Promise((r) => { setTimeout(r, 10); });

describe('the thread map', () => {
  it('keeps one thread record, at a chat of its own opened in the session the read of the bot answered', async () => {
    const { target, threads, sent, opened } = await made();
    const answer = await target(endpoint(), call({ thread: 'pr-12', text: 'hello' }));
    expect(answer.status).toBe(202);
    expect(opened).toEqual(['bot-chat:/motion']);
    expect(sent.map((one) => [one.chat, one.text])).toEqual([['ahp-chat:/1', 'hello']]);
    const kept = await threads.list();
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ endpoint: 'ci', thread: 'pr-12', session: 'bot-chat:/motion', chat: 'ahp-chat:/1' });
    expect(String(kept[0]?.id)).toMatch(/^t-[0-9a-f-]{36}$/);
  });

  it('sends a second call on the same thread in the same chat', async () => {
    const { target, sent, opened } = await made();
    await target(endpoint(), call({ thread: 'pr-12', text: 'one' }));
    await target(endpoint(), call({ thread: 'pr-12', text: 'two' }));
    expect(sent.map((one) => one.chat)).toEqual(['ahp-chat:/1', 'ahp-chat:/1']);
    expect(opened).toHaveLength(1);
    expect(sent[0]?.turn).not.toBe(sent[1]?.turn);
  });

  it('sends another thread of the bot in a chat of its own', async () => {
    const { target, threads, sent } = await made();
    await target(endpoint(), call({ thread: 'pr-12', text: 'one' }));
    await target(endpoint(), call({ thread: 'pr-13', text: 'two' }));
    expect(sent.map((one) => one.chat)).toEqual(['ahp-chat:/1', 'ahp-chat:/2']);
    expect((await threads.list()).map((one) => one['thread'])).toEqual(['pr-12', 'pr-13']);
  });

  it('keeps a record of each thread, and one of two first calls of one thread at the same time', async () => {
    const { target, threads, sent, opened } = await made();
    const answers = await Promise.all([
      target(endpoint(), call({ thread: 'pr-12', text: 'one' })),
      target(endpoint(), call({ thread: 'pr-12', text: 'two' })),
    ]);
    expect(answers.map((one) => one.status)).toEqual([202, 202]);
    expect(sent.map((one) => one.chat)).toEqual(['ahp-chat:/1', 'ahp-chat:/1']);
    expect(opened).toHaveLength(1);
    expect(await threads.list()).toHaveLength(1);
  });

  it('answers 409 and keeps no thread when the host opens no chat for it', async () => {
    const { target, threads, sent } = await made({ chatRefused: true });
    const answer = await target(endpoint(), call({ thread: 'pr-12', text: 'hello' }));
    expect(answer.status).toBe(409);
    expect(await threads.list()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('sends the text of a JSON body as the turn, with the thread from the body', async () => {
    const { target, sent } = await made();
    await target(endpoint(), call({ thread: 'pr-12', text: 'from json' }, '?thread=other'));
    expect(sent.map((one) => one.text)).toEqual(['from json']);
    const again = await target(endpoint(), call({ thread: 'pr-12', text: 'again' }));
    expect(again.status).toBe(202);
    expect(sent[1]?.chat).toBe(sent[0]?.chat);
  });

  it('sends a plain text body as the text, with the thread from the query value', async () => {
    const { target, sent, threads } = await made();
    expect((await target(endpoint(), call('the build broke', '?thread=pr-12'))).status).toBe(202);
    expect(sent.map((one) => one.text)).toEqual(['the build broke']);
    expect((await threads.list())[0]).toMatchObject({ thread: 'pr-12' });
  });

  it('sends a JSON body with no string text as the whole text, with the thread from the query', async () => {
    const { target, sent, threads } = await made();
    const body = { event: 'push', ref: 'main' };
    expect((await target(endpoint(), call(body, '?thread=pushes'))).status).toBe(202);
    expect(sent.map((one) => one.text)).toEqual([JSON.stringify(body)]);
    expect((await threads.list())[0]).toMatchObject({ thread: 'pushes' });
  });

  it('answers 400 to a call with no thread id, or with no text', async () => {
    const { target, sent } = await made();
    expect((await target(endpoint(), call({ text: 'hello' }))).status).toBe(400);
    expect((await target(endpoint(), call('', '?thread=pr-12'))).status).toBe(400);
    expect((await target(endpoint(), call({ thread: 'pr-12', text: '' }))).status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('answers 409 and keeps no thread when the read answers no chat for the bot', async () => {
    const { target, threads, sent } = await made({ sessions: {} });
    const answer = await target(endpoint(), call({ thread: 'pr-12', text: 'hello' }));
    expect(answer.status).toBe(409);
    expect(await threads.list()).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe('the reply modes', () => {
  it('answers 202 and posts nothing with reply none', async () => {
    const { target, posted, finish } = await made();
    const answer = await target(endpoint({ reply: 'none' }), call({ thread: 'pr-12', text: 'hello', callback: 'https://ci.example.com/x' }));
    expect(answer.status).toBe(202);
    finish(0, 'done');
    await settle();
    expect(posted).toEqual([]);
  });

  it('answers 202 with reply callback, and posts the text at the turn end', async () => {
    const { target, posted, sent, finish } = await made();
    const answer = await target(
      endpoint({ reply: 'callback', callbackPrefix: 'https://ci.example.com/hooks/' }),
      call({ thread: 'pr-12', text: 'hello', callback: 'https://ci.example.com/hooks/pr-12' }),
    );
    expect(answer.status).toBe(202);
    expect(await answer.json()).toMatchObject({ thread: 'pr-12', turn: sent[0]?.turn });
    expect(posted).toEqual([]);
    finish(0, 'all green');
    await settle();
    expect(posted).toEqual([{
      url: 'https://ci.example.com/hooks/pr-12',
      id: sent[0]?.turn,
      body: { thread: 'pr-12', turn: sent[0]?.turn, status: 'complete', text: 'all green' },
    }]);
  });

  it('takes the callback URL from the query when the body is text', async () => {
    const { target, posted, finish } = await made();
    const answer = await target(
      endpoint({ reply: 'callback', callbackPrefix: 'https://ci.example.com/hooks/' }),
      call('hello', `?thread=pr-12&callback=${encodeURIComponent('https://ci.example.com/hooks/a')}`),
    );
    expect(answer.status).toBe(202);
    finish(0, 'ok');
    await settle();
    expect(posted.map((one) => one.url)).toEqual(['https://ci.example.com/hooks/a']);
  });

  it('answers 400 and sends no turn for a callback URL outside the prefix', async () => {
    const { target, sent } = await made();
    const answer = await target(
      endpoint({ reply: 'callback', callbackPrefix: 'https://ci.example.com/hooks/' }),
      call({ thread: 'pr-12', text: 'hello', callback: 'https://ci.example.com/other/pr-12' }),
    );
    expect(answer.status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('answers 400 for a callback URL on another host with the same leading text', async () => {
    const { target, sent } = await made();
    const near = endpoint({ reply: 'callback', callbackPrefix: 'https://ci.example.com/' });
    for (const callback of ['https://ci.example.com.evil.test/x', 'https://ci.example.com@evil.test/x', 'not a url']) {
      expect((await target(near, call({ thread: 'pr-12', text: 'hello', callback }))).status).toBe(400);
    }
    expect(sent).toEqual([]);
  });

  it('answers 400 to a callback call on an endpoint with no prefix, or with no callback URL', async () => {
    const { target, sent } = await made();
    // A record written by hand can hold the reply without a prefix, though a
    // connector saved now cannot: the target still refuses every call.
    const noPrefix: Endpoint = { id: 'ci', bot: 'bot://motion', secret: 'host:ci-hook', reply: 'callback' };
    expect((await target(noPrefix, call({ thread: 'pr-12', text: 'hello', callback: 'https://ci.example.com/x' }))).status).toBe(400);
    expect((await target(endpoint({ reply: 'callback', callbackPrefix: 'https://ci.example.com/' }), call({ thread: 'pr-12', text: 'hello' }))).status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('answers 200 with the text of the turn with reply sync', async () => {
    const { target, sent } = await made({ auto: true });
    const answer = await target(endpoint({ reply: 'sync' }), call({ thread: 'pr-12', text: 'hello' }));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ thread: 'pr-12', turn: sent[0]?.turn, status: 'complete', text: 'echo: hello' });
  });

  it('answers 502 with status error and the message when a sync turn fails', async () => {
    const { target, sent, finish } = await made();
    const pending = target(endpoint({ reply: 'sync' }), call({ thread: 'pr-12', text: 'hello' }));
    setTimeout(() => { finish(0, 'half', 'error', 'the model refused'); }, 10);
    const answer = await pending;
    expect(answer.status).toBe(502);
    expect(await answer.json()).toEqual({ thread: 'pr-12', turn: sent[0]?.turn, status: 'error', text: 'half', error: 'the model refused' });
  });

  it('posts status error and the message to the callback when the turn fails', async () => {
    const { target, posted, sent, finish } = await made();
    const answer = await target(
      endpoint({ reply: 'callback', callbackPrefix: 'https://ci.example.com/hooks/' }),
      call({ thread: 'pr-12', text: 'hello', callback: 'https://ci.example.com/hooks/pr-12' }),
    );
    expect(answer.status).toBe(202);
    finish(0, '', 'error', 'the model refused');
    await settle();
    expect(posted).toEqual([{
      url: 'https://ci.example.com/hooks/pr-12',
      id: sent[0]?.turn,
      body: { thread: 'pr-12', turn: sent[0]?.turn, status: 'error', text: '', error: 'the model refused' },
    }]);
  });

  it('answers 202 with status running when a sync turn outlives the timeout, and leaves the turn alone', async () => {
    const { target, sent, posted } = await made({ timeout: 0.02 });
    const answer = await target(endpoint({ reply: 'sync' }), call({ thread: 'pr-12', text: 'hello' }));
    expect(answer.status).toBe(202);
    expect(await answer.json()).toEqual({ thread: 'pr-12', turn: sent[0]?.turn, status: 'running' });
    // Nothing more is sent: no cancel, and no second turn.
    expect(sent).toHaveLength(1);
    expect(posted).toEqual([]);
  });

  it('waits for the plugin option when the endpoint names no timeout', async () => {
    const { target, finish } = await made({ timeout: 0.2 });
    const pending = target(endpoint({ reply: 'sync' }), call({ thread: 'pr-12', text: 'hello' }));
    setTimeout(() => { finish(0, 'in time'); }, 50);
    const answer = await pending;
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ text: 'in time' });
  });

  it('holds a sync wait within the sender\'s window: three seconds for Graph and ten for GitHub, whatever the setting', async () => {
    vi.useFakeTimers();
    try {
      for (const [auth, seconds] of [['graph', 3], ['github', 10]] as const) {
        const { target } = await made({ timeout: 60 });
        let answered: Response | undefined;
        void target(endpoint({ reply: 'sync', auth, syncTimeoutSeconds: 60 }), call({ thread: 'pr-12', text: 'hello' }))
          .then((answer) => { answered = answer; });
        await vi.advanceTimersByTimeAsync(seconds * 1000 - 100);
        expect(answered).toBeUndefined();
        await vi.advanceTimersByTimeAsync(200);
        expect(answered?.status).toBe(202);
      }
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('takes the endpoint timeout over the plugin option', async () => {
    const { target, finish } = await made({ timeout: 0.02 });
    const pending = target(endpoint({ reply: 'sync', syncTimeoutSeconds: 1 }), call({ thread: 'pr-12', text: 'hello' }));
    setTimeout(() => { finish(0, 'in time'); }, 60);
    const answer = await pending;
    expect(answer.status).toBe(200);

    const { target: short } = await made({ timeout: 60 });
    const quick = await short(endpoint({ reply: 'sync', syncTimeoutSeconds: 0.02 }), call({ thread: 'pr-12', text: 'hello' }));
    expect(quick.status).toBe(202);
  });
});

describe('a turn the host refused', () => {
  it('answers 409 with the reason, and posts no callback', async () => {
    const { target, posted, problems, finish, waiting } = await made({ turnRefused: 'the chat is busy' });
    const answer = await target(
      endpoint({ reply: 'callback', callbackPrefix: 'https://ci.example.com/hooks/' }),
      call({ thread: 'pr-12', text: 'hello', callback: 'https://ci.example.com/hooks/pr-12' }),
    );
    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ message: 'the chat is busy' });
    expect(waiting.size).toBe(0);
    finish(0, 'late');
    await settle();
    expect(posted).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('the chat is busy');
  });

  it('answers 409 to a sync call at once, without the timeout', async () => {
    const { target, waiting } = await made({ turnRefused: 'the chat is busy', timeout: 60 });
    const started = Date.now();
    const answer = await target(endpoint({ reply: 'sync' }), call({ thread: 'pr-12', text: 'hello' }));
    expect(answer.status).toBe(409);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(waiting.size).toBe(0);
  });
});

it('forgets the wait for a turn the host refused', async () => {
  const ends = turnEnds();
  let settled = false;
  void ends.wait('ahp-chat:/c1', 't1').then(() => { settled = true; });
  ends.forget('ahp-chat:/c1', 't1');
  ends.heard({ chat: 'ahp-chat:/c1', turn: 't1', status: 'complete' });
  await settle();
  expect(settled).toBe(false);
});

it('hears a turn that ended in an error, with its message', async () => {
  const ends = turnEnds();
  const waited = ends.wait('ahp-chat:/c1', 't1');
  ends.heard({ chat: 'ahp-chat:/c1', turn: 't1', status: 'error', error: 'the model refused' });
  expect(await waited).toEqual({ status: 'error', error: 'the model refused' });
});

it('gives the plugin option syncTimeoutSeconds GitHub\'s ten seconds by default, and maxBodyBytes 25 MiB', () => {
  const optionsSchema = manifest.ahpd.optionsSchema;
  expect(defaults).toEqual({ syncTimeoutSeconds: 10, maxBodyBytes: 25 * 1024 * 1024 });
  expect(optionsSchema.properties).toHaveProperty('syncTimeoutSeconds');
  expect(optionsSchema.properties).toHaveProperty('maxBodyBytes');
});

describe('the plugin connection', () => {
  /** A connection stub that keeps what the plugin sent, and lets a case speak as the host. */
  const stub = () => {
    const notified: { method: string; params: Record<string, unknown> }[] = [];
    let handle: (message: Record<string, unknown>) => void = () => {};
    const conn: PluginPeer = {
      send: () => {},
      notify: (method, params) => { notified.push({ method, params: params as Record<string, unknown> }); },
      request: async () => ({}),
      onMessage: (next) => { handle = next; },
      close: () => {},
    };
    return { conn, notified, say: (message: Record<string, unknown>) => { handle(message); } };
  };

  it('resolves a dispatch with the rejectionReason of the action that carries its clientSeq', async () => {
    const { conn, notified, say } = stub();
    const sender = dispatcher(conn, 'ahpd-webhook');
    const first = sender.dispatch('ahp-chat:/c1', { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'one', origin: { kind: 'user' } } });
    const second = sender.dispatch('ahp-chat:/c1', { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { text: 'two', origin: { kind: 'user' } } });
    expect(notified.map((one) => one.params['clientSeq'])).toEqual([1, 2]);
    // Another client's action with the same seq is not this one's answer.
    say({ method: 'action', params: { channel: 'ahp-chat:/c1', origin: { clientId: 'other', clientSeq: 2 }, rejectionReason: 'no' } });
    say({ method: 'action', params: { channel: 'ahp-chat:/c1', origin: { clientId: 'ahpd-webhook', clientSeq: 2 }, rejectionReason: 'the chat is busy' } });
    say({ method: 'action', params: { channel: 'ahp-chat:/c1', origin: { clientId: 'ahpd-webhook', clientSeq: 1 } } });
    expect(await second).toEqual({ refused: 'the chat is busy' });
    expect(await first).toEqual({ taken: true });
  });

  it('reads no echo as a delivery not confirmed, never as taken, and says so', async () => {
    const { conn } = stub();
    const silent: string[] = [];
    const sender = dispatcher(conn, 'ahpd-webhook', 20, (channel) => { silent.push(channel); });
    expect(await sender.dispatch('ahp-chat:/c1', { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'one', origin: { kind: 'user' } } })).toEqual({ unconfirmed: true });
    expect(silent).toEqual(['ahp-chat:/c1']);
  });
});

/*
 * A chat's subscription is held while a turn needs it, for the echo of its
 * start and the read of its end, and let go once that read is made, as VS
 * Code's router holds one for a delivery and releases it when it settles.
 */
it('holds a chat\'s subscription while a turn needs it, and releases it at the turn\'s end or its refusal', async () => {
  const asked: string[] = [];
  const told: string[] = [];
  const handlers = new Map<string, (event: never) => void>();
  const conn = {
    request: async (method: string, params: { channel: string }) => {
      asked.push(`${method} ${params.channel}`);
      return { snapshot: { state: { turns: [{ id: 't1', responseParts: [{ kind: 'markdown', content: 'done' }] }] } } };
    },
    notify: (method: string, params: { channel: string }) => { told.push(`${method} ${params.channel}`); },
    onMessage: () => {},
  } as unknown as PluginPeer;
  const host = {
    on: (event: string, handler: (event: never) => void) => { handlers.set(event, handler); },
    problem: () => {},
    records: () => undefined,
    registerClose: () => {},
  } as unknown as Parameters<typeof botSeams>[0];
  let answer: Dispatched = { taken: true };
  const sender = { dispatch: async () => answer };
  const seams = botSeams(host, async () => ({ conn, sender }), 10);

  const end = seams.ended('ahp-chat:/c1', 't1');
  expect(await seams.send('ahp-chat:/c1', 't1', 'hello')).toEqual({ taken: true });
  expect(asked).toEqual(['subscribe ahp-chat:/c1']);
  expect(told).toEqual([]);
  (handlers.get('turn_end') as (event: unknown) => void)({ chat: 'ahp-chat:/c1', turn: 't1', status: 'complete' });
  expect(await end).toMatchObject({ status: 'complete', text: 'done' });
  expect(told).toEqual(['unsubscribe ahp-chat:/c1']);

  answer = { refused: 'the chat is busy' };
  expect(await seams.send('ahp-chat:/c2', 't2', 'again')).toEqual({ refused: 'the chat is busy' });
  seams.forget('ahp-chat:/c2', 't2');
  await new Promise((r) => { setTimeout(r, 5); });
  expect(told).toEqual(['unsubscribe ahp-chat:/c1', 'unsubscribe ahp-chat:/c2']);
});

it('answers 504 in VS Code\'s words to a call whose turn the host never confirmed, and posts nothing', async () => {
  const { target, posted, waiting, sent } = await made({ unconfirmed: true });
  const answer = await target(
    endpoint({ reply: 'callback', callbackPrefix: 'https://ci.example.com/hooks/' }),
    call({ thread: 'pr-12', text: 'hello', callback: 'https://ci.example.com/hooks/pr-12' }),
  );
  expect(answer.status).toBe(504);
  expect(await answer.json()).toEqual({
    thread: 'pr-12',
    turn: sent[0]?.turn,
    message: 'Remote message delivery was not confirmed. It may already be queued; do not retry automatically.',
  });
  expect(waiting.size).toBe(0);
  await settle();
  expect(posted).toEqual([]);
});

describe('the callback', () => {
  /** A server on a free port that answers each request with `reply`, and counts them. */
  const serve = async (reply: (response: ServerResponse) => void) => {
    let hits = 0;
    const server = createServer((_request, response) => { hits += 1; reply(response); });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}/`, hits: () => hits, close: () => new Promise((r) => { server.close(r); }) };
  };

  /** No wait between attempts, so a case runs the whole schedule at once. */
  const quick = { wait: async () => {} };

  it('counts a redirect a failure, does not follow it, and tries again on the schedule', async () => {
    const second = await serve((response) => { response.end('ok'); });
    const first = await serve((response) => { response.writeHead(307, { location: second.url }).end(); });
    try {
      await expect(callBack(endpoint(), first.url, 'turn-1', { thread: 'pr-12' }, { ...quick, schedule: [0, 5_000, 300_000] }))
        .rejects.toThrow('the callback failed 3 times, the last time because it answered 307');
      expect(first.hits()).toBe(3);
      expect(second.hits()).toBe(0);
    }
    finally {
      await first.close();
      await second.close();
    }
  });

  it('signs each attempt as Standard Webhooks has a producer sign one, with the attempt\'s own timestamp', async () => {
    const seen: Record<string, string | undefined>[] = [];
    const bodies: string[] = [];
    let answers = [500, 200];
    const fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      seen.push({ id: headers.get('webhook-id') ?? undefined, stamp: headers.get('webhook-timestamp') ?? undefined, signature: headers.get('webhook-signature') ?? undefined });
      bodies.push(String(init?.body));
      const [status = 200, ...rest] = answers;
      answers = rest;
      return new Response(null, { status });
    };
    let clock = 1_700_000_000_000;
    const key = Buffer.from('a fixed key of the endpoint');
    const secret = `whsec_${key.toString('base64')}`;
    await callBack(endpoint({ auth: 'standard', secret }), 'https://ci.example.com/hooks/pr-12', 'turn-1', { thread: 'pr-12' }, {
      ...quick, fetch, now: () => { clock += 7_000; return clock; },
    });
    expect(seen.map((one) => one.id)).toEqual(['turn-1', 'turn-1']);
    expect(seen.map((one) => one.stamp)).toEqual(['1700000007', '1700000014']);
    for (const [at, one] of seen.entries()) {
      const expected = createHmac('sha256', key).update(`turn-1.${String(one.stamp)}.${String(bodies[at])}`).digest('base64');
      expect(one.signature).toBe(`v1,${expected}`);
    }
  });

  it('stops at 410 Gone, and waits at least a retry-after it is given', async () => {
    const waited: number[] = [];
    let answers: [number, Record<string, string>][] = [[503, { 'retry-after': '120' }], [410, {}], [200, {}]];
    const fetch = async (): Promise<Response> => {
      const [[status, headers] = [200, {}], ...rest] = answers;
      answers = rest;
      return new Response(null, { status, headers });
    };
    await expect(callBack(endpoint(), 'https://ci.example.com/hooks/pr-12', 'turn-1', {}, { fetch, wait: async (ms) => { waited.push(ms); } }))
      .rejects.toThrow('the callback answered 410 Gone, so it is not tried again');
    expect(waited).toEqual([120_000]);
  });
});

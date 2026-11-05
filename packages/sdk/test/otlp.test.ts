import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { chatUriFor } from '../src/host/channels.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * The host's own log, as a channel.
 *
 * Worth its own file for one reason: it is the only thing here that is a
 * *notification* rather than an action. It carries no `serverSeq`, moves no
 * state and is not replayed - so the assertions are about what a subscriber
 * gets and, just as much, about what it does not.
 */

const DIR = '/tmp/otlp';

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return { notes, send: () => {}, notify: (method, params) => notes.push({ method, params }), request: async () => ({}), answered: () => {}, close: () => {} };
}

async function connected() {
  const host = createHost({ path: DIR, agents: [echo({ path: DIR, pace: 0 })] });
  const p = peer();
  const client = host.accept(p);
  const hello = await client.handle({
    method: 'initialize',
    params: { clientId: 'a', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { telemetry?: { logs?: string } };
  return { host, client, peer: p, hello };
}

const logs = (p: ReturnType<typeof peer>) => p.notes
  .filter((n) => n.method === 'otlp/exportLogs')
  .map((n) => n.params as { channel: string; payload: Record<string, unknown> });

it('advertises the logs channel as a template, because the variable is the severity', async () => {
  const { hello } = await connected();
  // A client expands this before subscribing. A literal URI would mean every
  // subscriber gets every line whether or not it wanted them.
  expect(hello.telemetry?.logs).toBe('ahp-otlp://logs/{level}');
});

it('sends nothing to a client that has not subscribed', async () => {
  const { client, peer: p } = await connected();
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/a', provider: 'echo' } });
  expect(logs(p)).toEqual([]);
});

it('subscribes without a snapshot, because the channel is a stream', async () => {
  const { client } = await connected();
  // The spec's empty SubscribeResult, the snapshot left out for a stateless
  // channel, as VS Code answers it.
  for (const channel of ['ahp-otlp://logs/info', 'ahp-otlp://traces', 'ahp-otlp://metrics']) {
    expect(await client.handle({ method: 'subscribe', params: { channel } })).toEqual({});
  }
});

it('carries what the host logs as an OTLP request the client can parse', async () => {
  const { client, peer: p } = await connected();
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-otlp://logs/info' } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/a', provider: 'echo' } });

  const sent = logs(p);
  expect(sent.length).toBeGreaterThan(0);
  expect(sent[0]?.channel).toBe('ahp-otlp://logs/info');
  // The payload is an `ExportLogsServiceRequest` verbatim - AHP does not
  // redeclare the OpenTelemetry type system, so the shape has to be right or
  // a client parsing it with an OTel schema gets nothing.
  const first = sent[0]?.payload as {
    resourceLogs: { scopeLogs: { logRecords: { body: { stringValue: string }; severityText: string }[] }[] }[];
  };
  const record = first.resourceLogs[0]?.scopeLogs[0]?.logRecords[0];
  expect(record?.severityText).toBe('INFO');
  expect(typeof record?.body.stringValue).toBe('string');
  expect(sent.some((one) => (one.payload as typeof first)
    .resourceLogs[0]?.scopeLogs[0]?.logRecords[0]?.body.stringValue.includes('ahp-session:/a'))).toBe(true);
});

it('is not replayed, which is what stateless means', async () => {
  const { client, peer: p } = await connected();
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-otlp://logs/info' } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/a', provider: 'echo' } });
  const had = logs(p).length;
  expect(had).toBeGreaterThan(0);

  // A reconnect replays actions from a `serverSeq`. These are notifications
  // and carry none, so a client that dropped and came back has missed them -
  // and must not be handed them again as if it had not.
  const again = await client.handle({
    method: 'reconnect',
    params: { clientId: 'a', subscriptions: ['ahp-otlp://logs/info'], lastSeenServerSeq: 0 },
  }) as { type: string; actions?: unknown[] };
  const replayed = (again.actions ?? []) as { action?: { type?: string } }[];
  expect(replayed.some((one) => String(one.action?.type ?? '').startsWith('otlp/'))).toBe(false);
});

/*
 * The other two signals.
 *
 * A turn is a span because it starts, ends and has a duration; the counters
 * beside it are cumulative, so a collector that arrives late reads totals
 * rather than a difference it missed the beginning of. Both are built out of
 * the actions this host already dispatches, so a second backend gets them
 * without knowing they exist.
 */

const traces = (p: ReturnType<typeof peer>) => p.notes
  .filter((n) => n.method === 'otlp/exportTraces')
  .map((n) => (n.params as { payload: Record<string, never> }).payload);

it('advertises the traces and metrics channels as literals, having no variable to offer', async () => {
  const { hello } = await connected() as unknown as {
    hello: { telemetry?: { logs?: string; traces?: string; metrics?: string } };
  };
  // The protocol defines template variables for `logs` only - severity - and
  // says a client MUST ignore a variable it does not know, so one of this
  // host's invention here would be a channel nobody can expand.
  expect(hello.telemetry?.traces).toBe('ahp-otlp://traces');
  expect(hello.telemetry?.metrics).toBe('ahp-otlp://metrics');
});

it('sends a span for the turn, once the turn has ended', async () => {
  const { client, peer: p } = await connected();
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-otlp://traces' } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/t', provider: 'echo' } });
  const chat = chatUriFor('ahp-session:/t');
  client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } },
  });
  await new Promise((resolve) => { setTimeout(resolve, 60); });

  const spans = traces(p).flatMap((one) => (one as unknown as {
    resourceSpans: { scopeSpans: { spans: { name: string; traceId: string; spanId: string; kind: number }[] }[] }[];
  }).resourceSpans[0]?.scopeSpans[0]?.spans ?? []);
  const turn = spans.find((one) => one.name === 'turn');
  expect(turn).toBeDefined();
  // A turn is work this host does on somebody's behalf, which is what
  // `SPAN_KIND_SERVER` means, and the ids are the widths OTLP declares.
  expect(turn?.kind).toBe(2);
  expect(turn?.traceId).toMatch(/^[0-9a-f]{32}$/);
  expect(turn?.spanId).toMatch(/^[0-9a-f]{16}$/);
});

/*
 * OpenTelemetry's GenAI conventions define an agent invocation's duration and
 * tool calls, and a tool execution's duration, as histograms with the units and
 * boundaries they name; kept cumulative, so a collector that arrives late reads
 * a total.
 * https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md
 */
it('measures each turn as the GenAI conventions\' agent invocation, cumulatively', async () => {
  const { client, peer: p } = await connected();
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-otlp://metrics' } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/m', provider: 'echo' } });
  const chat = chatUriFor('ahp-session:/m');
  client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } },
  });
  await new Promise((resolve) => { setTimeout(resolve, 60); });

  const sent = p.notes.filter((n) => n.method === 'otlp/exportMetrics');
  expect(sent.length).toBeGreaterThan(0);
  type Histogram = { aggregationTemporality: number; dataPoints: { count: string; bucketCounts: string[]; explicitBounds: number[]; attributes: { key: string }[] }[] };
  const last = (sent.at(-1)?.params as { payload: { resourceMetrics: { scopeMetrics: { metrics: {
    name: string; unit: string; histogram: Histogram;
  }[] }[] }[] } }).payload;
  const metrics = last.resourceMetrics[0]?.scopeMetrics[0]?.metrics ?? [];
  expect(metrics.map((one) => one.name).sort()).toEqual(['gen_ai.invoke_agent.duration', 'gen_ai.invoke_agent.tool_calls']);
  const duration = metrics.find((one) => one.name === 'gen_ai.invoke_agent.duration');
  expect(duration?.unit).toBe('s');
  // `2` is cumulative: the reference point is the process start, not the last
  // export, so a restarted collector is not reading from an unknown baseline.
  expect(duration?.histogram.aggregationTemporality).toBe(2);
  expect(duration?.histogram.dataPoints[0]?.count).toBe('1');
  expect(duration?.histogram.dataPoints[0]?.explicitBounds).toHaveLength(13);
  expect(duration?.histogram.dataPoints[0]?.bucketCounts).toHaveLength(14);
  expect(duration?.histogram.dataPoints[0]?.attributes.map((one) => one.key)).toEqual(['gen_ai.agent.name']);
  expect(metrics.find((one) => one.name === 'gen_ai.invoke_agent.tool_calls')?.unit).toBe('{tool_call}');
});

/*
 * The spec's correlation attributes on every span, a cancelled turn's status
 * left unset, as OpenTelemetry sets Error only where a convention calls the
 * outcome one.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/telemetry-channel.md#L141-L149
 * https://opentelemetry.io/docs/specs/otel/trace/api/#set-status
 */
it('marks a turn\'s span with the spec\'s correlation attributes, and leaves a cancelled one\'s status unset', async () => {
  const { client, peer: p } = await connected();
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-otlp://traces' } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/c', provider: 'echo' } });
  const chat = chatUriFor('ahp-session:/c');
  client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } },
  });
  await client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 1 } } });
  await new Promise((resolve) => { setTimeout(resolve, 60); });

  const spans = traces(p).flatMap((one) => (one as unknown as {
    resourceSpans: { scopeSpans: { spans: { name: string; status?: unknown; attributes: { key: string; value: { stringValue: string } }[] }[] }[] }[];
  }).resourceSpans[0]?.scopeSpans[0]?.spans ?? []);
  const turn = spans.find((one) => one.name === 'turn');
  expect(turn?.attributes).toEqual([
    { key: 'ahp.session.id', value: { stringValue: 'c' } },
    { key: 'ahp.turn.id', value: { stringValue: 't1' } },
  ]);
  expect(turn).not.toHaveProperty('status');
});

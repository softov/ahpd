import { raise } from '../plugins/plugins.js';
import { idOf } from '../sessions/catalog.js';
import type { Bag } from '../types/common.js';
import type { HostEvent } from '../types/events.js';
import type { HostContext } from './context.js';

/** What the host says about itself: its own log, and turns as spans and histograms. */
export interface Telemetry {
  LOGS: string;
  TRACES: string;
  METRICS: string;
  log(message: string): void;
  fire(event: HostEvent): Promise<void>;
  telemetered(channel: string, action: Record<string, unknown>): void;
}

export function createTelemetry(ctx: HostContext): Telemetry {
  const { options, connections } = ctx;

  /**
   * The host's own log, as OTLP.
   *
   * `ahp-otlp://logs/{level}` is a template rather than a channel: the
   * variable is severity, so a client that only wants warnings subscribes to
   * one and is not sent the rest. Everything this host logs already goes
   * through `log`, so this is the same lines with a second destination rather
   * than a new source of them.
   *
   * Stateless and ephemeral, as the protocol says: nothing is replayed on
   * reconnect, a subscriber gets only what was emitted after it arrived, and
   * `subscribe` answers an empty result with no snapshot.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/telemetry-channel.md#L43
   */
  const LOGS = 'ahp-otlp://logs';
  /**
   * The other two OTLP signals, as literal channels.
   *
   * Literal rather than templates: the protocol defines template variables for
   * `logs` only - severity - and says a client MUST ignore any variable it does
   * not know, so a variable of this host's invention on either of these would
   * be a channel nobody can expand.
   */
  const TRACES = 'ahp-otlp://traces';
  const METRICS = 'ahp-otlp://metrics';

  /** Tell whoever is watching an OTLP channel. Never replayed: these are streams. */
  const telling = (method: string, channel: string, payload: Bag): void => {
    for (const connection of connections) {
      if (connection.watching.has(channel)) connection.peer.notify(method, { channel, payload });
    }
  };

  /** Random hex, the width an OTLP id is: 16 bytes for a trace, 8 for a span. */
  const hex = (bytes: number): string => [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((one) => one.toString(16).padStart(2, '0')).join('');

  /** The resource every signal this host emits is attributed to. */
  const attributed = (): Bag => ({
    attributes: [
      { key: 'service.name', value: { stringValue: 'ahpd' } },
      { key: 'service.start_time', value: { stringValue: startedAt } },
    ],
  });
  const startedAt = new Date().toISOString();
  /**
   * Call every listener of one event, in the order they were registered.
   *
   * Each is awaited before the next, so two plugins that both watch a moment
   * see it in the order the configuration listed them. A handler that throws
   * is reported against its plugin through `onEvent` directly and not through
   * `log`, because `log` is itself an event and reporting a failed `log`
   * listener through `log` is a recursion. The return value is ignored: a
   * handler observes and cannot change what the host does.
   *
   * The listener carries the read-only context its plugin's `apply` was
   * handed, so a handler reads the same directories and the same log.
   */
  /*
   * `raise` is the shared implementation, so the daemon's own `listening` and
   * `stopping` reach a plugin under exactly the semantics every other event
   * does: registration order, each handler awaited, one that throws reported
   * against its plugin and the rest carrying on.
   *
   * It keys on `event.type`. The name used to be a second argument beside it
   * and was always the same string, which is one place for the two to differ
   * and no way for a reader to tell which one routed.
   */
  const fire = async (event: HostEvent): Promise<void> => {
    await raise(options.events, event, (line) => { options.onEvent?.(line); });
  };
  /**
   * Whether a `log` raise is already on the stack.
   *
   * `log` is itself an event, so a listener that calls this host's `log` from
   * inside its own synchronous start would raise `log` again from within the
   * raise. The flag covers exactly that window - the synchronous part of
   * `fire`, where a handler's first segment runs - and is cleared the moment
   * `fire` suspends, so a host line written while a listener is awaiting is
   * still an event rather than being swallowed by a flag held across the whole
   * chain.
   */
  let logging = false;
  const log = (message: string): void => {
    options.onEvent?.(message);
    // The line is also an event, raised from the one place every notable line
    // already passes through, so a plugin reads the log without a second
    // mechanism and without having to be the embedder.
    if (options.events?.log !== undefined && !logging) {
      logging = true;
      try {
        void fire({ type: 'log', line: message });
      }
      finally {
        logging = false;
      }
    }
    /*
     * OTLP/JSON, verbatim, because the protocol says so: the payload is an
     * `ExportLogsServiceRequest` and AHP deliberately does not redeclare the
     * OpenTelemetry type system, so a client parses it with an OTel schema.
     * Building it by hand here is a dozen lines and saves a dependency that
     * would exist only to serialise one shape.
     */
    const at = String(Date.now() * 1_000_000);
    const payload = {
      resourceLogs: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'ahpd' } },
            { key: 'service.start_time', value: { stringValue: startedAt } },
          ],
        },
        scopeLogs: [{
          scope: { name: 'ahpd' },
          logRecords: [{
            timeUnixNano: at,
            observedTimeUnixNano: at,
            // One severity, because this host has one kind of line. A `log`
            // that took a level would be a second thing to keep in step with
            // every call site, and every call site here is an event.
            severityNumber: 9,
            severityText: 'INFO',
            body: { stringValue: message },
          }],
        }],
      }],
    };
    /*
     * To every logs channel a connection watches whose level the record
     * reaches, the level read case-blind, under the channel's own name, as VS
     * Code's host fans a record out to each subscription whose band includes
     * its severity: an INFO line reaches `trace`, `debug` and `info`.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4529-L4558
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/otlp/otlpLogEmitter.ts#L28-L61
     */
    const reached = ['trace', 'debug', 'info'];
    for (const connection of connections) {
      for (const channel of connection.watching) {
        const level = channel.startsWith(`${LOGS}/`) ? channel.slice(LOGS.length + 1).toLowerCase() : undefined;
        // A notification, not an action: it carries no `serverSeq` and moves
        // no state, so it does not belong in the replay buffer.
        if (channel === LOGS || (level !== undefined && reached.includes(level)))
          connection.peer.notify('otlp/exportLogs', { channel, payload });
      }
    }
  };

  /**
   * Turns and tool calls, as OTLP spans and counters.
   *
   * Built from the actions this host already dispatches rather than from the
   * backend: a turn is a span because it starts, ends and has a duration, and
   * every tool call inside it is a child of that span. Nothing here asks the
   * backend for anything, so a second backend gets the same telemetry without
   * knowing this exists.
   *
   * Each span is sent as it ends, which is what `ExportTraceServiceRequest`
   * is for - a collector joins them by `traceId`, and holding a turn's
   * children until the turn finished would lose them all if the daemon went.
   */
  const turning = new Map<string, { trace: string; span: string; at: number; text: string; calls: number }>();
  const calling = new Map<string, { span: string; at: number; name: string; turn: string }>();

  /** One span, on the wire, with the resource it belongs to. */
  const spanned = (span: Bag): void => {
    telling('otlp/exportTraces', TRACES, {
      resourceSpans: [{ resource: attributed(), scopeSpans: [{ scope: { name: 'ahpd' }, spans: [span] }] }],
    });
  };

  /*
   * The agent and tool metrics OpenTelemetry's GenAI conventions define, each
   * with the units and bucket boundaries they name: an invocation's duration
   * and the tool calls it made, and each tool execution's duration.
   * https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md
   */
  const METRIC_SHAPES: Record<string, { unit: string; bounds: number[] }> = {
    'gen_ai.invoke_agent.duration': { unit: 's', bounds: [0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4, 12.8, 25.6, 51.2, 102.4, 204.8, 409.6] },
    'gen_ai.invoke_agent.tool_calls': { unit: '{tool_call}', bounds: [1, 2, 4, 8, 16, 32, 64, 128] },
    'gen_ai.execute_tool.duration': {
      unit: 's',
      bounds: [0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92],
    },
  };
  /**
   * Each histogram's totals since the process started, by metric and by the
   * attributes of its point: cumulative, so a collector restarted mid-run
   * reads the totals rather than a difference it missed the start of.
   */
  const histograms = new Map<string, Map<string, { attributes: Bag[]; count: number; sum: number; buckets: number[] }>>();

  /** One observation of a metric, under the attributes it is recorded with. */
  const observe = (metric: string, value: number, attributes: Bag[]): void => {
    const { bounds } = METRIC_SHAPES[metric] as { bounds: number[] };
    const points = histograms.get(metric) ?? new Map();
    histograms.set(metric, points);
    const key = JSON.stringify(attributes);
    const point = points.get(key) ?? { attributes, count: 0, sum: 0, buckets: bounds.map(() => 0).concat(0) };
    points.set(key, point);
    point.count += 1;
    point.sum += value;
    const bucket = bounds.findIndex((bound) => value <= bound);
    point.buckets[bucket === -1 ? bounds.length : bucket] += 1;
  };

  /** What this host has measured so far, as OTLP histograms with the process start as their reference point. */
  const measured = (): void => {
    const at = String(Date.now() * 1_000_000);
    const from = String(Date.parse(startedAt) * 1_000_000);
    telling('otlp/exportMetrics', METRICS, {
      resourceMetrics: [{
        resource: attributed(),
        scopeMetrics: [{
          scope: { name: 'ahpd' },
          metrics: [...histograms].map(([name, points]) => ({
            name,
            unit: METRIC_SHAPES[name]?.unit,
            histogram: {
              aggregationTemporality: 2,
              dataPoints: [...points.values()].map((point) => ({
                attributes: point.attributes,
                startTimeUnixNano: from,
                timeUnixNano: at,
                count: String(point.count),
                sum: point.sum,
                bucketCounts: point.buckets.map(String),
                explicitBounds: METRIC_SHAPES[name]?.bounds,
              })),
            },
          })),
        }],
      }],
    });
  };

  /**
   * A turn or a tool call moving, as far as telemetry is concerned.
   *
   * Each record carries the spec's correlation attributes, the session's id,
   * the turn's and the tool call's, and a tool's name as the GenAI
   * conventions name it.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/telemetry-channel.md#L141-L149
   */
  const telemetered = (channel: string, action: Record<string, unknown>): void => {
    const type = String(action.type ?? '');
    if (!type.startsWith('chat/')) return;
    const turnId = String(action.turnId ?? '');
    const now = Date.now();
    const at = String(now * 1_000_000);
    const session = { key: 'ahp.session.id', value: { stringValue: idOf(ctx.sessionFor(channel)) } };
    const agent = ctx.sessions.get(ctx.sessionFor(channel))?.agent.displayName;
    const named = agent === undefined ? [] : [{ key: 'gen_ai.agent.name', value: { stringValue: agent } }];
    if (type === 'chat/turnStarted') {
      const message = (typeof action.message === 'object' && action.message !== null
        ? action.message
        : {}) as { text?: unknown };
      turning.set(turnId, {
        trace: hex(16),
        span: hex(8),
        at: now,
        text: typeof message.text === 'string' ? message.text : '',
        calls: 0,
      });
      return;
    }
    const turn = turning.get(turnId);
    if (turn === undefined) return;
    if (type === 'chat/toolCallStart') {
      calling.set(String(action.toolCallId ?? ''), {
        span: hex(8),
        at: now,
        name: String(action.toolName ?? 'tool'),
        turn: turnId,
      });
      return;
    }
    if (type === 'chat/toolCallComplete') {
      const id = String(action.toolCallId ?? '');
      const call = calling.get(id);
      if (call === undefined) return;
      calling.delete(id);
      turn.calls += 1;
      observe('gen_ai.execute_tool.duration', (now - call.at) / 1000, [
        { key: 'gen_ai.tool.name', value: { stringValue: call.name } },
        ...named,
      ]);
      spanned({
        traceId: turn.trace,
        spanId: call.span,
        parentSpanId: turn.span,
        name: call.name,
        // A tool call is work this host asked something else to do, which is
        // what `SPAN_KIND_CLIENT` is.
        kind: 3,
        startTimeUnixNano: String(call.at * 1_000_000),
        endTimeUnixNano: at,
        attributes: [
          session,
          { key: 'ahp.turn.id', value: { stringValue: turnId } },
          { key: 'ahp.tool_call.id', value: { stringValue: id } },
          { key: 'gen_ai.tool.name', value: { stringValue: call.name } },
        ],
      });
      return;
    }
    if (type !== 'chat/turnComplete' && type !== 'chat/turnCancelled' && type !== 'chat/error') return;
    // The turn's entry and every call of it still open are let go at its end.
    turning.delete(turnId);
    for (const [id, call] of [...calling]) if (call.turn === turnId) calling.delete(id);
    /*
     * A turn that ended in an error says so on its span and its metric, and a
     * cancelled one leaves its status unset: OpenTelemetry sets `Error` only
     * where a convention calls the outcome one, and a cancel somebody asked
     * for is not.
     * https://opentelemetry.io/docs/specs/otel/trace/api/#set-status
     */
    const error = type === 'chat/error'
      ? ((action.part as { error?: { errorType?: unknown; message?: unknown } } | undefined)?.error ?? {})
      : undefined;
    const errorType = error === undefined ? undefined : (typeof error.errorType === 'string' ? error.errorType : '_OTHER');
    spanned({
      traceId: turn.trace,
      spanId: turn.span,
      name: 'turn',
      // The turn is work this host is doing on somebody's behalf, which is
      // `SPAN_KIND_SERVER`.
      kind: 2,
      startTimeUnixNano: String(turn.at * 1_000_000),
      endTimeUnixNano: at,
      attributes: [session, { key: 'ahp.turn.id', value: { stringValue: turnId } }],
      ...(error === undefined ? {} : { status: { code: 2, message: typeof error.message === 'string' ? error.message : '' } }),
    });
    observe('gen_ai.invoke_agent.duration', (now - turn.at) / 1000, [
      ...named,
      ...(errorType === undefined ? [] : [{ key: 'error.type', value: { stringValue: errorType } }]),
    ]);
    observe('gen_ai.invoke_agent.tool_calls', turn.calls, named);
    measured();
  };

  return { LOGS, TRACES, METRICS, log, fire, telemetered };
}
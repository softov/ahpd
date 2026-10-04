import { raise } from '../plugins.js';
import type { Bag } from '../types/common.js';
import type { HostEvent } from '../types/events.js';
import type { HostContext } from './context.js';

/** What the host says about itself: its own log, and turns as spans and counters. */
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
   * reconnect, and a subscriber gets only what was emitted after it arrived.
   * There is no state to snapshot either, which is why `subscribe` answers an
   * empty one rather than refusing.
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
    for (const level of ['info', '']) {
      const channel = level === '' ? LOGS : `${LOGS}/${level}`;
      for (const connection of connections) {
        // A notification, not an action: it carries no `serverSeq` and moves
        // no state, so it does not belong in the replay buffer.
        if (connection.watching.has(channel)) connection.peer.notify('otlp/exportLogs', { channel, payload });
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
  const turning = new Map<string, { trace: string; span: string; at: number; text: string }>();
  const calling = new Map<string, { span: string; at: number; name: string; turn: string }>();
  let turnsRun = 0;
  let toolsRun = 0;

  /** One span, on the wire, with the resource it belongs to. */
  const spanned = (span: Bag): void => {
    telling('otlp/exportTraces', TRACES, {
      resourceSpans: [{ resource: attributed(), scopeSpans: [{ scope: { name: 'ahpd' }, spans: [span] }] }],
    });
  };

  /**
   * What is true of this host right now, as OTLP metrics.
   *
   * Cumulative sums with the process start as their reference point, which is
   * what `aggregationTemporality: 2` means - a collector restarted mid-run
   * reads the totals rather than a difference it missed the start of.
   */
  const measured = (extra: Bag[] = []): void => {
    const at = String(Date.now() * 1_000_000);
    const sum = (name: string, count: number, unit: string): Bag => ({
      name,
      unit,
      sum: {
        aggregationTemporality: 2,
        isMonotonic: true,
        dataPoints: [{ asInt: String(count), startTimeUnixNano: String(Date.parse(startedAt) * 1_000_000), timeUnixNano: at }],
      },
    });
    telling('otlp/exportMetrics', METRICS, {
      resourceMetrics: [{
        resource: attributed(),
        scopeMetrics: [{
          scope: { name: 'ahpd' },
          metrics: [
            sum('ahpd.turns', turnsRun, '{turn}'),
            sum('ahpd.tool_calls', toolsRun, '{call}'),
            ...extra,
          ],
        }],
      }],
    });
  };

  /** A turn or a tool call moving, as far as telemetry is concerned. */
  const telemetered = (channel: string, action: Record<string, unknown>): void => {
    const type = String(action.type ?? '');
    if (!type.startsWith('chat/')) return;
    const turnId = String(action.turnId ?? '');
    const at = String(Date.now() * 1_000_000);
    if (type === 'chat/turnStarted') {
      const message = (typeof action.message === 'object' && action.message !== null
        ? action.message
        : {}) as { text?: unknown };
      turning.set(turnId, {
        trace: hex(16),
        span: hex(8),
        at: Date.now(),
        text: typeof message.text === 'string' ? message.text : '',
      });
      return;
    }
    const turn = turning.get(turnId);
    if (turn === undefined) return;
    if (type === 'chat/toolCallStart') {
      calling.set(String(action.toolCallId ?? ''), {
        span: hex(8),
        at: Date.now(),
        name: String(action.toolName ?? 'tool'),
        turn: turnId,
      });
      return;
    }
    if (type === 'chat/toolCallComplete') {
      const call = calling.get(String(action.toolCallId ?? ''));
      if (call === undefined) return;
      calling.delete(String(action.toolCallId ?? ''));
      toolsRun += 1;
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
          { key: 'ahp.chat', value: { stringValue: channel } },
          { key: 'ahp.tool', value: { stringValue: call.name } },
        ],
      });
      return;
    }
    if (type !== 'chat/turnComplete' && type !== 'chat/turnCancelled') return;
    turning.delete(turnId);
    turnsRun += 1;
    spanned({
      traceId: turn.trace,
      spanId: turn.span,
      name: 'turn',
      // The turn is work this host is doing on somebody's behalf, which is
      // `SPAN_KIND_SERVER`.
      kind: 2,
      startTimeUnixNano: String(turn.at * 1_000_000),
      endTimeUnixNano: at,
      attributes: [
        { key: 'ahp.chat', value: { stringValue: channel } },
        { key: 'ahp.turn', value: { stringValue: turnId } },
      ],
      // Cancelled is not an error - somebody asked - so the only status this
      // sets is the one the protocol's own action names.
      ...(type === 'chat/turnCancelled' ? { status: { code: 2, message: 'cancelled' } } : {}),
    });
    measured();
  };

  return { LOGS, TRACES, METRICS, log, fire, telemetered };
}
/**
 * The message a woken run begins with.
 *
 * The agent reads its message and nothing else - the event that woke the run
 * rides on the run's origin, where no agent looks. So the message is where the
 * event has to arrive, twice over: named in the text where the person writing
 * the automation asked for it, and stated at the end so a run that names
 * nothing still knows what it is answering.
 */

/**
 * What a run is told about the event that woke it.
 *
 * The same six facts wherever the wake came from. A session event names the
 * session it happened in; an event a plugin fired may name none, and a message
 * that asks for one is then filled with nothing rather than left as it was.
 */
export interface WakeFacts {
  /** The trigger's own title, as the saved trigger wrote it. */
  trigger: string;
  /** The event's plain title, as the type that offers it names it. */
  event: string;
  /** The session it happened in, where the event was about one. */
  session?: string | undefined;
  /** That session's title, where this host has one to give. */
  sessionTitle?: string | undefined;
  /** How many events the rule counted. */
  count: number;
  /** When it happened, ISO 8601. */
  at: string;
}

/** The names a message may carry, in one place so the list is checkable. */
export const WAKE_PLACEHOLDERS = ['session', 'sessionTitle', 'event', 'count', 'trigger', 'at'] as const;

const PLACEHOLDER = /\{\{(\w+)\}\}/gu;

/**
 * The block a woken run's message ends with.
 *
 * Four lines, because four is what is worth knowing: what happened, where, how
 * many times, and when. A session is named by its title and its URI both,
 * because the title is what a person recognises and the URI is what a client
 * opens.
 */
const summary = (facts: WakeFacts): string => [
  `What woke this run: ${facts.event}`,
  ...(facts.session === undefined
    ? []
    : [`Session: ${facts.sessionTitle === undefined ? facts.session : `${facts.sessionTitle} (${facts.session})`}`]),
  `Count: ${String(facts.count)}`,
  `At: ${facts.at}`,
].join('\n');

/**
 * The first message of a woken run.
 *
 * Every placeholder the automation wrote is filled, and one that is not in
 * {@link WAKE_PLACEHOLDERS} is left exactly as it was written: this host fills
 * the six it offers and does not claim a meaning for anything else.
 */
export function wakeMessage(text: string, facts: WakeFacts): string {
  const held: Record<(typeof WAKE_PLACEHOLDERS)[number], string> = {
    session: facts.session ?? '',
    sessionTitle: facts.sessionTitle ?? '',
    event: facts.event,
    count: String(facts.count),
    trigger: facts.trigger,
    at: facts.at,
  };
  const filled = text.replace(PLACEHOLDER, (whole, name: string) =>
    (Object.hasOwn(held, name) ? held[name as keyof typeof held] : whole));
  return `${filled}\n\n${summary(facts)}`;
}

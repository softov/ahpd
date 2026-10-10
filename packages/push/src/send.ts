import { bag, reason, str } from '@ahpd/sdk';

/**
 * Expo's push service, as this plugin uses it.
 *
 * One POST carries the messages, up to a hundred of them, and answers a ticket
 * per message - an id, or a refusal. A ticket says only that the service took
 * the message; whether a phone got it is in that ticket's receipt, which the
 * service answers for a while after the send and which this reads at the *next*
 * send rather than on a timer - decision
 * `receipts-are-read-at-the-next-send`.
 *
 * Everything here fails quietly: a service that is down, a body it refuses and
 * a receipt read that throws are each one line to the daemon's log and nothing
 * else. A notification is worth a log line, not a host that stops serving.
 *
 * The one thing a failure does do is remove a device: the service is the only
 * party that knows a token has been retired - an app uninstalled, a phone
 * wiped - and it says so once, as `DeviceNotRegistered`, after which every
 * message sent there is wasted.
 *
 * Reading the receipts at the next send rather than on a timer is what keeps
 * this module without a clock and the daemon without a timer it would have to
 * stop: a host nobody is waiting on sends nothing, and so reads nothing.
 */

/** Where the messages go. */
export const ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Where the tickets a send answered are read back. */
export const RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';

/** How many messages one request carries, which is the service's own limit. */
export const BATCH = 100;

/** One notification, as the service takes it. */
export interface PushMessage {
  /** The device's Expo push token. */
  to: string;
  /** What the phone draws above the text. */
  title: string;
  /** The text itself. */
  body: string;
  /** What the app reads when the notification is opened. */
  data: Record<string, unknown>;
}

/** What a sender is built with. */
export interface SendOptions {
  /** One line per failure, for the daemon's log. */
  log(line: string): void;
  /** A token the service no longer knows, which is a device to forget. */
  gone(token: string): void;
  /** Where the messages go, when it is not the service's own address. */
  endpoint?: string;
  /** Where the receipts are read, when it is not the service's own address. */
  receipts?: string;
  /** The request function, which is `fetch` unless a test says otherwise. */
  request?: typeof fetch;
}

/** The tickets one send answered, and the device each was for. */
interface Ticket {
  id: string;
  token: string;
}

/** One send, and the receipts of the one before it. */
export interface Sender {
  /**
   * Send these messages, after reading the receipts of the previous send.
   *
   * The receipts are read before this send's POST and never on a timer, so a
   * daemon that sends nothing reads nothing - which is the ordinary case for a
   * host nobody is waiting on.
   */
  send(messages: PushMessage[], accessToken?: string): Promise<void>;
}

/**
 * A sender over one service.
 *
 * The tickets of the last send are kept here rather than by the caller, because
 * they are this module's own business: what a caller knows is that it asked for
 * some messages to go out, and whether the phone they reached is still there is
 * something only the next send finds out.
 */
export const createSender = (options: SendOptions): Sender => {
  const endpoint = options.endpoint ?? ENDPOINT;
  const receipts = options.receipts ?? RECEIPTS;
  const request = options.request ?? fetch;

  let tickets: Ticket[] = [];

  const headers = (accessToken: string | undefined): Record<string, string> => ({
    'content-type': 'application/json',
    accept: 'application/json',
    // Only where a project has push security on. Absent otherwise, because a
    // header naming no token is a refusal rather than a default.
    ...(accessToken === undefined || accessToken === '' ? {} : { authorization: `Bearer ${accessToken}` }),
  });

  /** One request, whose answer is nothing when it failed - which is said and not thrown. */
  const post = async (url: string, body: unknown, accessToken: string | undefined): Promise<unknown> => {
    let response: Response;
    try {
      response = await request(url, { method: 'POST', headers: headers(accessToken), body: JSON.stringify(body) });
    }
    catch (error) {
      options.log(`the push service could not be reached: ${reason(error)}`);
      return undefined;
    }
    if (!response.ok) {
      options.log(`the push service answered ${response.status}`);
      return undefined;
    }
    try {
      return await response.json() as unknown;
    }
    catch (error) {
      options.log(`the push service answered something that is not JSON: ${reason(error)}`);
      return undefined;
    }
  };

  /**
   * One ticket or receipt the service refused, acted on.
   *
   * A retired token is the one refusal worth doing something about, and it is
   * named in `details.error` rather than in the message, which is prose.
   */
  const refused = (token: string, said: Record<string, unknown>): void => {
    const details = bag(said['details']);
    if (details['error'] === 'DeviceNotRegistered') {
      options.log(`${token} is no longer registered with Expo; the device was removed`);
      options.gone(token);
      return;
    }
    const why = str(details['error']) ?? str(said['message']) ?? 'no reason was given';
    options.log(`Expo refused a notification for ${token}: ${why}`);
  };

  /** The receipts of the last send, read and dropped before this one goes out. */
  const readReceipts = async (accessToken: string | undefined): Promise<void> => {
    const held = tickets;
    tickets = [];
    if (held.length === 0) return;
    const answered = await post(receipts, { ids: held.map((one) => one.id) }, accessToken);
    if (answered === undefined) return;
    const data = bag(bag(answered)['data']);
    for (const ticket of held) {
      const receipt = data[ticket.id];
      // A ticket the answer does not name is one the service is still working
      // on, which is not a failure and is not said.
      if (receipt === undefined) continue;
      const one = bag(receipt);
      if (one['status'] !== 'ok') refused(ticket.token, one);
    }
  };

  /** The tickets this send answered, kept for the next one to read. */
  const collect = (sent: PushMessage[], answered: unknown): void => {
    const data = bag(answered)['data'];
    // One message is answered by its ticket rather than by a list of one.
    const said = Array.isArray(data) ? data : [data];
    for (const [index, one] of said.entries()) {
      const token = sent[index]?.to;
      if (token === undefined) continue;
      const ticket = bag(one);
      if (ticket['status'] === 'ok' && typeof ticket['id'] === 'string') {
        tickets.push({ id: ticket['id'], token });
        continue;
      }
      refused(token, ticket);
    }
  };

  return {
    send: async (messages, accessToken) => {
      await readReceipts(accessToken);
      for (let from = 0; from < messages.length; from += BATCH) {
        const batch = messages.slice(from, from + BATCH);
        if (batch.length === 0) continue;
        const answered = await post(endpoint, batch, accessToken);
        if (answered === undefined) continue;
        collect(batch, answered);
      }
    },
  };
};

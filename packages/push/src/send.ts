import { bag, reason, str } from '@ahpd/sdk';

/**
 * Expo's push service, as this plugin uses it.
 *
 * One POST carries the messages, up to a hundred of them, and answers a ticket
 * per message - an id, or a refusal. A ticket says only that the service took
 * the message; whether a phone got it is in that ticket's receipt, which this
 * reads fifteen minutes after the send, as Expo recommends, three hundred ids
 * to a request as Expo's own Node SDK asks for them, before the service clears
 * them a day after. A ticket with no receipt by then is, Expo says, likely an
 * error of the service's, and is said.
 * https://docs.expo.dev/push-notifications/sending-notifications/#check-push-receipts-for-errors
 *
 * A send that the network, a 429 or a 5xx fails is tried again after a second
 * and then two, Expo's exponential backoff with its Node SDK's retry count and
 * first wait. Receipts are read once, as the SDK reads them. Any other failure,
 * and a send still failing after its retries, is one line to the daemon's log:
 * a notification is worth a log line, and the host goes on serving.
 * https://docs.expo.dev/push-notifications/sending-notifications/#retry-on-failure
 * https://github.com/expo/expo-server-sdk-node/blob/main/src/ExpoClient.ts
 *
 * The one thing a failure does do is remove a device: the service is the only
 * party that knows a token has been retired - an app uninstalled, a phone
 * wiped - and it says so once, as `DeviceNotRegistered`, after which every
 * message sent there is wasted.
 */

/** Where the messages go. */
export const ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Where the tickets a send answered are read back. */
export const RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';

/** How many messages one request carries, which is the service's own limit. */
export const BATCH = 100;

/** How many receipt ids one request asks for, as Expo's Node SDK chunks them. */
export const RECEIPT_BATCH = 300;

/** How long after a send its receipts are read, in milliseconds: Expo's fifteen minutes. */
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;

/** The waits before each retry of a send, in milliseconds: the SDK's two retries from one second, doubling. */
export const RETRY_WAITS_MS = [1000, 2000] as const;

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
  /** Wait this long, which is a timer unless a test says otherwise. */
  wait?: (ms: number) => Promise<void>;
}

/** The tickets one send answered, and the device each was for. */
interface Ticket {
  id: string;
  token: string;
}

/** One send, and the read of its receipts a quarter of an hour on. */
export interface Sender {
  /** Send these messages, and read their receipts fifteen minutes after. */
  send(messages: PushMessage[], accessToken?: string): Promise<void>;
  /** Drop the receipt reads still to come, as the plugin unloads. */
  close(): void;
}

/**
 * A sender over one service.
 *
 * The tickets of each send are kept here, because they are this module's own
 * business: what a caller knows is that it asked for some messages to go out,
 * and whether the phone they reached is still there is something only the
 * receipts find out.
 */
export const createSender = (options: SendOptions): Sender => {
  const endpoint = options.endpoint ?? ENDPOINT;
  const receipts = options.receipts ?? RECEIPTS;
  const request = options.request ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((done) => { setTimeout(done, ms); }));
  /** The receipt reads still to come, which `close` drops. */
  const pending = new Set<ReturnType<typeof setTimeout>>();

  const headers = (accessToken: string | undefined): Record<string, string> => ({
    'content-type': 'application/json',
    accept: 'application/json',
    // Only where a project has push security on. Absent otherwise, because a
    // header naming no token is a refusal rather than a default.
    ...(accessToken === undefined || accessToken === '' ? {} : { authorization: `Bearer ${accessToken}` }),
  });

  /**
   * One request, whose answer is nothing when it failed, which is said and
   * thrown nowhere. The network, a 429 or a 5xx is tried again after each of
   * `waits`.
   */
  const post = async (url: string, body: unknown, accessToken: string | undefined, waits: readonly number[]): Promise<unknown> => {
    let response: Response;
    for (let attempt = 0; ; attempt += 1) {
      let answered: Response | undefined;
      let failure: unknown;
      try {
        answered = await request(url, { method: 'POST', headers: headers(accessToken), body: JSON.stringify(body) });
      }
      catch (error) {
        failure = error;
      }
      const again = answered === undefined || answered.status === 429 || answered.status >= 500;
      if (!again || attempt >= waits.length) {
        if (answered === undefined) {
          options.log(`the push service could not be reached: ${reason(failure)}`);
          return undefined;
        }
        response = answered;
        break;
      }
      await answered?.body?.cancel().catch(() => undefined);
      await wait(waits[attempt] ?? 0);
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

  /**
   * The receipts of one send's tickets, three hundred to a request.
   *
   * A ticket the answer does not name has no receipt fifteen minutes on, which
   * Expo reads as likely an error of its service, and is said.
   */
  const readReceipts = async (held: Ticket[], accessToken: string | undefined): Promise<void> => {
    for (let from = 0; from < held.length; from += RECEIPT_BATCH) {
      const chunk = held.slice(from, from + RECEIPT_BATCH);
      const answered = await post(receipts, { ids: chunk.map((one) => one.id) }, accessToken, []);
      if (answered === undefined) continue;
      const data = bag(bag(answered)['data']);
      for (const ticket of chunk) {
        const receipt = data[ticket.id];
        if (receipt === undefined) {
          options.log(`Expo has no receipt for the notification to ${ticket.token} fifteen minutes on`);
          continue;
        }
        const one = bag(receipt);
        if (one['status'] !== 'ok') refused(ticket.token, one);
      }
    }
  };

  /** The tickets one send answered. */
  const collect = (sent: PushMessage[], answered: unknown): Ticket[] => {
    const data = bag(answered)['data'];
    // One message is answered by its ticket rather than by a list of one.
    const said = Array.isArray(data) ? data : [data];
    const tickets: Ticket[] = [];
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
    return tickets;
  };

  return {
    send: async (messages, accessToken) => {
      const tickets: Ticket[] = [];
      for (let from = 0; from < messages.length; from += BATCH) {
        const batch = messages.slice(from, from + BATCH);
        if (batch.length === 0) continue;
        const answered = await post(endpoint, batch, accessToken, RETRY_WAITS_MS);
        if (answered === undefined) continue;
        tickets.push(...collect(batch, answered));
      }
      if (tickets.length === 0) return;
      const timer = setTimeout(() => {
        pending.delete(timer);
        void readReceipts(tickets, accessToken);
      }, RECEIPT_DELAY_MS);
      timer.unref?.();
      pending.add(timer);
    },
    close: () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    },
  };
};

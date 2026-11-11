/**
 * The check an adapter makes with one call that needs the credential.
 *
 * Shared by every adapter that proves a key this way, the host's own and a
 * plugin's, so a connector's `check` alert means the same thing whichever
 * adapter answered it.
 */

import type { CheckResult } from '../types/connectors.js';

/**
 * How long one call of a check may take.
 *
 * The connectors channel gives a check ten seconds, so this ends first, and a
 * call of the same kind - a model list, an exchange - is held to it as well.
 */
export const PROBE_TIMEOUT_MS = 8_000;

/**
 * One check: a call with the key, mapped to the four outcomes.
 *
 * A `GET`, or a `POST` of `body` as JSON when there is one. A call that does
 * not connect, a timeout included, is `unreachable`. A 2xx is `ok`, a 401 or
 * 403 is `denied`, and any other answer is `failed` with its status. The answer
 * is cancelled rather than read: only the status says whether the key works,
 * and a provider's sentence may quote it.
 */
export const probe = async (
  url: string,
  headers: Record<string, string>,
  fetcher: typeof fetch,
  body?: unknown,
): Promise<CheckResult> => {
  let answer: Response;
  try {
    answer = await fetcher(url, {
      ...(body === undefined
        ? { headers }
        : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return { result: 'unreachable' };
  }
  await answer.body?.cancel().catch(() => undefined);
  if (answer.ok) return { result: 'ok' };
  const message = `HTTP ${String(answer.status)}`;
  if (answer.status === 401 || answer.status === 403) return { result: 'denied', message };
  return { result: 'failed', message };
};

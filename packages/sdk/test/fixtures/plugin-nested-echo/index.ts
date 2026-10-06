import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bag, Listed, Plugin, Session, Start, WireTurn } from '@ahpd/sdk';
import type { Turn } from '@microsoft/agent-host-protocol';
import { echo } from '../../../../../examples/echo/agent.ts';

/**
 * The example backend under provider `cofold`, for a host started as a child.
 *
 * What `test/nested-process.test.ts` loads into a real `ahpd --stdio`, so the
 * proxy is driven against a process rather than a pair of in-memory streams.
 * Three things are read from the environment the test hands the child:
 *
 * - `PACE`, the milliseconds between streamed words, `0` when unset;
 * - `XDG_STATE_HOME`, under which each finished turn is written to
 *   `nested-echo/<id>.json`, so a second host started on the same directory
 *   lists and resumes what the first one ran;
 * - `IGNORE_SIGTERM=1`, which makes the process deaf to `SIGTERM` and keeps it
 *   running after its input ends, so only `SIGKILL` ends it.
 *
 * The import names the real `.ts` file, because Node does not remap a `.js`
 * specifier to a `.ts` one.
 */

export const name = 'plugin-nested-echo';

/** One finished session, as it is written to the store. */
interface Kept {
  id: string;
  title: string;
  createdAt: string;
  modifiedAt: string;
  turns: Bag[];
}

export const apply: Plugin['apply'] = (host) => {
  if (process.env.IGNORE_SIGTERM === '1') {
    process.on('SIGTERM', () => { /* deaf on purpose */ });
    // Kept alive once its input ends, the way a host with work of its own is.
    setInterval(() => { /* nothing */ }, 60_000);
    const on = process.on.bind(process);
    process.on = ((event: string, listener: (...args: unknown[]) => void) =>
      (event === 'SIGTERM' ? process : on(event, listener))) as typeof process.on;
  }
  const pace = Number(process.env.PACE ?? '0');
  const state = process.env.XDG_STATE_HOME;
  const store = state === undefined ? undefined : join(state, 'nested-echo');
  if (store !== undefined) mkdirSync(store, { recursive: true });
  const base = echo({ path: host.path, pace: Number.isFinite(pace) ? pace : 0 });

  const read = (file: string): Kept | undefined => {
    try { return JSON.parse(readFileSync(file, 'utf8')) as Kept; }
    catch { return undefined; }
  };
  const all = (): Kept[] => (store === undefined ? [] : readdirSync(store)
    .filter((file) => file.endsWith('.json'))
    .map((file) => read(join(store, file)))
    .filter((kept): kept is Kept => kept !== undefined));

  const create = (start: Start): Session => {
    const createdAt = new Date().toISOString();
    let session: Session | undefined;
    const emit: Start['emit'] = (channel, action) => {
      start.emit(channel, action);
      if (store === undefined || session === undefined || action.type !== 'chat/turnComplete') return;
      const id = session.agentId() ?? '';
      const kept: Kept = { id, title: session.title(), createdAt, modifiedAt: session.modifiedAt(), turns: session.allTurns() };
      writeFileSync(join(store, `${id}.json`), JSON.stringify(kept));
    };
    session = base.create({ ...start, emit });
    return session;
  };

  host.registerAgent({
    ...base,
    provider: 'cofold',
    displayName: 'Cofold',
    list: async (): Promise<Listed[]> => all().map((kept) => ({
      id: kept.id,
      title: kept.title,
      createdAt: kept.createdAt,
      modifiedAt: kept.modifiedAt,
      workingDirectories: [`file://${host.path}`],
    })),
    transcript: async (id) => all().find((kept) => kept.id === id)?.turns as WireTurn<Turn>[] | undefined,
    create,
  });
};

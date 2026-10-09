import { chmodSync, mkdtempSync, readFileSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, describe } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { scheduledAutomations } from '../src/scheduled.js';
import type { Peer } from '../src/types/rpc.js';
import type { AutomationStore } from '../src/types/automations.js';
import type { Bag } from '../src/types/common.js';

/*
 * The half `memoryAutomations` deliberately does not have: a clock, and a file
 * to survive in.
 *
 * Both are handed in here rather than waited for. A test that used the real
 * clock to check a nine-o'clock schedule would be a test that runs once a day.
 */

const ONE = 'ahp-automation:/one';

/** A timer that is armed and never fires until a test says so. */
function clockwork() {
  let armed: { fire: () => void; ms: number } | undefined;
  let at = new Date('2026-09-01T08:00:00Z');
  return {
    get armed() { return armed; },
    now: () => at,
    /** Move the clock, then let whatever was waiting for it go off. */
    advance(to: string) {
      at = new Date(to);
      const held = armed;
      armed = undefined;
      held?.fire();
    },
    timer(fire: () => void, ms: number) {
      armed = { fire, ms };
      return { cancel: () => { armed = undefined; } };
    },
  };
}

/** A definition that fires at nine every morning, UTC. */
const nightly = (expression = '0 9 * * *', extra: Bag = {}): Bag => ({
  title: 'Nightly review',
  enabled: true,
  message: { text: 'review what changed today' },
  session: { provider: 'echo' },
  triggers: [{ id: 't1', kind: 'schedule', schedule: { expression, timeZone: 'UTC' }, ...extra }],
});

let dir: string;
let file: string;
let store: AutomationStore | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-sched-'));
  file = join(dir, 'automations.json');
});
afterEach(() => {
  store?.close?.();
  store = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('what it says is coming', () => {
  it('works out the next occurrence and reports it', () => {
    const clock = clockwork();
    store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    store.create(ONE, nightly());
    // 08:00, so today's nine has not been yet.
    expect(store.get(ONE)?.nextRunAt).toBe('2026-09-01T09:00:00.000Z');
  });

  it('says nothing is coming for one that is switched off', () => {
    const clock = clockwork();
    store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    store.create(ONE, { ...nightly(), enabled: false });
    // The absent `nextRunAt` is how a client reads "this will not fire", and
    // it has to mean that for a disabled automation as much as for a host
    // with no clock.
    expect(store.get(ONE)?.nextRunAt).toBeUndefined();
  });

  it('says nothing is coming for an automation with no trigger at all', () => {
    const clock = clockwork();
    store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    store.create(ONE, { title: 'By hand', enabled: true, triggers: [] });
    // An empty trigger list is what manual-only means. It is still runnable.
    expect(store.get(ONE)?.nextRunAt).toBeUndefined();
    expect(store.get(ONE)?.operations).toContain('run');
  });

  it('reports an expression it cannot read, and fires nothing for it', () => {
    const clock = clockwork();
    const problems: string[] = [];
    store = scheduledAutomations({
      file, now: clock.now, timer: clock.timer, onProblem: (message) => problems.push(message),
    });
    store.create(ONE, nightly('every morning please'));
    // Kept, because somebody wrote it and losing the definition with the typo
    // helps nobody - and reported, because a schedule that silently never
    // fires is the worst of the three outcomes.
    expect(store.get(ONE)).toBeDefined();
    expect(store.get(ONE)?.nextRunAt).toBeUndefined();
    expect(problems.join(' ')).toContain('five fields');
  });
});

describe('when the time comes', () => {
  it('says which automation is due, and what occurrence it is', () => {
    const clock = clockwork();
    store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    const seen: { automation: string; origin: Bag }[] = [];
    store.onDue?.((event) => seen.push(event));
    store.create(ONE, nightly());

    clock.advance('2026-09-01T09:00:00Z');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.automation).toBe(ONE);
    // The origin is the store's, because only it knows which trigger came
    // round and which occurrence this was.
    expect(seen[0]?.origin).toMatchObject({
      kind: 'trigger', triggerId: 't1', scheduledFor: '2026-09-01T09:00:00.000Z',
    });
  });

  it('arms the next one after firing', () => {
    const clock = clockwork();
    store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    store.onDue?.(() => {});
    store.create(ONE, nightly());
    clock.advance('2026-09-01T09:00:00Z');
    // Tomorrow, not today again, and not never.
    expect(store.get(ONE)?.nextRunAt).toBe('2026-09-02T09:00:00.000Z');
    expect(clock.armed).toBeDefined();
  });

  /*
   * Found by driving a real daemon, not by reading this file.
   *
   * The inner store announces "this changed" from inside its own `update`, and
   * a host listening reads the entry straight back. Rearming after that call
   * returned meant the entry went out still carrying the old occurrence - so a
   * client that switched an automation off was told it would fire at nine
   * anyway. Every test here passed because they all read the store afterwards
   * rather than listening to it.
   */
  it('announces the change with the clock already caught up', () => {
    const clock = clockwork();
    store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    store.create(ONE, nightly());

    const announced: (string | undefined)[] = [];
    store.onChanged?.((event) => {
      if (event.automation === undefined) return;
      // Read the way a host reads it: the moment it is told.
      announced.push(store?.get(event.automation)?.nextRunAt);
    });

    store.update(ONE, { enabled: false });
    expect(announced).toEqual([undefined]);
  });

  it('does not fire one that was switched off before its time', () => {
    const clock = clockwork();
    store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    const seen: string[] = [];
    store.onDue?.((event) => seen.push(event.automation));
    store.create(ONE, nightly());
    store.update(ONE, { enabled: false });
    clock.advance('2026-09-01T09:00:00Z');
    expect(seen).toEqual([]);
  });

  /*
   * A definition that stops itself, on a clock the test moves.
   *
   * The store says what is due and the host is what runs it, so a run is made
   * here the way the host makes one - with the origin the store gave - and the
   * count moves because a scheduled run is what an allowance pays for.
   */
  describe('an automation that switches itself off', () => {
    const settle = async (times = 12): Promise<void> => {
      for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
    };

    /** Answer every occasion the store announces, as the host does. */
    const answered = (fired: string[]) => {
      store?.onDue?.((event) => {
        fired.push(event.automation);
        void store?.run(event.automation, event.origin, async () => 'ahp-session:/made');
      });
    };

    it('counts the runs an allowance pays for, and stops at the cap', async () => {
      const clock = clockwork();
      store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
      const fired: string[] = [];
      answered(fired);
      store.create(ONE, {
        ...nightly('* * * * *'),
        disableConditions: [{ kind: 'afterRuns', max: 2 }],
      });
      expect(store.get(ONE)?.runCount).toBe(0);

      clock.advance('2026-09-01T08:01:00Z');
      clock.advance('2026-09-01T08:02:00Z');
      // A third minute goes by with the allowance spent: the schedule is off,
      // so it is not even announced. The cap ends the allowance rather than
      // refusing one run.
      clock.advance('2026-09-01T08:03:00Z');
      await settle();

      expect(fired).toEqual([ONE, ONE]);
      const found = store.get(ONE);
      expect(found?.runCount).toBe(2);
      expect(found?.definition.enabled).toBe(false);
      expect(found?.nextRunAt).toBeUndefined();
    });

    it('switches itself off when its date has gone by, and fires no more', async () => {
      const clock = clockwork();
      store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
      const fired: string[] = [];
      answered(fired);
      /*
       * A date the clock this test moves will reach, and one the store
       * underneath will still admit a run against: it holds no clock of its
       * own, so its half of the comparison is against the real time. Both
       * halves agree in a daemon, where there is only one clock.
       */
      const date = '2030-01-01T00:00:30.000Z';
      store.create(ONE, { ...nightly('* * * * *'), disableConditions: [{ kind: 'afterDate', date }] });

      // The occurrence the store was holding is before the date, so it runs.
      clock.advance('2030-01-01T00:00:00Z');
      await settle();
      expect(fired).toEqual([ONE]);
      expect(store.get(ONE)?.definition.enabled).toBe(true);
      expect(store.get(ONE)?.nextRunAt).toBe('2030-01-01T00:01:00.000Z');

      // Between occurrences the date passes, and what the store is holding is
      // the next one - so this is where it goes: switched off rather than left
      // armed to fire on into a date that has gone.
      clock.advance('2030-01-01T00:00:40Z');
      await settle();
      expect(store.get(ONE)?.definition.enabled).toBe(false);
      expect(store.get(ONE)?.nextRunAt).toBeUndefined();

      clock.advance('2030-01-01T00:05:00Z');
      await settle();
      expect(fired).toEqual([ONE]);
    });

    it('keeps the count across a restart, because it is not derived from runs', () => {
      const first = clockwork();
      const one = scheduledAutomations({ file, now: first.now, timer: first.timer });
      one.onDue?.((event) => {
        void one.run(event.automation, event.origin, async () => 'ahp-session:/made');
      });
      one.create(ONE, {
        ...nightly('* * * * *'),
        disableConditions: [{ kind: 'afterRuns', max: 5 }],
      });
      first.advance('2026-09-01T08:01:00Z');
      first.advance('2026-09-01T08:02:00Z');
      first.advance('2026-09-01T08:03:00Z');
      one.close?.();

      // This store keeps no run history - runs point at sessions that went with
      // the daemon - so what it has used is what it wrote down and nothing else.
      expect(JSON.parse(readFileSync(file, 'utf8')).automations)
        .toMatchObject([{ resource: ONE, runCount: 3 }]);
      const second = clockwork();
      store = scheduledAutomations({ file, now: second.now, timer: second.timer });
      expect(store.get(ONE)?.runCount).toBe(3);
      // Still enabled, because the allowance has two runs left in it.
      expect(store.get(ONE)?.definition.enabled).toBe(true);
    });
  });
});

describe('across a restart', () => {
  it('brings the definitions back', () => {
    const first = clockwork();
    const one = scheduledAutomations({ file, now: first.now, timer: first.timer });
    one.create(ONE, nightly());
    one.close?.();

    expect(existsSync(file)).toBe(true);
    const second = clockwork();
    store = scheduledAutomations({ file, now: second.now, timer: second.timer });
    expect(store.get(ONE)?.definition.title).toBe('Nightly review');
    expect(store.get(ONE)?.nextRunAt).toBe('2026-09-01T09:00:00.000Z');
  });

  it('writes the file owner-only, because it names whose work an automation is', () => {
    const clock = clockwork();
    const one = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    one.create(ONE, nightly());
    one.close?.();

    // Readable by the account the daemon runs as and by nobody else on the
    // machine, which is what every other file the daemon keeps is.
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('is owner-only even when a readable temp at its own name was left behind', () => {
    /*
     * A change here is written twice - once when the clock is caught up and
     * once with the stamp - and the last of the two is what leaves the file, so
     * the readable temp is put back between them. That is what a process with
     * this pid that died before its own last write would have left, and `mode`
     * applies when a file is created rather than when one is opened, so a write
     * that opens it keeps its 0644 - and the rename puts that on the real file.
     */
    const temporary = `${file}.${String(process.pid)}.tmp`;
    const leaveReadable = (): void => {
      writeFileSync(temporary, '{}');
      chmodSync(temporary, 0o644);
    };
    const clock = clockwork();
    const one = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    one.onChanged?.(leaveReadable);

    one.create(ONE, nightly());

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('keeps whose work it is, and whose it was before it had one', () => {
    const first = clockwork();
    const one = scheduledAutomations({ file, now: first.now, timer: first.timer });
    one.create(ONE, nightly(), 'user:ana');
    one.create('ahp-automation:/older', nightly());
    one.close?.();

    expect(JSON.parse(readFileSync(file, 'utf8')).automations).toEqual([
      expect.objectContaining({ resource: ONE, owner: 'user:ana' }),
      expect.not.objectContaining({ owner: expect.anything() }),
    ]);

    const second = clockwork();
    store = scheduledAutomations({ file, now: second.now, timer: second.timer });
    // Read back through `_meta`, where the entry a client reads carries it.
    expect(store.get(ONE)?._meta?.['ahpd.owner']).toBe('user:ana');
    // An automation written before this carried no owner, and saying so is
    // what it says rather than one that names nobody.
    expect(store.get('ahp-automation:/older')?._meta?.['ahpd.owner']).toBeUndefined();
  });

  it('reads a row whose owner is not a typed reference as one nobody owns', () => {
    writeFileSync(file, JSON.stringify({
      version: 1,
      automations: [{ resource: ONE, definition: nightly(), owner: 'ana' }],
    }));
    const clock = clockwork();
    store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    expect(store.get(ONE)?.definition.title).toBe('Nightly review');
    expect(store.get(ONE)?._meta?.['ahpd.owner']).toBeUndefined();
  });

  it('keeps when it was written, rather than when it was read', () => {
    const first = clockwork();
    const one = scheduledAutomations({ file, now: first.now, timer: first.timer });
    const made = one.create(ONE, nightly());
    one.close?.();

    const second = clockwork();
    store = scheduledAutomations({ file, now: second.now, timer: second.timer });
    expect(store.get(ONE)?.createdAt).toBe(made.createdAt);
  });

  it('catches a missed occurrence up once, however many went by', () => {
    const first = clockwork();
    const one = scheduledAutomations({ file, now: first.now, timer: first.timer });
    one.create(ONE, nightly());
    one.close?.();

    // A week later. Seven nines went by while nothing was running.
    const second = clockwork();
    second.advance('2026-09-08T08:00:00Z');
    store = scheduledAutomations({ file, now: second.now, timer: second.timer });
    const seen: Bag[] = [];
    store.onDue?.((event) => seen.push(event.origin));

    // One run, not seven: `runOnce` is the protocol's default and its whole
    // meaning, so a machine that was off for a week comes back to one.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ catchUp: true, scheduledFor: '2026-09-01T09:00:00.000Z' });
  });

  it('skips what it missed when the policy says to', () => {
    const first = clockwork();
    const one = scheduledAutomations({ file, now: first.now, timer: first.timer });
    one.create(ONE, nightly('0 9 * * *', { misfirePolicy: 'skip' }));
    one.close?.();

    const second = clockwork();
    second.advance('2026-09-08T08:00:00Z');
    store = scheduledAutomations({ file, now: second.now, timer: second.timer });
    const seen: Bag[] = [];
    store.onDue?.((event) => seen.push(event.origin));

    expect(seen).toEqual([]);
    // And it still knows when the next real one is.
    expect(store.get(ONE)?.nextRunAt).toBe('2026-09-08T09:00:00.000Z');
  });

  it('forgets one that was removed', () => {
    const first = clockwork();
    const one = scheduledAutomations({ file, now: first.now, timer: first.timer });
    one.create(ONE, nightly());
    one.remove(ONE);
    one.close?.();

    const second = clockwork();
    store = scheduledAutomations({ file, now: second.now, timer: second.timer });
    expect(store.get(ONE)).toBeUndefined();
  });

  it('leaves a file it does not understand alone', () => {
    const clock = clockwork();
    const problems: string[] = [];
    writeFileSync(file, JSON.stringify({ version: 99, automations: [] }));
    store = scheduledAutomations({
      file, now: clock.now, timer: clock.timer, onProblem: (message) => problems.push(message),
    });
    expect(store.list()).toEqual([]);
    expect(problems.join(' ')).toContain('is not something this version understands');
  });
});

describe('what it advertises', () => {
  it('answers the event triggers of the store underneath', () => {
    const clock = clockwork();
    store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    // A schedule trigger is protocol-defined and never listed here. What is
    // listed is what the store underneath wakes on, so the daemon and a host
    // in memory draw the same form.
    expect(store.triggers({}).map((one) => one.type)).toEqual(['session', 'watch']);
  });

  it('writes the file where it was told, and nowhere else', () => {
    const clock = clockwork();
    store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    store.create(ONE, nightly());
    const held = JSON.parse(readFileSync(file, 'utf8')) as { version: number; automations: unknown[] };
    expect(held.version).toBe(1);
    expect(held.automations).toHaveLength(1);
  });
});

/*
 * The clock and the host, together.
 *
 * Everything above checks that the store knows when nine o'clock is. This
 * checks the thing that makes that worth anything: the store cannot create a
 * session, so a schedule that fires and reaches nobody is a schedule that does
 * nothing.
 */
describe('a schedule that reaches the host', () => {
  const settle = async (times = 12): Promise<void> => {
    for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
  };

  it('starts a session at nine, with nobody connected', async () => {
    const clock = clockwork();
    store = scheduledAutomations({ file, now: clock.now, timer: clock.timer });
    const host = createHost({
      path: dir,
      agents: [echo({ path: dir, pace: 0 })],
      automations: store,
    });

    store.create(ONE, {
      ...nightly(),
      session: { provider: 'echo', workingDirectories: [`file://${dir}`] },
    });

    // Nobody has connected. This is the whole point: an automation fires
    // because the daemon is running, not because somebody is watching.
    clock.advance('2026-09-01T09:00:00Z');
    await settle();

    const peer: Peer = { send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} };
    const client = host.accept(peer);
    await client.handle({
      method: 'initialize',
      params: { clientId: 'a', protocolVersions: ['0.9.0'] },
    });
    const found = await client.handle({
      method: 'listSessions', params: { channel: 'ahp-root://' },
    }) as { items: { resource: string }[] };

    expect(found.items).toHaveLength(1);
    // And the run knows which session it was, which is what a client opens.
    const run = store.get(ONE)?.runs[0] as { primarySession?: string } | undefined;
    expect(run?.primarySession).toBe(found.items[0]?.resource);
    /*
     * And the session says what started it.
     *
     * Also found against a real daemon. Everything above proved the run knew
     * about the session; nothing proved the session knew about the run, and a
     * catalogue is where somebody looks - a row that appeared at nine with no
     * account of itself, among rows somebody typed.
     */
    const started = found.items[0] as { origin?: { kind: string; automation: string } };
    expect(started.origin).toMatchObject({ kind: 'automation', automation: ONE });
  });
});

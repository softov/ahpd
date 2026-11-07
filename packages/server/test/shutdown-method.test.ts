/*
 * What a `shutdown` request reaches in the daemon.
 *
 * The method belongs to the host, which shuts its backends down, answers and
 * then calls what it was given; what the daemon gives it is what is here -
 * the service manager's stop where one holds the daemon, the way down once
 * the lifecycle exists, and the signal a shutdown sent itself before that.
 * Nothing in this file signals a process or asks a real manager: the signal
 * is a spy, the manager records what it was asked and the way down is driven
 * with a fake exit, so no case can stop the process running the suite or
 * reach a real daemon to take down.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { lifecycle } from '../src/commands/restart.js';
import { daemonShutdown } from '../src/commands/run.js';
import type { Lifecycle } from '../src/commands/restart.js';
import type { Service } from '../src/service.js';

afterEach(() => { vi.restoreAllMocks(); });

/** A lifecycle whose way down and exit are recorded, in the order they ran. */
const driving = (): { way: Lifecycle; ran: string[] } => {
  const ran: string[] = [];
  const way = lifecycle({
    // The daemon's own way down raises `stopping` first; this stands in for it.
    // The word is `raise stopping` and not `stopping`, which is the line the
    // lifecycle writes itself, a step earlier.
    down: async () => { ran.push('raise stopping'); },
    start: async () => { throw new Error('no successor is started here'); },
    stop: () => { ran.push('stop'); },
    forget: () => { ran.push('forget'); },
    log: (line) => { ran.push(`log ${line}`); },
    exit: (code) => { ran.push(`exit ${String(code)}`); },
    later: (step) => { step(); },
  });
  return { way, ran };
};

/** Let the way down settle: the exit is a `then` on it rather than a step in it. */
const settled = (): Promise<void> => new Promise((done) => { setTimeout(done, 0); });

describe('the shutdown a request is given', () => {
  it('runs the way down, which raises stopping, and exits only after it', async () => {
    const { way, ran } = driving();
    void daemonShutdown(() => way.shutdown)();
    // Answered by the way down before it settles, so a request cannot exit
    // ahead of the stopping handlers a plugin is still running in.
    expect(ran).toEqual(['log stopping', 'raise stopping']);
    await settled();
    // Said either side of it, and the record goes once it is complete: the
    // daemon a request stopped is not one `ahpd status` should go on offering.
    expect(ran).toEqual(['log stopping', 'raise stopping', 'log stopped', 'forget', 'exit 0']);
  });

  it('sends no signal to this daemon\'s own process', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const { way, ran } = driving();
    void daemonShutdown(() => way.shutdown)();
    await settled();
    expect(kill).not.toHaveBeenCalled();
    expect(ran).toEqual(['log stopping', 'raise stopping', 'log stopped', 'forget', 'exit 0']);
  });

  it('keeps the signal while there is no way down yet', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    // The window between the host being built with a shutdown and the
    // lifecycle being made, which the bound socket lets a request land in.
    await daemonShutdown(() => undefined)();
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });

  /*
   * A daemon a service manager holds is stopped through the manager, as `ahpd
   * stop` stops one: a unit that starts its daemon again whenever it exits
   * answers the manager's stop by leaving it stopped, and an exit of the
   * daemon's own by starting another.
   */
  it('asks the service manager that holds the daemon to stop it, and runs no way down of its own', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const { way, ran } = driving();
    const asked: [Service, string | undefined][] = [];
    const manager = { stop: async (service: Service, name?: string) => { asked.push([service, name]); } };
    await daemonShutdown(() => way.shutdown, { service: 'systemd', name: 'ahpd-work', manager })();
    await settled();
    expect(asked).toEqual([['systemd', 'ahpd-work']]);
    expect(ran).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  });
});

/**
 * A terminal's screen, as an emulator keeps it from what the terminal said.
 *
 * The reference host's `AgentHostHeadlessTerminal`
 * (https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostHeadlessTerminal.ts),
 * over the same `@xterm/headless`. Its tools ask it whether the alternate
 * screen is showing and whether the shell has bracketed paste on, and it
 * answers a program's cursor position query by writing the answer back to the
 * program - which is the only thing this host writes to a terminal's input
 * that the person did not type.
 *
 * The emulator is a dependency of the daemon rather than of `@ahpd/sdk`, so
 * this is the implementation of that library's `SpawnScreen` port.
 */

import pkg from '@xterm/headless';
import type { Screen, ScreenOptions, SpawnScreen } from '@ahpd/sdk';

const { Terminal } = pkg;

/**
 * A cursor position report, and nothing else.
 *
 * `@xterm/headless` answers `ESC[6n` on its data channel, which is the stream
 * a terminal writes back to the program. Only the answers this host sends
 * itself are meant to reach the program, so anything that is not one of them -
 * another `onData` the emulator may grow - stays in this process, as VS Code
 * filters it
 * (https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostHeadlessTerminal.ts).
 */
const CURSOR_ANSWER = /^(?:\u001b\[\??\d+;\d+R)+$/;

/** Make one: what `shellTerminals({ screen })` hands the store. */
export const screen: SpawnScreen = (options: ScreenOptions): Screen => {
  const terminal = new Terminal({
    cols: options.cols,
    rows: options.rows,
    // Nothing to scroll back through: the screen exists for the buffer and
    // the modes, and an agent reads the output from the channel.
    scrollback: 0,
    // `onBufferChange` is what `whenAltBuffer` listens on.
    allowProposedApi: true,
  });
  let disposed = false;
  /** Everything fed so far, so a write settles after what came before it. */
  let barrier: Promise<void> = Promise.resolve();

  terminal.onData((data) => {
    if (CURSOR_ANSWER.test(data)) options.write(data);
  });

  const isInAltBuffer = (): boolean => terminal.buffer.active === terminal.buffer.alternate;

  const write = (data: string): Promise<void> => {
    barrier = barrier.catch(() => undefined).then(() => {
      if (disposed) return undefined;
      return new Promise<void>((resolve) => {
        try {
          terminal.write(data, resolve);
        }
        catch {
          resolve();
        }
      });
    });
    return barrier;
  };

  return {
    write,
    resize: (cols, rows) => { terminal.resize(cols, rows); },
    isInAltBuffer,
    isBracketedPasteMode: () => terminal.modes.bracketedPasteMode,
    /*
     * Settled once what was fed before the call is parsed, so a program that
     * switched buffers in the last chunk is seen as being on the other one.
     * The listener is what catches a switch that comes later; a disposed
     * screen has nothing more to show, and answers rather than hanging.
     */
    whenAltBuffer: async () => {
      await barrier.catch(() => undefined);
      if (disposed || isInAltBuffer()) return;
      await new Promise<void>((resolve) => {
        const listener = terminal.buffer.onBufferChange(() => {
          if (!isInAltBuffer()) return;
          listener.dispose();
          resolve();
        });
      });
    },
    dispose: () => {
      disposed = true;
      terminal.dispose();
    },
  };
};

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { gitChanges } from '@ahpd/sdk';
import type { Bag, Session } from '@ahpd/sdk';

/*
 * The edit a write call would make, on the card before it is approved.
 *
 * A person approving a `Write`, `Edit` or `MultiEdit` is asked to trust a file
 * they cannot see, and the tool has not run - so the harness's own input is
 * turned into the text the tool would leave, and the host holds that text for
 * the client to read while the question is open.
 *
 * The changes port itself is the host half here rather than a stand-in: the
 * session is handed the two seams a host wires to it, so a case in this file
 * is the backend and the port meeting. What the port does with a URI is
 * `changes-uris.test.ts`'s.
 */

const sdk = vi.hoisted(() => ({
  frames: [] as Record<string, unknown>[],
  /** Frames queued after the stream was held, which it reads on waking. */
  pushed: [] as Record<string, unknown>[],
  /** What the stream waits on after its frames, so a test can keep it open. */
  hold: Promise.resolve() as Promise<void>,
  canUseTool: undefined as undefined | ((name: string, input: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  getSessionMessages: async () => sdk.frames,
  query: ({ options }: { options: Record<string, unknown> }) => ({
    async *[Symbol.asyncIterator]() {
      sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
      for (const frame of sdk.frames) yield frame;
      await sdk.hold;
      while (sdk.pushed.length > 0) yield sdk.pushed.shift() as Record<string, unknown>;
    },
    interrupt: async () => {},
    setPermissionMode: async () => {},
    setModel: async () => {},
    applyFlagSettings: async () => {},
    toggleMcpServer: async () => {},
    reconnectMcpServer: async () => {},
    setMcpServers: async () => {},
    initializationResult: async () => ({}),
    mcpServerStatus: async () => [],
    reloadSkills: async () => ({ skills: [] }),
    reloadPlugins: async () => ({ plugins: [] }),
    supportedModels: async () => [],
    streamInput: async () => {},
    close: () => {},
  }),
}));

const { createSession } = await import('../src/session.js');

const SESSION = 'ahp-session:/preview';
const CHAT = 'ahp-chat:/preview';

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A directory of this test's own, which the session is rooted in. */
const scratch = (): string => mkdtempSync(join(tmpdir(), 'ahpd-preview-'));

interface Previewed {
  /** Every action the session sent. */
  sent: Bag[];
  /** The calls in the session's own snapshot, by call id. */
  held: Map<string, Bag>;
  /** The call ids the host was told it is done with, in order. */
  settled: string[];
  source: ReturnType<typeof gitChanges>;
  session: Session;
}

/**
 * A session with the host's two seams wired to a real changes port.
 *
 * `port: false` is a host with no changeset source at all, which passes
 * neither seam - the other half of the same case.
 */
async function previewing(
  dir: string,
  call: { id: string; name: string; input: Bag },
  extra: { port?: boolean } = {},
): Promise<Previewed> {
  sdk.frames = [{
    type: 'assistant', parent_tool_use_id: null, uuid: 'a1',
    message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }] },
  }];
  sdk.pushed = [];
  const source = gitChanges();
  const settled: string[] = [];
  const sent: Bag[] = [];
  const session = createSession({
    uri: SESSION,
    chatUri: CHAT,
    cwd: dir,
    emit: (_channel, action) => { sent.push(action as Bag); },
    ...(extra.port === false ? {} : {
      onEditProposed: (toolCallId, path, apply) => source.propose?.(dir, SESSION, toolCallId, path, apply),
      onEditSettled: (toolCallId) => { settled.push(toolCallId); source.settle?.(SESSION, toolCallId); },
    }),
  });
  await settle();
  void sdk.canUseTool?.(call.name, call.input, { toolUseID: call.id, title: `Run ${call.name}?` });
  await settle();

  const chat = session.chatState() as Bag;
  const turns = [...(chat.turns ?? []) as Bag[], ...(chat.activeTurn ? [chat.activeTurn as Bag] : [])];
  const held = new Map<string, Bag>();
  for (const part of turns.flatMap((turn) => (turn.responseParts ?? []) as Bag[])) {
    if (part.kind === 'toolCall') {
      const one = part.toolCall as Bag;
      held.set(one.toolCallId as string, one);
    }
  }
  return { sent, held, settled, source, session };
}

/**
 * The `chat/toolCallReady` a call ended up with, or nothing.
 *
 * The last one, not the first: a call the assistant message announced before
 * anybody was asked is ready once as `not-needed`, and the question that
 * follows is ready again. The question is the one carrying a card.
 */
const readyOf = (sent: Bag[], id: string): Bag | undefined =>
  sent.filter((one) => one.type === 'chat/toolCallReady' && one.toolCallId === id).pop();

/** The one `FileEdit` a confirmation carries, or nothing when it carries none. */
const editOf = (action: Bag | undefined): Bag | undefined => {
  const items = (action?.edits as Bag | undefined)?.items;
  return Array.isArray(items) ? items[0] as Bag : undefined;
};

/** The text a preview URI reads back as, through the host's own `read`. */
const readable = async (source: ReturnType<typeof gitChanges>, uri: unknown): Promise<string | undefined> =>
  typeof uri === 'string' ? (await source.read?.(uri))?.data : undefined;

/** A file with this text in it, and the path to it. */
const holding = (dir: string, name: string, text: string): string => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

it('previews a Write of a new file as a creation, with the text it would leave', async () => {
  const dir = scratch();
  const file = join(dir, 'new.md');
  const { sent, held, source } = await previewing(dir, {
    id: 'toolu_write', name: 'Write', input: { file_path: file, content: 'made\n' },
  });

  const edge = editOf(readyOf(sent, 'toolu_write'));
  // Absent `before` is how the protocol says a creation.
  expect(edge?.before).toBeUndefined();
  expect(edge).not.toHaveProperty('diff');
  expect(await readable(source, ((edge?.after as Bag).content as Bag).uri)).toBe('made\n');
  // And the same edit is on the call a client reads from the snapshot.
  expect(editOf(held.get('toolu_write'))).toEqual(edge);
  // Nothing was written to make it: the tool has not run.
  expect(existsSync(file)).toBe(false);
});

it('previews an Edit of an existing file on both sides', async () => {
  const dir = scratch();
  const file = holding(dir, 'a.md', 'one\ntwo\nthree\n');
  const { sent, source } = await previewing(dir, {
    id: 'toolu_edit', name: 'Edit', input: { file_path: file, old_string: 'two', new_string: 'TWO' },
  });

  const edge = editOf(readyOf(sent, 'toolu_edit')) as Bag;
  /*
   * The file as it is, read off the disk it is still on: a `before` side is a
   * `file:` URI, which the host resolves through its filesystem rather than
   * through the changes port. Only the side the tool would leave is the
   * port's to serve.
   */
  const before = ((edge.before as Bag).content as Bag).uri as string;
  expect(readFileSync(fileURLToPath(before), 'utf8')).toBe('one\ntwo\nthree\n');
  expect(await readable(source, ((edge.after as Bag).content as Bag).uri)).toBe('one\nTWO\nthree\n');
});

it('replaces every occurrence when the call asks for all of them', async () => {
  const dir = scratch();
  const file = holding(dir, 'a.md', 'a b a\n');
  const { sent, source } = await previewing(dir, {
    id: 'toolu_all', name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b', replace_all: true },
  });

  const edge = editOf(readyOf(sent, 'toolu_all')) as Bag;
  expect(await readable(source, ((edge.after as Bag).content as Bag).uri)).toBe('b b b\n');
});

it('applies a MultiEdit\'s edits in order, each over what the one before left', async () => {
  const dir = scratch();
  const file = holding(dir, 'a.md', 'one\ntwo\nthree\n');
  const { sent, source } = await previewing(dir, {
    id: 'toolu_many',
    name: 'MultiEdit',
    input: {
      file_path: file,
      edits: [
        { old_string: 'one', new_string: 'three' },
        // Over what the first one left, which is what the tool does.
        { old_string: 'three\ntwo', new_string: 'three\nTWO' },
      ],
    },
  });

  const edge = editOf(readyOf(sent, 'toolu_many')) as Bag;
  expect(await readable(source, ((edge.after as Bag).content as Bag).uri)).toBe('three\nTWO\nthree\n');
});

it('sends no edits for an Edit that names no string, or one the file does not hold', async () => {
  const dir = scratch();
  const file = holding(dir, 'a.md', 'one\ntwo\n');
  for (const input of [{ file_path: file, new_string: 'x' }, { file_path: file, old_string: 'absent', new_string: 'x' }]) {
    const { sent, held, settled } = await previewing(dir, { id: 'toolu_none', name: 'Edit', input });
    // The confirmation goes out as it would have without any of this.
    expect(readyOf(sent, 'toolu_none')).toBeDefined();
    expect(readyOf(sent, 'toolu_none')).not.toHaveProperty('edits');
    expect(held.get('toolu_none')).not.toHaveProperty('edits');
    // And nothing was held for it, so there is nothing to settle.
    expect(settled).toEqual([]);
  }
});

it('sends no edits for a tool that writes no named file', async () => {
  const dir = scratch();
  const { sent, held } = await previewing(dir, {
    id: 'toolu_bash', name: 'Bash', input: { command: 'rm -rf /tmp/scratch', description: 'Clear scratch' },
  });
  expect(readyOf(sent, 'toolu_bash')).toBeDefined();
  expect(readyOf(sent, 'toolu_bash')).not.toHaveProperty('edits');
  expect(held.get('toolu_bash')).not.toHaveProperty('edits');
});

it('settles the preview the person approved, and not a second time', async () => {
  const dir = scratch();
  const file = join(dir, 'new.md');
  const { sent, settled, source, session } = await previewing(dir, {
    id: 'toolu_write', name: 'Write', input: { file_path: file, content: 'made\n' },
  });
  const uri = ((editOf(readyOf(sent, 'toolu_write'))?.after as Bag).content as Bag).uri;
  expect(await readable(source, uri)).toBe('made\n');

  session.confirm('toolu_write', true);
  await settle();
  expect(settled).toEqual(['toolu_write']);
  expect(await readable(source, uri)).toBeUndefined();

  // The session going is the other end of the same question, and the text it
  // is holding has already gone: the host is told once.
  await session.close();
  await settle();
  expect(settled).toEqual(['toolu_write']);
});

it('settles the preview the person denied', async () => {
  const dir = scratch();
  const file = holding(dir, 'a.md', 'one\ntwo\n');
  const { sent, settled, source, session } = await previewing(dir, {
    id: 'toolu_edit', name: 'Edit', input: { file_path: file, old_string: 'two', new_string: 'TWO' },
  });
  const uri = ((editOf(readyOf(sent, 'toolu_edit'))?.after as Bag).content as Bag).uri;

  session.confirm('toolu_edit', false);
  await settle();
  expect(settled).toEqual(['toolu_edit']);
  expect(await readable(source, uri)).toBeUndefined();
});

it('sends the confirmation as it was, on a host with no changeset source', async () => {
  const dir = scratch();
  const file = holding(dir, 'a.md', 'one\ntwo\n');
  const { sent, held } = await previewing(dir, {
    id: 'toolu_edit', name: 'Edit', input: { file_path: file, old_string: 'two', new_string: 'TWO' },
  }, { port: false });

  const ready = readyOf(sent, 'toolu_edit');
  expect(ready).toBeDefined();
  expect(ready).not.toHaveProperty('edits');
  expect(held.get('toolu_edit')).not.toHaveProperty('edits');
  // Everything else about the card is what it always was.
  expect(ready?.confirmationTitle).toBe('Run Edit?');
  expect(held.get('toolu_edit')?.status).toBe('pending-confirmation');
});

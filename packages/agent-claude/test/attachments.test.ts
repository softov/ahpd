import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { SNAPSHOT_TAG } from '@ahpd/sdk';
import type { Bag, MessageAttachment } from '@ahpd/sdk';

/*
 * A Claude turn reads its message's attachments.
 *
 * The host writes what a client pasted to a file and the message names the
 * path - decision `an-attachments-bytes-are-written-to-disk-and-the-message-
 * names-the-file` - and `partsOf` decides what each attachment is.
 * What this backend adds is the block: a text part stays text, and an image
 * part becomes the base64 image source the API takes.
 *
 * A message with no attachments is the plain string it always was, which is
 * every ordinary turn and every message this host writes itself.
 */

const sdk = vi.hoisted(() => {
  interface Feed { held: Record<string, unknown>[]; wake: (() => void) | undefined }
  const feed: Feed = { held: [], wake: undefined };
  return {
    feed,
    /** The stream the session pushes prompts onto, which nothing else reads. */
    prompt: undefined as AsyncGenerator<Bag> | undefined,
    reset() {
      feed.held = [];
      feed.wake = undefined;
    },
    push(...frames: Record<string, unknown>[]) {
      feed.held.push(...frames);
      feed.wake?.();
      feed.wake = undefined;
    },
    async next(): Promise<Record<string, unknown>> {
      while (feed.held.length === 0) await new Promise<void>((resolve) => { feed.wake = resolve; });
      return feed.held.shift() as Record<string, unknown>;
    },
  };
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: (given: { prompt: AsyncGenerator<Bag> }) => {
    sdk.prompt = given.prompt;
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) yield await sdk.next();
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
    };
  },
}));

const { createSession } = await import('../src/session.js');

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A folder of real files, because a part's bytes are read off disk. */
const folder = mkdtempSync(join(tmpdir(), 'ahpd-claude-attach-'));

const wrote = (name: string, bytes: Buffer | string): string => {
  const path = join(folder, name);
  writeFileSync(path, bytes);
  return path;
};

/** A PNG's first bytes. Nothing here decodes it, so a header is a picture. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

const IMAGE_LIMIT = 5 * 1024 * 1024;
const TEXT_LIMIT = 64 * 1024;

const smallImage = wrote('small.png', PNG);
const largeImage = wrote('large.png', Buffer.alloc(IMAGE_LIMIT + 1, 7));
const note = wrote('note.txt', 'one\ntwo\n');
const pasted = wrote('pasted.txt', 'x'.repeat(TEXT_LIMIT));
const longText = wrote('long.txt', 'x'.repeat(TEXT_LIMIT + 1));
const pdf = wrote('paper.pdf', '%PDF-1.4\n');
const unknown = wrote('blob.bin', Buffer.from([0, 1, 2]));
const picked = wrote('picked.txt', 'mine\n');

/**
 * An attachment as a client sends it.
 *
 * The protocol declares its variants as a `const enum`, whose members name
 * themselves as words but are not values anything imports, so a test writes the
 * word and this is where it becomes the type the session is handed.
 */
const carried = (one: Bag): MessageAttachment => one as unknown as MessageAttachment;

/** A file the host wrote for this message, as host 68 rewrites one. */
const written = (path: string, label: string, contentType: string): MessageAttachment => carried({
  type: 'resource',
  uri: `file://${path}`,
  label,
  contentType,
  _meta: { [SNAPSHOT_TAG]: { isSnapshot: true, contentType } },
});

/** A file somebody picked, which nothing wrote for this message. */
const existing = (path: string, label: string, contentType: string): MessageAttachment => carried({
  type: 'resource',
  uri: `file://${path}`,
  label,
  contentType,
});

const imageBlock = (path: string, type: string): Bag => ({
  type: 'image',
  source: { type: 'base64', media_type: type, data: PNG.toString('base64') },
});

/** The one reference block, which names what is not sent as its own part. */
const references = (...lines: string[]): Bag => ({
  type: 'text',
  text: ['The user provided the following references:', ...lines.map((one) => `- ${one}`)].join('\n'),
});

/** The note a snapshot carries in the reference block. */
const READ_ONLY = '(read-only snapshot, do not edit this file)';

const textBlock = (text: string): Bag => ({ type: 'text', text });

/** The frame a turn ends with, with no round under it. */
const ended = (): Record<string, unknown> => ({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });

/**
 * A real session over a CLI that answers nothing, and what it pushed at it.
 *
 * The prompts are read by one reader for the whole session, because a second
 * `next()` on the same generator queues behind the first - which would make an
 * absent prompt look like a late one.
 */
async function open(context?: string) {
  sdk.reset();
  const said: (string | Bag[])[] = [];
  const session = createSession({
    uri: 'ahp-session:/attach',
    chatUri: 'ahp-chat:/attach',
    cwd: folder,
    emit: () => {},
    ...(context === undefined ? {} : { context }),
  });
  await settle();
  const stream = sdk.prompt as AsyncGenerator<Bag>;
  void (async () => {
    for (;;) {
      const one = await stream.next();
      if (one.done === true) return;
      said.push(((one.value as Bag).message as Bag).content as string | Bag[]);
    }
  })();
  return { session, said };
}

it('sends a message with no attachments as the string it always was', async () => {
  const { session, said } = await open();
  session.begin('t1', 'what is this');
  await settle();
  expect(said).toEqual(['what is this']);
});

it('sends a pasted image as an image, and one too large by path', async () => {
  const { session, said } = await open();
  session.begin('t1', 'look', undefined, undefined, [
    written(smallImage, 'small.png', 'image/png'),
    written(largeImage, 'large.png', 'image/png'),
  ]);
  await settle();

  expect(said).toEqual([[
    textBlock('look'),
    imageBlock(smallImage, 'image/png'),
    references(`${largeImage} ${READ_ONLY}`),
  ]]);
});

it('inlines a pasted text up to 64 KiB and names what is larger', async () => {
  const { session, said } = await open();
  session.begin('t1', 'read this', undefined, undefined, [
    written(note, 'note.txt', 'text/plain'),
    written(longText, 'long.txt', 'text/plain'),
  ]);
  await settle();

  expect(said).toEqual([[
    textBlock('read this'),
    textBlock('note.txt (lines 1-2):\n```\none\ntwo\n```'),
    references(`${longText} ${READ_ONLY}`),
  ]]);
});

it('inlines a text of exactly the limit, which is the largest one that fits', async () => {
  const { session, said } = await open();
  session.begin('t1', 'read this', undefined, undefined, [written(pasted, 'pasted.txt', 'text/plain')]);
  await settle();
  expect(said).toEqual([[
    textBlock('read this'),
    textBlock(`pasted.txt (lines 1-1):\n\`\`\`\n${'x'.repeat(TEXT_LIMIT)}\n\`\`\``),
  ]]);
});

it('names a PDF and anything of an unknown type, because a document block is not sent', async () => {
  const { session, said } = await open();
  session.begin('t1', 'here', undefined, undefined, [
    written(pdf, 'paper.pdf', 'application/pdf'),
    written(unknown, 'blob.bin', 'application/octet-stream'),
  ]);
  await settle();

  expect(said).toEqual([[
    textBlock('here'),
    references(`${pdf} ${READ_ONLY}`, `${unknown} ${READ_ONLY}`),
  ]]);
});

it('names a file somebody picked, which is one they work in rather than paste', async () => {
  const { session, said } = await open();
  session.begin('t1', 'look at this', undefined, undefined, [existing(picked, 'picked.txt', 'text/plain')]);
  await settle();
  // Small and textual, and still named: only a file this host wrote is the
  // message's own, and a copy of somebody's buffer is not what they attached.
  expect(said).toEqual([[textBlock('look at this'), references(picked)]]);
});

it('keeps the side chat\'s carried prefix in the first block', async () => {
  const { session, said } = await open('what came before');
  session.begin('t1', 'and now', undefined, undefined, [written(smallImage, 'small.png', 'image/png')]);
  await settle();

  expect(said).toEqual([[
    textBlock('what came before\n\nand now'),
    imageBlock(smallImage, 'image/png'),
  ]]);
});

it('sends a queued message with its image when its turn comes', async () => {
  const { session, said } = await open();
  session.begin('t1', 'first');
  await settle();
  session.queue('q1', 'second', undefined, undefined, [written(smallImage, 'small.png', 'image/png')]);
  await settle();
  // Waiting, so nothing of it has reached the CLI yet.
  expect(said).toEqual(['first']);

  sdk.push(ended());
  await settle();
  expect(said).toEqual([
    'first',
    [textBlock('second'), imageBlock(smallImage, 'image/png')],
  ]);
});

it('sends a queued message with no attachments as the string it always was', async () => {
  const { session, said } = await open();
  session.begin('t1', 'first');
  await settle();
  session.queue('q1', 'second');
  await settle();
  sdk.push(ended());
  await settle();
  expect(said).toEqual(['first', 'second']);
});

it('sends a steering message with its pasted text into the turn that is running', async () => {
  const { session, said } = await open();
  session.begin('t1', 'first');
  await settle();
  expect(session.steer?.('s1', 'actually', [written(note, 'note.txt', 'text/plain')])).toBe(true);
  await settle();

  expect(said).toEqual([
    'first',
    [textBlock('actually'), textBlock('note.txt (lines 1-2):\n```\none\ntwo\n```')],
  ]);
});

it('keeps a queued message\'s attachments where a client reads them waiting', async () => {
  const { session } = await open();
  session.begin('t1', 'first');
  await settle();
  const one = written(smallImage, 'small.png', 'image/png');
  session.queue('q1', 'second', undefined, undefined, [one]);
  await settle();

  // What `chat/pendingMessageSet` echoed, which is the chip a client draws
  // while the message waits.
  const held = (session.chatState().queuedMessages as Bag[])[0] as Bag;
  expect((held.message as Bag).attachments).toEqual([one]);
});

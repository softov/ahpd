import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { SNAPSHOT_TAG } from '@ahpd/sdk';
import { fileResources } from '../../sdk/src/resources.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/clientcalls.js';
import type { Agent, Bag, Emit, MessageAttachment, Session, Start } from '@ahpd/sdk';
import { acpAgent } from '../src/index.js';

/*
 * What a prompt carries, what a queued message keeps, and what a session is
 * opened with.
 *
 * The first two are decided by what the server said in its handshake: an image
 * is an image block only to an agent that advertised `promptCapabilities.image`,
 * a file is an embedded resource only to one that advertised
 * `embeddedContext`, and the directories beside the working one go only to an
 * agent that advertised `sessionCapabilities.additionalDirectories`. What an
 * agent cannot take is named in the text rather than dropped, because a message
 * carrying a picture the agent never heard about is a message missing
 * something.
 *
 * The file an attachment names is the host's own copy of what the client
 * pasted, which the shared parts helper reads within its limits. Anything else
 * - a file somebody works in, a pipe, a device - is named by its path and never
 * opened, whatever the server said it takes.
 *
 * The server is the scripted subprocess in `test/fixtures/acp-server.mjs`, which
 * reports the blocks a prompt arrived in and logs every request it is sent, so
 * what is checked is what went over the wire rather than state the bridge kept.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** Everything this file made, so each case leaves nothing behind. */
const made: string[] = [];
const started: Session[] = [];

afterEach(() => {
  for (const session of started.splice(0)) session.close();
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** A fresh directory under the system temp root, kept for cleanup. */
const scratch = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-blocks-'));
  made.push(path);
  return path;
};

/** The backend under test, with its own request log. */
function backend(flags: string[] = []): { agent: Agent; log: string } {
  const log = join(scratch(), 'requests.jsonl');
  return {
    agent: acpAgent({
      command: process.execPath,
      args: [FIXTURE, ...flags],
      env: { ACP_LOG: log },
      provider: 'acp',
    }),
    log,
  };
}

type Watcher = { emit: Emit; prose(): string; ended(): number; waiting(): Bag[] };

/** A session's emitted actions, which is how a test knows a turn has settled. */
function watcher(): Watcher {
  const actions: { channel: string; action: Bag }[] = [];
  return {
    emit: (channel, action) => { actions.push({ channel, action }); },
    prose: () => actions
      .filter((one) => one.action.type === 'chat/delta')
      .map((one) => String(one.action.content))
      .join(''),
    ended: () => actions.filter((one) => ['chat/turnComplete', 'chat/turnCancelled', 'chat/error'].includes(String(one.action.type))).length,
    // The messages a client was told are waiting, as the actions carried them.
    waiting: () => actions
      .filter((one) => one.action.type === 'chat/pendingMessageSet')
      .map((one) => one.action.message as Bag),
  };
}

/** The start a session is handed, without the host that would normally build it. */
const opening = (id: string, over: Partial<Start> = {}): Start => ({
  uri: `ahp-session:/${id}`,
  chatUri: `ahp-chat:/${id}`,
  settings: {},
  schema: () => ({ type: 'object', properties: {} }),
  emit: () => {},
  // The host always resolves this, and its own answer when the deployment said
  // nothing is ten minutes.
  clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  // This case is not about trust, and an absent answer is untrusted - decision
  // `a-folder-is-untrusted-until-a-client-says-otherwise` - so the folder is
  // one the host vouched for, as a session a window opened for itself is.
  trusted: () => true,
  ...over,
});

/** One session of a backend, watched and remembered for cleanup. */
function start(agent: Agent, id: string, over: Partial<Start> = {}): { session: Session; watch: Watcher } {
  const watch = watcher();
  const session = agent.create(opening(id, { ...over, emit: watch.emit }));
  started.push(session);
  return { session, watch };
}

/** The subprocess's work finishing, up to a point; the fixture never sleeps. */
const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
};

/**
 * One turn with attachments, waited on until the action that ends it.
 *
 * Asked of the fixture's own `blocks` script, which answers with the blocks the
 * prompt arrived in rather than what this bridge thinks it sent.
 */
const prompt = async (
  session: Session,
  watch: Watcher,
  attachments: MessageAttachment[],
): Promise<string> => {
  const before = watch.ended();
  session.begin('t1', 'what are these blocks?', undefined, undefined, attachments);
  await until(() => watch.ended() > before);
  const said = watch.prose();
  const at = said.indexOf('blocks=');
  return at < 0 ? '' : said.slice(at);
};

/** Every request the fixture was sent, in order. */
const requests = (log: string): { method?: string; params?: Record<string, unknown> }[] => {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> });
  }
  catch {
    // No file yet is no requests yet.
    return [];
  }
};

/**
 * An attachment as a client sends it.
 *
 * The protocol declares its variants as a `const enum`, whose members name
 * themselves as words but are not values anything imports, so a test writes the
 * word and this is where it becomes the type the session is handed.
 */
const carried = (one: Bag): MessageAttachment => one as unknown as MessageAttachment;

/** A pasted image: bytes, a name, and the kind that makes it an image. */
const PICTURE = carried({
  type: 'embeddedResource',
  label: 'shot.png',
  contentType: 'image/png',
  data: 'aW1hZ2U=',
});

/** A pasted file that is not an image. */
const NOTES = carried({
  type: 'embeddedResource',
  label: 'notes.txt',
  contentType: 'text/plain',
  data: 'bm90ZXM=',
});

/** A file this host wrote for the message, as the host's rewrite leaves it. */
const written = (path: string, label: string, type: string): MessageAttachment => carried({
  type: 'resource',
  label,
  uri: `file://${path}`,
  contentType: type,
  _meta: { [SNAPSHOT_TAG]: { isSnapshot: true, contentType: type } },
});

it('sends an image as an image block to a server that takes images', async () => {
  const { agent } = backend(['--prompt-caps']);
  const { session, watch } = start(agent, 'image');
  expect(await prompt(session, watch, [PICTURE]))
    .toBe('blocks=text:what are these blocks?|image:acp-attachment:acp/shot.png');
});

it('names the image in the text for a server that does not take them', async () => {
  // The handshake said nothing about images, so an image block would be a block
  // this server never agreed to read.
  const { agent } = backend();
  const { session, watch } = start(agent, 'no-image');
  expect(await prompt(session, watch, [PICTURE]))
    .toBe('blocks=text:what are these blocks?|text:The user provided the following references:\n- shot.png');
});

it('sends a file the host wrote as an embedded resource to a server that takes context', async () => {
  const dir = scratch();
  const path = join(dir, 'notes.txt');
  writeFileSync(path, 'the notes\n');
  const { agent } = backend(['--prompt-caps']);
  const { session, watch } = start(agent, 'context');
  /*
   * The URI is the file the host wrote, which is one an agent with tools of its
   * own can open, and the text is the file's own words: the report names the URI
   * and then the text, so what is read here is the file's bytes and nothing this
   * bridge added. No fence and no line header, and the newline the file ends
   * with is still there.
   */
  expect(await prompt(session, watch, [written(path, 'notes.txt', 'text/plain')]))
    .toBe(`blocks=text:what are these blocks?|resource:file://${path}\nthe notes\n`);
});

it('inlines an attachment that never reached a file, which names no resource', async () => {
  // What the client pasted, on a host that wrote nothing for it: a resource
  // block would name a URI nothing here can open, so the text goes as text.
  const { agent } = backend(['--prompt-caps']);
  const { session, watch } = start(agent, 'no-file');
  expect(await prompt(session, watch, [NOTES]))
    .toBe('blocks=text:what are these blocks?|text:notes.txt (lines 1-1):\n```\nnotes\n```');
});

it('names what the server cannot take rather than dropping it', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'named');
  // A pasted file is the text it holds, which is what any server takes; a
  // simple attachment is the text its producer wrote for the model.
  const said = await prompt(session, watch, [NOTES, carried({
    type: 'simple',
    label: 'the first paragraph',
    modelRepresentation: 'It was a dark and stormy night.',
  })]);
  expect(said).toBe(
    'blocks=text:what are these blocks?'
    + '|text:notes.txt (lines 1-1):\n```\nnotes\n```'
    + '|text:It was a dark and stormy night.',
  );
});

it('names a file the client gave by URI, and does not read it', async () => {
  const dir = scratch();
  const path = join(dir, 'note.txt');
  writeFileSync(path, 'the note body');
  const asked: string[] = [];
  const store = fileResources();
  const { agent } = backend(['--prompt-caps']);
  const { session, watch } = start(agent, 'referenced', {
    resources: { ...store, read: (uri: string, wanted?: string) => { asked.push(uri); return store.read(uri, wanted); } },
  });
  const said = await prompt(session, watch, [carried({
    type: 'resource',
    label: 'note.txt',
    uri: `file://${path}`,
  })]);
  // A file in somebody's workspace is named by its path and left where it is:
  // the agent opens it with its own tools, and this host never read it at all.
  expect(said).toBe(`blocks=text:what are these blocks?|text:The user provided the following references:\n- ${path}`);
  expect(asked.filter((uri) => uri.includes('note.txt'))).toEqual([]);
});

it('names a large file, a pipe and a device without reading them', async () => {
  const dir = scratch();
  const big = join(dir, 'huge.bin');
  writeFileSync(big, Buffer.alloc(6 * 1024 * 1024, 7));
  const pipe = join(dir, 'a-pipe');
  execFileSync('mkfifo', [pipe]);
  // A server that takes embedded context gets these as names too: read, a pipe
  // is forever, a device is endless and six megabytes is more than the helper
  // sends, so each is named by its path and none of them is opened.
  const { agent } = backend(['--prompt-caps']);
  const { session, watch } = start(agent, 'limits');
  const said = await prompt(session, watch, [
    carried({ type: 'resource', label: 'huge.bin', uri: `file://${big}`, contentType: 'application/octet-stream' }),
    carried({ type: 'resource', label: 'a-pipe', uri: `file://${pipe}` }),
    carried({ type: 'resource', label: 'zero', uri: 'file:///dev/zero' }),
  ]);
  const named = ['The user provided the following references:', `- ${big}`, `- ${pipe}`, '- /dev/zero'].join('\n');
  expect(said).toBe(`blocks=text:what are these blocks?|text:${named}`);
});

/** Run one turn with nothing attached to it, and wait for it to settle. */
const turn = async (session: Session, watch: Watcher, text: string): Promise<void> => {
  const before = watch.ended();
  session.begin('t1', text);
  await until(() => watch.ended() > before);
};

it('sends a queued message with its attachments when its turn starts', async () => {
  const { agent } = backend(['--prompt-caps']);
  const { session, watch } = start(agent, 'queued');
  // Queued while the turn before it is still running, so it waits rather than
  // being sent: what it becomes when its turn comes is its text and its
  // attachments, which a client was already shown as waiting.
  session.begin('t1', 'hello');
  session.queue('q1', 'what are these blocks?', undefined, undefined, [PICTURE]);
  expect(watch.waiting()[0]?.attachments).toEqual([PICTURE]);
  await until(() => watch.prose().includes('blocks='));
  expect(watch.prose()).toContain('blocks=text:what are these blocks?|image:acp-attachment:acp/shot.png');
});

it('sends the directories beside the working one only to a server that advertised them', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'beside', { additional: ['/tmp/beside'] });
  await turn(session, watch, 'hi');
  // A field a server never said it knows is one it may reject the whole call
  // over, and the directories are kept on the session either way.
  expect(requests(log).find((one) => one.method === 'session/new')?.params)
    .not.toHaveProperty('additionalDirectories');

  const allowed = backend(['--extra-dirs']);
  const second = start(allowed.agent, 'beside-allowed', { additional: ['/tmp/beside'] });
  await turn(second.session, second.watch, 'hi');
  expect(requests(allowed.log).find((one) => one.method === 'session/new')?.params)
    .toMatchObject({ additionalDirectories: ['/tmp/beside'] });
});
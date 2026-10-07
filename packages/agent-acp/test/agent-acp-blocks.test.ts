import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { fileResources } from '../../sdk/src/resources.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/clientcalls.js';
import type { Agent, Bag, Emit, MessageAttachment, Session, Start } from '@ahpd/sdk';
import { acpAgent } from '../src/index.js';

/*
 * What a prompt carries, and what a session is opened with.
 *
 * Both are decided by what the server said in its handshake: an image is an
 * image block only to an agent that advertised `promptCapabilities.image`, a
 * file is an embedded resource only to one that advertised `embeddedContext`,
 * and the directories beside the working one go only to an agent that
 * advertised `sessionCapabilities.additionalDirectories`. What an agent cannot
 * take is named in the text rather than dropped, because a message carrying a
 * picture the agent never heard about is a message missing something.
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

type Watcher = { emit: Emit; prose(): string; ended(): number };

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
    .toBe('blocks=text:what are these blocks?|text:[shot.png]');
});

it('sends a pasted file as an embedded resource to a server that takes context', async () => {
  const { agent } = backend(['--prompt-caps']);
  const { session, watch } = start(agent, 'context');
  expect(await prompt(session, watch, [NOTES]))
    .toBe('blocks=text:what are these blocks?|resource:acp-attachment:acp/notes.txt');
});

it('names what the server cannot take rather than dropping it', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'named');
  // A file the server did not ask for is named; a simple attachment is the
  // text its producer wrote for the model.
  const said = await prompt(session, watch, [NOTES, carried({
    type: 'simple',
    label: 'the first paragraph',
    modelRepresentation: 'It was a dark and stormy night.',
  })]);
  expect(said).toBe('blocks=text:what are these blocks?|text:[notes.txt]|text:It was a dark and stormy night.');
});

it('reads a file the client named by URI, through the host\'s own store', async () => {
  const path = scratch();
  writeFileSync(join(path, 'note.txt'), 'the note body');
  const { agent } = backend(['--prompt-caps']);
  const { session, watch } = start(agent, 'referenced', { resources: fileResources() });
  const said = await prompt(session, watch, [carried({
    type: 'resource',
    label: 'note.txt',
    uri: `file://${join(path, 'note.txt')}`,
  })]);
  // The URI travels as it was given, so the agent can name what it was sent.
  expect(said).toBe(`blocks=text:what are these blocks?|resource:file://${join(path, 'note.txt')}`);
});

/** Run one turn with nothing attached to it, and wait for it to settle. */
const turn = async (session: Session, watch: Watcher, text: string): Promise<void> => {
  const before = watch.ended();
  session.begin('t1', text);
  await until(() => watch.ended() > before);
};

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
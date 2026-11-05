import { describe, expect, it } from 'vitest';
import { adapterOf, inputOf, nameOf, schemaOf } from '../src/mapping.js';
import { checkAdapter } from '../../sdk/src/plugins/validate.js';
import { schemaGaps } from '../../sdk/src/plugins/schemagaps.js';
import type { ActionDescription, AuthDescription, PieceDescription, PropDescription } from '../src/wire.js';
import type { Connector } from '@ahpd/sdk';

/*
 * What a piece becomes in the daemon.
 *
 * The mapping reads the description the engine sends and nothing else, so a
 * case builds one by hand: the auth the piece takes, and the props of its
 * actions. No piece is loaded here, and no function survives into an adapter.
 */

/** A piece description, with the parts a case does not name left empty. */
const piece = (fields: Partial<PieceDescription> = {}): PieceDescription => ({
  package: '@activepieces/piece-demo',
  displayName: 'Demo',
  actions: [],
  ...fields,
});

/** One action description, with a required text prop unless a case says otherwise. */
const action = (fields: Partial<ActionDescription> = {}): ActionDescription => ({
  name: 'say',
  displayName: 'Say',
  description: 'Says the text it is given.',
  props: { text: { type: 'SHORT_TEXT', displayName: 'Text', required: true } },
  ...fields,
});

/** Slack's auth, as the piece declares it: an OAuth2 entry, then a custom one. */
const SLACK_AUTH: AuthDescription[] = [
  { type: 'OAUTH2', displayName: 'Connection', description: 'Authenticate via a Slack OAuth flow.' },
  {
    type: 'CUSTOM_AUTH',
    displayName: 'Bot Token',
    description: 'Authenticate using a Slack bot token (and optional user token).',
    props: {
      botToken: { type: 'SECRET_TEXT', displayName: 'Bot Token', description: 'The bot token for your Slack app (starts with xoxb-)', required: true },
      userToken: { type: 'SECRET_TEXT', displayName: 'User Token', description: 'Optional user token for actions that require user-level access.', required: false },
    },
  },
];

describe('a piece becomes an adapter', () => {
  it('names the adapter after the package, with the ap- prefix', () => {
    expect(nameOf('@activepieces/piece-resend')).toBe('ap-resend');
    expect(nameOf('@activepieces/piece-telegram-bot')).toBe('ap-telegram-bot');
    expect(nameOf('left-pad')).toBeUndefined();
  });

  it('gives a SECRET_TEXT auth one secret string, secret_text', () => {
    const auth: AuthDescription = { type: 'SECRET_TEXT', displayName: 'API Key', description: 'The key.' };
    const schema = schemaOf([auth]);

    expect(schema).toEqual({
      type: 'object',
      properties: {
        secret_text: { type: 'string', secret: true, title: 'API Key', description: 'The key.' },
      },
      required: ['secret_text'],
    });
  });

  it("uses Slack's custom auth entry, with both tokens secret and the bot token required", () => {
    const mapped = adapterOf(piece({ package: '@activepieces/piece-slack', displayName: 'Slack', auth: SLACK_AUTH }));
    const schema = mapped.adapter?.schema as Record<string, unknown>;
    const properties = schema['properties'] as Record<string, Record<string, unknown>>;

    expect(Object.keys(properties)).toEqual(['botToken', 'userToken']);
    expect(properties['botToken']).toMatchObject({ type: 'string', secret: true, title: 'Bot Token' });
    expect(properties['userToken']).toMatchObject({ type: 'string', secret: true, title: 'User Token' });
    expect(schema['required']).toEqual(['botToken']);
  });

  it('gives a BASIC_AUTH auth a username and a secret password, as Activepieces collects them, and hands them over as its value', async () => {
    const auth: AuthDescription = {
      type: 'BASIC_AUTH',
      displayName: 'Credentials',
      username: { displayName: 'Login', description: 'Your login.' },
      password: { displayName: 'Password' },
    };
    let handed: Record<string, unknown> | undefined;
    const mapped = adapterOf(piece({ auth, actions: [action()] }), async (call) => { handed = call.auth; return null; });

    expect(mapped.adapter?.schema).toEqual({
      type: 'object',
      properties: {
        username: { type: 'string', title: 'Login', description: 'Your login.' },
        password: { type: 'string', secret: true, title: 'Password' },
      },
      required: ['username', 'password'],
    });
    await mapped.adapter?.run?.({ id: 'work', adapter: 'ap-demo', owner: 'host', config: { username: 'ana', password: 'pw' } }, 'say', { text: 'hi' });
    expect(handed).toEqual({ type: 'BASIC_AUTH', username: 'ana', password: 'pw' });
  });

  it('offers each kind a piece lists that a connector can carry, the connector picking one by its type', async () => {
    const mapped = adapterOf(piece({
      package: '@activepieces/piece-github',
      displayName: 'GitHub',
      auth: [
        { type: 'OAUTH2', displayName: 'Connection' },
        { type: 'CUSTOM_AUTH', displayName: 'GitHub App', props: { appId: { type: 'SHORT_TEXT', displayName: 'App ID', required: true }, privateKey: { type: 'SECRET_TEXT', displayName: 'Private key', required: true } } },
        { type: 'SECRET_TEXT', displayName: 'Personal access token' },
      ],
      actions: [action()],
    }), async (call) => call.auth);
    const schema = mapped.adapter?.schema as Record<string, unknown>;

    expect(schema['properties']).toEqual({
      type: { type: 'string', title: 'Connection', enum: ['CUSTOM_AUTH', 'SECRET_TEXT'], enumLabels: ['GitHub App', 'Personal access token'] },
      appId: { type: 'string', title: 'App ID' },
      privateKey: { type: 'string', secret: true, title: 'Private key' },
      secret_text: { type: 'string', secret: true, title: 'Personal access token' },
    });
    expect(schema['required']).toEqual(['type']);
    expect(schema['allOf']).toEqual([
      { if: { properties: { type: { const: 'CUSTOM_AUTH' } } }, then: { required: ['appId', 'privateKey'] } },
      { if: { properties: { type: { const: 'SECRET_TEXT' } } }, then: { required: ['secret_text'] } },
    ]);
    expect(await mapped.adapter?.run?.({ id: 'work', adapter: 'ap-github', owner: 'host', config: { type: 'SECRET_TEXT', secret_text: 'ghp_x' } }, 'say', {}))
      .toEqual({ type: 'SECRET_TEXT', secret_text: 'ghp_x' });
    expect(() => checkAdapter(mapped.adapter, 'activepieces')).not.toThrow();
  });

  it('checks a connector with the piece\'s own validate, where the piece has one', async () => {
    const auth: AuthDescription = { type: 'SECRET_TEXT', displayName: 'API Key', validates: true };
    const asked: Record<string, unknown>[] = [];
    const answers = [{ valid: true }, { valid: false, error: 'Invalid Api Key' }];
    const mapped = adapterOf(piece({ auth, actions: [action()] }), undefined, undefined, async (value) => {
      asked.push(value);
      const said = answers.shift();
      if (said === undefined) throw new Error('the engine is down');
      return said;
    });
    const connector: Connector = { id: 'work', adapter: 'ap-demo', owner: 'host', config: { secret_text: 're_x' } };

    expect(await mapped.adapter?.check?.(connector)).toEqual({ result: 'ok' });
    expect(await mapped.adapter?.check?.(connector)).toEqual({ result: 'denied', message: 'Invalid Api Key' });
    expect(await mapped.adapter?.check?.(connector)).toEqual({ result: 'failed', message: 'the engine is down' });
    expect(asked[0]).toEqual({ type: 'SECRET_TEXT', secret_text: 're_x' });
    expect(adapterOf(piece({ auth: { type: 'SECRET_TEXT', displayName: 'API Key' } }), undefined, undefined, async () => ({ valid: true })).adapter).not.toHaveProperty('check');
  });

  it('leaves out an action its piece marks for humans alone, as Activepieces hides it from agents', () => {
    const mapped = adapterOf(piece({
      auth: { type: 'SECRET_TEXT', displayName: 'API Key' },
      actions: [
        action({ name: 'create_issue', displayName: 'Create Issue', audience: 'human' }),
        action({ name: 'create_issue_agent', displayName: 'Create Issue (Agent)', audience: 'ai' }),
        action({ name: 'list', displayName: 'List', audience: 'both' }),
      ],
    }));

    expect(mapped.adapter?.capabilities.map((one) => one.name)).toEqual(['create_issue_agent', 'list']);
  });

  it('types a multi-select dropdown as an array of its values', () => {
    const input = inputOf({
      labels: { type: 'STATIC_MULTI_SELECT_DROPDOWN', displayName: 'Labels', required: false, options: ['bug', 'feature'] },
      people: { type: 'MULTI_SELECT_DROPDOWN', displayName: 'People', required: false },
    });

    expect(input?.['properties']).toEqual({
      labels: { type: 'array', title: 'Labels', items: { enum: ['bug', 'feature'] } },
      people: { type: 'array', title: 'People', items: { type: 'string' }, description: 'Give the ids.' },
    });
  });

  it('describes an adapter in the piece\'s own words, or by its name where it wrote none', () => {
    expect(adapterOf(piece({ auth: { type: 'SECRET_TEXT', displayName: 'API Key' } })).adapter?.description).toBe('Demo');
  });

  it('gives a piece with only an OAuth2 auth no adapter, and says so', () => {
    const mapped = adapterOf(piece({
      package: '@activepieces/piece-oauth',
      auth: [{ type: 'OAUTH2', displayName: 'Connection' }],
    }));

    expect(mapped.adapter).toBeUndefined();
    expect(mapped.notes).toHaveLength(1);
    expect(mapped.notes[0]).toContain('ap-oauth');
  });

  it('puts the icon on the adapter when the piece has one', () => {
    const icon = { src: 'data:image/png;base64,AAAA', contentType: 'image/png' };
    const mapped = adapterOf(
      piece({ auth: { type: 'SECRET_TEXT', displayName: 'API Key' } }),
      undefined,
      icon,
    );

    expect(mapped.adapter?.icons).toEqual([icon]);
  });

  it('leaves the icons key off an adapter with no logo', () => {
    const mapped = adapterOf(piece({ auth: { type: 'SECRET_TEXT', displayName: 'API Key' } }));

    expect(mapped.adapter).not.toHaveProperty('icons');
  });

  it('maps each prop type, and leaves out a MARKDOWN prop', () => {
    const props: Record<string, PropDescription> = {
      short: { type: 'SHORT_TEXT', displayName: 'Short', required: false },
      long: { type: 'LONG_TEXT', displayName: 'Long', required: false },
      count: { type: 'NUMBER', displayName: 'Count', required: false },
      loud: { type: 'CHECKBOX', displayName: 'Loud', required: false },
      list: { type: 'ARRAY', displayName: 'List', required: false },
      body: { type: 'OBJECT', displayName: 'Body', required: false },
      raw: { type: 'JSON', displayName: 'Raw', required: false },
      chosen: { type: 'DYNAMIC', displayName: 'Chosen', required: false },
      format: { type: 'STATIC_DROPDOWN', displayName: 'Format', required: false, options: ['plain', 'markdown'] },
      channel: { type: 'DROPDOWN', displayName: 'Channel', description: 'The channel to post in.', required: false },
      when: { type: 'DATE_TIME', displayName: 'When', required: false },
      note: { type: 'MARKDOWN', displayName: 'Note', required: false },
      file: { type: 'FILE', displayName: 'File', required: false },
    };
    const input = inputOf(props);
    const properties = input?.['properties'] as Record<string, Record<string, unknown>>;

    expect(properties['short']).toMatchObject({ type: 'string' });
    expect(properties['long']).toMatchObject({ type: 'string' });
    expect(properties['count']).toMatchObject({ type: 'number' });
    expect(properties['loud']).toMatchObject({ type: 'boolean' });
    expect(properties['list']).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(properties['body']).toMatchObject({ type: 'object', additionalProperties: {} });
    expect(properties['raw']).toEqual({});
    expect(properties['chosen']).toMatchObject({ type: 'object', additionalProperties: {} });
    expect(properties['format']).toMatchObject({ type: 'string', enum: ['plain', 'markdown'] });
    expect(properties['channel']).toMatchObject({ type: 'string', description: 'The channel to post in. Give the id.' });
    expect(properties['when']).toMatchObject({ type: 'string', format: 'date-time' });
    expect(properties['file']).toMatchObject({
      type: 'string',
      description: 'An https: URL, a data: URI or the name of a session attachment.',
    });
    expect(properties).not.toHaveProperty('note');
  });

  it('maps an ARRAY prop that names its item props to an array of objects', () => {
    const input = inputOf({
      emails: {
        type: 'ARRAY',
        displayName: 'Emails',
        description: 'The emails to send at once.',
        required: true,
        props: {
          from: { type: 'SHORT_TEXT', displayName: 'From', required: true },
          subject: { type: 'SHORT_TEXT', displayName: 'Subject', required: true },
          bcc: { type: 'SHORT_TEXT', displayName: 'Bcc', required: false },
        },
      },
    });

    expect(input?.['properties']).toEqual({
      emails: {
        type: 'array',
        title: 'Emails',
        description: 'The emails to send at once.',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', title: 'From' },
            subject: { type: 'string', title: 'Subject' },
            bcc: { type: 'string', title: 'Bcc' },
          },
          required: ['from', 'subject'],
        },
      },
    });
  });

  it('leaves an action with no drawable prop without an input', () => {
    const mapped = adapterOf(piece({
      auth: { type: 'SECRET_TEXT', displayName: 'API Key' },
      actions: [
        action({ name: 'ping', displayName: 'Ping', props: {} }),
        action({ name: 'help', displayName: 'Help', props: { note: { type: 'MARKDOWN', displayName: 'Note', required: false } } }),
      ],
    }));

    expect(mapped.adapter?.capabilities[0]?.input).toBeUndefined();
    expect(mapped.adapter?.capabilities[1]?.input).toBeUndefined();
  });

  it('names every value of an input that holds each prop type', () => {
    const mapped = adapterOf(piece({
      auth: { type: 'SECRET_TEXT', displayName: 'API Key' },
      actions: [action({
        props: {
          text: { type: 'SHORT_TEXT', displayName: 'Text', required: true },
          list: { type: 'ARRAY', displayName: 'List', required: false },
          rows: {
            type: 'ARRAY',
            displayName: 'Rows',
            required: false,
            props: { id: { type: 'SHORT_TEXT', displayName: 'Id', required: true } },
          },
          body: { type: 'OBJECT', displayName: 'Body', required: false },
          raw: { type: 'JSON', displayName: 'Raw', required: false },
          chosen: { type: 'DYNAMIC', displayName: 'Chosen', required: false },
        },
      })],
    }));

    expect(schemaGaps(mapped.adapter?.capabilities[0]?.input)).toEqual([]);
  });

  it('offers an action that needs a file, with the file required', () => {
    const mapped = adapterOf(piece({
      auth: { type: 'SECRET_TEXT', displayName: 'API Key' },
      actions: [
        action(),
        action({
          name: 'upload-file',
          displayName: 'Upload file',
          props: { file: { type: 'FILE', displayName: 'File', required: true } },
        }),
      ],
    }));

    expect(mapped.adapter?.capabilities.map((one) => one.name)).toEqual(['say', 'upload-file']);
    expect(mapped.notes).toEqual([]);
    const upload = mapped.adapter?.capabilities.find((one) => one.name === 'upload-file');
    expect(upload?.input?.['required']).toEqual(['file']);
  });

  it('keeps a file optional, and puts the prop own description before the three forms', () => {
    const mapped = adapterOf(piece({
      auth: { type: 'SECRET_TEXT', displayName: 'API Key' },
      actions: [action({
        name: 'send',
        props: { file: { type: 'FILE', displayName: 'File', description: 'The file to send.', required: false } },
      })],
    }));
    const send = mapped.adapter?.capabilities[0];

    expect(send?.input?.['properties']).toMatchObject({
      file: {
        type: 'string',
        title: 'File',
        description: 'The file to send. An https: URL, a data: URI or the name of a session attachment.',
      },
    });
    expect(send?.input).not.toHaveProperty('required');
  });

  it('makes each action an action capability, titled and described by the piece', () => {
    const mapped = adapterOf(piece({
      displayName: 'Resend',
      description: 'The email API for developers.',
      auth: { type: 'SECRET_TEXT', displayName: 'API Key' },
      actions: [
        action({ name: 'send_email', displayName: 'Send email', description: 'Sends an email.', aiDescription: 'Sends one email.' }),
        action({ name: 'list_audiences', displayName: 'List audiences', description: 'Lists the audiences.' }),
      ],
    }));

    expect(mapped.adapter).toMatchObject({
      name: 'ap-demo',
      title: 'Resend',
      description: 'The email API for developers.',
    });
    expect(mapped.adapter?.capabilities).toMatchObject([
      { type: 'action', name: 'send_email', title: 'Send email', description: 'Sends one email.' },
      { type: 'action', name: 'list_audiences', title: 'List audiences', description: 'Lists the audiences.' },
    ]);
  });

  it('makes an adapter that checkAdapter accepts', () => {
    const simple = adapterOf(piece({ auth: { type: 'SECRET_TEXT', displayName: 'API Key' }, actions: [action()] }));
    const slack = adapterOf(piece({ package: '@activepieces/piece-slack', displayName: 'Slack', auth: SLACK_AUTH, actions: [action()] }));

    expect(() => checkAdapter(simple.adapter, 'activepieces')).not.toThrow();
    expect(() => checkAdapter(slack.adapter, 'activepieces')).not.toThrow();
    expect(checkAdapter(simple.adapter, 'activepieces').name).toBe('ap-demo');
  });
});

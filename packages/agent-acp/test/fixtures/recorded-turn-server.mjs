import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const file = process.env.ACP_TEST_HISTORY;
const read = () => {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return {}; }
};
const write = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
const update = (sessionId, value) => write({ method: 'session/update', params: { sessionId, update: value } });

createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const data = read();
  const params = request.params ?? {};
  let result = {};
  switch (request.method) {
    case 'initialize':
      result = { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } }, authMethods: [] };
      break;
    case 'session/new': {
      const sessionId = `native-${randomUUID()}`;
      data[sessionId] = { cwd: params.cwd, turns: [] };
      writeFileSync(file, JSON.stringify(data));
      result = { sessionId };
      break;
    }
    case 'session/list':
      result = { sessions: Object.entries(data).map(([sessionId, one]) => ({ sessionId, cwd: one.cwd, title: 'Recorded turns', updatedAt: '2026-11-06T00:00:00Z' })) };
      break;
    case 'session/load':
      for (const turn of data[params.sessionId]?.turns ?? []) {
        update(params.sessionId, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: turn.text.slice(0, 2) } });
        update(params.sessionId, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: turn.text.slice(2) } });
        for (const one of turn.updates) update(params.sessionId, one);
      }
      break;
    case 'session/prompt': {
      const session = data[params.sessionId];
      const text = params.prompt.filter((one) => one.type === 'text').map((one) => one.text).join('');
      const n = session.turns.length + 1;
      const messageId = (suffix) => process.argv.includes('--no-message-id') || text.includes('[without-id]') ? {} : { messageId: `native-message-${n}-${suffix}` };
      const updates = [
        { sessionUpdate: 'agent_thought_chunk', messageId: 'not-an-answer', content: { type: 'text', text: 'thinking' } },
        { sessionUpdate: 'tool_call', toolCallId: `call-${n}`, title: 'Fixture tool', status: 'completed', content: [] },
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer: ' } },
        { sessionUpdate: 'agent_message_chunk', ...messageId('first'), content: { type: 'text', text: text.slice(0, 2) } },
        { sessionUpdate: 'agent_message_chunk', ...messageId('first'), content: { type: 'text', text: text.slice(2) } },
        { sessionUpdate: 'agent_message_chunk', ...messageId('second'), content: { type: 'text', text: ' done' } },
      ];
      session.turns.push({ text, updates });
      writeFileSync(file, JSON.stringify(data));
      update('another-session', { sessionUpdate: 'agent_message_chunk', messageId: 'foreign-message', content: { type: 'text', text: 'ignore' } });
      for (const one of updates) update(params.sessionId, one);
      result = { stopReason: 'end_turn' };
      break;
    }
  }
  write({ id: request.id, result });
});

/**
 * What reading one transcript costs, in heap and in wall clock.
 *
 * `node scripts/transcript-memory.mjs <session-id> [dir]`. A session with
 * several hundred turns is the one worth measuring - see the read-once
 * cache in the host.
 */
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
const mb = () => Math.round(process.memoryUsage().heapUsed / 1048576);
const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const id = process.argv[2];
console.log('before  heap', mb(), 'rss', rss());
const t = Date.now();
const msgs = await getSessionMessages(id, { dir: process.argv[3] ?? process.cwd() });
console.log('after   heap', mb(), 'rss', rss(), '|', msgs.length, 'messages in', Date.now() - t, 'ms');

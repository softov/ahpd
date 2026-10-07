---
title: An ACP prompt reads a referenced file only within the limits, and a queued message keeps its attachments - implemented
date: 2026-10-07
refs:
  - git://222e393 - the commit this work sits on; none of it is committed yet, on `build/agents/b8555747`
  - "[code://packages/sdk/src/attachments.ts#L65-L83](../../../../packages/sdk/src/attachments.ts#L65-L83) - `PartSource` and `Part`, the attachment a part came from, and the file text it read"
  - "[code://packages/sdk/src/attachments.ts#L178-L187](../../../../packages/sdk/src/attachments.ts#L178-L187) - `sourceOf`, set on every part an attachment became"
  - "[code://packages/sdk/src/attachments.ts#L154-L159](../../../../packages/sdk/src/attachments.ts#L154-L159) - the snapshot branch, which reads a file and keeps its own text"
  - "[code://packages/agent-acp/src/session/turn.ts#L241-L270](../../../../packages/agent-acp/src/session/turn.ts#L241-L270) - `blocksFor`, which maps the parts to ACP blocks"
  - "[code://packages/agent-acp/src/session/queue.ts#L176-L199](../../../../packages/agent-acp/src/session/queue.ts#L176-L199) - `startNext`, which hands a queued entry's attachments to `begin`"
  - "[code://packages/agent-acp/src/session/queue.ts#L226-L239](../../../../packages/agent-acp/src/session/queue.ts#L226-L239) - `queue`, which keeps them on the entry's message"
  - "[code://packages/agent-acp/test/agent-acp-blocks.test.ts](../../../../packages/agent-acp/test/agent-acp-blocks.test.ts) - what a prompt carries, and what a queued message keeps"
  - "[code://packages/sdk/test/attachments.test.ts](../../../../packages/sdk/test/attachments.test.ts) - the shape of each part, and the attachment it names"
---

An ACP turn sends what a message's attachments became, within host 68's limits, and reads no referenced file itself. An image the model takes is an image block. A file the host wrote for the message is an embedded `resource` carrying the file's own text, where the server takes embedded context. Everything else - a file in somebody's workspace, a pipe, a device, six megabytes - is named by its path in the text. A queued message reaches its turn with the attachments it was queued with.

## What was built

- [`code://packages/sdk/src/attachments.ts#L65-L83`](../../../../packages/sdk/src/attachments.ts#L65-L83) - `PartSource`, and the optional `source` on each `Part`. It holds the label of the attachment the part came from, and its URI where it has one. Where the helper read a file it also holds that file's own text. A backend that ignores the field is unchanged.
- [`code://packages/sdk/src/attachments.ts#L178-L187`](../../../../packages/sdk/src/attachments.ts#L178-L187) - `sourceOf`, which sets the label and URI on every part an attachment became. The file's text is not set here, because it is not the attachment's: the branch that read the file adds it.
- [`code://packages/sdk/src/attachments.ts#L154-L159`](../../../../packages/sdk/src/attachments.ts#L154-L159) - the branch that inlines a snapshot. It reads the file within the text limit. The bytes' own text goes on the source, beside the fenced copy the part itself carries.
- [`code://packages/agent-acp/src/session/turn.ts#L241-L270`](../../../../packages/agent-acp/src/session/turn.ts#L241-L270) - `blocksFor`. It asks `partsOf` for the parts and sends one block for each. An image part is an image block named by the attachment. A text part is a text block. A part carrying a file's own text is an embedded `resource` of that text where the server advertised `embeddedContext`. `contentOf` and the three helpers around it are gone, so nothing here reads a file.
- [`code://packages/agent-acp/src/session/queue.ts#L226-L239`](../../../../packages/agent-acp/src/session/queue.ts#L226-L239) - the queue entry's `message` carries `attachments`, so the `chat/pendingMessageSet` echo and the chat state report the message as it was queued.
- [`code://packages/agent-acp/src/session/queue.ts#L176-L199`](../../../../packages/agent-acp/src/session/queue.ts#L176-L199) - `startNext` passes the entry's attachments to `begin`, so the turn a queued message becomes carries them.
- `packages/agent-acp/test/fixtures/acp-server.mjs` - the `blocks` script reports a resource block's own text after its URI. A test reads the words a client sent for a file, rather than only which file it named.

## Verified

- `pnpm build`, `pnpm typecheck` and `pnpm boundary` all clean.
- `npx vitest run` from the root - **244 files, 4254 tests, all passing**, none skipped. Two runs of the same suite each lost one unrelated case to the box's load. One was an `ENOTEMPTY` while a test removed its own scratch folder. The other was a five-second timeout in `computer-needs.test.ts`. Each file passes alone, and the suite passes whole with `--maxWorkers=4`.
- The plan's checklist. `agent-acp-blocks.test.ts` attaches a 6 MB file, a FIFO and `/dev/zero`. It reads the prompt naming all three by path, with that text as the whole assertion. It also queues a message with a pasted image, and reads the image block in the prompt of the turn that message became.
- Three negative checks, run by hand. With `startNext` passing nothing again, the queued case fails on the image block. With the entry's message stripped of attachments, it fails on the echo. With `blocksFor` sending the part's fenced text again, the resource case fails on the fence and the line header.
- `packages/sdk/test/attachments.test.ts` - 14 cases, one new: a part from an attachment carries its label, and its URI where the attachment has one. Where the helper read a file, it carries that file's own text as well. Two cases now assert that a part with no file behind it carries no text.
- `packages/agent-acp/test/agent-acp-blocks.test.ts` - 9 cases, three of them new. The embedded resource case reads the raw file text, with the file's own trailing newline and nothing added.

## Departures from the plan

- Task 01 step 3, and the fork the plan's second table records. A part from an attachment that never reached a file goes as text, not as an embedded `resource`. A resource block needs a URI, and one made up here names nothing an agent can open. So acp 10's case `sends a pasted file as an embedded resource to a server that takes context` became two - `sends a file the host wrote as an embedded resource to a server that takes context`, whose URI is the file the host wrote, and `inlines an attachment that never reached a file, which names no resource`.
- An embedded `resource` block carries the file's own text, and not the helper's fenced copy of it. ACP's `TextResourceContents.text` is the resource's own contents, which is what acp 10 sent. The fence and the line header only label a text part for reading. So a part the helper read out of a file keeps that text on its source, and `blocksFor` sends it. Softov asked for this in review on 2026-10-07: "Fix raw text, then merge".
- Three more of acp 10's cases moved, because the words are the helper's now rather than this bridge's. `names the image in the text for a server that does not take them` and `names what the server cannot take rather than dropping it` read the one reference block. `reads a file the client named by URI, through the host's own store` became `names a file the client gave by URI, and does not read it`, which watches the store's `read` and finds it was never called. `sends an image as an image block to a server that takes images` and `sends the directories beside the working one only to a server that advertised them` are unchanged.
- The two tasks are `implemented`, not `done`, and the plan is left `planned`. Nothing here is committed, and the plan still awaits its close.

## Left for later

- The other backends' queues still drop a queued message's attachments. They take the attachments parameter in their own plans: claude 20, pi 15, plugin 36.
- An ACP session has no `steer`, so a message cannot be put into a running ACP turn at all. Nothing here changes that, and the plan did not name it.

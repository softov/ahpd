---
title: Icons stay small at a hundred connectors
created: 2026-11-05
refs:
  - git://87f04753 - the commit of ahpd the facts were checked at
  - git://e1745880 - the last commit of main before #242, which holds the Activepieces mark table
  - git://1ea68fcb - MayCXC's commit that removed the mark table, so each piece reads its own logo up to 256 KB
  - "[code://packages/activepieces/src/logos.ts#L119](../../packages/activepieces/src/logos.ts#L119) - `logoOf`, which reads a piece's logo and sends it as a `data:` URI"
  - "[code://packages/sdk/src/connectors/adapters.ts#L54-L79](../../packages/sdk/src/connectors/adapters.ts#L54-L79) - an adapter row carries its icons, or its plugin's, inline"
  - "[code://packages/server/src/icons.ts](../../packages/server/src/icons.ts) - the host's icon rules, and the `mark:` source it resolves from `packages/server/icons/`"
  - https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/common/state.ts - `Icon.src`, an `https:` URL or a `data:` URI
---

# Icons stay small at a hundred connectors

Softov wants the host marks kept for later use, because a hundred or more connectors with their own logos will be a problem. Each adapter row carries its icon inline as a `data:` URI, and every client receives every row. At 48 to 77 KB a logo, a hundred adapters is several megabytes in one list.

## What others do

The protocol's `Icon.src` is an `https:` URL or a `data:` URI. A client that receives a URL fetches the image itself, and the protocol asks it to trust only its own domain or a trusted one.

VS Code reads a remote image up to 256 KB. The draft #244 makes ahpd's host follow that bound.

## What ahpd has today

- An adapter row carries its icons inline, or its plugin's when it has none.
- The host turns a file, an `https:` URL and a `mark:` source into a `data:` URI at load. A client never contacts the server a plugin names.
- The host ships 22 marks in `packages/server/icons/`, 92 KB in all, with a dark variant for some.
- Until #242, the Activepieces plugin sent `mark:<name>` for GitHub, Jira, Linear, Resend and WhatsApp, and fetched no CDN logo for them.
- Since #242, each piece fetches its own logo and keeps it in `<configDir>/activepieces/icons/`.
- The host keeps an icon of up to 32 KB. The draft #244 raises it to 256 KB of image.

## Who writes

- MayCXC's fork writes `packages/activepieces`. His `1ea68fcb` removed the mark table to show each piece's own logo, as Activepieces does.
- The host's icon rules are in `packages/server/src/icons.ts`. Nothing else writes them.
- ahpw draws the adapter and plugin lists.

## The change

- To be decided. These are the ways the brief records.
- A piece whose logo has a host mark sends the mark, as before #242.
- The host serves each icon once at a URL of its own, and a row carries that URL in place of the bytes.
- A list sends each distinct icon once, and a row names it.

## Open points

- Which of the three ways, or which mix, and at how many connectors it is needed.
- Whether a mark wins over a piece's own logo, or only stands in when the logo is too large.
- Whether a client can reach a URL the host serves on every transport, a tunnel and a remote machine included.

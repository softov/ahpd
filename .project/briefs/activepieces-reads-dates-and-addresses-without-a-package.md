---
title: Activepieces reads dates and addresses without a package
created: 2026-11-05
refs:
  - git://03259190 - origin/main, the commit the facts were checked at; packages/activepieces is the same at main ad89aa2d
  - git://2dbb6e5a - MayCXC's commit that added dayjs and ipaddr.js
  - git://81f1d0a1 - the last commit before MayCXC's activepieces work, with no dayjs or ipaddr.js
  - "[code://packages/activepieces/package.json#L75-L76](../../packages/activepieces/package.json#L75-L76) - the two dependencies"
  - "[code://packages/activepieces/src/props.ts#L2-L4](../../packages/activepieces/src/props.ts#L2-L4) - the dayjs imports"
  - "[code://packages/activepieces/src/props.ts#L258-L269](../../packages/activepieces/src/props.ts#L258-L269) - dateTimeProcessor, the one use of dayjs"
  - "[code://packages/activepieces/src/guard.ts#L4-L68](../../packages/activepieces/src/guard.ts#L4-L68) - isBlockedIp and its helpers, the one use of ipaddr.js"
  - "[code://packages/activepieces/src/fetch.ts#L233](../../packages/activepieces/src/fetch.ts#L233) - the logo fetch, the second caller of isBlockedIp"
  - "[code://packages/activepieces/test/guard.test.ts#L15-L60](../../packages/activepieces/test/guard.test.ts#L15-L60) - the classifier cases the change must keep"
  - https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/core/utils/src/lib/ssrf-ip-classifier.ts - Activepieces' classifier, which uses ipaddr.js
  - https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/engine/src/lib/variables/props-processor.ts - Activepieces' props processor, whose date processor uses dayjs
  - npm://dayjs@1.11.9 - REGEX_PARSE in esm/constant.js, parseDate in esm/index.js, d.tz in esm/plugin/timezone/index.js
  - npm://ipaddr.js@2.3.0 - SpecialRanges for IPv4 and IPv6, and the deprecatedTransitional parse rule, in lib/ipaddr.js
  - https://nodejs.org/api/net.html#class-netblocklist - net.BlockList, the built-in subnet check
---

# Activepieces reads dates and addresses without a package

Softov wants the Activepieces plugin to drop the `dayjs` and `ipaddr.js` dependencies that MayCXC added in `2dbb6e5a`.
Each one serves one function, and a few lines of built-in code can do the same work.
The behaviour stays the same: the same dates come out, and the same addresses are blocked.

## What others do

- Activepieces uses `dayjs` in its engine's date processor and `ipaddr.js` in its SSRF classifier, at `0a2f7057`. The plugin ports both, so it took both packages.
- Node has `net.BlockList`, which checks an address against IPv4 and IPv6 subnets. It reads an IPv4-mapped IPv6 address such as `::ffff:127.0.0.1` against IPv4 rules (checked on Node 24.19).
- The plugin had its own address check before MayCXC's work, in `fetch.ts` at `81f1d0a1` (`refusedV4`, `groupsOf`), with no dependency.

## What the plugin has today

### dayjs

- [`code://packages/activepieces/src/props.ts#L262-L269`](../../packages/activepieces/src/props.ts#L262-L269) is the only use: `dayjs.tz(value, 'UTC').toISOString()`, with any throw read as no value.
- For a string, `dayjs.tz` parses with `utc: true` and the UTC offset is 0, so the result is what `parseDate` makes in UTC.
- `parseDate` matches a string that does not end in `Z` against `REGEX_PARSE`. On a match, it builds `Date.UTC(year, month - 1 || 0, day || 1, hour || 0, minute || 0, second || 0, ms)`, with `ms` the first three digits of the fraction.
- Every other value goes to `new Date(value)`: a string with `Z` or an offset, a string the regex does not match, and a number.
- An invalid date makes `toISOString` throw, and the processor answers `undefined`.

A port of these rules gave the same output as `dayjs` for 26 inputs, under `TZ=America/Campo_Grande` and `TZ=Asia/Tokyo`.
The inputs held zone-less dates and times, `Z` and offset forms, RFC 2822 text, numbers, `true`, invalid strings and the empty string.
A plain `new Date(value)` is not the same: it reads `2026-11-05T10:00` in the daemon's local time zone.

### ipaddr.js

- [`code://packages/activepieces/src/guard.ts#L63-L68`](../../packages/activepieces/src/guard.ts#L63-L68) `isBlockedIp` is the only use. An address is blocked unless `ipaddr.js` names its range `unicast`, an IPv4-mapped one read as its IPv4.
- The allow list lets an address through when it holds the same string, or a CIDR range of the same family that contains the address.
- A string that is no address is blocked.
- The DNS guard, the socket guard and the logo fetch each hand an address from DNS, or a string that Node's `isIP` takes.

The non-unicast ranges of `ipaddr.js` 2.3.0 are these:

| Family | Ranges |
|---|---|
| IPv4 | `0.0.0.0/8`, `255.255.255.255/32`, `224.0.0.0/4`, `169.254.0.0/16`, `127.0.0.0/8`, `100.64.0.0/10`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `240.0.0.0/4`, `192.175.48.0/24`, `192.31.196.0/24`, `192.52.193.0/24` |
| IPv6 | `::/128`, `fe80::/10`, `ff00::/8`, `::1/128`, `fc00::/7`, `100::/64`, `::ffff:0:0:0/96`, `64:ff9b::/96`, `2002::/16`, `2001::/32`, `2001:2::/48`, `2001:3::/32`, `2001:4:112::/48`, `2620:4f:8000::/48`, `2001:10::/28`, `2001:20::/28`, `2001:30::/28`, `2001::/23`, `2001:db8::/32` |

The IPv6 table leaves out `ipaddr.js`'s `ipv4Mapped` range, `::ffff:0:0/96`, because `isBlockedIp` reads a mapped address as its IPv4 first.
A `net.BlockList` with that range blocks `::ffff:8.8.8.8`, which `isBlockedIp` lets through.

`ipaddr.js` reads the deprecated form `::a.b.c.d` as `::ffff:a.b.c.d`, so `::127.0.0.1` is blocked as `127.0.0.1`.
`net.BlockList` reads `::127.0.0.1` as `::7f00:1`, which is in no range.

A `net.BlockList` port of the table gave the same answer as `ipaddr.js` for 57 of 58 addresses.
The one difference was `::127.0.0.1`, from the parse rule in the previous paragraph.
The allow list's CIDR match gave the same answer for 10 of 10 pairs.

## Who writes

- MayCXC wrote `guard.ts`, `props.ts` and the dependencies. That work is on main through PR #242. No branch of the `maycxc` remote has an unmerged change to `packages/activepieces`.
- The two `maycxc/union-2026-10-30-*` branches have merge commits that name `packages/activepieces`, but no diff to it.
- No local branch or worktree has an unmerged change to `packages/activepieces`.

## The change

- `props.ts` reads a date with a port of `REGEX_PARSE` and `parseDate` in UTC, and writes it with `toISOString`.
- `guard.ts` checks an address with `net.BlockList`, filled from the range table in *What the plugin has today*.
- An IPv6 address of the form `::a.b.c.d` is checked as `a.b.c.d`, as `ipaddr.js` does.
- A zone index, such as `%eth0`, is removed before the check.
- The allow list keeps the exact string match, and checks a CIDR entry with a `net.BlockList` of its own.
- `isBlockedIp` keeps its signature and its answers, so `fetch.ts` and the engine do not change.
- `package.json` and `pnpm-lock.yaml` lose `dayjs` and `ipaddr.js`.
- The comments that cite `ipaddr.js` cite the range table and its source instead.
- The tests keep every case in `guard.test.ts`, and add `::127.0.0.1` and the date cases from the comparison.

## Open points

- `ipaddr.js` reads loose IPv4 forms in an allow list entry: `10.0/8` is `10.0.0.0/8`, `0xa.0.0.0/8` is `10.0.0.0/8`, and `010.0.0.0/8` is `8.0.0.0/8` (octal). The port can take only the dotted form that `isIP` takes, so such an entry matches nothing and blocks more. Or it can port the loose parser. The suggested option is the dotted form only.
- The same loose forms reach `isBlockedIp` itself only from a direct call, because every caller checks with `isIP` or DNS first. The port blocks such a string, where `ipaddr.js` could read `0x08.8.8.8` as `8.8.8.8` and let it through.

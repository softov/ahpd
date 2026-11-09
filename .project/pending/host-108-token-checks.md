---
title: Check a person's token from another computer and the token docs
plans:
  - plans/host/108-a-person-mints-tokens-of-their-own/plan.md
---

# Check a person's token from another computer and the token docs

host/108 is on main (PR 34). A person mints tokens of their own. These checks need a second computer that reaches your daemon on port 37537.

The HTTP API and the model API are on already: your `config-dev.json` sets `httpApi` and `modelApi` to `true`. Step 2's `/v1/models` call needs `modelApi`, because `httpApi` alone no longer serves `/v1`.

## Set up

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

In a second terminal on this computer:

```bash
cd /github/ahpd
ahpd() { node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts "$@" --config-file /home/softov/.config/ahpd/config-dev.json; }
ahpd user add ana --role member
```

The last line adds the person `ana`, whom these checks use. The `member` role holds `proxy:write`.

## A proxy:write token from another computer

1. Mint the token, and keep the secret and the id it prints:

```bash
ahpd token mint --user ana --grant proxy:write --label laptop
```

2. On the second computer, with the secret in place of `<secret>` and in place of `<host>` this computer's address as your `origins` lists it. The daemon refuses a `Host` it does not answer to before it reads the token:

```bash
curl -s http://<host>:37537/v1/models -H 'Authorization: Bearer <secret>' | head -c 500
curl -s http://<host>:37537/api/status -H 'Authorization: Bearer <secret>'
```

3. Check that the first call lists model names, and that the second is refused.
4. Remove the token, with its id in place of `<id>`:

```bash
ahpd token rm <id> --user ana
```

5. Run the `/v1/models` call on the second computer again, and check that it is refused.

## The commands in the docs

1. Run each command in `docs/server/USERS.md`, section "Tokens of their own", with the `ahpd` of *Set up*.
2. Check that each output matches the docs.
3. Run `ahpd token list`, and check that it shows the id, the label, the grants, the date and the expiry, and no secret.
4. Do the same for the example in `docs/server/PROXY.md`, section "Who may call".

## Reply

Write "pass" for each section, or what you saw.

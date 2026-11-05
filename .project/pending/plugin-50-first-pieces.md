---
title: Check each Activepieces piece with a real account
plans:
  - plans/plugin/50-a-connector-plugin-runs-activepieces-pieces/plan.md
---

# Check each Activepieces piece with a real account

plugin/50 is on main. It ships fourteen pieces as adapters, and its tests load each piece. Each check below needs a real account of that service. Do the sections you have accounts for.

## Set up

Your `config-dev.json` names the fourteen pieces in the activepieces options, and `@activepieces/piece-postgres` as well.

1. Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

2. Check that the daemon's terminal shows no piece error, and that ahpw's connectors page offers an `ap-` adapter for each piece.

## Resend

1. Make a connector `mail` of `ap-resend`, with `secret_text` set to a Resend key that may send from a verified domain.
2. Bind `mail` to a bot, or to the session config key the session reads.
3. In a session, call `ap_resend_send_email` with `from`, `to`, `subject` and `content`.
4. Check that the mail arrives, and that the call answers the piece's id.

## Telegram

1. Make a connector `tg` of `ap-telegram-bot`, with `secret_text` set to a bot token from BotFather.
2. Send the bot one message, so that the chat exists.
3. In a session, call `ap_telegram_bot_send_text_message` with `chat_id` and `message`.
4. Check that the message arrives in the chat.

## Slack

1. Make a connector `work` of `ap-slack`, with `botToken` and `userToken` from a Slack app installed in the workspace.
2. Check that the app holds the `chat:write` scope, and that the bot is in the channel.
3. In a session, call `ap_slack_send_channel_message` with `channel` set to the channel id and `text` set to one line.
4. Check that the message arrives in the channel.

## The other pieces

For each piece, make one connector with the fields in the README table, bind it to a session, and call the action named.
The action reads and changes nothing, except for the three that send.
Check that the answer holds the data the account has, and no secret value.

| Piece | Connector | Action and its inputs |
| --- | --- | --- |
| GitHub | a GitHub App installed on one repository | `find_user` with `username` |
| Linear | a personal API key | `linear_viewer_get` |
| Jira Cloud | the site URL, an email and an API token | `get_current_user` |
| Discord | a bot token, with the bot in one server | `discord_find_channel` with `guild_id` and `name` |
| WhatsApp Business | an access token and the business account id | `sendMessage` with `phone_number_id`, `to` and `text`, to a test number |
| Notion | an internal integration token, shared with one page | `notion_search` with `query` |
| Airtable | a personal access token with access to one base | `airtable_find_base` with `baseName` |
| SMTP | a mail server's host, port, TLS, email and password | `send-email` to your own address |
| SendGrid | an API key that may send from a verified sender | `send_email` to your own address |
| Stripe | a test-mode secret key | `search_customer` with `email` |
| HubSpot | a private app access token | `get-contact` with `contactId` |

## A wrong key

1. Change the Resend connector's `secret_text` to a key that is not valid.
2. Call `ap_resend_send_email` again, and check that the answer is the piece's message about the key.
3. Check that the daemon log and the answer hold no key value.

## Reply

Write "pass" for each section, or what you saw.

---
title: Check that a browser gets a push
plans:
  - plans/plugin/20261031-0804-a-browser-gets-a-push/plan.md
---

# Check that a browser gets a push

plugin/20261031-0804 is on main. A browser subscribes with the host's VAPID key. The host keeps the subscription as a device under `push://devices`. ahpw main subscribes with its command "Notify me when this tab is closed".

## Set up

```bash
source <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) agent-claude push
ahpd plugin install @ahpd/web@next && ahpd restart
```

Open http://127.0.0.1:39200/plugins/web/ in Chrome, and sign in with `check-token`.

## Steps

1. In ahpw, run the command "Notify me when this tab is closed", and allow notifications.
2. Check that `push://devices` shows the device:

```bash
rpc resourceList '{"channel":"ahp-root://","uri":"push://devices"}'
```

3. Start a session in ahpw, and leave a request waiting. Close the Chrome tab. Expect a notification, and a click that opens that session. The test daemon has no users file, so a browser with the default audience hears every session. Run "Notify me only about sessions started on this device". Start a session from ahpc, and expect no notification for it. Run "Notify me about all my sessions" to go back.
4. Close the tab again, then finish a turn. Expect `Session: <title>` with `Completed in work.`
5. Do steps 1 to 4 in Firefox.
6. Run the command "Stop notifications when this tab is closed". Send again, and expect the device to leave `push://devices`.

## The Apple question

1. Open ahpw in Safari on macOS, and run "Notify me when this tab is closed".
2. Make a notification, and read `~/ahpd-check/config/ahpd/daemon.log`. Expect a delivery, or a 403 that names the `sub` claim.
3. If Apple refuses it, the plugin's `contact` option needs a default. Say so in the reply.

## Reply

- Write "pass", or what went wrong at which step, and the log line Safari's push service gave.
- Stop the test daemon with `ahpd stop`.

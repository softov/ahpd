# @ahpd/activepieces

<!--@include: ../../packages/activepieces/README.md{2,}-->

## How a session binds a connector

A session names the connectors it may use in the `connectors` key of its config. A bot names the same map in its `connectors` field:

```json
{ "connectors": { "work": "connectors://ap-resend/mail" } }
```

That session has the tool `ap_resend_send_email` with no `connector` argument, because the alias says whose account the call uses. With two bindings of one adapter, the tool takes a `connector` argument that names one alias. [PLUGINS.md](PLUGINS.md#an-action-offered-as-a-tool) says how a tool is named, offered and checked.

## Each piece shows its logo

Each piece becomes an adapter, and the adapter carries the logo Activepieces publishes for the piece, as Activepieces shows each piece with its own logo. The plugin fetches each logo once, at load, and keeps it at `<configDir>/activepieces/icons/<piece>.<ext>`, with the extension of the image type the CDN sent. A client receives it as a `data:` icon, so a second start makes no fetch. A daemon with no configuration directory to cache in fetches nothing.

A logo is read as VS Code reads a remote image: `https:` on every hop, five redirects followed by hand, ten seconds for the whole read, and its size checked from `content-length` and again as the bytes arrive, up to 256 KB, VS Code's bound for an icon's image. Each hop goes through the guarded fetch a `FILE` value's URL takes, [below](#an-action-that-takes-or-writes-a-file), so a logo URL that resolves into the host's own network is refused. An answer that is not an image, a read that fails and a logo past the bound cost the icon and one line. The adapter is still registered, without it.

The logos are the brands' own marks, and the plugin passes on what Activepieces publishes for each piece. They belong to their owners: a host that shows one is showing the piece, not claiming the mark.

## An action that takes or writes a file

An action with a `FILE` prop is offered with that prop as a string. The value is one of three things: an `https:` URL, a `data:` URI, or the name of a file in the session's attachments folder, which stands for Activepieces' upload. The engine turns it into the file the piece reads before the action runs, as Activepieces' engine does. A base64 `data:` URI is decoded and named `unknown.<ext>` by the engine's table of media types, `bin` for a type the table lacks. A URL, and a `data:` URI that is not base64, is read and named by its `Content-Disposition`, else by the last segment of its path when that holds a dot, else `unknown.<ext>` by its media type; such a `data:` URI is decoded as the engine's `fetch` decodes one. An attachment is resolved inside the folder, by its name or by its absolute path there. A prop the piece declares `streaming` is given a body to read, and any other the whole file.

A URL is read by the guarded fetch, and only `https:` is read. The name is resolved once, and the URL is refused when any address it answers on is loopback, link-local, private, shared, benchmarking, multicast, reserved or unspecified, in IPv4 or IPv6. An IPv4 address written as IPv6 is read as the IPv4 address it holds. Each redirect is checked again the same way, and the request goes to the address that was checked. A URL is read only up to 32 MB, the size the host reads an attachment to, and a request that has not answered in 30 seconds is ended. The whole answer is read into memory, a streaming prop's body included. A refusal names only the URL's host, and a refused URL is no file. A `data:` URI and an attachment have no limit of their own.

A value that names no file, a URL that answers no success, and a name that leaves the folder or names nothing in it are no file. The engine's validator then refuses a required prop in its words: `Expected file url or base64 with mimeType, received: <value>`. The `FILE` props of each item of an array are made the same way.

A piece that calls `files.write` or `files.upload` puts the file in the session's attachments folder, under the name it asked for, as the engine's file uploader takes one: its data a `Buffer` or a `Readable`, and at most 25 MB, Activepieces' default `AP_MAX_FILE_SIZE_MB`. Anything else is refused in the engine's words, a larger file with `File size is larger than maximum supported size`. A name longer than 80 characters is cut, and its extension is kept. A name of a file already there gets a number before its extension, and an existing file is never replaced. `write` answers the file's name, and `upload` answers it as its `id` and its `url`: the name is what a later `FILE` value takes, as a later step takes Activepieces' file URL. The written file goes when the session goes, like every other attachment. A call on a session with no folder refuses the write, and a `FILE` value that names an attachment is no file there.

## A connector's store

A piece's `store` keeps its values on disk, one file to a connector in `<configDir>/activepieces/stores/`, so a value outlives the engine and the daemon, as Activepieces keeps a piece's store past its run. A connector stands for Activepieces' project: a value put in the `PROJECT` scope is the connector's, and one put in the `FLOW` scope, the default, is kept under the flow the call runs in, so the two scopes never meet. A key is at most 128 characters and a value at most 512 KB as JSON, Activepieces' limits, each refused in its words.

## An action's input

A call's input is made as Activepieces makes a single action run's, before the action runs. A key the action has no prop for refuses the call, with the prop the key most likely meant and the action's props listed. A required prop with no value, and a value a static dropdown does not list, refuse it too: `Cannot run action: Missing required inputs: ...` and `Invalid option values: ...`, each in Activepieces' words. An empty object or list given for a prop of the other shape is made the prop's own, and an optional list, dynamic prop or checkbox the call leaves out is filled, a checkbox with its default.

Then each value is made its prop's type, as the engine's processors make it: a number from its text, a checkbox from `"true"`, an object or a JSON value from its text, a time as ISO 8601 in UTC, a multi-select's one value as a list, and text from anything else. A value its prop's validator refuses refuses the call, with the engine's JSON of every prop that failed, such as `{ "count": ["Expected number, received: many"] }`.

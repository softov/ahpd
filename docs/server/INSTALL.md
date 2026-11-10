# Install

## Install

::: code-group

```bash [Linux, macOS]
curl -fsSL https://ahpio.com/ahpd/install.sh | bash
```

```powershell [Windows]
irm https://ahpio.com/ahpd/install.ps1 | iex
```

:::

To run it in a container instead, with no Node on the machine, see [Docker](DOCKER.md).

The script checks for Node 22.18 or newer, installs `@ahpd/server` without sudo, adds `ahpd` to your PATH, and runs `ahpd configure` when a terminal is open. That asks for the backends and the web UI, and installs what you answer for. On Linux and macOS the PATH line goes into your shell's rc file and its login file (`~/.bashrc` and `~/.profile` for bash, `~/.zshrc` and `~/.zprofile` for zsh), so desktop apps such as ahp-desk find `ahpd` from your next login. Read [install.sh](https://ahpio.com/ahpd/install.sh) or [install.ps1](https://ahpio.com/ahpd/install.ps1) before you pipe it.

The script looks for an installed `ahpd` first. When it finds one, it prints the version and the folder it is in, and asks before it updates it there. The update goes into the npm prefix that holds that `ahpd`, and a folder that is not writable stops it. An `ahpd` that is already the newest version is left alone. After the update, the script fails unless `ahpd --version` prints the new version. An old `ahpd` earlier on the PATH is what made an install look done. Without a terminal, pass `--yes` (`-Yes` on PowerShell, `AHPD_YES=1`) to update, since there is nobody to ask.

## Flags

A pipe cannot pass a flag to `install.sh` except after `bash -s --`, and it cannot pass a parameter to `install.ps1` at all. Every flag also reads an `AHPD_*` environment variable, and on PowerShell the block form passes a parameter.

| `install.sh` | `install.ps1` | Environment | What it does |
| --- | --- | --- | --- |
| `--version <v>` | `-Version <v>` | `AHPD_VERSION` | install this package version, the newest when omitted |
| `--package <p>` | `-Package <p>` | `AHPD_PACKAGE` | install this package, `@ahpd/server` by default |
| `--runtime <r>` | `-Runtime <r>` | `AHPD_RUNTIME` | `node` or `bun` |
| `--yes` | `-Yes` | `AHPD_YES` | update an installed `ahpd` without asking |
| `--no-onboard` | `-NoOnboard` | `AHPD_NO_ONBOARD` | do not run `ahpd configure` |
| `--dry-run` | `-DryRun` | `AHPD_DRY_RUN` | print each step and change nothing |
| `--verbose` | `-Verbose` | `AHPD_VERBOSE` | print each command before it runs |
| `--help` | `-Help` | `AHPD_HELP` | print the help |
| `--uninstall` | `-Uninstall` | `AHPD_UNINSTALL` | remove the package and the PATH line |
| `--purge` | `-Purge` | `AHPD_PURGE` | with `--uninstall`, remove the configuration |

```bash
curl -fsSL https://ahpio.com/ahpd/install.sh | bash -s -- --no-onboard
```

```powershell
& ([scriptblock]::Create((irm https://ahpio.com/ahpd/install.ps1))) -NoOnboard
```

## By hand

```bash
npm i -g @ahpd/server --allow-scripts=node-pty
```

This installs the `ahpd` command. It has no backend of its own: add one with [`ahpd configure`](CONFIGURE.md#first-setup) or [`ahpd plugin install`](PLUGINS.md).

::: tip node-pty
npm 12 skips install scripts by default. `node-pty` needs its script to build the terminal binding. Allow it once for every install:

```bash
npm config set allow-scripts=node-pty --location=user
```

Without it, terminals fall back to pipes (`isPty: false`). On Bun the terminal is Bun's own and `node-pty` is never loaded, so the script makes no difference there.
:::

## Runtimes

ahpd runs on Node, Bun and Deno. The first line of output names the runtime.

::: code-group

```bash [Node]
ahpd
```

```bash [Bun]
bun "$(npm root -g)/@ahpd/server/dist/main.js"
```

```bash [Deno]
deno run -A "$(npm root -g)/@ahpd/server/dist/main.js"
```

:::

Node needs the optional `ws` dependency, which npm installs. Bun and Deno use their built-in servers.

A terminal is a pseudoterminal on Node and Deno where `node-pty` loads, and on Bun through Bun's own: from 1.3.5 on Linux and macOS, and from 1.3.14 on Windows. Anywhere else it runs on pipes. See [TERMINALS.md](../sdk/TERMINALS.md#pipes-or-a-pseudoterminal).

Before they install, `install.sh` and `install.ps1` print one line for each of Node, Bun and Deno: the version, and whether ahpd runs on it.

## Uninstall

```bash
curl -fsSL https://ahpio.com/ahpd/install.sh | bash -s -- --uninstall
```

On PowerShell:

```powershell
& ([scriptblock]::Create((irm https://ahpio.com/ahpd/install.ps1))) -Uninstall
```

The script removes the service if one is installed, stops a daemon that still runs, uninstalls `@ahpd/server` from the npm prefix that holds it, and removes the PATH lines it wrote, under any shell. The npm prefix stays, and so does the configuration folder with the plugins in it. Add `--purge` (`-Purge` on PowerShell) to remove `~/.config/ahpd` too.

By hand, in this order:

1. `ahpd service uninstall`, when a service manager starts the daemon.
2. `ahpd stop`, when a daemon still runs.
3. `npm uninstall -g @ahpd/server`.
4. Remove the line the install added to your shell's startup file. It is the line under `# added by the ahpd install script`.
5. On Windows, remove the npm global folder from your user PATH.
6. Remove `~/.config/ahpd` only if you want the configuration gone.

## From a checkout

```bash
pnpm install && pnpm build
node packages/server/dist/main.js --help
```

Use `node packages/server/dist/main.js` wherever these pages say `ahpd`. To work on ahpd itself, see [DEVELOPER.md](../../DEVELOPER.md).

To move to a newer version, see [Upgrade](UPGRADE.md).

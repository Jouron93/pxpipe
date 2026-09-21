# Repository-local Warp launchers on Windows

These PowerShell wrappers invoke this checkout's absolute
`node_modules\.bin\pxpipe.cmd` path with `warp -- claude` or `warp -- agy`,
forward remaining arguments, and return the launcher's exit code. They do not
use `npx`, download a fallback package, install globally, or change persistent
environment settings. The caller's working directory is preserved.

## Prerequisites

Use PowerShell 7 (`pwsh.exe`), Node.js >= 20.19, and pnpm 10.21.0. Install the
target CLI separately so `claude` or `agy` is resolvable on PATH. From this
checkout, install dependencies and build the current source before launching:

```powershell
Set-Location 'C:\Projects\pxpipe'
pnpm install --frozen-lockfile
pnpm run build
pwsh.exe -NoProfile -File 'C:\Projects\pxpipe\scripts\windows\setup-local-bin.ps1'
```

Installing dependencies does not guarantee that a package's own executable is
linked into its local `node_modules\.bin`. The setup script explicitly creates
that local Windows shim, pointing at this repository's `bin\cli.js`, which loads
`dist\node.js`. It requires an existing build and refuses to overwrite a
different shim. It is safe to rerun when its own shim already exists. Rebuild
after source changes; recreate the shim after replacing `node_modules`.

## One-line launch commands

From any working directory:

```powershell
pwsh.exe -NoProfile -File 'C:\Projects\pxpipe\scripts\windows\warp-claude.ps1'
pwsh.exe -NoProfile -File 'C:\Projects\pxpipe\scripts\windows\warp-agy.ps1'
```

Append CLI arguments after the script path. Version-only smoke tests (no model
request) are:

```powershell
pwsh.exe -NoProfile -File 'C:\Projects\pxpipe\scripts\windows\warp-claude.ps1' --version
pwsh.exe -NoProfile -File 'C:\Projects\pxpipe\scripts\windows\warp-agy.ps1' --version
```

The wrappers do not provision model authentication or require Claude Max.
Interactive model use still requires the target CLI's independently configured
and authorized provider credentials. A version check establishes only that the
launcher can start the installed CLI, not that model routing or billing works.
Keep smoke tests version-only while the Claude Max subscription is paused.

These scripts do not alter scheduled tasks, services, or live proxy configuration.

## Verified on this Windows checkout

The equivalent direct PowerShell commands (no `npx` argument parsing) are:

```powershell
& 'C:\Projects\pxpipe\node_modules\.bin\pxpipe.cmd' warp -- claude
& 'C:\Projects\pxpipe\node_modules\.bin\pxpipe.cmd' warp -- agy
```

Version-only wrapper checks returned Claude Code `2.1.273` and agy `1.2.7`.
Typecheck, build (including version/provenance smoke checks), and 80 Vitest
files / 1,229 tests passed. The Windows regression test exercises a `.cmd`
shim in a path containing spaces, argument quoting, exit-code propagation,
an invalid POSIX `SHELL`, and child-scoped proxy environment overrides.

Warp reported no system root bundle on this machine. Version checks do not
prove TLS connectivity; non-PXPipe HTTPS may need a valid public-root bundle
provided through a process-scoped `SSL_CERT_FILE`. Do not disable TLS checks
or install the Warp CA into a machine/user trust store to work around this.

Default compression scope remains `claude-fable-5,gemini`; Grok stays opt-in
and off. Native Grok usage guidance is in
`C:\Users\auron\.pxpipe\GROK47_USAGE.md`; Grok discovery/config is not changed.
Do not send secrets into image/ref content.

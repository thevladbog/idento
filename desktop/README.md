# Idento Kiosk (Tauri Desktop)

Desktop/kiosk app for Idento: check-in and equipment settings. Runs on Windows, macOS, Linux (x64 and ARM for Raspberry Pi).

## Requirements

- Node.js 22+
- Rust (for Tauri)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Development

Install from the **repo root** (desktop is part of the npm workspace and depends on `@idento/ui`):

```bash
npm install
npm run tauri dev -w idento-desktop
# or: cd desktop && npm run tauri dev
```

Backend and agent must be running separately (e.g. `make dev` from repo root). Set the backend URL in the app (Connection / Server URL) if not using `http://localhost:8008`.

## Build

```bash
npm run build
npm run tauri build
```

Output: `src-tauri/target/release/bundle/` (e.g. `.app`, `.dmg`, `.deb`, `.msi`).

## Bundling the agent (sidecar)

To ship the Idento hardware agent with the app so it starts automatically:

1. Build the agent for your platform and place it in `src-tauri/sidecars/` with the Tauri target triple suffix, e.g.:
   - macOS ARM: `idento-agent-aarch64-apple-darwin`
   - macOS x64: `idento-agent-x86_64-apple-darwin`
   - Linux x64: `idento-agent-x86_64-unknown-linux-gnu`
   - Linux ARM (Raspberry Pi): `idento-agent-aarch64-unknown-linux-gnu`

2. Set in `src-tauri/tauri.conf.json` under `bundle`:
   ```json
   "externalBin": ["sidecars/idento-agent"]
   ```

3. Run `npm run tauri build` again.

Example (from repo root) for current host:

```bash
TARGET=$(rustc -vV | sed -n 's/host: //p')
cd agent && go build -o "../desktop/src-tauri/sidecars/idento-agent-$TARGET" . && cd ..
# Then set externalBin in tauri.conf and run tauri build
```

## Connecting to a standalone agent (external mode)

Instead of bundling the agent, a station can connect to one already running
on another machine (e.g. a headless Raspberry Pi wired to a printer/scanner
-- see `agent/dist/`'s systemd install). In the Equipment step of the
pre-flight wizard, switch "Agent connection" to **External** and enter the
standalone agent's base URL (e.g. `http://192.168.1.50:12345`) and its auth
token (printed by `agent/dist/install.sh` on install, or found in
`~/.idento/agent_config.json` on that machine).

## Self-service mode (unattended stations)

A station can run unattended instead of staffed: on the Mode pre-flight step,
switch "Station type" to **Self-service**. This restricts scan input to
wedge/scanner (no manual code entry -- there's no operator to type a code on
a guest's behalf), shows an idle attract screen between scans, and shows
privacy-safe verdicts (name only, no check-in time/operator detail) that
auto-return to the attract screen on their own, including for a duplicate
scan (staffed mode leaves that one for an operator to dismiss; self-service
has none).

While a self-service station is running, the app window is locked down:
fullscreen, no window decorations, always on top, hidden from the
taskbar/dock, and cannot be closed via the OS's own window controls or quit
shortcuts (including macOS Cmd+Q). To exit, tap the small icon in the
screen's corner and enter a staff QR token -- the same token used for QR
login on the Login pre-flight step. A successful check releases the lockdown
and returns to the Mode step.

**Known gap**: live lockdown behavior (fullscreen actually taking effect,
window-close genuinely blocked on each OS including Cmd+Q, always-on-top
under a real window manager) has been verified against the Tauri API
surface but never exercised on real hardware. Test this on your actual
target device(s) before relying on it for a genuinely unattended
deployment.

## Auto-updates (one-time setup, before the first release)

The desktop app checks for updates against signed release manifests. Before
tagging the first `desktop-v*` release, generate a minisign keypair and wire
it into this repo (**run these yourself** -- not automated):

```bash
# From the repo root, with the Tauri CLI already installed (npm ci first):
npx tauri signer generate -w ~/.tauri/idento-kiosk.key
```

This prints a public key and writes the private key to
`~/.tauri/idento-kiosk.key` (you'll be prompted for a password -- remember
it). Then:

1. Replace `REPLACE_WITH_MINISIGN_PUBLIC_KEY_FROM_tauri_signer_generate` in
   `src-tauri/tauri.conf.json`'s `plugins.updater.pubkey` with the printed
   public key, and commit that change.
2. Set the two GitHub secrets the release workflow reads:
   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/idento-kiosk.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
   # (paste the password you chose above when prompted)
   ```

`bundle.createUpdaterArtifacts` (required for Tauri to emit `.sig` files and
updater metadata) is injected by `.github/workflows/release-desktop.yml`'s
own `--config` patch at build time -- it deliberately does NOT belong in the
committed `src-tauri/tauri.conf.json` above, since PR-time CI builds have no
signing secrets and would fail every desktop-touching PR if it were baked in
there.

Keep `~/.tauri/idento-kiosk.key` somewhere safe outside the repo -- it's
never committed, and losing it means future releases can't be verified as
continuations of past ones (operators would need to manually reinstall).

Update checks happen at app boot and once every 24 hours; the run screen is
never interrupted. An "Update manifest URL (advanced)" field in the Mode
pre-flight step lets a station point at a self-hosted mirror instead of
GitHub Releases, for closed networks -- it must serve the same `latest.json`
format Tauri's updater expects (`file://` paths are not supported; the
mirror needs to be a plain HTTP(S) server).

## Raspberry Pi

- Use a 64-bit OS (e.g. Raspberry Pi OS 64-bit).
- Build for `aarch64-unknown-linux-gnu` (Pi 4/5).
- For serial/USB printers and scanners, add the user to the `dialout` group: `sudo usermod -a -G dialout $USER`.
- To run in kiosk/fullscreen, start the app with the window maximized or use your OS’s kiosk mode.

## Backend URL

Configure the Idento backend URL in the app (Connection screen or link from login). Example for a server on the same network: `http://192.168.1.10:8008`.

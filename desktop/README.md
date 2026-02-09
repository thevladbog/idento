# Idento Kiosk (Tauri Desktop)

Desktop/kiosk app for Idento: check-in and equipment settings. Runs on Windows, macOS, Linux (x64 and ARM for Raspberry Pi).

## Requirements

- Node.js 22+
- Rust (for Tauri)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Development

```bash
# From repo root or desktop/
npm install
npm run tauri dev
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

## Raspberry Pi

- Use a 64-bit OS (e.g. Raspberry Pi OS 64-bit).
- Build for `aarch64-unknown-linux-gnu` (Pi 4/5).
- For serial/USB printers and scanners, add the user to the `dialout` group: `sudo usermod -a -G dialout $USER`.
- To run in kiosk/fullscreen, start the app with the window maximized or use your OS’s kiosk mode.

## Backend URL

Configure the Idento backend URL in the app (Connection screen or link from login). Example for a server on the same network: `http://192.168.1.10:8008`.

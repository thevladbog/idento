# Idento Desktop Kiosk – Deployment

The Idento desktop app (Tauri) can run as a kiosk on a dedicated machine or on a Raspberry Pi at the gate.

## Backend URL

Configure the Idento backend URL in the app:

1. Open the app and go to **Connection** (or use the “Server URL” link on the login screen).
2. Enter the backend URL (e.g. `http://192.168.1.10:8008` for a server on the same network).
3. Click **Connect** to verify, then **Save and go to login**.

The URL is stored locally and used for all API calls (login, events, check-in).

## Raspberry Pi

### Requirements

- Raspberry Pi 4 or 5 (64-bit recommended).
- Raspberry Pi OS 64-bit (or another Linux distro with a desktop for the WebView).

### Build for Pi

From a machine that can cross-compile (or on the Pi itself):

```bash
# On the Pi or a Linux ARM64 builder:
cd desktop
npm ci
npm run tauri build
# Output: src-tauri/target/release/bundle/ (e.g. .deb, AppImage)
```

To bundle the hardware agent with the app, build the agent for `aarch64-unknown-linux-gnu`, place it in `desktop/src-tauri/sidecars/idento-agent-aarch64-unknown-linux-gnu`, set `externalBin: ["sidecars/idento-agent"]` in `desktop/src-tauri/tauri.conf.json`, and run `npm run tauri build` again. See [desktop/README.md](../desktop/README.md#bundling-the-agent-sidecar).

### Serial / USB access

For printers and barcode scanners connected via USB/Serial, add the user to the `dialout` group:

```bash
sudo usermod -a -G dialout $USER
# Log out and back in (or reboot)
```

### Autostart (optional)

To run the kiosk at login (Raspberry Pi OS with desktop):

1. Create a desktop entry or a script that launches the app (e.g. `idento-desktop` or path to the built binary).
2. Add it to autostart:
   - **LXDE**: `~/.config/autostart/idento-kiosk.desktop`
   - Content example:
     ```ini
     [Desktop Entry]
     Type=Application
     Name=Idento Kiosk
     Exec=/path/to/idento-desktop
     X-GNOME-Autostart-enabled=true
     ```

### Fullscreen / kiosk mode

- Run the app and maximize the window, or use your OS’s fullscreen/kiosk options.
- To start in fullscreen, you can use a window manager or a wrapper script that maximizes the window after launch.

## Windows / macOS

Build from the `desktop/` directory:

```bash
cd desktop
npm ci
npm run tauri build
```

Install or run the app from the generated bundle (e.g. `.msi` on Windows, `.app` or `.dmg` on macOS).

# Installing Idento (on-prem)

## Prerequisites

- A Linux host with [Docker Engine](https://docs.docker.com/engine/install/) and the Compose v2 plugin installed (`docker compose version` should work — the legacy standalone `docker-compose` v1 binary is not supported).
- Recommended: 2 vCPUs, 2 GB RAM, 10 GB free disk. This is a starting estimate for small-to-medium event volumes, not a hard minimum — `install.sh` warns (does not block) if disk space looks tight.
- Ports 80 and 8008 free on the host (the web UI and the backend API, respectively).

## Install

1. (Optional but recommended) Verify the download against the `SHA256SUMS` file published alongside it on the [Releases page](https://github.com/thevladbog/idento/releases):
   ```bash
   sha256sum -c SHA256SUMS --ignore-missing
   ```
2. Extract the tarball and `cd` into it:
   ```bash
   tar -xzf idento-onprem-vX.Y.Z.tar.gz
   cd idento-onprem-vX.Y.Z   # or wherever you extracted it
   ```
3. Run the installer. It checks Docker/Compose are present, warns about port conflicts or low disk space, and generates a `.env` file with freshly random secrets:
   ```bash
   ./install.sh
   ```
4. Edit `.env` and fill in the values `install.sh` printed as still needed — at minimum `IDENTO_ADMIN_EMAIL`, `IDENTO_ADMIN_PASSWORD`, `PUBLIC_API_URL`, and `CORS_ALLOWED_ORIGINS`. These are never auto-generated: they're specific to you and your server, not something a script can safely guess.
5. Start the stack:
   ```bash
   docker compose up -d
   ```
6. Confirm it's up:
   ```bash
   curl http://localhost:8008/api/instance
   ```
   should return `{"mode":"onprem",...}`.
7. Open the web UI at whatever URL you set `PUBLIC_API_URL`'s host to (port 80), and log in with the `IDENTO_ADMIN_EMAIL`/`IDENTO_ADMIN_PASSWORD` you set in step 4. This account is created automatically on first start against an empty database — it is not created again on later restarts, so the credentials you chose in `.env` are the ones that matter.

## Upgrade

```bash
docker compose pull
docker compose up -d
```

Database migrations run automatically at backend startup — no manual SQL, no downtime beyond the container restart itself. If you set `VERSION` in `.env`, bump it to the new release tag before running `pull` so you upgrade to a specific version rather than tracking `latest`.

## Backup & Restore

```bash
./backup.sh                        # writes backup-YYYYMMDD-HHMMSS.dump in the current directory
./restore.sh backup-20260101-1200.dump   # asks for confirmation before overwriting the live database
```

`restore.sh` automatically stops the `backend` container before restoring (so it can't hold open connections during the restore or read a partially-restored database) and restarts it once the restore completes — expect a brief outage while it does.

Store backup files somewhere outside the host itself (they're plain files — where you copy them afterward is up to you; this repo doesn't provide cloud-storage integration).

## Badge Printing & Scanning

Printing badges and using barcode/QR scanners from a browser goes through a separate small local service, the **print agent** (bundled with the desktop "Idento Kiosk" app, or installed standalone — see the project's `agent/README.md` for installation). The agent only ever talks to your printers/scanners and to whatever browser tab is open on the same machine; it never talks to the on-prem backend directly.

By default, the agent only accepts requests from a browser at `http://localhost:5173`, `http://localhost:5174`, or `http://localhost:3000` (its development defaults). If your on-prem web UI is served from anywhere else — the `PUBLIC_API_URL`-style host/port you set in `.env`, for example — the agent will silently refuse those calls until you tell it to allow that origin too:

```bash
AGENT_ALLOWED_ORIGINS=http://your-host,http://your-host:80 <path-to-agent-binary>
```

(Comma-separated, exact origins — scheme + host + port, no trailing slash. See `agent/README.md` for the config-file equivalent if you're not setting it via environment variable.)

## Troubleshooting

- **Nothing responds after `docker compose up -d`:** check `docker compose logs backend` and `docker compose logs web` for startup errors — a missing/invalid `.env` value is the most common cause (look for a message naming the specific variable).
- **Login page loads but shows no admin account / can't log in:** the admin account is only created once, on a truly empty database. If you already started the stack once before setting `IDENTO_ADMIN_EMAIL`/`PASSWORD` correctly, either fix the values and start over with `docker compose down -v` (destroys all data — only do this before you have real data in the system) or manually create a user (see the project's operator documentation for the super-admin CLI tools).
- **Port already in use:** `install.sh` warns about this in advance where it can detect it, but `docker compose up -d` will also fail with a clear "address already in use" error naming the port — free it or edit the port mapping in `docker-compose.yml`.

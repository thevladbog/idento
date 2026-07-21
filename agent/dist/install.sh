#!/usr/bin/env bash
# Installs the Idento hardware agent as a systemd service on a headless
# Linux box (typically a Raspberry Pi next to a printer/scanner). Run this
# as the user who should own the agent process (NOT root, e.g. `./install.sh`
# or `sudo ./install.sh` -- either works, the target user is detected
# either way). That user is baked into the installed unit and added to
# `dialout` for serial scanner/printer access.
#
# --host 0.0.0.0 in the unit (see idento-agent.service) is required for the
# kiosk app on another machine to reach this agent at all; the agent's own
# bearer-token auth (httpauth.go) is the real access gate, not the bind
# address -- see agent/README.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_SRC="${SCRIPT_DIR}/idento-agent"
BINARY_DEST="/usr/local/bin/idento-agent"
UNIT_SRC="${SCRIPT_DIR}/idento-agent.service"
UNIT_DEST="/etc/systemd/system/idento-agent.service"

INSTALL_USER="${SUDO_USER:-$(whoami)}"
INSTALL_HOME="$(getent passwd "${INSTALL_USER}" | cut -d: -f6)"

if [ ! -f "${BINARY_SRC}" ]; then
  echo "error: ${BINARY_SRC} not found -- run this script from the extracted agent-standalone bundle" >&2
  exit 1
fi
if [ -z "${INSTALL_HOME}" ]; then
  echo "error: could not resolve a home directory for user '${INSTALL_USER}'" >&2
  exit 1
fi

echo "Installing idento-agent for user '${INSTALL_USER}'..."

sudo install -m 0755 "${BINARY_SRC}" "${BINARY_DEST}"
sed "s/__IDENTO_AGENT_USER__/${INSTALL_USER}/" "${UNIT_SRC}" | sudo tee "${UNIT_DEST}" > /dev/null

sudo usermod -a -G dialout "${INSTALL_USER}" || true

sudo systemctl daemon-reload
sudo systemctl enable --now idento-agent.service

echo ""
echo "idento-agent is now running as a systemd service (idento-agent.service)."
echo "If '${INSTALL_USER}' was just added to the 'dialout' group, log out and back in"
echo "before using a serial scanner (group membership doesn't apply to the current session)."
echo ""
echo "To connect the kiosk app to this agent, use its 'External agent' setting"
echo "(Equipment step) with:"
echo ""

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo "  Base URL: http://${HOST_IP:-<this-machine-ip>}:12345"

CONFIG_FILE="${INSTALL_HOME}/.idento/agent_config.json"
TOKEN=""
for _ in 1 2 3 4 5; do
  if [ -f "${CONFIG_FILE}" ]; then
    TOKEN="$(grep -o '"auth_token"[[:space:]]*:[[:space:]]*"[^"]*"' "${CONFIG_FILE}" | sed 's/.*"\([^"]*\)"$/\1/' || true)"
    [ -n "${TOKEN}" ] && break
  fi
  sleep 1
done
if [ -n "${TOKEN}" ]; then
  echo "  Token: ${TOKEN}"
else
  echo "  Token: (not generated yet -- run 'cat ${CONFIG_FILE}' in a few seconds, or"
  echo "          'curl http://localhost:12345/info' once the service is fully up)"
fi

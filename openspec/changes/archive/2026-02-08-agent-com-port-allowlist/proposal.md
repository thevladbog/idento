## Why

The agent currently opens every detected serial port on startup, which blocks unrelated devices and forces operators to reconfigure on each run. We need predictable, allow-list-based behavior that only opens ports explicitly added for use while still listing available ports for selection.

## What Changes

- Stop auto-opening all serial ports on agent startup; only open ports that were explicitly added and persisted.
- Remove serial/COM auto-discovery and auto-open for printers; keep system printers and network printers only.
- Persist a scanner allow-list in agent config and open only those ports at startup.
- Redefine scanner endpoints: list available ports with metadata, list active scanners, add/remove scanners (allow-list + open/close).
- Update the web equipment settings UI to support keyboard scanner mode and consume port metadata objects instead of string arrays.
- Ensure check-in flow supports keyboard scanners by keeping input focus behavior reliable.

## Capabilities

### New Capabilities
- `scanner-port-management`: Discover serial scanner ports with metadata, persist an allow-list, and open only allowed ports at startup.
- `scanner-input-modes`: Support camera, serial (agent), and keyboard scanner modes in the web UI and check-in flows.

### Modified Capabilities
- (none)

## Impact

- Agent: startup device handling, scanner config persistence, scanner endpoints, and OpenAPI documentation.
- Web: equipment settings UI, agent client types, and scanner mode copy in i18n.
- Runtime behavior: no global COM port locking; only allow-listed serial scanners are opened.

## 1. Agent Configuration And Startup Behavior

- [x] 1.1 Extend `AgentConfig` to persist `scanner_ports` allow-list with backward-compatible defaults
- [x] 1.2 Load scanner allow-list on startup and open only allow-listed ports
- [x] 1.3 Remove serial/COM printer discovery and auto-open from startup
- [x] 1.4 Log and continue when allow-listed ports fail to open

## 2. Agent Scanner APIs And Port Discovery

- [x] 2.1 Update scanner port discovery to return metadata objects without opening ports
- [x] 2.2 Update `/scanners` to return only active/open scanners
- [x] 2.3 Update `/scanners/add` to add to allow-list and open the port
- [x] 2.4 Add `/scanners/remove` to remove from allow-list and close the port
- [x] 2.5 Update OpenAPI spec to reflect new scanner endpoints and response shapes

## 3. Web Agent Client And Types

- [x] 3.1 Add TypeScript types for scanner port metadata in `agent` client
- [x] 3.2 Update `getAvailablePorts` to return port objects and handle legacy string arrays
- [x] 3.3 Add agent client method for removing scanners

## 4. Equipment Settings UI

- [x] 4.1 Add keyboard scanner mode option and copy in i18n
- [x] 4.2 Render port list using `display_name` fallback to `port_name`
- [x] 4.3 Wire add/remove scanner actions to allow-list endpoints
- [x] 4.4 Ensure keyboard scanner mode bypasses agent port calls

## 5. Check-In Keyboard Scanner Support

- [x] 5.1 Verify check-in input focus behavior supports keyboard-wedge scanners
- [x] 5.2 Add focus management tweaks if needed (focus on mount and on click in fullscreen)

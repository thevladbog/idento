## Purpose

Define how scanner input modes are selected in the web UI and how check-in handles keyboard and serial scanners.

## Requirements

### Requirement: Scanner mode selection includes keyboard mode
The web UI SHALL provide scanner mode options for camera, serial (agent), and keyboard scanners.

#### Scenario: Display scanner modes
- **WHEN** a user opens equipment settings
- **THEN** the UI shows camera, serial/USB, and keyboard scanner modes

### Requirement: Keyboard scanner mode does not call the agent
In keyboard scanner mode, the web UI MUST NOT call agent scanner endpoints and MUST rely on keyboard input only.

#### Scenario: Select keyboard mode
- **WHEN** a user selects keyboard scanner mode
- **THEN** the UI does not attempt to fetch COM ports or add scanners via the agent

### Requirement: Serial scanner mode uses agent port list metadata
In serial scanner mode, the web UI SHALL fetch available port objects and display `display_name` when present, using `port_name` as the value.

#### Scenario: Port metadata rendering
- **WHEN** available ports are returned with `display_name`
- **THEN** the UI displays `display_name` and stores the selected `port_name`

### Requirement: Serial scanner mode supports add and test
In serial scanner mode, the web UI SHALL add the selected port via the agent and allow scanner testing through the existing scan polling flow.

#### Scenario: Add a serial scanner
- **WHEN** a user clicks add for a selected port
- **THEN** the UI calls the agent add endpoint and refreshes the active scanners list

### Requirement: Check-in input remains focusable for keyboard scanners
The check-in interface SHALL keep the primary input focusable to receive keyboard-wedge scanner input.

#### Scenario: Keyboard scanner input
- **WHEN** a keyboard-wedge scanner sends input and presses Enter
- **THEN** the check-in flow processes the input as a search or scan

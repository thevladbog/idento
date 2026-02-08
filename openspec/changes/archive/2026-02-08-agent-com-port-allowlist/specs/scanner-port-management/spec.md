## ADDED Requirements

### Requirement: Discover serial scanner ports without opening them
The agent SHALL provide a port discovery operation that returns available serial/COM ports and MUST NOT open or lock any port during discovery.

#### Scenario: List available ports
- **WHEN** a client requests the available ports list
- **THEN** the agent returns a list of port objects without opening any of the ports

### Requirement: Port metadata includes stable identifiers
The agent SHALL return each port with `port_name` and MAY include optional metadata fields such as `display_name`, `device_type`, `transport`, `vendor_id`, `product_id`, `manufacturer`, `product`, and `serial_number`.

#### Scenario: Metadata fallback
- **WHEN** the OS does not provide metadata for a port
- **THEN** the agent returns the port with `port_name` and omits unavailable fields

### Requirement: Persist scanner allow-list
The agent SHALL persist a scanner allow-list in its configuration storage and reuse it on subsequent startups.

#### Scenario: Load allow-list on startup
- **WHEN** the agent starts and a saved allow-list exists
- **THEN** the agent loads the allow-list before opening any scanner ports

### Requirement: Open only allow-listed scanner ports at startup
The agent SHALL open serial scanner ports only if they are present in the persisted allow-list and MUST NOT open any other serial ports automatically.

#### Scenario: Startup port opening
- **WHEN** the agent starts
- **THEN** it opens only the allow-listed scanner ports and skips all other ports

### Requirement: Manage allow-list via scanner endpoints
The agent SHALL provide endpoints to add and remove scanner ports from the allow-list; add MUST attempt to open the port and remove MUST close the port if open.

#### Scenario: Add scanner port
- **WHEN** a client adds a scanner port via the add endpoint
- **THEN** the agent adds the port to the allow-list and attempts to open it

#### Scenario: Remove scanner port
- **WHEN** a client removes a scanner port via the remove endpoint
- **THEN** the agent removes the port from the allow-list and closes it if open

### Requirement: List active scanners separately from available ports
The agent SHALL expose a list of active scanners that represents currently opened scanner ports.

#### Scenario: Get active scanners
- **WHEN** a client requests the scanners list
- **THEN** the agent returns only scanners that are currently open

### Requirement: Do not auto-open serial printers
The agent SHALL NOT auto-discover or open serial/COM printer ports at startup.

#### Scenario: Startup printer discovery
- **WHEN** the agent starts
- **THEN** it does not open any serial/COM printer ports

### Requirement: Graceful handling of unavailable allow-listed ports
The agent SHALL continue startup if an allow-listed port cannot be opened and MUST log the failure.

#### Scenario: Allow-listed port unavailable
- **WHEN** an allow-listed port is unavailable or busy
- **THEN** the agent logs the error and continues startup without crashing

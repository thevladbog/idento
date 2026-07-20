CREATE TABLE equipment_machines (
    tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    machine_id    uuid NOT NULL,
    hostname      text NOT NULL DEFAULT '',
    agent_version text NOT NULL DEFAULT '',
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, machine_id)
);

CREATE TABLE equipment_devices (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL,
    machine_id     uuid NOT NULL,
    class          text NOT NULL CHECK (class IN ('printer','scanner','camera')),
    kind           text NOT NULL CHECK (kind IN ('system','network','usb_wedge','com')),
    display_name   text NOT NULL,
    config         jsonb NOT NULL DEFAULT '{}',
    is_default     boolean NOT NULL DEFAULT false,
    test_passed_at timestamptz,
    last_seen_at   timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT equipment_devices_default_is_printer
        CHECK (NOT is_default OR class = 'printer'),
    FOREIGN KEY (tenant_id, machine_id)
        REFERENCES equipment_machines (tenant_id, machine_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX equipment_devices_one_default
    ON equipment_devices (tenant_id, machine_id)
    WHERE is_default AND class = 'printer';

CREATE INDEX equipment_devices_by_machine
    ON equipment_devices (tenant_id, machine_id, class, created_at);

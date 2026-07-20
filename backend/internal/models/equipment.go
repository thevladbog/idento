package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// EquipmentMachine is one computer's registry root (P4.3 spec §4.1) —
// identified by the agent's persisted machine_id, scoped per tenant so a
// shared physical machine keeps disjoint registries per organization.
type EquipmentMachine struct {
	TenantID     uuid.UUID `json:"-"`
	MachineID    uuid.UUID `json:"machine_id"`
	Hostname     string    `json:"hostname"`
	AgentVersion string    `json:"agent_version"`
	LastSeenAt   time.Time `json:"last_seen_at"`
	CreatedAt    time.Time `json:"created_at"`
}

// EquipmentDevice is one saved device. Config carries per-kind facts plus
// the stable agent-side identity link (config.agent_name / port_name) —
// display_name is user-renameable and must never be that link.
type EquipmentDevice struct {
	ID           uuid.UUID       `json:"id"`
	TenantID     uuid.UUID       `json:"-"`
	MachineID    uuid.UUID       `json:"-"`
	Class        string          `json:"class"`
	Kind         string          `json:"kind"`
	DisplayName  string          `json:"display_name"`
	Config       json.RawMessage `json:"config"`
	IsDefault    bool            `json:"is_default"`
	TestPassedAt *time.Time      `json:"test_passed_at"`
	LastSeenAt   *time.Time      `json:"last_seen_at"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

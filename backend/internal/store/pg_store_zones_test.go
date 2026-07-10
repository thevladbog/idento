package store

import (
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
)

func strPtr(s string) *string { return &s }

func TestEvaluateZoneAccessRules_NoRulesDefaultAllow(t *testing.T) {
	allowed, _ := evaluateZoneAccessRules("VIP", nil, time.Now())
	if !allowed {
		t.Fatal("expected default allow when zone has no access rules")
	}
}

func TestEvaluateZoneAccessRules_NoCategoryDeniedWhenRulesExist(t *testing.T) {
	rules := []*models.ZoneAccessRule{{ID: uuid.New(), Category: "VIP", Allowed: true}}
	allowed, reason := evaluateZoneAccessRules("", rules, time.Now())
	if allowed {
		t.Fatalf("expected deny for attendee with no category when rules exist, got allowed (reason=%q)", reason)
	}
}

func TestEvaluateZoneAccessRules_CategoryNotInRulesDenied(t *testing.T) {
	rules := []*models.ZoneAccessRule{{ID: uuid.New(), Category: "VIP", Allowed: true}}
	allowed, _ := evaluateZoneAccessRules("Участник", rules, time.Now())
	if allowed {
		t.Fatal("expected deny for a category with no matching rule")
	}
}

func TestEvaluateZoneAccessRules_TimeWindowDeniesAfterCutoff(t *testing.T) {
	// "Участник" allowed only until 14:00.
	rules := []*models.ZoneAccessRule{
		{ID: uuid.New(), Category: "Участник", Allowed: true, TimeTo: strPtr("14:00")},
		{ID: uuid.New(), Category: "VIP", Allowed: true},
	}
	at := time.Date(2026, 7, 10, 15, 0, 0, 0, time.UTC) // 15:00, after cutoff
	allowed, reason := evaluateZoneAccessRules("Участник", rules, at)
	if allowed {
		t.Fatalf("expected deny after 14:00 cutoff, got allowed (reason=%q)", reason)
	}

	allowedVIP, _ := evaluateZoneAccessRules("VIP", rules, at)
	if !allowedVIP {
		t.Fatal("expected VIP (no time bound) to always be allowed")
	}
}

func TestEvaluateZoneAccessRules_TimeWindowAllowsBeforeCutoff(t *testing.T) {
	rules := []*models.ZoneAccessRule{
		{ID: uuid.New(), Category: "Участник", Allowed: true, TimeTo: strPtr("14:00")},
	}
	at := time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC) // 10:00, before cutoff
	allowed, _ := evaluateZoneAccessRules("Участник", rules, at)
	if !allowed {
		t.Fatal("expected allow before the 14:00 cutoff")
	}
}

func TestEvaluateZoneAccessRules_ExplicitlyDeniedCategory(t *testing.T) {
	rules := []*models.ZoneAccessRule{{ID: uuid.New(), Category: "Подрядчик", Allowed: false}}
	allowed, _ := evaluateZoneAccessRules("Подрядчик", rules, time.Now())
	if allowed {
		t.Fatal("expected deny for a category rule with allowed=false")
	}
}

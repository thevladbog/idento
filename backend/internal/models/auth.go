package models

import "github.com/golang-jwt/jwt/v5"

type JWTCustomClaims struct {
	UserID   string `json:"user_id"`
	TenantID string `json:"tenant_id"`
	Role     string `json:"role"`
	// ImpersonatedBy is set only on operator-minted impersonation tokens:
	// the super admin's user id. Its presence marks the session for audit.
	ImpersonatedBy string `json:"imp_by,omitempty"`
	jwt.RegisteredClaims
}

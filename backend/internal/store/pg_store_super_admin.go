package store

import (
	"context"
	"fmt"
	"idento/backend/internal/models"
)

// GetAllUsers returns paginated list of all users with tenant info
func (s *PGStore) GetAllUsers(ctx context.Context, search string, tenantIDFilter string, limit int, offset int) ([]*models.User, int, error) {
	baseQuery := `
		SELECT DISTINCT u.id, u.tenant_id, u.email, u.role, u.is_super_admin, u.created_at, u.updated_at
		FROM users u
		LEFT JOIN user_tenants ut ON u.id = ut.user_id
		WHERE 1=1
	`

	countQuery := `
		SELECT COUNT(DISTINCT u.id)
		FROM users u
		LEFT JOIN user_tenants ut ON u.id = ut.user_id
		WHERE 1=1
	`

	args := []interface{}{}
	argCount := 1

	if search != "" {
		searchFilter := fmt.Sprintf(" AND (u.email ILIKE $%d)", argCount)
		baseQuery += searchFilter
		countQuery += searchFilter
		args = append(args, "%"+search+"%")
		argCount++
	}

	if tenantIDFilter != "" {
		tenantFilter := fmt.Sprintf(" AND (u.tenant_id = $%d OR ut.tenant_id = $%d)", argCount, argCount)
		baseQuery += tenantFilter
		countQuery += tenantFilter
		args = append(args, tenantIDFilter)
		argCount++
	}

	// Get total count
	var total int
	err := s.db.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	// Get paginated results
	baseQuery += fmt.Sprintf(" ORDER BY u.created_at DESC LIMIT $%d OFFSET $%d", argCount, argCount+1)
	args = append(args, limit, offset)

	rows, err := s.db.Query(ctx, baseQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	users := make([]*models.User, 0)
	for rows.Next() {
		var u models.User
		err := rows.Scan(&u.ID, &u.TenantID, &u.Email, &u.Role, &u.IsSuperAdmin, &u.CreatedAt, &u.UpdatedAt)
		if err != nil {
			return nil, 0, err
		}
		users = append(users, &u)
	}

	return users, total, rows.Err()
}

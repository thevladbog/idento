-- Seed data for development/testing
-- Run this after migrations

-- Insert test tenant
INSERT INTO tenants (id, name, created_at, updated_at) 
VALUES 
    ('550e8400-e29b-41d4-a716-446655440000', 'Test Company Ltd', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert test users (password is 'password' hashed with bcrypt cost 10)
-- bcrypt hash: $2a$10$7zrdL/KqT9k1TX9kLSCi8egPvwoHIMKGGGMUtj.2lsFIjiJzwE1ly
WITH seed_users (id, tenant_id, email, password_hash, role) AS (
    VALUES
        ('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', 'admin@test.com', '$2a$10$7zrdL/KqT9k1TX9kLSCi8egPvwoHIMKGGGMUtj.2lsFIjiJzwE1ly', 'admin'),
        ('550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440000', 'manager@test.com', '$2a$10$7zrdL/KqT9k1TX9kLSCi8egPvwoHIMKGGGMUtj.2lsFIjiJzwE1ly', 'manager')
),
upserted_users AS (
    INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at)
    SELECT id, tenant_id, email, password_hash, role, NOW(), NOW()
    FROM seed_users
    ON CONFLICT (email) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        updated_at = NOW()
    RETURNING id, tenant_id, role
)
INSERT INTO user_tenants (user_id, tenant_id, role, joined_at)
SELECT id, tenant_id, role, NOW()
FROM upserted_users
ON CONFLICT (user_id, tenant_id) DO UPDATE
SET role = EXCLUDED.role;

-- Insert test events
INSERT INTO events (id, tenant_id, name, location, start_date, end_date, created_at, updated_at)
VALUES 
    ('550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440000', 'Tech Conference 2025', 'San Francisco Convention Center', '2025-03-15 09:00:00', '2025-03-17 18:00:00', NOW(), NOW()),
    ('550e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440000', 'Annual Meeting 2025', 'Company Headquarters', '2025-04-20 10:00:00', '2025-04-20 16:00:00', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert test print template
INSERT INTO print_templates (id, tenant_id, name, width_mm, height_mm, json_schema, created_at, updated_at)
VALUES 
    ('550e8400-e29b-41d4-a716-446655440020', '550e8400-e29b-41d4-a716-446655440000', 'Standard Badge 80x50mm', 80, 50, 
    '{
        "fields": [
            {"type": "text", "source": "first_name", "x": 10, "y": 10, "fontSize": 24, "fontWeight": "bold"},
            {"type": "text", "source": "last_name", "x": 10, "y": 35, "fontSize": 24, "fontWeight": "bold"},
            {"type": "text", "source": "company", "x": 10, "y": 55, "fontSize": 14},
            {"type": "text", "source": "position", "x": 10, "y": 70, "fontSize": 12},
            {"type": "qrcode", "source": "code", "x": 160, "y": 10, "size": 60}
        ]
    }', 
    NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert test attendees
INSERT INTO attendees (id, event_id, first_name, last_name, email, company, position, code, custom_fields, created_at, updated_at)
VALUES 
    ('550e8400-e29b-41d4-a716-446655440100', '550e8400-e29b-41d4-a716-446655440010', 'Alice', 'Johnson', 'alice@example.com', 'Tech Corp', 'Software Engineer', 'TC2025-001', '{}', NOW(), NOW()),
    ('550e8400-e29b-41d4-a716-446655440101', '550e8400-e29b-41d4-a716-446655440010', 'Bob', 'Smith', 'bob@example.com', 'Dev Solutions', 'CTO', 'TC2025-002', '{}', NOW(), NOW()),
    ('550e8400-e29b-41d4-a716-446655440102', '550e8400-e29b-41d4-a716-446655440010', 'Charlie', 'Brown', 'charlie@example.com', 'Startup Inc', 'Product Manager', 'TC2025-003', '{}', NOW(), NOW()),
    ('550e8400-e29b-41d4-a716-446655440103', '550e8400-e29b-41d4-a716-446655440010', 'Diana', 'Lee', 'diana@example.com', 'Cloud Services', 'DevOps Lead', 'TC2025-004', '{}', NOW(), NOW()),
    ('550e8400-e29b-41d4-a716-446655440104', '550e8400-e29b-41d4-a716-446655440010', 'Eve', 'Martinez', 'eve@example.com', 'AI Labs', 'Data Scientist', 'TC2025-005', '{}', NOW(), NOW()),
    ('550e8400-e29b-41d4-a716-446655440105', '550e8400-e29b-41d4-a716-446655440011', 'Frank', 'Wilson', 'frank@test.com', 'Test Company Ltd', 'Sales Director', 'AM2025-001', '{}', NOW(), NOW()),
    ('550e8400-e29b-41d4-a716-446655440106', '550e8400-e29b-41d4-a716-446655440011', 'Grace', 'Taylor', 'grace@test.com', 'Test Company Ltd', 'Marketing Manager', 'AM2025-002', '{}', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Mark one attendee as checked in
UPDATE attendees SET 
    checkin_status = true, 
    checked_in_at = NOW(),
    updated_at = NOW()
WHERE id = '550e8400-e29b-41d4-a716-446655440100';

SELECT 'Seed data inserted successfully!' as status;

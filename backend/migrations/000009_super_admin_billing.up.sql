-- Добавляем роль super_admin в существующую систему
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE;
CREATE INDEX idx_users_super_admin ON users(is_super_admin) WHERE is_super_admin = TRUE;

-- Тарифные планы
CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    tier VARCHAR(20) NOT NULL, -- free, starter, pro, enterprise, custom
    description TEXT,
    price_monthly DECIMAL(10,2) DEFAULT 0,
    price_yearly DECIMAL(10,2) DEFAULT 0,
    
    -- Лимиты (JSON для гибкости)
    limits JSONB DEFAULT '{}', -- {events_per_month: 10, attendees_per_event: 100, users: 3}
    
    -- Фичи
    features JSONB DEFAULT '{}', -- {custom_branding: true, api_access: true, priority_support: false}
    
    is_active BOOLEAN DEFAULT TRUE,
    is_public BOOLEAN DEFAULT TRUE, -- показывать ли в публичном прайсинге
    sort_order INT DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Подписки организаций
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES subscription_plans(id),
    
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, expired, cancelled, trial
    
    -- Период подписки
    start_date TIMESTAMP NOT NULL DEFAULT NOW(),
    end_date TIMESTAMP,
    trial_end_date TIMESTAMP,
    
    -- Кастомные лимиты (переопределяют план)
    custom_limits JSONB DEFAULT '{}',
    custom_features JSONB DEFAULT '{}',
    
    -- Информация об оплате
    payment_method VARCHAR(50), -- manual, stripe, yandex_kassa
    last_payment_date TIMESTAMP,
    next_billing_date TIMESTAMP,
    
    -- Примечания админа
    admin_notes TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    
    UNIQUE(tenant_id) -- одна активная подписка на организацию
);

-- Логи использования ресурсов
CREATE TABLE IF NOT EXISTS usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    resource_type VARCHAR(50) NOT NULL, -- event, attendee, user, api_call
    resource_id UUID,
    action VARCHAR(50), -- created, deleted, checked_in
    
    quantity INT DEFAULT 1,
    metadata JSONB DEFAULT '{}',
    
    logged_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_tenant ON usage_logs(tenant_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_type ON usage_logs(resource_type, logged_at);

-- Аудит действий super admin
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID NOT NULL REFERENCES users(id),
    
    action VARCHAR(100) NOT NULL, -- update_subscription, change_limits, etc
    target_type VARCHAR(50), -- tenant, user, subscription
    target_id UUID,
    
    changes JSONB, -- до/после изменений
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_type, target_id);

-- Базовые тарифные планы
INSERT INTO subscription_plans (name, slug, tier, description, price_monthly, price_yearly, limits, features) VALUES
('Free', 'free', 'free', 'For small events and testing', 0, 0, 
 '{"events_per_month": 2, "attendees_per_event": 50, "users": 2, "storage_mb": 100}',
 '{"custom_branding": false, "api_access": false, "priority_support": false}'),
 
('Starter', 'starter', 'starter', 'For growing organizations', 29, 290,
 '{"events_per_month": 10, "attendees_per_event": 500, "users": 5, "storage_mb": 1000}',
 '{"custom_branding": true, "api_access": false, "priority_support": false}'),
 
('Professional', 'pro', 'pro', 'For professional event organizers', 99, 990,
 '{"events_per_month": -1, "attendees_per_event": 5000, "users": 20, "storage_mb": 10000}',
 '{"custom_branding": true, "api_access": true, "priority_support": true}'),
 
('Enterprise', 'enterprise', 'enterprise', 'Custom solution for large organizations', 0, 0,
 '{"events_per_month": -1, "attendees_per_event": -1, "users": -1, "storage_mb": -1}',
 '{"custom_branding": true, "api_access": true, "priority_support": true, "dedicated_support": true}')
ON CONFLICT (slug) DO NOTHING;

-- Создаем Free подписки для всех существующих организаций
INSERT INTO subscriptions (tenant_id, plan_id, status, start_date)
SELECT t.id, p.id, 'active', NOW()
FROM tenants t
CROSS JOIN subscription_plans p
WHERE p.slug = 'free'
ON CONFLICT (tenant_id) DO NOTHING;


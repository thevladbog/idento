# Super Admin Panel Setup Guide

## Overview

The Super Admin Panel has been implemented to manage organizations, subscriptions, and billing across the entire Idento platform.

## Features Implemented

### 1. Database Schema
- ✅ Subscription plans table with flexible limits and features
- ✅ Subscriptions table linking organizations to plans
- ✅ Usage logs for tracking resource consumption
- ✅ Admin audit log for tracking super admin actions
- ✅ Super admin flag on users table

### 2. Backend API
- ✅ Super admin middleware for access control
- ✅ Limits checking middleware
- ✅ CRUD endpoints for subscription plans
- ✅ Organization management endpoints
- ✅ Subscription management per organization
- ✅ Usage tracking and statistics
- ✅ Audit log endpoints

### 3. Frontend
- ✅ Super Admin layout with sidebar navigation
- ✅ Dashboard with system overview
- ✅ Organizations list with filtering
- ✅ Organization detail page with subscription management
- ✅ Subscription plans display
- ✅ Audit log viewer
- ✅ Internationalization (EN/RU)

### 4. Limits Integration
- ✅ Automatic limit checking on event creation
- ✅ Automatic limit checking on attendee creation
- ✅ Automatic limit checking on user creation
- ✅ Usage logging for all resource creation

## Setup Instructions

### 1. Apply Database Migration

```bash
cd backend
# Run migration
go run main.go # or use your migration tool
```

The migration will:
- Add `is_super_admin` column to users table
- Create subscription_plans, subscriptions, usage_logs, and admin_audit_log tables
- Insert 4 default plans (Free, Starter, Professional, Enterprise)
- Create Free subscriptions for all existing organizations

### 2. Create a Super Admin User

You need to manually set a user as super admin in the database:

```sql
-- Find your user
SELECT id, email FROM users WHERE email = 'your-email@example.com';

-- Set as super admin
UPDATE users SET is_super_admin = TRUE WHERE id = 'your-user-id';
```

### 3. Start Backend

```bash
cd backend
go run main.go
```

The backend will now have the following new endpoints:

```
/api/super-admin/tenants                    - GET: List all organizations
/api/super-admin/tenants/:id/stats          - GET: Get organization stats
/api/super-admin/tenants/:id/subscription   - PATCH: Update subscription
/api/super-admin/users                      - GET: List all users
/api/super-admin/plans                      - GET/POST: Manage plans
/api/super-admin/plans/:id                  - PUT: Update plan
/api/super-admin/usage/:tenantId            - GET: Usage statistics
/api/super-admin/analytics                  - GET: System analytics
/api/super-admin/audit-log                  - GET: Audit log
```

### 4. Start Frontend

```bash
cd web
npm install  # if needed
npm run dev
```

### 5. Access Super Admin Panel

1. Login with your super admin user
2. Navigate to `/super-admin` in your browser
3. You should see the Super Admin dashboard

## Default Subscription Plans

The migration creates 4 plans:

### Free Plan
- **Price**: $0/month
- **Limits**:
  - Events per month: 2
  - Attendees per event: 50
  - Users: 2
  - Storage: 100 MB
- **Features**: No custom branding, no API access, no priority support

### Starter Plan
- **Price**: $29/month ($290/year)
- **Limits**:
  - Events per month: 10
  - Attendees per event: 500
  - Users: 5
  - Storage: 1 GB
- **Features**: Custom branding enabled

### Professional Plan
- **Price**: $99/month ($990/year)
- **Limits**:
  - Events per month: Unlimited
  - Attendees per event: 5,000
  - Users: 20
  - Storage: 10 GB
- **Features**: Custom branding, API access, priority support

### Enterprise Plan
- **Price**: Custom pricing
- **Limits**: All unlimited
- **Features**: All features + dedicated support

## Using the Super Admin Panel

### Managing Organizations

1. Go to **Organizations** page
2. Filter and search organizations
3. Click "View" to see organization details
4. On the detail page you can:
   - View usage statistics
   - Change subscription plan
   - Set custom limits (JSON format)
   - Add admin notes
   - View organization information

### Custom Limits Example

Override plan limits with custom JSON:

```json
{
  "events_per_month": 100,
  "attendees_per_event": 10000,
  "users": 50
}
```

Use `-1` for unlimited:

```json
{
  "events_per_month": -1,
  "attendees_per_event": -1
}
```

### Limits Enforcement

The system automatically checks limits when:
- Creating events (`events_per_month`)
- Creating attendees (`attendees_per_event`)
- Creating users (`users`)

If a limit is exceeded, the API returns:

```json
{
  "error": "Limit exceeded for events_per_month",
  "current": 5,
  "max": 2,
  "upgrade_required": true,
  "limit_type": "events_per_month"
}
```

### Usage Tracking

All resource creation is automatically logged:
- Event created/deleted
- Attendee created/deleted
- User created

View usage statistics on the organization detail page.

### Audit Log

All super admin actions are logged:
- Subscription updates
- Plan changes
- Custom limit modifications

View the audit log at `/super-admin/audit`.

## Future Enhancements

The architecture is ready for:
1. **Payment Integration**: Stripe/Yandex.Kassa (webhook endpoints)
2. **Self-Service Billing**: User-facing billing page
3. **Automated Renewals**: Cron job for expiring subscriptions
4. **Invoice Generation**: PDF invoices table
5. **Upgrade Dialogs**: Frontend components for limit exceeded scenarios

## Security Notes

- Super admin access is protected by middleware
- All actions require valid JWT token
- Super admin flag is checked on every request
- All actions are logged in audit log
- IP addresses can be whitelisted (optional enhancement)

## Troubleshooting

### Cannot access super admin panel
- Verify `is_super_admin = TRUE` in database
- Check JWT token is valid
- Check browser console for errors

### Limits not working
- Verify migration was applied
- Check subscriptions table has entries
- Verify plan has limits defined
- Check server logs for errors

### Usage not being tracked
- Verify usage_logs table exists
- Check that handlers are calling `LogUsage`
- Verify no database errors in logs

## API Testing

Test super admin endpoints with curl:

```bash
# Get all organizations
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8008/api/super-admin/tenants

# Update subscription
curl -X PATCH \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan_id":"PLAN_UUID","custom_limits":{"events_per_month":100}}' \
  http://localhost:8008/api/super-admin/tenants/TENANT_UUID/subscription
```

## Support

For issues or questions:
1. Check backend logs for errors
2. Check browser console for frontend errors
3. Verify database schema matches migration
4. Ensure user has `is_super_admin = TRUE`


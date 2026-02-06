# Event Zones & Multi-day Support - Implementation Status

## ✅ Completed (Backend Core)

### 1. Database Schema ✅
- **File**: `backend/migrations/011_event_zones.up.sql`
- **Status**: Complete with up and down migrations
- **Tables Created**:
  - `event_zones` - Main zone definitions
  - `zone_access_rules` - Category-based access rules
  - `attendee_zone_access` - Individual access overrides
  - `zone_checkins` - Zone check-in records
  - `staff_zone_assignments` - Staff-zone assignments
- **Attendee Extensions**: Added `packet_delivered`, `registered_at`, `registration_zone_id`

### 2. Backend Models ✅
- **File**: `backend/internal/models/models.go`
- **Models Added**:
  - `EventZone` - Zone configuration
  - `ZoneAccessRule` - Access rules
  - `AttendeeZoneAccess` - Individual overrides
  - `ZoneCheckin` - Check-in records
  - `StaffZoneAssignment` - Staff assignments
  - `EventZoneWithStats` - Enhanced zone with statistics
  - `ZoneCheckInRequest/Response` - API models
  - `ZoneQRData` - QR code data structure
  - `MovementHistoryEntry` - Movement tracking

### 3. Store Implementation ✅
- **File**: `backend/internal/store/pg_store_zones.go`
- **Methods Implemented** (all from interface):
  - Zone CRUD operations
  - Access rule management (bulk updates supported)
  - Attendee access override management
  - Check-in creation and queries
  - Staff assignment management
  - **Complex Access Validation Logic**: `CheckZoneAccess()` - Priority: Individual > Category > Default

### 4. API Handlers ✅
- **File**: `backend/internal/handler/zones.go`
- **Endpoints Implemented**:
  - Zone Management: CREATE, READ, UPDATE, DELETE
  - Access Rules: CREATE, READ, BULK_UPDATE
  - Individual Access: CREATE, READ, UPDATE, DELETE
  - Staff Assignments: ASSIGN, READ, REMOVE
  - **Zone Check-in**: Full validation flow with time/access/registration checks
  - Movement History: GET attendee zone history
  - QR Code Generation: Generate zone selection QR codes
  - Mobile API: Filtered zones by staff permissions, day calculation

### 5. API Routes Registration ✅
- **File**: `backend/internal/handler/handler.go`
- **Route Groups**:
  - `/api/events/:event_id/zones` - Zone management
  - `/api/zones/:zone_id/access-rules` - Access rules
  - `/api/attendees/:attendee_id/zone-access` - Individual access
  - `/api/zones/:zone_id/staff` - Staff assignments
  - `/api/zones/checkin` - Zone check-in
  - `/api/mobile/events/:event_id/zones` - Mobile filtered zones
  - `/api/attendees/:attendee_id/zone-history` - Movement history

### 6. Internationalization ✅
- **File**: `web/src/i18n.ts`
- **Keys Added** (EN/RU):
  - Zone management (50+ keys)
  - Access control
  - Check-in status messages
  - Movement history
  - Offline mode indicators

## 🔄 Partially Completed

### 7. QR Code Generation (Backend) ✅
- **Endpoint**: `GET /api/zones/:id/qr`
- **Library**: `github.com/skip2/go-qrcode`
- **Status**: Backend complete, web UI integration needed

### 8. Movement History API ✅
- **Endpoint**: `GET /api/attendees/:attendee_id/zone-history`
- **Status**: Backend complete, web UI component needed

## ⏳ Remaining Work (Frontend & Mobile)

### Web Admin Panel Components
These components need to be created:

#### EventZones Management Page
**File to create**: `web/src/pages/event/EventZones.tsx`
**Features**:
- List zones with drag-and-drop reordering
- Create/Edit zone modal with:
  - Name, type (dropdown), order
  - Time constraints (open_time, close_time)
  - Flags: is_registration_zone, requires_registration, is_active
- Delete zone with confirmation
- Zone statistics cards (total check-ins, today's check-ins, assigned staff)
- Integration with event detail pages

#### ZoneAccessRules Component
**File to create**: `web/src/components/ZoneAccessRules.tsx`
**Features**:
- Fetch unique categories from `attendees.custom_fields['category']`
- Table/list with checkboxes for allow/deny
- Bulk update button
- Clear explanation of access priority (Individual > Category > Default)

#### StaffZoneAssignments Component
**File to create**: `web/src/components/StaffZoneAssignments.tsx`
**Features**:
- Staff member dropdown (filtered by role=staff)
- Multi-select zones
- Assign/Remove buttons
- List current assignments with user details

#### AttendeeMovementTimeline Component
**File to create**: `web/src/components/AttendeeMovementTimeline.tsx`
**Features**:
- Vertical timeline showing zone check-ins
- Zone name, type badge, timestamp, day
- "Current Location" badge for most recent
- Empty state handling

#### EventAttendees Category Filter
**File to update**: `web/src/pages/event/EventAttendees.tsx`
**Add**:
- Category dropdown (extract unique values from custom_fields)
- Filter attendees by selected category
- Export filtered list to CSV
- Bulk actions for selected category

### Mobile App (Kotlin Multiplatform)
**Note**: These are significant changes to the mobile app architecture

#### Navigation Update
**Files**:
- `mobile/shared/src/commonMain/kotlin/navigation/Screen.kt`
- Navigation graph updates

**New Screens**:
1. `DaySelectScreen` - Show event days (start_date to end_date)
2. `ZoneSelectScreen` - Show zones filtered by staff assignments
3. Updated `CheckinScreen` - Add zone and day context

#### API Service
**File to update**: `mobile/shared/src/commonMain/kotlin/network/ApiService.kt`
**Add Endpoints**:
```kotlin
@GET("/api/mobile/events/{eventId}/zones")
suspend fun getEventZones(@Path("eventId") eventId: String): List<EventZone>

@POST("/api/zones/checkin")
suspend fun zoneCheckin(@Body request: ZoneCheckInRequest): ZoneCheckInResponse

@GET("/api/attendees/{attendeeId}/zone-history")
suspend fun getZoneHistory(@Path("attendeeId") attendeeId: String): List<MovementHistoryEntry>
```

### Advanced Mobile Features (Optional/Future)

#### Zone QR Scanning
- Scan zone QR code to quickly select zone
- Parse `ZoneQRData` JSON from QR
- Navigate directly to zone check-in

#### Offline Mode
- SQLite database for local storage
- Sync queue for pending check-ins
- Background sync service
- UI indicators (offline banner, pending count)

#### Sync Service
- Periodic sync (every 30s when online)
- Manual sync button
- Retry logic with exponential backoff
- Conflict resolution

## Testing Scenarios

### 1. Zone Creation & Configuration
- [ ] Create Registration zone
- [ ] Create General zone
- [ ] Create VIP zone with time constraints (14:00-18:00)
- [ ] Verify zone ordering

### 2. Access Rules
- [ ] Set VIP zone to only allow category="VIP"
- [ ] Verify general participant blocked from VIP
- [ ] Add individual override to allow specific participant
- [ ] Verify override takes precedence

### 3. Staff Assignment
- [ ] Assign staff member to specific zones
- [ ] Login as staff via mobile
- [ ] Verify only assigned zones visible
- [ ] Verify admin sees all zones

### 4. Check-in Flow
- [ ] Scan participant at Registration zone
- [ ] Verify packet_delivered set
- [ ] Verify registered_at timestamp set
- [ ] Try to check-in at General zone before registration (should fail)
- [ ] Register, then check-in at General zone (should succeed)
- [ ] Check-in again same day (should show "already checked in")
- [ ] Check-in next day (should succeed)

### 5. Time Constraints
- [ ] Try to access zone outside open hours (should fail)
- [ ] Try to access zone within open hours (should succeed)

### 6. Movement History
- [ ] Check-in to multiple zones
- [ ] View movement history
- [ ] Verify chronological order
- [ ] Verify zone names and types displayed

### 7. Multi-day Event
- [ ] Create event with start_date and end_date spanning 3 days
- [ ] Mobile: verify 3 days shown in DaySelect
- [ ] Check-in on Day 1
- [ ] Check-in same zone on Day 2
- [ ] Verify both check-ins recorded separately

### 8. QR Code for Zones
- [ ] Generate QR code for zone in admin panel
- [ ] Download QR as PNG
- [ ] Scan QR in mobile app
- [ ] Verify app navigates to correct zone

### 9. Offline Mode (if implemented)
- [ ] Perform check-in while offline
- [ ] Verify stored locally
- [ ] Go online
- [ ] Verify auto-sync
- [ ] Verify UI indicators

### 10. Edge Cases
- [ ] Delete zone with check-ins (verify cascade)
- [ ] Block attendee, try to check-in (should fail)
- [ ] Inactive zone, try to check-in (should fail)
- [ ] Staff removed from zone, verify mobile updates

## API Endpoints Reference

### Zone Management
```
POST   /api/events/:event_id/zones              Create zone
GET    /api/events/:event_id/zones              List zones (with ?with_stats=true)
GET    /api/zones/:id                           Get single zone
PUT    /api/zones/:id                           Update zone
DELETE /api/zones/:id                           Delete zone
GET    /api/zones/:id/qr                        Get zone QR code (PNG)
```

### Access Rules
```
POST   /api/zones/:zone_id/access-rules         Create access rule
GET    /api/zones/:zone_id/access-rules         List access rules
PUT    /api/zones/:zone_id/access-rules         Bulk update access rules
```

### Individual Access Overrides
```
POST   /api/attendees/:attendee_id/zone-access  Create override
GET    /api/attendees/:attendee_id/zone-access  List overrides
PUT    /api/attendee-zone-access/:id            Update override
DELETE /api/attendee-zone-access/:id            Delete override
```

### Staff Assignments
```
POST   /api/zones/:zone_id/staff                Assign staff
GET    /api/zones/:zone_id/staff                List zone staff
DELETE /api/zones/:zone_id/staff/:user_id       Remove staff
GET    /api/users/:user_id/zones                List user zones
```

### Check-in & History
```
POST   /api/zones/checkin                       Zone check-in
GET    /api/zones/:zone_id/checkins?date=YYYY-MM-DD  List check-ins
GET    /api/attendees/:attendee_id/zone-history      Movement history
```

### Mobile API
```
GET    /api/mobile/events/:event_id/zones       Filtered zones (by staff assignment)
GET    /api/mobile/zones/:zone_id/days          Event days (from start_date to end_date)
```

## Database Queries Reference

### Check Access Priority
```sql
-- 1. Individual override (highest priority)
SELECT allowed FROM attendee_zone_access 
WHERE attendee_id = ? AND zone_id = ?;

-- 2. Category rule (if no individual override)
SELECT allowed FROM zone_access_rules 
WHERE zone_id = ? AND category = ?;

-- 3. Default allow if no rules exist
```

### Zone Statistics
```sql
-- Total check-ins
SELECT COUNT(*) FROM zone_checkins WHERE zone_id = ?;

-- Today's check-ins
SELECT COUNT(*) FROM zone_checkins 
WHERE zone_id = ? AND event_day = CURRENT_DATE;

-- Assigned staff count
SELECT COUNT(*) FROM staff_zone_assignments WHERE zone_id = ?;
```

### Movement History
```sql
SELECT 
  zc.id, zc.checked_in_at, zc.event_day,
  ez.name as zone_name, ez.zone_type
FROM zone_checkins zc
JOIN event_zones ez ON ez.id = zc.zone_id
WHERE zc.attendee_id = ?
ORDER BY zc.checked_in_at DESC;
```

## Dependencies Required

### Backend (already in go.mod):
```go
github.com/skip2/go-qrcode  // QR code generation
github.com/jackc/pgx/v5      // PostgreSQL driver
github.com/google/uuid       // UUID handling
github.com/labstack/echo/v4  // Web framework
```

### Web (needs to be installed):
```json
{
  "dependencies": {
    "react-dnd": "^16.0.1",           // Drag-and-drop for zone reordering
    "react-dnd-html5-backend": "^16.0.1"
  }
}
```

### Mobile (KMP):
```kotlin
// In shared/build.gradle.kts
commonMain.dependencies {
    implementation("com.squareup.sqldelight:runtime:2.0.0")  // Offline storage
    implementation("org.jetbrains.kotlinx:kotlinx-datetime:0.4.0")  // Date handling
}
```

## Implementation Priority

1. **Phase 1 - Core Backend** ✅ COMPLETE
   - Database migration
   - Models
   - Store implementation
   - API handlers
   - Routes

2. **Phase 2 - Essential Web UI** (DO NEXT)
   - EventZones page (basic CRUD)
   - Access rules component
   - Category filter in attendees list
   - Test full flow with Postman/curl

3. **Phase 3 - Mobile Basic Support**
   - API client updates
   - Navigation changes
   - Basic zone check-in

4. **Phase 4 - Enhanced Features**
   - Zone QR codes (web + mobile)
   - Movement history timeline
   - Staff management UI

5. **Phase 5 - Advanced Mobile** (OPTIONAL)
   - Offline mode
   - Sync service
   - Zone QR scanning

## Notes for Developers

### Backend
- All zone operations are tenant-scoped via event ownership
- Access validation follows: Individual Override > Category Rule > Default Allow
- Zone check-ins are unique per (attendee, zone, date) - one check-in per zone per day
- Registration zones automatically set `registered_at` and `packet_delivered`
- Time constraints use HH:MM format (e.g., "14:30")

### Frontend
- Use React Query/SWR for data fetching
- Zone drag-and-drop should update `order_index` via PUT /zones/:id
- Category filter extracts unique values from `attendees[].custom_fields.category`
- QR code display: `<img src={`${API_URL}/api/zones/${zoneId}/qr`} />`

### Mobile
- Filter zones by staff assignments for role=staff
- Show all zones for role=admin/manager
- Day selection: generate days from event.start_date to event.end_date
- Check-in payload: `{ attendee_code, zone_id, event_day }`

### Testing
- Use Postman collection for API testing
- Test access validation thoroughly (individual > category > default)
- Test time constraints at boundary times
- Test multi-day scenarios with different dates
- Test staff permission filtering

## Migration Guide

### Existing Events
- Existing events will have no zones initially
- No disruption to current check-in flow (still works)
- To enable zones for an event:
  1. Create at least one Registration zone
  2. Configure access rules (optional)
  3. Assign staff to zones
  4. Use zone check-in instead of legacy check-in

### Backward Compatibility
- Legacy check-in endpoint still works: `PUT /api/attendees/:id`
- Zone check-in is parallel system: `POST /api/zones/checkin`
- No breaking changes to existing functionality
- `packet_delivered`, `registered_at`, `registration_zone_id` are nullable

## Performance Considerations

### Database
- Indexes created on:
  - `event_zones(event_id, zone_type)`
  - `zone_checkins(zone_id, event_day)`
  - `zone_checkins(attendee_id)`
  - `staff_zone_assignments(user_id, zone_id)`
- Use prepared statements for check-in flow
- Consider materialized view for zone statistics if performance issues

### Mobile
- Cache zone list locally
- Minimize API calls by fetching event zones once per session
- Batch sync operations when going back online
- Use pagination for movement history if >100 records

### Web
- Use React.memo for zone list items
- Debounce category filter input
- Load zone statistics on-demand (not on initial page load)
- Use virtual scrolling for large attendee lists with category filter


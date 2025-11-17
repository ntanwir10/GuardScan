# Test Migrations Locally

Quick guide to test the migrations before applying to production.

## Prerequisites

- Supabase account
- SQL Editor access
- Backend running locally

## Test Checklist

### ✅ Step 1: Create Test Project

1. Go to [supabase.com](https://supabase.com)
2. Create new project: `guardscan-test`
3. Wait for provisioning (~2 min)
4. Save credentials

### ✅ Step 2: Apply Migration 001

1. Open **SQL Editor**
2. Copy entire contents of `migrations/001_core_schema.sql`
3. Paste and click **Run**
4. Look for success message:

   ```
   GuardScan Core Schema Applied
   Tables created: clients, telemetry
   ```

### ✅ Step 3: Verify Tables

Go to **Table Editor** and verify:

- [ ] `clients` table exists
  - Columns: client_id, created_at, last_seen_at, cli_version, metadata
  - 1 row: system client
  
- [ ] `telemetry` table exists
  - Columns: event_id, client_id, repo_id, action_type, duration_ms, model, loc, timestamp, metadata
  - 0 rows (empty)

### ✅ Step 4: Test Indexes

Run in SQL Editor:

```sql
-- Check clients indexes
SELECT indexname FROM pg_indexes 
WHERE tablename = 'clients';

-- Should see:
-- clients_pkey
-- idx_clients_created_at
-- idx_clients_last_seen
-- idx_clients_cli_version
```

```sql
-- Check telemetry indexes
SELECT indexname FROM pg_indexes 
WHERE tablename = 'telemetry';

-- Should see 7 indexes
```

### ✅ Step 5: Apply Migration 002

1. In **SQL Editor**
2. Copy entire contents of `migrations/002_monitoring_and_security.sql`
3. Paste and click **Run**
4. Look for success message:

   ```
   GuardScan Monitoring & Security Applied
   Total tables: 6
   Total views: 3
   Total functions: 2
   ```

### ✅ Step 6: Verify Monitoring Tables

Go to **Table Editor** and verify:

- [ ] `errors` table exists
- [ ] `metrics` table exists
- [ ] `usage_events` table exists
- [ ] `health_checks` table exists

### ✅ Step 7: Verify Views

Run in SQL Editor:

```sql
-- Check views exist
SELECT viewname FROM pg_views 
WHERE schemaname = 'public';

-- Should see:
-- error_summary
-- performance_summary
-- usage_summary
```

### ✅ Step 8: Verify Functions

Run in SQL Editor:

```sql
-- List functions
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_type = 'FUNCTION';

-- Should see:
-- cleanup_old_monitoring_data
-- get_system_health
```

### ✅ Step 9: Test RLS Policies

Run in SQL Editor:

```sql
-- Check policies
SELECT tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename;

-- Should see 6 policies (one per table)
```

### ✅ Step 10: Test Backend Connection

Configure backend:

```bash
cd backend
cat > .dev.vars << 'EOF'
SUPABASE_URL=https://your-test-project.supabase.co
SUPABASE_KEY=your_test_service_role_key
EOF
```

Start backend:

```bash
npm run dev
```

### ✅ Step 11: Send Test Telemetry

```bash
curl -X POST http://localhost:8787/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "test-client-001",
    "repoId": "test-repo-001",
    "events": [{
      "action": "scan",
      "loc": 1000,
      "durationMs": 2500,
      "model": "gpt-4",
      "timestamp": 1700000000000,
      "metadata": {"test": true}
    }],
    "cliVersion": "1.0.0"
  }'
```

Expected: `{"status":"ok"}`

### ✅ Step 12: Verify Data Inserted

In Supabase **Table Editor**:

#### Check clients table:

```sql
SELECT * FROM clients;

-- Should show 2 rows:
-- 1. system (created by migration)
-- 2. test-client-001 (just inserted)
```

#### Check telemetry table:

```sql
SELECT * FROM telemetry;

-- Should show 1 row with:
-- - client_id: test-client-001
-- - repo_id: test-repo-001
-- - action_type: scan
-- - loc: 1000
-- - duration_ms: 2500
```

### ✅ Step 13: Test Monitoring Data

```bash
curl -X POST http://localhost:8787/api/monitoring \
  -H "Content-Type: application/json" \
  -d '{
    "timestamp": "2024-11-17T10:00:00Z",
    "errors": [{
      "errorId": "err-test-001",
      "timestamp": "2024-11-17T10:00:00Z",
      "severity": "medium",
      "message": "Test error",
      "context": {"test": true},
      "environment": {"node": "18"}
    }],
    "metrics": [{
      "metricId": "metric-test-001",
      "timestamp": "2024-11-17T10:00:00Z",
      "name": "test_metric",
      "value": 100,
      "unit": "ms"
    }],
    "usage": [{
      "eventId": "usage-test-001",
      "timestamp": "2024-11-17T10:00:00Z",
      "command": "scan",
      "duration": 2500,
      "success": true,
      "clientId": "test-client-001"
    }]
  }'
```

Expected: `{"success":true,"received":{"errors":1,"metrics":1,"usage":1}}`

### ✅ Step 14: Verify Monitoring Data

```sql
-- Check errors
SELECT * FROM errors;
-- Should show 1 row

-- Check metrics
SELECT * FROM metrics;
-- Should show 1 row

-- Check usage_events
SELECT * FROM usage_events;
-- Should show 1 row
```

### ✅ Step 15: Test Analytics Views

```sql
-- Error summary
SELECT * FROM error_summary;

-- Performance summary
SELECT * FROM performance_summary;

-- Usage summary
SELECT * FROM usage_summary;
```

### ✅ Step 16: Test Functions

```sql
-- Test system health
SELECT * FROM get_system_health();

-- Should return:
-- status, error_rate, avg_response_time, success_rate, active_users
```

```sql
-- Test cleanup (won't delete anything since data is new)
SELECT * FROM cleanup_old_monitoring_data(1);

-- Should return:
-- errors_deleted: 0
-- metrics_deleted: 0
-- usage_deleted: 0
-- health_checks_deleted: 0
```

### ✅ Step 17: Test Rate Limiting

```bash
# Send 105 requests (rate limit is 100/min)
for i in {1..105}; do
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" \
    -X POST http://localhost:8787/api/telemetry \
    -H "Content-Type: application/json" \
    -d '{"clientId":"test-rl","repoId":"test","events":[{"action":"scan","loc":100,"durationMs":1000,"model":"gpt-4","timestamp":1700000000000,"metadata":{}}],"cliVersion":"1.0.0"}'
done
```

Expected:
- Requests 1-100: `200 OK`
- Requests 101-105: `429 Too Many Requests`

### ✅ Step 18: Check RLS Security

Try to access with anon key (should fail):

```bash
# This should be blocked by RLS
curl -X POST https://your-test-project.supabase.co/rest/v1/clients \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"client_id":"hacker","metadata":{}}'

# Expected: 403 Forbidden or similar error
```

## Success Criteria

All steps above should pass:

- [x] Migration 001 applied successfully
- [x] Migration 002 applied successfully
- [x] All 6 tables created
- [x] All 3 views created
- [x] All 2 functions created
- [x] All indexes created
- [x] RLS policies in place
- [x] Backend can insert data
- [x] Data appears in tables
- [x] Views return data
- [x] Functions work
- [x] Rate limiting works
- [x] RLS blocks public access

## If Tests Fail

### Common Issues

**"relation already exists"**
- Tables from old migrations exist
- Solution: Drop all tables first:

  ```sql
  DROP TABLE IF EXISTS 
    clients, telemetry, errors, metrics, 
    usage_events, health_checks 
  CASCADE;
  ```

**"permission denied"**
- Using wrong API key
- Solution: Use service_role key, not anon key

**"column does not exist"**
- Migration didn't complete
- Solution: Re-run migration, check for errors

## Cleanup

After testing, you can:

1. **Keep test project** for staging
2. **Delete test project** if no longer needed
3. **Reset database**: Drop all tables and re-run migrations

## Next Steps

If all tests pass:

1. ✅ Migrations are ready for production
2. Create production Supabase project
3. Apply migrations to production
4. Configure production secrets in Cloudflare
5. Deploy backend to production

---

**Test Status**: ⬜ Not Started | ⏳ In Progress | ✅ Passed | ❌ Failed


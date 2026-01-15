# First Run Instructions

## Database Ready

The panic has been inserted into `panics.db`:

| Field | Value |
|-------|-------|
| panic_location | `core/translate/pragma.rs:331:39` |
| panic_message | PRAGMA integrity_check with zero argument triggers unreachable panic - integrity_check pragma incorrectly treats numeric 0 as a value to set |
| sql_statements | `PRAGMA integrity_check(0)` |
| status | `pending` |

## Setup

1. **Set environment variables** (or update `properties.ts` directly):

   ```bash
   export TURSO_URL="file:panics.db"
   export GITHUB_TOKEN="<your-github-token>"
   ```

   Or edit `properties.ts`:
   ```typescript
   tursoUrl: "file:panics.db",
   githubToken: "<your-github-token>",
   ```

2. **Ensure base repo exists** at `/opt/turso-base` (or update `baseRepoPath` in config)

3. **Ensure AgentFS is available** for sandbox creation

## Run

```bash
# Development mode
npm run dev

# Or build and run
npm run build && npm start
```

## Expected Workflow

```
pending → repo_setup → reproducing → fixing → shipping → pr_open
```

1. **repo_setup**: Creates sandbox, branch, TCL test, context files
2. **reproducing**: Planner analyzes (15 min) → Implementer extends simulator (45 min)
3. **fixing**: Planner analyzes root cause (15 min) → Implementer fixes bug (45 min)
4. **shipping**: Squash commits, push, create draft PR

## Dry Run Mode

To test without pushing/creating PRs, set in `properties.ts`:
```typescript
dryRun: true,
```

## Monitoring

Watch stdout for real-time logs, or query the database:
```bash
sqlite3 panics.db "SELECT status, workflow_error FROM panic_fixes WHERE panic_location = 'core/translate/pragma.rs:331:39';"
sqlite3 panics.db "SELECT payload FROM logs ORDER BY created_at DESC LIMIT 10;"
```

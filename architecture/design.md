# Turso Panic Fix Workflow

An automated system for reproducing, fixing, and shipping patches for panics discovered in the Turso database. Uses
Claude Code agents orchestrated with AgentFS sandboxes for parallel, isolated execution.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Workflow](#workflow)
- [Database Schema](#database-schema)
    - [Slug Generation](#slug-generation)
- [Components](#components)
    - [Orchestrator](#orchestrator)
    - [MCP Tools](#mcp-tools)
    - [Agent Prompts](#agent-prompts)
- [AgentFS Integration](#agentfs-integration)
- [IPC: Timeout Tracking](#ipc-timeout-tracking)
- [Configuration](#configuration)
- [Error Handling](#error-handling)
- [Graceful Shutdown](#graceful-shutdown)

---

## Overview

The system processes panics from a database, each containing:

- Panic location (file:line)
- Panic message
- SQL statements that reproduce the panic

For each panic, the system:

1. Creates an isolated AgentFS sandbox with a pre-built Turso repo
2. Runs a **Reproducer Agent** to extend the simulator to trigger the panic
3. Runs a **Fixer Agent** to fix the bug and validate the fix
4. Opens a draft PR with the fix

All agents are Claude Code instances running in sandboxes, communicating through a shared context file (
`panic_context.md`) and MCP tools.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Orchestrator                                │
│                          (TypeScript)                                │
├─────────────────────────────────────────────────────────────────────┤
│  • Workflow state machine                                            │
│  • Timeout management (with IPC for sim runtime exclusion)           │
│  • Spawns Claude Code agents via `agentfs run`                       │
│  • Manages sandbox lifecycle                                         │
│  • Database interactions (Turso)                                     │
│  • HTTP server for IPC (localhost:9100)                              │
│  • Graceful shutdown on SIGINT                                       │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   ┌───────────┐        ┌───────────┐        ┌───────────┐
   │  AgentFS  │        │  AgentFS  │        │  AgentFS  │
   │ sandbox-  │        │ sandbox-  │        │ sandbox-  │
   │  panic-001│        │  panic-002│        │  panic-003│
   ├───────────┤        ├───────────┤        ├───────────┤
   │ MCP Server│        │ MCP Server│        │ MCP Server│
   │ Claude CC │        │ Claude CC │        │ Claude CC │
   └───────────┘        └───────────┘        └───────────┘
         │                    │                    │
         └────────────────────┴────────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │   Base Turso Repo │
                    │   (pre-built)     │
                    └───────────────────┘
```

### Key Design Decisions

| Area               | Decision                                                   |
|--------------------|------------------------------------------------------------|
| Language           | TypeScript                                                 |
| Agent runtime      | Claude Code (CLI, `--dangerously-skip-permissions`)        |
| Sandboxing         | AgentFS CoW filesystems                                    |
| Tool protocol      | MCP servers (one per sandbox)                              |
| Tool communication | Tools return structured data, agent writes to context file |
| Git operations     | Agents use git directly                                    |
| IPC                | HTTP callbacks for timeout tracking                        |
| Concurrency        | Configurable, default 2 parallel panics                    |

---

## Workflow

See [workflow file](./workflow.mermaid).

### Phase Summary

| Phase      | Executor          | Timeout              | Description                              |
|------------|-------------------|----------------------|------------------------------------------|
| Pre-flight | Orchestrator      | None                 | Verify base repo builds and passes tests |
| Repo Setup | Orchestrator      | None                 | Create sandbox, branch, TCL test         |
| Reproducer | Claude Code Agent | 60min (excludes sim) | Extend simulator to reproduce panic      |
| Fixer      | Claude Code Agent | 60min                | Fix bug, validate, document              |
| Ship       | Orchestrator      | None                 | Squash, open PR, cleanup                 |

---

## Database Schema

### `panic_fixes` Table

```sql
CREATE TABLE panic_fixes
(
    panic_location TEXT PRIMARY KEY,    -- e.g., "src/vdbe.c:1234" (unique identifier)
    status         TEXT      DEFAULT 'pending',
    -- pending | repo_setup | reproducing | fixing | shipping | pr_open | needs_human_review

    panic_message  TEXT NOT NULL,       -- e.g., "assertion failed: pCur->isValid"
    sql_statements TEXT NOT NULL,       -- Newline-separated SQL statements

    branch_name    TEXT,                -- e.g., "fix/panic-src-vdbe.c-1234"
    pr_url         TEXT,                -- Set after PR opened

    retry_count    INTEGER   DEFAULT 0, -- Reset to 0 on each state transition
    workflow_error TEXT,                -- JSON: error info for human review

    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Note on `panic_location` as primary key:** Since `panic_location` (e.g., `"src/vdbe.c:1234"`) contains
characters unsuitable for URLs and file paths (`/`, `:`), we derive a **slug** for use in branch names,
session names, and IPC endpoints. See [Slug Generation](#slug-generation) below.

### `logs` Table

```sql
CREATE TABLE logs
(
    payload TEXT NOT NULL
);
```

Log payload structure:

```json
{
  "panic_location": "src/vdbe.c:1234",
  "phase": "reproducer",
  "level": "info",
  "message": "Simulator compiled successfully",
  "timestamp": "2025-01-13T10:30:00Z",
  "metadata": {}
}
```

### Slug Generation

Since `panic_location` contains characters unsuitable for URLs and file paths (`/`, `:`), we derive a
URL-safe **slug** for use in:

- **Session names**: `fix-panic-{slug}`
- **Branch names**: `fix/panic-{slug}`
- **IPC endpoints**: URL-encoded for routing

```typescript
// encoding.ts

/**
 * Convert panic_location to a filesystem/git-safe slug.
 * Example: "src/vdbe.c:1234" → "src-vdbe.c-1234"
 */
export function toSlug(panicLocation: string): string {
    return panicLocation.replace(/[/:]/g, '-');
}

/**
 * URL-encode panic_location for use in IPC endpoints.
 * Example: "src/vdbe.c:1234" → "src%2Fvdbe.c%3A1234"
 */
export function toUrlSafe(panicLocation: string): string {
    return encodeURIComponent(panicLocation);
}
```

Usage:

| Context        | Function                    | Example Output                      |
|----------------|-----------------------------|-------------------------------------|
| Session name   | `toSlug(panicLocation)`     | `fix-panic-src-vdbe.c-1234`         |
| Branch name    | `toSlug(panicLocation)`     | `fix/panic-src-vdbe.c-1234`         |
| IPC endpoint   | `toUrlSafe(panicLocation)`  | `/sim/src%2Fvdbe.c%3A1234/started`  |
| DB queries     | Raw `panic_location`        | `WHERE panic_location = ?`          |

---

## Components

### Orchestrator

**Assumption:** Exactly one orchestrator process will run at any time. Multiple agents may run in parallel within
AgentFS sessions. Under this assumption, no DB-based work-claiming/locking is required; the orchestrator can
sequentially enqueue and dispatch work to agents based on `maxParallelPanics`.

```
orchestrator/
├── src/
│   ├── index.ts              # Entry point, CLI
│   ├── workflow.ts           # State machine
│   ├── agents.ts             # Claude Code spawning
│   ├── sandbox.ts            # AgentFS management
│   ├── database.ts           # Turso client
│   ├── ipc-server.ts         # HTTP server for timeout tracking
│   ├── git.ts                # Git operations (squash, etc.)
│   ├── pr.ts                 # GitHub PR creation
│   ├── context-parser.ts     # Parse panic_context.md JSON block
│   ├── logger.ts             # Structured logging to DB
│   ├── config.ts             # Configuration
│   └── encoding.ts              # toSlug(), toUrlSafe() helpers
├── package.json
└── tsconfig.json
```

#### State Machine

```typescript
type PanicStatus =
    | 'pending'
    | 'repo_setup'
    | 'reproducing'
    | 'fixing'
    | 'shipping'
    | 'pr_open'
    | 'needs_human_review';

interface WorkflowState {
    panicLocation: string;  // Primary key, e.g., "src/vdbe.c:1234"
    status: PanicStatus;
    sessionName: string;    // Derived: `fix-panic-${toSlug(panicLocation)}`
    startTime: Date;
    pausedTime: number;     // Accumulated sim runtime (excluded from timeout)
}
```

#### Spawning Agents

```typescript
async function spawnAgent(
    sessionName: string,
    promptFile: string,
    timeout: number
): Promise<AgentResult> {
    const prompt = await readFile(promptFile, 'utf-8');
    const proc = spawn('agentfs', [
        'run', '--session', sessionName,
        'claude',
        '--dangerously-skip-permissions',
        '--print', 'text',
        '--prompt', prompt
    ]);

    // Handle timeout (excluding paused time)
    // Handle stdout/stderr
    // Return result
}
```

### MCP Tools

```
tools/
├── src/
│   ├── server.ts             # MCP server entry
│   ├── run-simulator.ts      # Run simulator with seed
│   ├── describe-sim-fix.ts   # Document simulator changes
│   ├── describe-fix.ts       # Document bug fix
│   └── validate-fix.ts       # Run validation (fast + slow)
├── package.json
└── tsconfig.json
```

#### Tool: `run-simulator`

```typescript
interface RunSimulatorParams {
    seed?: number;              // Optional: specific seed
    timeout_seconds?: number;   // Default: 300
}

interface RunSimulatorResult {
    panic_found: boolean;
    seed_used: number;
    panic_message?: string;
}

async function runSimulator(params: RunSimulatorParams): Promise<RunSimulatorResult> {
    // PANIC_LOCATION is set by orchestrator, e.g., "src/vdbe.c:1234"
    const panicLocation = process.env.PANIC_LOCATION;
    // URL-encode for safe use in IPC endpoints
    const urlSafe = encodeURIComponent(panicLocation);

    // Notify orchestrator: sim started (URL-encoded panic_location in path)
    await fetch(`http://localhost:9100/sim/${urlSafe}/started`, {method: 'POST'});

    try {
        const seed = params.seed ?? Math.floor(Math.random() * 1000000);
        const result = await exec(`./simulator --seed ${seed}`);

        return {
            panic_found: result.includes('PANIC'),
            seed_used: seed,
            panic_message: extractPanicMessage(result)
        };
    } finally {
        // Notify orchestrator: sim finished
        await fetch(`http://localhost:9100/sim/${urlSafe}/finished`, {method: 'POST'});
    }
}
```

#### Tool: `describe-sim-fix`

Documents simulator changes and updates the JSON block in `panic_context.md`.

```typescript
interface DescribeSimFixParams {
    failing_seed: number;         // The seed that reproduced the panic
    why_simulator_missed: string;
    what_was_added: string;
}

interface DescribeSimFixResult {
    success: boolean;
    error?: string;  // Descriptive error message when validation or file update fails
}

async function describeSimFix(params: DescribeSimFixParams): Promise<DescribeSimFixResult> {
    // Validate failing_seed: must be a number
    if (typeof params.failing_seed !== "number") {
        return {success: false, error: "Missing required field: failing_seed (must be a number)"};
    }

    // Validate why_simulator_missed: must be a non-empty string
    if (typeof params.why_simulator_missed !== "string" ||
        params.why_simulator_missed.trim().length === 0) {
        return {success: false, error: "Field why_simulator_missed cannot be empty"};
    }

    // Validate what_was_added: must be a non-empty string
    if (typeof params.what_was_added !== "string" ||
        params.what_was_added.trim().length === 0) {
        return {success: false, error: "Field what_was_added cannot be empty"};
    }

    // Read and parse panic_context.md
    const content = await fs.readFile("panic_context.md", "utf-8");
    const jsonBlockRegex = /```json\n([\s\S]*?)\n```/;
    const match = content.match(jsonBlockRegex);
    if (!match) {
        return {success: false, error: "No JSON block found in panic_context.md"};
    }

    const prData = JSON.parse(match[1]);

    // Update fields
    prData.failing_seed = params.failing_seed;
    prData.why_simulator_missed = params.why_simulator_missed;
    prData.simulator_changes = params.what_was_added;

    // Write back
    const updatedContent = content.replace(
        jsonBlockRegex,
        "```json\n" + JSON.stringify(prData, null, 2) + "\n```"
    );
    await fs.writeFile("panic_context.md", updatedContent);

    return {success: true};
}
```

#### Tool: `describe-fix`

```typescript
interface DescribeFixParams {
    bug_description: string;
    fix_description: string;
}

interface DescribeFixResult {
    success: boolean;
    error?: string;  // Descriptive error message when validation fails
}

function describeFix(params: DescribeFixParams): DescribeFixResult {
    // Validate bug_description: must be a non-empty string
    if (params.bug_description === undefined ||
        params.bug_description === null ||
        typeof params.bug_description !== "string") {
        return {success: false, error: "Missing required field: bug_description"};
    }
    if (params.bug_description.trim().length === 0) {
        return {success: false, error: "Field bug_description cannot be empty"};
    }

    // Validate fix_description: must be a non-empty string
    if (params.fix_description === undefined ||
        params.fix_description === null ||
        typeof params.fix_description !== "string") {
        return {success: false, error: "Missing required field: fix_description"};
    }
    if (params.fix_description.trim().length === 0) {
        return {success: false, error: "Field fix_description cannot be empty"};
    }

    return {success: true};
}
```

#### Tool: `validate-fix`

```typescript
interface ValidateFixParams {
    failing_seed: number;
}

/**
 * Field presence by validation stage:
 * - passed, fast_validation_passed: Always present
 * - slow_validation_passed, make_test_passed: Present if fast validation passed
 * - sim_runs_passed: Present only if make test passed (simulators actually ran)
 * - error: Present when validation fails
 * - stdout, stderr: Present on fast validation failure (for debugging)
 */
interface ValidateFixResult {
    passed: boolean;
    fast_validation_passed: boolean;
    slow_validation_passed?: boolean;
    make_test_passed?: boolean;
    sim_runs_passed?: boolean;
    error?: string;
    stdout?: string;   // Only on fast validation failure
    stderr?: string;   // Only on fast validation failure
}

async function validateFix(params: ValidateFixParams): Promise<ValidateFixResult> {
    // Run fast validation (make test-single)
    const fastResult = await exec('make test-single');
    if (fastResult.exitCode !== 0) {
        return {
            passed: false,
            fast_validation_passed: false,
            error: fastResult.stderr,
            stdout: fastResult.stdout,
            stderr: fastResult.stderr
        };
    }

    // Run slow validation: make test
    const makeResult = await exec('make test');
    if (makeResult.exitCode !== 0) {
        return {
            passed: false,
            fast_validation_passed: true,
            slow_validation_passed: false,
            make_test_passed: false,
            // sim_runs_passed omitted - simulators never ran
            error: makeResult.stderr
        };
    }

    // Run simulator 10 times on failing seed
    for (let i = 0; i < 10; i++) {
        const simResult = await runSimulator({seed: params.failing_seed});
        if (simResult.panic_found) {
            return {
                passed: false,
                fast_validation_passed: true,
                slow_validation_passed: false,
                make_test_passed: true,
                sim_runs_passed: false,
                error: `Panic still occurs on simulator run ${i + 1} of 10`
            };
        }
    }

    return {
        passed: true,
        fast_validation_passed: true,
        slow_validation_passed: true,
        make_test_passed: true,
        sim_runs_passed: true
    };
}
```

### Agent Prompts

#### `prompts/reproducer.md`

```markdown
# Reproducer Agent

You are a Reproducer Agent working on the Turso database project. Your job is to extend the simulator so that it can
generate SQL statements that trigger a specific panic.

## Context

Read the file `panic_context.md` in the repository root. It contains:

- The panic location and message
- The SQL statements that reproduce the panic
- A JSON block (updated automatically by `describe-sim-fix`)

Another agent (the Fixer) will use this file after you're done, so keep it well-organized.

## Your Task

1. **Analyze** the panic and the SQL statements that trigger it
2. **Extend the simulator** to generate similar statements
3. **Run the simulator** using the `run-simulator` tool until the panic is reproduced
4. **Call `describe-sim-fix`** with the failing seed and documentation
   - This automatically updates the JSON block in `panic_context.md`
5. **Commit your changes** with message: `reproducer: {panic_location}`

## Tools Available

- `run-simulator`: Run the simulator with an optional seed
- `describe-sim-fix`: Document your simulator changes and update JSON block

## Important

- Use git directly for all git operations
- The simulator is in `simulator/` directory
- Keep iterating until the panic is reproduced
- Do not modify the Turso database code, only the simulator
```

#### `prompts/fixer.md`

```markdown
# Fixer Agent

You are a Fixer Agent working on the Turso database project. Your job is to fix a panic that has been reproduced by the
Reproducer Agent.

## Context

Read the file `panic_context.md` in the repository root. It contains:

- The panic location and message
- The SQL statements that reproduce the panic
- The failing simulator seed
- Information from the Reproducer about the simulator changes

## Your Task

1. **Analyze** the root cause of the panic
2. **Implement a fix** in the Turso codebase
3. **Commit** when it compiles with message: `wip: fix compiles`
4. **Validate** using `validate-fix` - runs TCL test, then full test suite and simulator
5. **Call `describe-fix`** after validation passes to document:
    - What the bug was
    - How you fixed it
6. **Update the JSON block** in `panic_context.md` with:
    - `bug_description`
    - `fix_description`
7. **Commit your changes** with message: `fix: {panic_location}`

## Tools Available

- `validate-fix`: Run TCL test, then full test suite + simulator 10x
- `describe-fix`: Document your fix

## Important

- Use git directly for all git operations
- If validation fails, analyze the failure and iterate on your fix
- Do not modify the simulator code, only the Turso database code
- The TCL test was created during Repo Setup and should pass after your fix
```

---

## AgentFS Integration

### Base Repo Setup (One-time)

```bash
# Clone and build Turso (this becomes the base layer)
git clone https://github.com/tursodatabase/turso /opt/turso-base
cd /opt/turso-base
cargo build
make test  # Verify it passes
```

### Session Lifecycle

**Cleanup on successful completion:** delete the AgentFS session to free storage.

```bash
# Delete the session database file
rm .agentfs/${SESSION_NAME}.db
```

AgentFS sessions are created automatically when first used with `--session`. The session name can
become a git branch name.

```typescript
import { toSlug } from './utils';

// Get session name for a panic (uses slug for filesystem safety)
function getSessionName(panicLocation: string): string {
    return `fix-panic-${toSlug(panicLocation)}`;
    // e.g., "src/vdbe.c:1234" → "fix-panic-src-vdbe.c-1234"
}

// Get branch name for a panic (uses slug for git safety)
function getBranchName(panicLocation: string): string {
    return `fix/panic-${toSlug(panicLocation)}`;
    // e.g., "src/vdbe.c:1234" → "fix/panic-src-vdbe.c-1234"
}

// Run command in session (session is created on first use)
async function runInSession(sessionName: string, command: string): Promise<ExecResult> {
    return exec(`agentfs run --session ${sessionName} ${command}`);
}
```

### Spawning Claude Code in Session

```typescript
async function spawnAgentInSession(
    sessionName: string,
    panicLocation: string,
    promptFile: string
): Promise<void> {
    // Set up MCP server config in session
    await runInSession(sessionName, `claude mcp add panic-tools \
      --scope project \
      --transport stdio \
      "npx tsx /opt/tools/server.ts"`);

    // Spawn Claude Code with PANIC_LOCATION env var for IPC
    const prompt = await readFile(promptFile, 'utf-8');
    await exec(`PANIC_LOCATION="${panicLocation}" agentfs run --session ${sessionName} claude \
        --dangerously-skip-permissions \
        --print text \
        --prompt "${escapeForShell(prompt)}"`);
}
```

---

## IPC: Timeout Tracking

**Note:** Timers are best-effort. Process restarts do not preserve or reconcile elapsed time; on restart, timers
reset. This is acceptable for this system.

The orchestrator runs an HTTP server to track simulator runtime, which is excluded from agent timeouts.

### Orchestrator HTTP Server

```typescript
// ipc-server.ts
import express from 'express';

interface TimeTracker {
    startTime: Date;
    pausedAt?: Date;
    totalPausedMs: number;
}

// Map keyed by raw panic_location (e.g., "src/vdbe.c:1234")
const trackers = new Map<string, TimeTracker>();

const app = express();

// URL param :panicLocation is URL-encoded (e.g., "src%2Fvdbe.c%3A1234")
// Express automatically decodes it via req.params
app.post('/sim/:panicLocation/started', (req, res) => {
    // req.params.panicLocation is auto-decoded to "src/vdbe.c:1234"
    const panicLocation = req.params.panicLocation;
    const tracker = trackers.get(panicLocation);
    if (tracker && !tracker.pausedAt) {
        tracker.pausedAt = new Date();
    }
    res.sendStatus(200);
});

app.post('/sim/:panicLocation/finished', (req, res) => {
    const panicLocation = req.params.panicLocation;
    const tracker = trackers.get(panicLocation);
    if (tracker && tracker.pausedAt) {
        tracker.totalPausedMs += Date.now() - tracker.pausedAt.getTime();
        tracker.pausedAt = undefined;
    }
    res.sendStatus(200);
});

export function getElapsedMs(panicLocation: string): number {
    const tracker = trackers.get(panicLocation);
    if (!tracker) return 0;

    const totalMs = Date.now() - tracker.startTime.getTime();
    const pausedMs = tracker.totalPausedMs +
        (tracker.pausedAt ? Date.now() - tracker.pausedAt.getTime() : 0);

    return totalMs - pausedMs;
}

export function startTracking(panicLocation: string): void {
    trackers.set(panicLocation, {
        startTime: new Date(),
        totalPausedMs: 0
    });
}

export function stopTracking(panicLocation: string): void {
    trackers.delete(panicLocation);
}

app.listen(9100);
```

### Timeout Check

```typescript
const REPRODUCER_TIMEOUT_MS = 60 * 60 * 1000;  // 60 minutes
const FIXER_TIMEOUT_MS = 60 * 60 * 1000;       // 60 minutes

function checkTimeout(panicLocation: string, phase: 'reproducer' | 'fixer'): boolean {
    const elapsed = getElapsedMs(panicLocation);
    const limit = phase === 'reproducer' ? REPRODUCER_TIMEOUT_MS : FIXER_TIMEOUT_MS;
    return elapsed >= limit;
}
```

---

## Configuration

```typescript
// config.ts
export interface Config {
    // Database
    tursoUrl: string;
    tursoAuthToken: string;

    // AgentFS
    baseRepoPath: string;        // /opt/turso-base

    // Concurrency
    maxParallelPanics: number;   // Default: 2

    // Timeouts (milliseconds)
    reproducerTimeout: number;   // Default: 60 * 60 * 1000
    fixerTimeout: number;        // Default: 60 * 60 * 1000

    // GitHub
    githubToken: string;
    githubRepo: string;          // tursodatabase/turso
    prReviewer: string;          // Hard-coded reviewer username

    // IPC
    ipcPort: number;             // Default: 9100
}

export function loadConfig(): Config {
    return {
        tursoUrl: requireEnv('TURSO_URL'),
        tursoAuthToken: requireEnv('TURSO_AUTH_TOKEN'),
        baseRepoPath: process.env.BASE_REPO_PATH ?? '/opt/turso-base',
        maxParallelPanics: parseInt(process.env.MAX_PARALLEL ?? '2'),
        reproducerTimeout: parseInt(process.env.REPRODUCER_TIMEOUT ?? String(60 * 60 * 1000)),
        fixerTimeout: parseInt(process.env.FIXER_TIMEOUT ?? String(60 * 60 * 1000)),
        githubToken: requireEnv('GITHUB_TOKEN'),
        githubRepo: process.env.GITHUB_REPO ?? 'tursodatabase/turso',
        prReviewer: process.env.PR_REVIEWER ?? 'default-reviewer',
        ipcPort: parseInt(process.env.IPC_PORT ?? '9100')
    };
}
```

---

## Error Handling

### Error Categories

| Error Type          | Behavior                                               |
|---------------------|--------------------------------------------------------|
| Timeout             | Abort immediately, no retry, flag `needs_human_review` |
| Claude Code crash   | Abort, flag `needs_human_review`                       |
| AgentFS failure     | Abort, flag `needs_human_review`                       |
| Compilation failure | Agent retries (within timeout)                         |
| Test failure        | Agent retries (within timeout)                         |

### Abort Flow

```typescript
async function abort(panicLocation: string, error: Error, phase: string): Promise<void> {
    // Update database (panic_location is the primary key)
    await db.execute({
        sql: `UPDATE panic_fixes
          SET status = 'needs_human_review',
              workflow_error = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE panic_location = ?`,
        args: [
            JSON.stringify({
                phase,
                error: error.message,
                timestamp: new Date().toISOString()
            }),
            panicLocation
        ]
    });

    // Log warning about retained session
    await log({
        panic_location: panicLocation,
        phase,
        level: 'warn',
        message: `Session retained for debugging: ${getSessionName(panicLocation)}`,
        timestamp: new Date().toISOString()
    });

    // Stop tracking
    stopTracking(panicLocation);
}
```

---

## Graceful Shutdown

On SIGINT, the orchestrator:

1. Stops accepting new panics
2. Waits for in-flight agents to complete their current phase
3. Exits cleanly

```typescript
let shuttingDown = false;
// Set of in-flight panic_locations (the primary key)
const inFlightPanics = new Set<string>();

process.on('SIGINT', async () => {
    if (shuttingDown) {
        console.log('Force shutdown...');
        process.exit(1);
    }

    shuttingDown = true;
    console.log('Graceful shutdown initiated. Waiting for in-flight panics...');

    // Wait for all in-flight to complete
    while (inFlightPanics.size > 0) {
        await sleep(1000);
        console.log(`Waiting for ${inFlightPanics.size} panic(s)...`);
    }

    console.log('Shutdown complete.');
    process.exit(0);
});

// In main loop
async function processNextPanic(): Promise<void> {
    if (shuttingDown) return;

    const panic = await fetchNextPanic();
    if (!panic) return;

    inFlightPanics.add(panic.panic_location);
    try {
        await runWorkflow(panic);
    } finally {
        inFlightPanics.delete(panic.panic_location);
    }
}
```

---

## Context File Format

### `panic_context.md`

```markdown
# Panic Context: {panic_location}

## Panic Info

- **Location**: src/vdbe.c:1234
- **Message**: assertion failed: pCur->isValid

## SQL Statements

```sql
CREATE TABLE t1(a INTEGER PRIMARY KEY, b TEXT);
INSERT INTO t1 VALUES(1, 'test');
SELECT * FROM t1 WHERE a = 1;
```

## Reproducer Notes

<!-- Reproducer agent writes analysis here -->

## Fixer Notes

<!-- Fixer agent writes analysis here -->

---

## PR Data (Machine Readable)

```json
{
  "panic_location": "src/vdbe.c:1234",
  "panic_message": "assertion failed: pCur->isValid",
  "failing_seed": 42,
  "why_simulator_missed": "...",
  "simulator_changes": "...",
  "bug_description": "...",
  "fix_description": "...",
  "tcl_test_file": "test/panic_abc123.test"
}
```

### Required Fields for Ship

| Field                  | Populated By                    |
|------------------------|---------------------------------|
| `panic_location`       | Repo Setup                      |
| `panic_message`        | Repo Setup                      |
| `failing_seed`         | Reproducer                      |
| `why_simulator_missed` | Reproducer (`describe-sim-fix`) |
| `simulator_changes`    | Reproducer (`describe-sim-fix`) |
| `bug_description`      | Fixer (`describe-fix`)          |
| `fix_description`      | Fixer (`describe-fix`)          |
| `tcl_test_file`        | Repo Setup                      |

The orchestrator extracts the first JSON code block in the file via regex and validates all fields before opening the
PR.

---

## Ship Phase Details

```typescript
async function ship(panicLocation: string, sessionName: string): Promise<void> {
    // 1. Parse context file
    const contextPath = `panic_context.md`;
    const content = await runInSession(sessionName, `cat ${contextPath}`);
    const prData = extractJsonBlock(content.stdout);

    // 2. Validate required fields
    const required = [
        'panic_location', 'panic_message', 'failing_seed',
        'why_simulator_missed', 'simulator_changes', 'bug_description',
        'fix_description', 'tcl_test_file'
    ];
    for (const field of required) {
        if (!prData[field]) {
            throw new Error(`Missing required field: ${field}`);
        }
    }

    // 3. Delete context file
    await runInSession(sessionName, `rm ${contextPath}`);

    // 4. Squash commits
    await runInSession(sessionName, `git reset --soft $(git merge-base HEAD main) && \
    git commit -m "fix: ${prData.panic_message}

Location: ${prData.panic_location}
Bug: ${prData.bug_description}
Fix: ${prData.fix_description}

Failing seed: ${prData.failing_seed}
Simulator: ${prData.why_simulator_missed}"`);

    // 5. Push branch (use slug for branch name)
    const branchName = getBranchName(panicLocation);
    await runInSession(sessionName, `git push -u origin ${branchName}`);

    // 6. Open draft PR
    const prUrl = await openPullRequest({
        title: `fix: ${prData.panic_message}`,
        body: formatPrBody(prData),
        draft: true,
        reviewer: config.prReviewer
    });

    // 7. Update database (panic_location is the primary key)
    await db.execute({
        sql: `UPDATE panic_fixes
          SET status = 'pr_open', pr_url = ?, updated_at = CURRENT_TIMESTAMP
          WHERE panic_location = ?`,
        args: [prUrl, panicLocation]
    });
}
```

---

## Directory Structure

```
turso-panic-fixer/
├── orchestrator/
│   ├── src/
│   │   ├── index.ts
│   │   ├── workflow.ts
│   │   ├── agents.ts
│   │   ├── sandbox.ts
│   │   ├── database.ts
│   │   ├── ipc-server.ts
│   │   ├── git.ts
│   │   ├── pr.ts
│   │   ├── context-parser.ts
│   │   ├── logger.ts
│   │   ├── config.ts
│   │   └── encoding.ts              # toSlug(), toUrlSafe()
│   ├── package.json
│   └── tsconfig.json
├── tools/
│   ├── src/
│   │   ├── server.ts
│   │   ├── run-simulator.ts
│   │   ├── describe-sim-fix.ts
│   │   ├── describe-fix.ts
│   │   └── validate-fix.ts
│   ├── package.json
│   └── tsconfig.json
├── prompts/
│   ├── reproducer.md
│   └── fixer.md
└── README.md
```
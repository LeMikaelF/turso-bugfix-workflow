# Turso Panic Fix Workflow

Automated system to reproduce, fix, and ship patches for panics in the Turso database using Claude Code agents.

## Features

- **Automated panic reproduction** using a configurable simulator
- **Claude Code agents** for extending simulators and implementing fixes
- **Isolated AgentFS sandboxes** for safe, copy-on-write execution
- **Automated GitHub PR creation** with squashed commits
- **Configurable parallelism** and timeout management
- **IPC-based timeout tracking** that excludes simulator runtime

## Architecture

[View workflow diagram](architecture/workflow.mermaid)

### Components

| Component                  | Description                                                                 |
|----------------------------|-----------------------------------------------------------------------------|
| **Orchestrator**           | Main loop that fetches pending panics and drives the workflow state machine |
| **Workflow State Machine** | Manages panic processing through 7 states with retry logic                  |
| **Sandbox Manager**        | Creates and manages AgentFS copy-on-write sessions                          |
| **IPC Server**             | HTTP server for tracking simulator runtime to exclude from timeouts         |
| **MCP Server**             | Exposes 4 tools to Claude Code agents via Model Context Protocol            |
| **Agents**                 | Claude Code instances running in sandboxes with MCP tools                   |

## Prerequisites

- **Node.js** v18+
- **Git**
- **GitHub CLI** (`gh`) - authenticated via `gh auth login`
- **AgentFS CLI**
- **Claude Code CLI**
- **Turso database** - for state persistence and logging
- **GitHub repository** - the target repo where PRs will be created (must have push access)

## Configuration

Create a `properties.json` file in the project root:

```json
{
  "tursoUrl": "libsql://your-database.turso.io",
  "baseRepoPath": "/path/to/turso-repo",
  "maxParallelPanics": 2,
  "reproducerTimeoutMs": 3600000,
  "fixerTimeoutMs": 3600000,
  "githubToken": "ghp_...",
  "githubRepo": "tursodatabase/turso",
  "prReviewer": "@username",
  "prLabels": [
    "automated",
    "panic-fix"
  ],
  "ipcPort": 9100,
  "dryRun": false
}
```

### Configuration Options

| Field                 | Required | Default               | Description                         |
|-----------------------|----------|-----------------------|-------------------------------------|
| `tursoUrl`            | Yes      | -                     | Turso database URL                  |
| `baseRepoPath`        | No       | `/opt/turso-base`     | Path to base Turso repository       |
| `maxParallelPanics`   | No       | `2`                   | Maximum concurrent panic processing |
| `reproducerTimeoutMs` | No       | `3600000`             | Reproducer agent timeout (60 min)   |
| `fixerTimeoutMs`      | No       | `3600000`             | Fixer agent timeout (60 min)        |
| `githubToken`         | Yes      | -                     | GitHub personal access token        |
| `githubRepo`          | No       | `tursodatabase/turso` | Target GitHub repository            |
| `prReviewer`          | No       | `@LeMikaelF`          | Default PR reviewer                 |
| `prLabels`            | No       | `[]`                  | Labels to apply to PRs              |
| `ipcPort`             | No       | `9100`                | IPC server port                     |
| `dryRun`              | No       | `false`               | Skip PR creation when true          |

## Usage

### 1. Install Dependencies

```bash
npm install
npm run build
```

### 2. Initialize the Database

The database schema is created automatically on first run. However, you need to **prime the database** with panic records for the workflow to process.

#### Using the Turso CLI

```bash
# Install Turso CLI if needed
brew install tursodatabase/tap/turso

# Connect to your database
turso db shell your-database-name

# Insert a panic record
INSERT INTO panic_fixes (panic_location, panic_message, sql_statements)
VALUES (
  'src/vdbe.c:1234',
  'assertion failed: some_condition',
  'CREATE TABLE t(x);
INSERT INTO t VALUES(1);
SELECT * FROM t;'
);
```

#### Using the Turso Web Console

1. Go to [turso.tech](https://turso.tech/) and open your database
2. Navigate to the SQL console
3. Run the INSERT statement above

### 3. Set Up the Base Repository

The workflow needs a base Turso repository to create sandboxes from:

```bash
# Clone the Turso repo to the configured baseRepoPath
git clone https://github.com/tursodatabase/turso /opt/turso-base

# Build it once to verify everything works
cd /opt/turso-base
make
```

### 4. Run the Workflow

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm run build
npm start
```

The orchestrator will:
1. Poll the database for `pending` panic records
2. Create sandboxes and spawn Claude Code agents
3. Process panics through the state machine
4. Create GitHub PRs for successful fixes

### 5. Monitor Progress

- Check the `panic_fixes` table for status updates
- Check the `logs` table for detailed event logs
- Use `Ctrl+C` once for graceful shutdown, twice to force exit

### Other Commands

```bash
# Start MCP tools server (for agents)
npm run mcp

# Run tests
npm test
npm run test:watch

# Lint and format
npm run lint
npm run format
```

## Workflow States

The system processes panics through a state machine with the following states:

| State                | Executor     | Description                                                  |
|----------------------|--------------|--------------------------------------------------------------|
| `pending`            | Orchestrator | Preflight check: verify base repo builds and passes tests    |
| `repo_setup`         | Orchestrator | Create AgentFS sandbox, git branch, and TCL test file        |
| `reproducing`        | Claude Agent | Extend simulator to reproduce the panic (60 min timeout*)    |
| `fixing`             | Claude Agent | Fix the bug, validate, and document changes (60 min timeout) |
| `shipping`           | Orchestrator | Squash commits and open draft PR                             |
| `pr_open`            | -            | Success: PR created                                          |
| `needs_human_review` | -            | Error: requires manual intervention                          |

*Simulator runtime is excluded from timeout via IPC callbacks

## MCP Tools

Agents have access to 4 tools via Model Context Protocol:

| Tool              | Description                                                                |
|-------------------|----------------------------------------------------------------------------|
| `run-simulator`   | Execute the simulator with a seed, returns panic status                    |
| `describe-sim-fix`| Document changes made to extend the simulator                              |
| `describe-fix`    | Document the bug fix (root cause and solution)                             |
| `validate-fix`    | Run fast validation (single test) then slow validation (full suite + 10x simulator) |

## Project Structure

```
panic-fix-workflow/
├── src/
│   ├── orchestrator/
│   │   ├── index.ts           # CLI entry point
│   │   ├── config.ts          # Configuration loading
│   │   ├── database.ts        # Turso database client
│   │   ├── logger.ts          # Structured logging
│   │   ├── ipc-server.ts      # Timeout tracking server
│   │   ├── sandbox.ts         # AgentFS session management
│   │   ├── agents.ts          # Claude Code spawning
│   │   ├── git.ts             # Git operations
│   │   ├── pr.ts              # GitHub PR creation
│   │   └── workflow/
│   │       ├── index.ts       # Workflow orchestrator
│   │       ├── types.ts       # Type definitions
│   │       └── states/        # State handlers
│   └── tools/
│       ├── server.ts          # MCP server setup
│       └── *.ts               # Individual tool implementations
├── prompts/
│   ├── reproducer.md          # Reproducer agent instructions
│   └── fixer.md               # Fixer agent instructions
├── architecture/              # Design documentation
├── package.json
└── tsconfig.json
```

## Database Schema

The system uses two tables:

### `panic_fixes`

Tracks panic processing state:

- `panic_location` (PK) - e.g., `src/vdbe.c:1234`
- `status` - Current workflow state
- `panic_message` - The panic text
- `sql_statements` - SQL that reproduces the panic
- `branch_name` - Git branch for the fix
- `pr_url` - GitHub PR URL after creation
- `retry_count` - Retry attempts per state
- `workflow_error` - Error info for human review

### `logs`

Structured logging with timestamps and context.

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint code
npm run lint

# Format code
npm run format
```

## Graceful Shutdown

The orchestrator handles shutdown signals:

- First `SIGINT`/`SIGTERM`: Stops accepting new panics, waits for in-flight work
- Second signal: Forces immediate exit with cleanup

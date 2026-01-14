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
| **MCP Server**             | Exposes 5 tools to Claude Code agents via Model Context Protocol            |
| **Agents**                 | Claude Code instances running in sandboxes with MCP tools                   |

## Prerequisites

- **Node.js** v18+
- **AgentFS CLI** - for sandbox management
- **Claude Code CLI** - for running agents
- **Turso database** - for state persistence and logging
- **GitHub CLI** (`gh`) - for PR creation

## Configuration

Create a `properties.json` file in the project root:

```json
{
  "tursoUrl": "libsql://your-database.turso.io",
  "tursoAuthToken": "your-auth-token",
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
| `tursoAuthToken`      | Yes      | -                     | Turso authentication token          |
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

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Run in production
npm start

# Start MCP tools server (for agents)
npm run mcp

# Run tests
npm test
npm run test:watch
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

Agents have access to 5 tools via Model Context Protocol:

| Tool                | Description                                                 |
|---------------------|-------------------------------------------------------------|
| `run-simulator`     | Execute the simulator with a seed, returns panic status     |
| `describe-sim-fix`  | Document changes made to extend the simulator               |
| `describe-fix`      | Document the bug fix (root cause and solution)              |
| `validate-fix-fast` | Run a single TCL test for quick validation                  |
| `validate-fix-slow` | Run full test suite + simulator 10x for thorough validation |

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

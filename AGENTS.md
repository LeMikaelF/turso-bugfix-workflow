# Agent Instructions

This document provides context for AI coding assistants working on this project.

## Project Overview

Automated system to reproduce, fix, and ship patches for panics in the Turso database. Uses Claude Code agents running in isolated AgentFS sandboxes with MCP tools.

For each panic, the system:
1. Creates an isolated AgentFS sandbox with a pre-built Turso repo
2. Runs **Reproducer Planner** + **Reproducer Implementer** to extend the simulator
3. Runs **Fixer Planner** + **Fixer Implementer** to fix the bug
4. Opens a draft PR with the fix

## Tech Stack

- Language: TypeScript (ES modules)
- Runtime: Node.js 18+
- Database: Turso
- Testing: Vitest
- Linting: ESLint + Prettier
- Agent Sandboxing: AgentFS (copy-on-write filesystems)
- Tool Protocol: MCP (Model Context Protocol)

## Workflow States

The workflow is a state machine with 7 states:

```
pending → repo_setup → reproducing → fixing → shipping → pr_open
                 ↓           ↓           ↓          ↓
              (any state can transition to needs_human_review on error)
```

| State | Executor | Description |
|-------|----------|-------------|
| `pending` | - | Initial state, waiting to be processed |
| `repo_setup` | Orchestrator | Create sandbox, branch, TCL test, context files |
| `reproducing` | Planner + Implementer agents | Extend simulator to reproduce panic |
| `fixing` | Planner + Implementer agents | Fix bug, validate with tests |
| `shipping` | Orchestrator | Squash commits, push, create PR |
| `pr_open` | - | Terminal state, PR created successfully |
| `needs_human_review` | - | Error state, requires manual intervention |

State handlers are in `src/orchestrator/workflow/states/`.

## Agent Types

The system uses 4 agent types (planner/implementer split for each phase):

### Reproducer Planner
- **Purpose**: Analyze panic and design strategy for extending the simulator
- **Prompt**: `prompts/reproducer-planner.md`
- **Timeout**: 15 minutes (default)
- **Output**: Creates `reproducer_plan.md`
- **Tools**: `write-reproducer-plan`, `run-simulator` (optional)
- **Constraint**: READ-ONLY - must not modify files

### Reproducer Implementer
- **Purpose**: Follow the plan to extend simulator and reproduce panic
- **Prompt**: `prompts/reproducer-implementer.md`
- **Timeout**: 45 minutes (default, excludes simulator runtime)
- **Tools**: `run-simulator`, `describe-sim-fix`
- **Constraint**: Only modify `simulator/` and `sql_generation/` crates

### Fixer Planner
- **Purpose**: Analyze root cause and design fix strategy
- **Prompt**: `prompts/fixer-planner.md`
- **Timeout**: 15 minutes (default)
- **Output**: Creates `fixer_plan.md`
- **Tools**: `write-fixer-plan`
- **Constraint**: READ-ONLY - must not modify files

### Fixer Implementer
- **Purpose**: Follow the plan to fix the bug and validate
- **Prompt**: `prompts/fixer-implementer.md`
- **Timeout**: 45 minutes (default)
- **Tools**: `validate-fix`, `describe-fix`
- **Constraint**: Only modify `core/` crate (not simulator)

## MCP Tools

6 tools are available via the `panic-tools` MCP server:

### run-simulator
Run the simulator to reproduce a panic. Pauses timeout tracking during execution.

```typescript
// Parameters
seed?: number           // Optional seed (random if not provided)
timeout_seconds?: number // Default: 300

// Returns
{
  panic_found: boolean,
  seed_used: number,
  panic_message?: string,
  output_file?: string,   // Path to output on failure
  roadmap?: string        // Instructions on failure
}
```

### describe-sim-fix
Document simulator changes. Updates `panic_context.json`.

```typescript
// Parameters (all required)
failing_seed: number         // Seed that triggered the panic
why_simulator_missed: string // Why simulator didn't catch this before
what_was_added: string       // What was added to trigger the panic

// Returns
{ success: boolean, error?: string }
```

### write-reproducer-plan
Create `reproducer_plan.md` for the implementer agent.

```typescript
// Parameters (all required)
analysis_summary: string
root_cause_hypothesis: string
sql_pattern_analysis: string
files_to_modify: Array<{ path: string, description: string }>
generation_strategy: string
verification_approach: string

// Returns
{ success: boolean, plan_file?: string, error?: string }
```

### validate-fix
Validate a fix by running tests and simulator.

```typescript
// Parameters
failing_seed: number  // Seed that originally triggered panic

// Returns
{
  passed: boolean,
  fast_validation_passed: boolean,
  slow_validation_passed?: boolean,
  make_test_passed?: boolean,
  sim_runs_passed?: boolean,
  error?: string,
  stdout?: string,  // On fast validation failure
  stderr?: string   // On fast validation failure
}
```

### describe-fix
Document the bug fix. Updates `panic_context.json`.

```typescript
// Parameters (all required)
bug_description: string  // Root cause description
fix_description: string  // How the bug was fixed

// Returns
{ success: boolean, error?: string }
```

### write-fixer-plan
Create `fixer_plan.md` for the implementer agent.

```typescript
// Parameters (all required)
root_cause_analysis: string
code_path_trace: string
fix_strategy: string
files_to_modify: Array<{ path: string, description: string }>
validation_approach: string
risk_assessment: string

// Returns
{ success: boolean, plan_file?: string, error?: string }
```

## Project Structure

```
src/
├── orchestrator/              # Main workflow orchestration
│   ├── index.ts               # CLI entry point
│   ├── config.ts              # Configuration loading (properties.json)
│   ├── database.ts            # Turso client wrapper
│   ├── logger.ts              # Structured logging to DB
│   ├── ipc-server.ts          # HTTP server for timeout tracking
│   ├── sandbox.ts             # AgentFS session management
│   ├── agents.ts              # Claude Code agent spawning (6 functions)
│   ├── git.ts                 # Git operations
│   ├── pr.ts                  # GitHub PR creation
│   ├── encoding.ts            # Panic location encoding
│   ├── context-parser.ts      # Validate panic_context.json
│   ├── context-json.ts        # Read/write panic_context.json
│   ├── plan-files.ts          # Plan file utilities
│   ├── workflow/
│   │   ├── index.ts           # WorkflowOrchestrator class
│   │   ├── types.ts           # Shared types
│   │   ├── states/
│   │   │   ├── index.ts       # State handler exports
│   │   │   ├── preflight.ts   # Verify base repo builds
│   │   │   ├── repo-setup.ts  # Create branch, context files
│   │   │   ├── reproducing.ts # Run reproducer agents
│   │   │   ├── fixing.ts      # Run fixer agents
│   │   │   └── shipping.ts    # Squash, push, create PR
│   │   └── templates/
│   │       ├── tcl-test.ts    # TCL test file generation
│   │       └── context-file.ts # Context file generation
│   └── __tests__/             # Tests
└── tools/                     # MCP tools for agents
    ├── server.ts              # MCP server (6 tools)
    ├── run-simulator.ts       # Simulator execution
    ├── describe-sim-fix.ts    # Document simulator changes
    ├── describe-fix.ts        # Document bug fix
    ├── validate-fix.ts        # Run validation tests
    ├── write-reproducer-plan.ts # Create reproducer plan
    ├── write-fixer-plan.ts    # Create fixer plan
    └── __tests__/             # Tests

prompts/
├── reproducer.md              # Original reproducer agent prompt
├── reproducer-planner.md      # Reproducer planner agent prompt
├── reproducer-implementer.md  # Reproducer implementer agent prompt
├── fixer.md                   # Original fixer agent prompt
├── fixer-planner.md           # Fixer planner agent prompt
└── fixer-implementer.md       # Fixer implementer agent prompt

architecture/                  # Design documents
├── design.md                  # Complete system specification
├── workflow.mermaid           # Visual workflow diagram
└── implementation-overview.md # Implementation guide
```

## Context Files

Context is shared between agents via files in the sandbox root:

### panic_context.md
Human-readable documentation created during repo setup:
- Panic location and message
- SQL statements that trigger the panic
- Sections for reproducer and fixer notes

### panic_context.json
Machine-readable data updated by tools:
```json
{
  "panic_location": "core/storage/btree.rs:1234",
  "panic_message": "assertion failed: cursor.is_valid()",
  "tcl_test_file": "test/panic_abc123.test",
  "failing_seed": 42,
  "why_simulator_missed": "...",
  "simulator_changes": "...",
  "bug_description": "...",
  "fix_description": "..."
}
```

### reproducer_plan.md
Created by Reproducer Planner agent. Contains:
- Panic analysis summary
- SQL pattern analysis
- Files to modify
- Generation strategy
- Verification approach

### fixer_plan.md
Created by Fixer Planner agent. Contains:
- Root cause analysis
- Code path trace
- Fix strategy
- Files to modify
- Risk assessment

## Commands

```bash
npm run build        # Compile TypeScript
npm run dev          # Run with tsx (development)
npm start            # Run compiled output
npm test             # Run tests once
npm run test:watch   # Run tests in watch mode
npm run lint         # Lint code
npm run format       # Format code with Prettier
```

## Code Conventions

- Use ES module imports (`import`/`export`)
- Prefer `async`/`await` over raw promises
- Use TypeScript strict mode
- Export interfaces/types from the file where they're defined
- Test files go in `__tests__/` directories adjacent to source

## Configuration

The project uses `properties.json` in the root:

```typescript
interface Config {
  // Database (required)
  tursoUrl: string;
  tursoAuthToken: string;

  // AgentFS
  baseRepoPath: string;        // Default: "/opt/turso-base"

  // Concurrency
  maxParallelPanics: number;   // Default: 2

  // Phase timeouts (milliseconds)
  reproducerTimeoutMs: number; // Default: 60min (legacy)
  fixerTimeoutMs: number;      // Default: 60min (legacy)

  // Planner/Implementer timeouts (milliseconds)
  reproducerPlannerTimeoutMs: number;     // Default: 15min
  reproducerImplementerTimeoutMs: number; // Default: 45min
  fixerPlannerTimeoutMs: number;          // Default: 15min
  fixerImplementerTimeoutMs: number;      // Default: 45min

  // GitHub (required)
  githubToken: string;
  githubRepo: string;          // Default: "tursodatabase/turso"
  prReviewer: string;          // Default: "@LeMikaelF"
  prLabels: string[];          // Default: []

  // IPC
  ipcPort: number;             // Default: 9100

  // Debug
  dryRun: boolean;             // Default: false
}
```

## Testing

Tests use Vitest. Run with `npm test` or `npm run test:watch`.

For testing database operations, use `:memory:` as the Turso URL:
```typescript
import { loadConfigWithDefaults } from "../config.js";
const config = loadConfigWithDefaults({ tursoUrl: ":memory:" });
```

## Key Patterns

### State Machine
The workflow uses a state machine pattern in `src/orchestrator/workflow/`. Each state has a handler in `states/` that returns the next state or an error.

### Planner/Implementer Split
Each phase (reproducer, fixer) uses two agents:
1. **Planner**: Analyzes the problem, creates a plan file (read-only)
2. **Implementer**: Follows the plan, makes changes, uses validation tools

This separation allows deep analysis before implementation and keeps implementer focused.

### MCP Tools
Tools in `src/tools/` follow the MCP SDK pattern. Each tool exports a registration function that takes the MCP server instance. Tools are registered in `server.ts`.

### IPC Timeout Tracking
The orchestrator runs an HTTP server (default port 9100) to track agent runtime. Simulator execution time is excluded from timeout calculations via `/sim/:panicLocation/started` and `/sim/:panicLocation/finished` endpoints.

### Context Files
Dual files (`panic_context.md` + `panic_context.json`) provide both human-readable documentation and machine-readable data. Plan files (`*_plan.md`) pass strategy from planner to implementer.

### Encoding
`src/orchestrator/encoding.ts` handles panic location encoding for URLs and branch names (e.g., `src/vdbe.c:1234` → `src-vdbe.c-1234`).

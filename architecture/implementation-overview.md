# Turso Panic Fix Workflow - Implementation Plan

## Overview

Implement the automated panic fix workflow system as described in `architecture/design.md`. The system consists of:

1. **Orchestrator** - TypeScript workflow controller that manages the state machine, spawns Claude Code agents in
   AgentFS sandboxes, handles timeouts, and opens PRs
2. **MCP Tools** - Tools for agents to run the simulator, validate fixes, and document changes
3. **Agent Prompts** - Prompt files for the Reproducer and Fixer agents

## Directory Structure (Single Package)

```
panic-fix-workflow/
├── src/
│   ├── orchestrator/
│   │   ├── index.ts              # Entry point, CLI
│   │   ├── workflow.ts           # State machine
│   │   ├── agents.ts             # Claude Code spawning
│   │   ├── sandbox.ts            # AgentFS management
│   │   ├── database.ts           # Turso client
│   │   ├── ipc-server.ts         # HTTP server for timeout tracking
│   │   ├── git.ts                # Git operations (squash, etc.)
│   │   ├── pr.ts                 # GitHub PR creation (via gh CLI)
│   │   ├── context-parser.ts     # Parse panic_context.md JSON block
│   │   ├── logger.ts             # Structured logging to DB
│   │   └── config.ts             # Configuration
│   └── tools/
│       ├── server.ts             # MCP server entry
│       ├── run-simulator.ts      # Run simulator with seed
│       ├── describe-sim-fix.ts   # Document simulator changes
│       ├── describe-fix.ts       # Document bug fix
│       ├── validate-fix-fast.ts  # Run single TCL test
│       └── validate-fix-slow.ts  # Run full test suite + sim
├── prompts/
│   ├── reproducer.md
│   └── fixer.md
├── architecture/                  # (existing)
├── package.json
└── tsconfig.json
```

## Implementation Steps

### Phase 1: Project Setup

1. Update `package.json` with dependencies:
    - `@tursodatabase/database` - Turso database (NOT `@libsql/client`)
    - `express` + `@types/express` - IPC HTTP server
    - `@modelcontextprotocol/sdk` - MCP server
2. Update `tsconfig.json` for Node.js

### Phase 2: Orchestrator - Core Infrastructure

3. `src/orchestrator/config.ts` - configuration loading from properties file
4. `src/orchestrator/database.ts` - Turso client wrapper with query methods (add tests, use in-memory db in tests)
5. `src/orchestrator/logger.ts` - structured logging to DB logs table (add tests, use in-memory db in tests)
6. `src/orchestrator/ipc-server.ts` - Express server on port 9100 for sim timeout tracking (add tests)

### Phase 3: Orchestrator - Sandbox & Agent Management

7. `src/orchestrator/sandbox.ts` - AgentFS session create/delete
8. `src/orchestrator/agents.ts` - spawn Claude Code via `agentfs run`
9. `src/orchestrator/context-parser.ts` - regex extraction of JSON block from panic_context.md

### Phase 4: Orchestrator - Workflow Engine

10. `src/orchestrator/git.ts` - branch creation, squash commits
11. `src/orchestrator/pr.ts` - create draft PR via `gh pr create`
12. `src/orchestrator/workflow.ts` - state machine with transitions: // change of plans: use a orchestrator/workflow/ dir with a file per state
    - pending → repo_setup → reproducing → fixing → shipping → pr_open
    - any → needs_human_review (on error)
13. `src/orchestrator/index.ts` - CLI entry point with main loop and graceful shutdown

### Phase 5: MCP Tools

14. `src/tools/server.ts` - MCP server setup exposing all tools
15. `src/tools/run-simulator.ts` - execute simulator, send IPC callbacks
16. `src/tools/describe-sim-fix.ts` - validate and return success
17. `src/tools/describe-fix.ts` - validate and return success
18. `src/tools/validate-fix-fast.ts` - run `make test-single`
19. `src/tools/validate-fix-slow.ts` - run `make test` + simulator 10x

### Phase 6: Agent Prompts

20. `prompts/reproducer.md` - instructions for reproducer agent
21. `prompts/fixer.md` - instructions for fixer agent

## Key Files to Create (in order)

| #  | File                                 | Purpose                                 |
|----|--------------------------------------|-----------------------------------------|
| 1  | `src/orchestrator/config.ts`         | Load env vars, provide typed Config     |
| 2  | `src/orchestrator/database.ts`       | Turso client, CRUD for panic_fixes      |
| 3  | `src/orchestrator/logger.ts`         | Log to DB with structured payloads      |
| 4  | `src/orchestrator/ipc-server.ts`     | Track sim runtime for timeout exclusion |
| 5  | `src/orchestrator/sandbox.ts`        | Create/delete AgentFS sessions          |
| 6  | `src/orchestrator/agents.ts`         | Spawn Claude in sandbox with MCP        |
| 7  | `src/orchestrator/context-parser.ts` | Extract JSON from markdown              |
| 8  | `src/orchestrator/git.ts`            | Git branch, squash operations           |
| 9  | `src/orchestrator/pr.ts`             | Open draft PR via gh CLI                |
| 10 | `src/orchestrator/workflow.ts`       | State machine orchestration             |
| 11 | `src/orchestrator/index.ts`          | Main entry point                        |
| 12 | `src/tools/server.ts`                | MCP server                              |
| 13 | `src/tools/run-simulator.ts`         | Simulator tool                          |
| 14 | `src/tools/describe-sim-fix.ts`      | Describe sim fix tool                   |
| 15 | `src/tools/describe-fix.ts`          | Describe fix tool                       |
| 16 | `src/tools/validate-fix-fast.ts`     | Fast validation tool                    |
| 17 | `src/tools/validate-fix-slow.ts`     | Slow validation tool                    |
| 18 | `prompts/reproducer.md`              | Reproducer agent prompt                 |
| 19 | `prompts/fixer.md`                   | Fixer agent prompt                      |

## Dependencies to Add

```json
{
  "dependencies": {
    "@libsql/client": "^0.14.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21"
  }
}
```

## Verification

1. Run `npx tsc` - verify compilation
2. Run `npx tsx src/orchestrator/index.ts` - verify startup/shutdown
3. Run `npx tsx src/tools/server.ts` - verify MCP server starts

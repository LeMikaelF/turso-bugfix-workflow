# Turso Panic Fix Workflow - Implementation Plan

## Overview

Implement the automated panic fix workflow system as described in `architecture/design.md`. The system consists of:

1. **Orchestrator** - TypeScript workflow controller that manages the state machine, spawns Claude Code agents in
   AgentFS sandboxes, handles timeouts, and opens PRs
2. **MCP Tools** - Tools for agents to run the simulator, validate fixes, create plans, and document changes
3. **Agent Prompts** - Prompt files for Planner and Implementer agents (4 agent types total)

## Directory Structure (Single Package)

```
panic-fix-workflow/
├── src/
│   ├── orchestrator/
│   │   ├── index.ts              # Entry point, CLI
│   │   ├── config.ts             # Configuration (properties.json)
│   │   ├── database.ts           # Turso client
│   │   ├── logger.ts             # Structured logging to DB
│   │   ├── ipc-server.ts         # HTTP server for timeout tracking
│   │   ├── sandbox.ts            # AgentFS management
│   │   ├── agents.ts             # Claude Code spawning (6 functions)
│   │   ├── git.ts                # Git operations
│   │   ├── pr.ts                 # GitHub PR creation
│   │   ├── encoding.ts           # Panic location encoding
│   │   ├── context-parser.ts     # Validate panic_context.json
│   │   ├── context-json.ts       # Read/write panic_context.json
│   │   ├── plan-files.ts         # Plan file utilities
│   │   └── workflow/
│   │       ├── index.ts          # WorkflowOrchestrator class
│   │       ├── types.ts          # Shared types
│   │       └── states/
│   │           ├── index.ts      # State handler exports
│   │           ├── preflight.ts  # Verify base repo builds
│   │           ├── repo-setup.ts # Create branch, context files
│   │           ├── reproducing.ts # Run reproducer agents
│   │           ├── fixing.ts     # Run fixer agents
│   │           └── shipping.ts   # Squash, push, create PR
│   └── tools/
│       ├── server.ts             # MCP server (6 tools)
│       ├── run-simulator.ts      # Run simulator with seed
│       ├── describe-sim-fix.ts   # Document simulator changes
│       ├── describe-fix.ts       # Document bug fix
│       ├── validate-fix.ts       # Run validation tests
│       ├── write-reproducer-plan.ts # Create reproducer plan
│       └── write-fixer-plan.ts   # Create fixer plan
├── prompts/
│   ├── reproducer.md             # Legacy reproducer prompt
│   ├── reproducer-planner.md     # Reproducer planner prompt
│   ├── reproducer-implementer.md # Reproducer implementer prompt
│   ├── fixer.md                  # Legacy fixer prompt
│   ├── fixer-planner.md          # Fixer planner prompt
│   └── fixer-implementer.md      # Fixer implementer prompt
├── architecture/                  # (existing)
├── package.json
├── tsconfig.json
└── properties.json               # Configuration
```

## Implementation Steps

### Phase 1: Project Setup

1. Update `package.json` with dependencies:
    - `@libsql/client` - Turso database
    - `express` + `@types/express` - IPC HTTP server
    - `@modelcontextprotocol/sdk` - MCP server
    - `zod` - Schema validation
2. Update `tsconfig.json` for Node.js

### Phase 2: Orchestrator - Core Infrastructure

3. `src/orchestrator/config.ts` - configuration loading from properties.json
4. `src/orchestrator/database.ts` - Turso client wrapper with query methods
5. `src/orchestrator/logger.ts` - structured logging to DB logs table
6. `src/orchestrator/ipc-server.ts` - Express server on port 9100 for sim timeout tracking

### Phase 3: Orchestrator - Sandbox & Agent Management

7. `src/orchestrator/sandbox.ts` - AgentFS session create/delete
8. `src/orchestrator/agents.ts` - spawn Claude Code via `agentfs run` (6 agent spawn functions)
9. `src/orchestrator/context-parser.ts` - validation of panic_context.json data
10. `src/orchestrator/context-json.ts` - read/write panic_context.json file
11. `src/orchestrator/plan-files.ts` - utilities for *_plan.md files

### Phase 4: Orchestrator - Workflow Engine

12. `src/orchestrator/git.ts` - branch creation, squash commits
13. `src/orchestrator/pr.ts` - create draft PR via `gh pr create`
14. `src/orchestrator/workflow/` - state machine with separate state handlers:
    - `states/preflight.ts` - verify base repo
    - `states/repo-setup.ts` - create sandbox, branch, context files
    - `states/reproducing.ts` - run reproducer planner + implementer
    - `states/fixing.ts` - run fixer planner + implementer
    - `states/shipping.ts` - squash, push, create PR
15. `src/orchestrator/index.ts` - CLI entry point with main loop and graceful shutdown

### Phase 5: MCP Tools

16. `src/tools/server.ts` - MCP server setup exposing all 6 tools
17. `src/tools/run-simulator.ts` - execute simulator, send IPC callbacks
18. `src/tools/describe-sim-fix.ts` - validate and update panic_context.json
19. `src/tools/describe-fix.ts` - validate and update panic_context.json
20. `src/tools/validate-fix.ts` - run tests and simulator
21. `src/tools/write-reproducer-plan.ts` - create reproducer_plan.md
22. `src/tools/write-fixer-plan.ts` - create fixer_plan.md

### Phase 6: Agent Prompts

23. `prompts/reproducer-planner.md` - instructions for reproducer planner agent
24. `prompts/reproducer-implementer.md` - instructions for reproducer implementer agent
25. `prompts/fixer-planner.md` - instructions for fixer planner agent
26. `prompts/fixer-implementer.md` - instructions for fixer implementer agent

## Key Files to Create (in order)

| #  | File                                     | Purpose                                 |
|----|------------------------------------------|-----------------------------------------|
| 1  | `src/orchestrator/config.ts`             | Load properties.json, provide typed Config |
| 2  | `src/orchestrator/database.ts`           | Turso client, CRUD for panic_fixes      |
| 3  | `src/orchestrator/logger.ts`             | Log to DB with structured payloads      |
| 4  | `src/orchestrator/ipc-server.ts`         | Track sim runtime for timeout exclusion |
| 5  | `src/orchestrator/sandbox.ts`            | Create/delete AgentFS sessions          |
| 6  | `src/orchestrator/agents.ts`             | Spawn Claude in sandbox (6 functions)   |
| 7  | `src/orchestrator/context-parser.ts`     | Validate panic_context.json data        |
| 8  | `src/orchestrator/context-json.ts`       | Read/write panic_context.json file      |
| 9  | `src/orchestrator/plan-files.ts`         | Plan file utilities                     |
| 10 | `src/orchestrator/git.ts`                | Git branch, squash operations           |
| 11 | `src/orchestrator/pr.ts`                 | Open draft PR via gh CLI                |
| 12 | `src/orchestrator/workflow/index.ts`     | WorkflowOrchestrator class              |
| 13 | `src/orchestrator/workflow/states/*.ts`  | State handlers                          |
| 14 | `src/orchestrator/index.ts`              | Main entry point                        |
| 15 | `src/tools/server.ts`                    | MCP server (6 tools)                    |
| 16 | `src/tools/run-simulator.ts`             | Simulator tool                          |
| 17 | `src/tools/describe-sim-fix.ts`          | Describe sim fix tool                   |
| 18 | `src/tools/describe-fix.ts`              | Describe fix tool                       |
| 19 | `src/tools/validate-fix.ts`              | Validation tool                         |
| 20 | `src/tools/write-reproducer-plan.ts`     | Reproducer plan tool                    |
| 21 | `src/tools/write-fixer-plan.ts`          | Fixer plan tool                         |
| 22 | `prompts/reproducer-planner.md`          | Reproducer planner prompt               |
| 23 | `prompts/reproducer-implementer.md`      | Reproducer implementer prompt           |
| 24 | `prompts/fixer-planner.md`               | Fixer planner prompt                    |
| 25 | `prompts/fixer-implementer.md`           | Fixer implementer prompt                |

## Dependencies

```json
{
  "dependencies": {
    "@libsql/client": "^0.14.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "express": "^4.21.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "vitest": "^2.0.0"
  }
}
```

## Verification

1. Run `npx tsc` - verify compilation
2. Run `npx tsx src/orchestrator/index.ts` - verify startup/shutdown
3. Run `npx tsx src/tools/server.ts` - verify MCP server starts
4. Run `npm test` - verify all tests pass

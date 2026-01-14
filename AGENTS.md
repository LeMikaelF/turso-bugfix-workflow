# Agent Instructions

This document provides context for AI coding assistants working on this project.

## Project Overview

Automated system to reproduce, fix, and ship patches for panics in the Turso database. Uses Claude Code agents running in isolated AgentFS sandboxes with MCP tools.

## Tech Stack

- Language: TypeScript (ES modules)
- Runtime: Node.js 18+
- Database: Turso
- Testing: Vitest
- Linting: ESLint + Prettier

## Project Structure

```
src/
├── orchestrator/          # Main workflow orchestration
│   ├── index.ts           # CLI entry point
│   ├── config.ts          # Configuration loading
│   ├── database.ts        # Turso client wrapper
│   ├── workflow/          # State machine
│   │   ├── index.ts       # WorkflowOrchestrator class
│   │   └── states/        # State handlers (preflight, repo-setup, etc.)
│   └── __tests__/         # Tests
└── tools/                 # MCP tools for agents
    ├── server.ts          # MCP server setup
    └── *.ts               # Individual tools
```

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

The project uses `properties.json` in the root for configuration. Required fields:
- `tursoUrl` - Database URL
- `tursoAuthToken` - Auth token
- `githubToken` - GitHub PAT

See `src/orchestrator/config.ts` for the full schema and defaults.

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

### MCP Tools
Tools in `src/tools/` follow the MCP SDK pattern. Each tool exports a registration function that takes the MCP server instance.

### Encoding
`src/orchestrator/encoding.ts` handles panic location encoding for URLs and branch names (e.g., `src/vdbe.c:1234` → `src-vdbe.c-1234`).

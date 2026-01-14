// Fixing state handler - spawns the fixer agent

import type { StateHandler, StateResult } from "../types.js";
import { spawnFixerAgent } from "../../agents.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default prompt path - can be overridden via config in the future
const DEFAULT_FIXER_PROMPT_PATH = join(__dirname, "../../../../prompts/fixer.md");

/**
 * Spawn the fixer agent to fix the panic.
 * The agent will:
 * 1. Analyze the root cause of the panic
 * 2. Implement a fix
 * 3. Validate with fast and slow tests
 * 4. Document the fix
 * 5. Update panic_context.md
 * 6. Commit changes
 */
export const handleFixing: StateHandler = async (ctx): Promise<StateResult> => {
  const { logger, panic, sessionName, config, ipcServer } = ctx;
  const panicLocation = panic.panic_location;

  await logger.info(panicLocation, "fixer", "Spawning fixer agent", {
    timeoutMs: config.fixerTimeoutMs,
  });

  const result = await spawnFixerAgent(
    sessionName,
    panicLocation,
    DEFAULT_FIXER_PROMPT_PATH,
    config,
    ipcServer
  );

  if (result.timedOut) {
    await logger.error(panicLocation, "fixer", "Agent timed out", {
      elapsedMs: result.elapsedMs,
      timeoutMs: config.fixerTimeoutMs,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Fixer agent timed out after ${result.elapsedMs}ms (limit: ${config.fixerTimeoutMs}ms)`,
    };
  }

  if (!result.success) {
    await logger.error(panicLocation, "fixer", "Agent failed", {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 500),
    });
    return {
      nextStatus: "needs_human_review",
      error: `Fixer agent failed with exit code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
    };
  }

  await logger.info(panicLocation, "fixer", "Agent completed successfully", {
    elapsedMs: result.elapsedMs,
  });

  return { nextStatus: "shipping" };
};

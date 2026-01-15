// Reproducing state handler - spawns the reproducer agent

import type { StateHandler, StateResult } from "../types.js";
import { spawnReproducerAgent, setupMcpTools } from "../../agents.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default prompt path - can be overridden via config in the future
const DEFAULT_REPRODUCER_PROMPT_PATH = join(__dirname, "../../../../prompts/reproducer.md");

/**
 * Spawn the reproducer agent to extend the simulator.
 * The agent will:
 * 1. Analyze the panic and SQL statements
 * 2. Extend the simulator to generate similar statements
 * 3. Run the simulator until the panic is reproduced
 * 4. Record the failing seed
 * 5. Document simulator changes
 * 6. Update panic_context.md
 *
 * After the agent succeeds, the orchestrator commits the changes.
 */
export const handleReproducing: StateHandler = async (ctx): Promise<StateResult> => {
  const { logger, panic, sessionName, config, ipcServer, sandbox } = ctx;
  const panicLocation = panic.panic_location;

  await logger.info(panicLocation, "reproducer", "Setting up MCP tools");

  try {
    await setupMcpTools(sessionName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(panicLocation, "reproducer", "Failed to setup MCP tools", {
      error: message,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Failed to setup MCP tools: ${message}`,
    };
  }

  await logger.info(panicLocation, "reproducer", "Spawning reproducer agent", {
    timeoutMs: config.reproducerTimeoutMs,
  });

  const result = await spawnReproducerAgent(
    sessionName,
    panicLocation,
    DEFAULT_REPRODUCER_PROMPT_PATH,
    config,
    ipcServer
  );

  if (result.timedOut) {
    await logger.error(panicLocation, "reproducer", "Agent timed out", {
      elapsedMs: result.elapsedMs,
      timeoutMs: config.reproducerTimeoutMs,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Reproducer agent timed out after ${result.elapsedMs}ms (limit: ${config.reproducerTimeoutMs}ms)`,
    };
  }

  if (!result.success) {
    await logger.error(panicLocation, "reproducer", "Agent failed", {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 500),
    });
    return {
      nextStatus: "needs_human_review",
      error: `Reproducer agent failed with exit code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
    };
  }

  await logger.info(panicLocation, "reproducer", "Agent completed successfully", {
    elapsedMs: result.elapsedMs,
  });

  // Commit changes made by the reproducer agent
  await logger.info(panicLocation, "reproducer", "Committing reproducer changes");

  const addResult = await sandbox.runInSession(sessionName, "git add -A");
  if (addResult.exitCode !== 0) {
    await logger.error(panicLocation, "reproducer", "Failed to stage changes", {
      stderr: addResult.stderr,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Failed to stage changes: ${addResult.stderr}`,
    };
  }

  const commitMessage = `reproducer: ${panicLocation}`;
  const commitResult = await sandbox.runInSession(
    sessionName,
    `git commit -m '${commitMessage.replace(/'/g, "'\\''")}'`
  );
  if (commitResult.exitCode !== 0) {
    // Check if it's a "nothing to commit" situation - proceed anyway
    const output = commitResult.stderr + commitResult.stdout;
    if (output.includes("nothing to commit")) {
      await logger.warn(panicLocation, "reproducer", "No changes to commit (proceeding)");
    } else {
      await logger.error(panicLocation, "reproducer", "Failed to commit changes", {
        stderr: commitResult.stderr,
      });
      return {
        nextStatus: "needs_human_review",
        error: `Failed to commit changes: ${commitResult.stderr}`,
      };
    }
  } else {
    await logger.info(panicLocation, "reproducer", "Changes committed successfully");
  }

  return { nextStatus: "fixing" };
};

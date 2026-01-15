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
 *
 * After the agent succeeds, the orchestrator runs clippy/fmt and commits the changes.
 */
export const handleFixing: StateHandler = async (ctx): Promise<StateResult> => {
  const { logger, panic, sessionName, config, ipcServer, sandbox } = ctx;
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

  // Run clippy and fmt before committing
  await logger.info(panicLocation, "fixer", "Running clippy and fmt");

  const clippyResult = await sandbox.runInSession(
    sessionName,
    "cargo clippy --fix --allow-dirty --all-features"
  );
  if (clippyResult.exitCode !== 0) {
    await logger.warn(panicLocation, "fixer", "Clippy fix failed (continuing)", {
      stderr: clippyResult.stderr.slice(0, 200),
    });
  }

  const fmtResult = await sandbox.runInSession(sessionName, "cargo fmt");
  if (fmtResult.exitCode !== 0) {
    await logger.warn(panicLocation, "fixer", "Cargo fmt failed (continuing)", {
      stderr: fmtResult.stderr.slice(0, 200),
    });
  }

  // Commit changes made by the fixer agent
  await logger.info(panicLocation, "fixer", "Committing fixer changes");

  const addResult = await sandbox.runInSession(sessionName, "git add -A");
  if (addResult.exitCode !== 0) {
    await logger.error(panicLocation, "fixer", "Failed to stage changes", {
      stderr: addResult.stderr,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Failed to stage changes: ${addResult.stderr}`,
    };
  }

  const commitMessage = `fix: ${panicLocation}`;
  const commitResult = await sandbox.runInSession(
    sessionName,
    `git commit -m '${commitMessage.replace(/'/g, "'\\''")}'`
  );
  if (commitResult.exitCode !== 0) {
    // Check if it's a "nothing to commit" situation - proceed anyway
    const output = commitResult.stderr + commitResult.stdout;
    if (output.includes("nothing to commit")) {
      await logger.warn(panicLocation, "fixer", "No changes to commit (proceeding)");
    } else {
      await logger.error(panicLocation, "fixer", "Failed to commit changes", {
        stderr: commitResult.stderr,
      });
      return {
        nextStatus: "needs_human_review",
        error: `Failed to commit changes: ${commitResult.stderr}`,
      };
    }
  } else {
    await logger.info(panicLocation, "fixer", "Changes committed successfully");
  }

  return { nextStatus: "shipping" };
};

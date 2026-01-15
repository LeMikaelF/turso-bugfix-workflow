// Fixing state handler - spawns planner then implementer agents

import type { StateHandler, StateResult } from "../types.js";
import {
  spawnFixerPlannerAgent,
  spawnFixerImplementerAgent,
} from "../../agents.js";
import { FIXER_PLAN_FILE } from "../../plan-files.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Prompt paths
const FIXER_PLANNER_PROMPT_PATH = join(__dirname, "../../../../prompts/fixer-planner.md");
const FIXER_IMPLEMENTER_PROMPT_PATH = join(__dirname, "../../../../prompts/fixer-implementer.md");

/**
 * Run the fixer planner agent.
 * Returns error result if planner fails or doesn't create plan file.
 */
async function runFixerPlanner(ctx: Parameters<StateHandler>[0]): Promise<StateResult | null> {
  const { logger, panic, sessionName, config, ipcServer, sandbox } = ctx;
  const panicLocation = panic.panic_location;

  await logger.info(panicLocation, "fixer-planner", "Spawning fixer planner agent", {
    timeoutMs: config.fixerPlannerTimeoutMs,
  });

  const result = await spawnFixerPlannerAgent(
    sessionName,
    panicLocation,
    FIXER_PLANNER_PROMPT_PATH,
    config,
    ipcServer
  );

  if (result.timedOut) {
    await logger.error(panicLocation, "fixer-planner", "Agent timed out", {
      elapsedMs: result.elapsedMs,
      timeoutMs: config.fixerPlannerTimeoutMs,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Fixer planner agent timed out after ${result.elapsedMs}ms (limit: ${config.fixerPlannerTimeoutMs}ms)`,
    };
  }

  if (!result.success) {
    await logger.error(panicLocation, "fixer-planner", "Agent failed", {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 500),
    });
    return {
      nextStatus: "needs_human_review",
      error: `Fixer planner agent failed with exit code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
    };
  }

  await logger.info(panicLocation, "fixer-planner", "Agent completed successfully", {
    elapsedMs: result.elapsedMs,
  });

  // Verify plan file was created (check inside sandbox filesystem)
  const planCheckResult = await sandbox.runInSession(
    sessionName,
    `test -f ${FIXER_PLAN_FILE} && echo exists`
  );
  const planExists = planCheckResult.stdout.trim() === "exists";
  if (!planExists) {
    await logger.error(panicLocation, "fixer-planner", "Plan file not created", {
      expectedFile: FIXER_PLAN_FILE,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Fixer planner agent did not create ${FIXER_PLAN_FILE}`,
    };
  }

  await logger.info(panicLocation, "fixer-planner", "Plan file created successfully");

  // Planner succeeded, continue to implementer
  return null;
}

/**
 * Run the fixer implementer agent.
 * Returns error result if implementer fails.
 */
async function runFixerImplementer(ctx: Parameters<StateHandler>[0]): Promise<StateResult> {
  const { logger, panic, sessionName, config, ipcServer, sandbox } = ctx;
  const panicLocation = panic.panic_location;

  await logger.info(panicLocation, "fixer-implementer", "Spawning fixer implementer agent", {
    timeoutMs: config.fixerImplementerTimeoutMs,
  });

  const result = await spawnFixerImplementerAgent(
    sessionName,
    panicLocation,
    FIXER_IMPLEMENTER_PROMPT_PATH,
    config,
    ipcServer
  );

  if (result.timedOut) {
    await logger.error(panicLocation, "fixer-implementer", "Agent timed out", {
      elapsedMs: result.elapsedMs,
      timeoutMs: config.fixerImplementerTimeoutMs,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Fixer implementer agent timed out after ${result.elapsedMs}ms (limit: ${config.fixerImplementerTimeoutMs}ms)`,
    };
  }

  if (!result.success) {
    await logger.error(panicLocation, "fixer-implementer", "Agent failed", {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 500),
    });
    return {
      nextStatus: "needs_human_review",
      error: `Fixer implementer agent failed with exit code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
    };
  }

  await logger.info(panicLocation, "fixer-implementer", "Agent completed successfully", {
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

  // Commit changes made by the fixer agents
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
}

/**
 * Handle the fixing state by running planner then implementer agents.
 *
 * Workflow:
 * 1. Run planner agent (creates fixer_plan.md)
 * 2. Verify plan file was created
 * 3. Run implementer agent (follows plan, implements fix)
 * 4. Run clippy and fmt
 * 5. Commit changes
 * 6. Transition to shipping state
 */
export const handleFixing: StateHandler = async (ctx): Promise<StateResult> => {
  const { logger, panic } = ctx;
  const panicLocation = panic.panic_location;

  await logger.info(panicLocation, "fixer", "Starting fixer phase");

  // Run planner agent
  const plannerResult = await runFixerPlanner(ctx);
  if (plannerResult !== null) {
    return plannerResult;
  }

  // Run implementer agent
  const implementerResult = await runFixerImplementer(ctx);
  return implementerResult;
};

// Reproducing state handler - spawns planner then implementer agents

import type { StateHandler, StateResult } from "../types.js";
import {
  spawnReproducerPlannerAgent,
  spawnReproducerImplementerAgent,
  setupMcpTools,
} from "../../agents.js";
import { REPRODUCER_PLAN_FILE } from "../../plan-files.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Prompt paths
const REPRODUCER_PLANNER_PROMPT_PATH = join(__dirname, "../../../../prompts/reproducer-planner.md");
const REPRODUCER_IMPLEMENTER_PROMPT_PATH = join(__dirname, "../../../../prompts/reproducer-implementer.md");

/**
 * Run the reproducer planner agent.
 * Returns error result if planner fails or doesn't create plan file.
 */
async function runReproducerPlanner(ctx: Parameters<StateHandler>[0]): Promise<StateResult | null> {
  const { logger, panic, sessionName, config, ipcServer, sandbox } = ctx;
  const panicLocation = panic.panic_location;

  await logger.info(panicLocation, "reproducer-planner", "Spawning reproducer planner agent", {
    timeoutMs: config.reproducerPlannerTimeoutMs,
  });

  const result = await spawnReproducerPlannerAgent(
    sessionName,
    panicLocation,
    REPRODUCER_PLANNER_PROMPT_PATH,
    config,
    ipcServer
  );

  if (result.timedOut) {
    await logger.error(panicLocation, "reproducer-planner", "Agent timed out", {
      elapsedMs: result.elapsedMs,
      timeoutMs: config.reproducerPlannerTimeoutMs,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Reproducer planner agent timed out after ${result.elapsedMs}ms (limit: ${config.reproducerPlannerTimeoutMs}ms)`,
    };
  }

  if (!result.success) {
    await logger.error(panicLocation, "reproducer-planner", "Agent failed", {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 500),
    });
    return {
      nextStatus: "needs_human_review",
      error: `Reproducer planner agent failed with exit code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
    };
  }

  await logger.info(panicLocation, "reproducer-planner", "Agent completed successfully", {
    elapsedMs: result.elapsedMs,
  });

  // Verify plan file was created (check inside sandbox filesystem)
  const planCheckResult = await sandbox.runInSession(
    sessionName,
    `test -f ${REPRODUCER_PLAN_FILE} && echo exists`
  );
  const planExists = planCheckResult.stdout.trim() === "exists";
  if (!planExists) {
    await logger.error(panicLocation, "reproducer-planner", "Plan file not created", {
      expectedFile: REPRODUCER_PLAN_FILE,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Reproducer planner agent did not create ${REPRODUCER_PLAN_FILE}`,
    };
  }

  await logger.info(panicLocation, "reproducer-planner", "Plan file created successfully");

  // Planner succeeded, continue to implementer
  return null;
}

/**
 * Run the reproducer implementer agent.
 * Returns error result if implementer fails.
 */
async function runReproducerImplementer(ctx: Parameters<StateHandler>[0]): Promise<StateResult> {
  const { logger, panic, sessionName, config, ipcServer, sandbox } = ctx;
  const panicLocation = panic.panic_location;

  await logger.info(panicLocation, "reproducer-implementer", "Spawning reproducer implementer agent", {
    timeoutMs: config.reproducerImplementerTimeoutMs,
  });

  const result = await spawnReproducerImplementerAgent(
    sessionName,
    panicLocation,
    REPRODUCER_IMPLEMENTER_PROMPT_PATH,
    config,
    ipcServer
  );

  if (result.timedOut) {
    await logger.error(panicLocation, "reproducer-implementer", "Agent timed out", {
      elapsedMs: result.elapsedMs,
      timeoutMs: config.reproducerImplementerTimeoutMs,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Reproducer implementer agent timed out after ${result.elapsedMs}ms (limit: ${config.reproducerImplementerTimeoutMs}ms)`,
    };
  }

  if (!result.success) {
    await logger.error(panicLocation, "reproducer-implementer", "Agent failed", {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 500),
    });
    return {
      nextStatus: "needs_human_review",
      error: `Reproducer implementer agent failed with exit code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
    };
  }

  await logger.info(panicLocation, "reproducer-implementer", "Agent completed successfully", {
    elapsedMs: result.elapsedMs,
  });

  // Commit changes made by the reproducer agents
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
}

/**
 * Handle the reproducing state by running planner then implementer agents.
 *
 * Workflow:
 * 1. Setup MCP tools
 * 2. Run planner agent (creates reproducer_plan.md)
 * 3. Verify plan file was created
 * 4. Run implementer agent (follows plan, reproduces panic)
 * 5. Commit changes
 * 6. Transition to fixing state
 */
export const handleReproducing: StateHandler = async (ctx): Promise<StateResult> => {
  const { logger, panic, sessionName } = ctx;
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

  // Run planner agent
  const plannerResult = await runReproducerPlanner(ctx);
  if (plannerResult !== null) {
    return plannerResult;
  }

  // Run implementer agent
  const implementerResult = await runReproducerImplementer(ctx);
  return implementerResult;
};

// Preflight state handler - verifies base repo builds and tests pass
// This is a one-time check that runs at orchestrator startup, not per-panic

import type { StateHandler, StateResult } from "../types.js";

/**
 * Verify the base repository builds and passes tests.
 * This ensures the base environment is healthy before processing panics.
 */
export const handlePreflight: StateHandler = async (ctx): Promise<StateResult> => {
  const { logger, sandbox, sessionName, panic } = ctx;
  const panicLocation = panic.panic_location;

  await logger.info(panicLocation, "preflight", "Verifying base repo builds");

  // Run build
  const buildResult = await sandbox.runInSession(sessionName, "make");
  if (buildResult.exitCode !== 0) {
    await logger.error(panicLocation, "preflight", "Build failed", {
      stderr: buildResult.stderr.slice(0, 1000),
    });
    return {
      nextStatus: "needs_human_review",
      error: `Build failed: ${buildResult.stderr.slice(0, 500)}`,
    };
  }

  await logger.info(panicLocation, "preflight", "Build successful, running tests");

  // Run tests
  const testResult = await sandbox.runInSession(sessionName, "make test");
  if (testResult.exitCode !== 0) {
    await logger.error(panicLocation, "preflight", "Tests failed", {
      stderr: testResult.stderr.slice(0, 1000),
    });
    return {
      nextStatus: "needs_human_review",
      error: `Tests failed: ${testResult.stderr.slice(0, 500)}`,
    };
  }

  await logger.info(panicLocation, "preflight", "Preflight checks passed");
  return { nextStatus: "repo_setup" };
};

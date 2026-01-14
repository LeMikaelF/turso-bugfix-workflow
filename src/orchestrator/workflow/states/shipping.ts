// Shipping state handler - parse context, squash commits, push, create PR

import type { StateHandler, StateResult } from "../types.js";
import { parseAndValidate } from "../../context-parser.js";
import { squashCommits } from "../../git.js";
import { createPullRequest } from "../../pr.js";

/**
 * Ship the fix:
 * 1. Read and parse panic_context.md
 * 2. Validate all required fields are present
 * 3. Delete panic_context.md (not needed in final commit)
 * 4. Squash all commits into one well-formatted commit
 * 5. Push branch to origin
 * 6. Create draft pull request
 */
export const handleShipping: StateHandler = async (ctx): Promise<StateResult> => {
  const { logger, panic, sandbox, sessionName, branchName, config } = ctx;
  const panicLocation = panic.panic_location;

  await logger.info(panicLocation, "ship", "Reading panic_context.md");

  // Read context file
  const catResult = await sandbox.runInSession(sessionName, "cat panic_context.md");
  if (catResult.exitCode !== 0) {
    await logger.error(panicLocation, "ship", "Failed to read context file", {
      stderr: catResult.stderr,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Failed to read context file: ${catResult.stderr}`,
    };
  }

  // Parse and validate context
  const parseResult = parseAndValidate(catResult.stdout, "ship");
  if (!parseResult.success || !parseResult.valid || !parseResult.data) {
    const errors = parseResult.errors.join(", ");
    await logger.error(panicLocation, "ship", "Context validation failed", { errors });
    return {
      nextStatus: "needs_human_review",
      error: `Context validation failed: ${errors}`,
    };
  }

  const contextData = parseResult.data;
  await logger.info(panicLocation, "ship", "Context validated successfully");

  // Delete context file (not needed in final commit)
  await logger.info(panicLocation, "ship", "Deleting panic_context.md");
  const rmResult = await sandbox.runInSession(sessionName, "rm panic_context.md");
  if (rmResult.exitCode !== 0) {
    await logger.warn(panicLocation, "ship", "Failed to delete context file", {
      stderr: rmResult.stderr,
    });
    // Continue anyway - not critical
  }

  // Stage the deletion
  await sandbox.runInSession(sessionName, "git add -A");

  // Squash all commits
  await logger.info(panicLocation, "ship", "Squashing commits");
  const squashResult = await squashCommits({ sessionName, contextData }, sandbox);
  if (!squashResult.success) {
    const errorMsg = squashResult.error ?? "Unknown error squashing commits";
    await logger.error(panicLocation, "ship", "Failed to squash commits", {
      error: errorMsg,
    });
    return {
      nextStatus: "needs_human_review",
      error: errorMsg,
    };
  }

  // Push branch
  await logger.info(panicLocation, "ship", "Pushing branch", { branchName });
  const pushResult = await sandbox.runInSession(
    sessionName,
    `git push -u origin ${branchName}`
  );
  if (pushResult.exitCode !== 0) {
    await logger.error(panicLocation, "ship", "Failed to push branch", {
      stderr: pushResult.stderr,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Failed to push: ${pushResult.stderr}`,
    };
  }

  // Create pull request
  await logger.info(panicLocation, "ship", "Creating pull request");
  try {
    const prUrl = await createPullRequest(
      { sessionName, contextData },
      sandbox,
      config
    );

    await logger.info(panicLocation, "ship", "Pull request created", { prUrl });

    return {
      nextStatus: "pr_open",
      contextData,
      prUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(panicLocation, "ship", "Failed to create PR", {
      error: message,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Failed to create PR: ${message}`,
    };
  }
};

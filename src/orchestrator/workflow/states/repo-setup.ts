// Repo setup state handler - creates session, branch, TCL test, and panic_context.md

import type { StateHandler, StateResult } from "../types.js";
import { createBranch } from "../../git.js";
import { toSlug } from "../../encoding.js";
import { generateTclTest } from "../templates/tcl-test.js";
import { generateContextFile } from "../templates/context-file.js";

/**
 * Escape a string for safe use in a shell heredoc.
 * Replaces single quotes with escaped version.
 */
function escapeForHeredoc(str: string): string {
  return str.replace(/'/g, "'\\''");
}

/**
 * Set up the repository for panic fixing:
 * 1. Create a new branch
 * 2. Create TCL test file from SQL statements
 * 3. Create panic_context.md with initial JSON block
 * 4. Commit initial setup
 */
export const handleRepoSetup: StateHandler = async (ctx): Promise<StateResult> => {
  const { logger, sandbox, panic, sessionName, branchName } = ctx;
  const panicLocation = panic.panic_location;

  await logger.info(panicLocation, "repo_setup", "Creating branch", { branchName });

  // Create branch
  const branchResult = await createBranch({ sessionName, branchName }, sandbox);
  if (!branchResult.success) {
    const errorMsg = branchResult.error ?? "Unknown error creating branch";
    await logger.error(panicLocation, "repo_setup", "Failed to create branch", {
      error: errorMsg,
    });
    return {
      nextStatus: "needs_human_review",
      error: errorMsg,
    };
  }

  await logger.info(panicLocation, "repo_setup", "Creating TCL test file");

  // Create TCL test file from SQL statements
  const tclTestFile = `test/panic-${toSlug(panicLocation)}.test`;
  const tclContent = generateTclTest(panic.sql_statements, panic.panic_message, panicLocation);
  const escapedTclContent = escapeForHeredoc(tclContent);

  const writeTestResult = await sandbox.runInSession(
    sessionName,
    `cat > '${tclTestFile}' << 'ENDTCL'\n${escapedTclContent}\nENDTCL`
  );
  if (writeTestResult.exitCode !== 0) {
    await logger.error(panicLocation, "repo_setup", "Failed to create TCL test", {
      stderr: writeTestResult.stderr,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Failed to create TCL test: ${writeTestResult.stderr}`,
    };
  }

  await logger.info(panicLocation, "repo_setup", "Creating panic_context.md");

  // Create panic_context.md with initial JSON block
  const contextContent = generateContextFile(panic, tclTestFile);
  const escapedContextContent = escapeForHeredoc(contextContent);

  const writeContextResult = await sandbox.runInSession(
    sessionName,
    `cat > panic_context.md << 'ENDCTX'\n${escapedContextContent}\nENDCTX`
  );
  if (writeContextResult.exitCode !== 0) {
    await logger.error(panicLocation, "repo_setup", "Failed to create context file", {
      stderr: writeContextResult.stderr,
    });
    return {
      nextStatus: "needs_human_review",
      error: `Failed to create context file: ${writeContextResult.stderr}`,
    };
  }

  await logger.info(panicLocation, "repo_setup", "Committing initial setup");

  // Stage and commit
  const addResult = await sandbox.runInSession(sessionName, "git add -A");
  if (addResult.exitCode !== 0) {
    return {
      nextStatus: "needs_human_review",
      error: `Git add failed: ${addResult.stderr}`,
    };
  }

  const commitResult = await sandbox.runInSession(
    sessionName,
    `git commit -m 'setup: ${panicLocation}'`
  );
  if (commitResult.exitCode !== 0) {
    return {
      nextStatus: "needs_human_review",
      error: `Git commit failed: ${commitResult.stderr}`,
    };
  }

  await logger.info(panicLocation, "repo_setup", "Repo setup complete");
  return { nextStatus: "reproducing" };
};

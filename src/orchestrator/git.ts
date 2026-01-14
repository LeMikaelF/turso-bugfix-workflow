// Git operations for the panic-fix workflow
// Handles squashing commits into a single well-formatted commit

import type { PanicContextData } from "./context-parser.js";
import type { SandboxManager } from "./sandbox.js";

export interface SquashCommitsParams {
  sessionName: string;
  contextData: PanicContextData;
}

export interface SquashResult {
  success: boolean;
  error?: string;
}

/**
 * Build a formatted commit message from panic context data.
 */
export function buildCommitMessage(contextData: PanicContextData): string {
  const lines = [
    `fix: ${contextData.panic_message}`,
    "",
    `Location: ${contextData.panic_location}`,
    `Bug: ${contextData.bug_description ?? ""}`,
    `Fix: ${contextData.fix_description ?? ""}`,
    "",
    `Failing seed: ${contextData.failing_seed ?? ""}`,
    `Simulator: ${contextData.why_simulator_missed ?? ""}`,
  ];

  return lines.join("\n");
}

/**
 * Escape a string for safe use in a shell command.
 * Uses single quotes and escapes any single quotes in the string.
 */
function escapeForShell(str: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Squash all commits on the current branch into a single commit.
 *
 * This resets to the merge-base with main and creates a new commit
 * with all the changes and a formatted commit message.
 *
 * @param params - Session name and context data
 * @param sandbox - Sandbox manager for running commands
 * @returns Result indicating success or failure
 */
export async function squashCommits(
  params: SquashCommitsParams,
  sandbox: SandboxManager
): Promise<SquashResult> {
  const { sessionName, contextData } = params;

  const commitMessage = buildCommitMessage(contextData);
  const escapedMessage = escapeForShell(commitMessage);

  // First, reset to merge-base with main
  const resetResult = await sandbox.runInSession(
    sessionName,
    "git reset --soft $(git merge-base HEAD main)"
  );

  if (resetResult.exitCode !== 0) {
    return {
      success: false,
      error: `Git reset failed: ${resetResult.stderr}`,
    };
  }

  // Then, create the squashed commit
  const commitResult = await sandbox.runInSession(
    sessionName,
    `git commit -m ${escapedMessage}`
  );

  if (commitResult.exitCode !== 0) {
    return {
      success: false,
      error: `Git commit failed: ${commitResult.stderr}`,
    };
  }

  return { success: true };
}

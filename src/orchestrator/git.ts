// Git operations for the panic-fix workflow
// Handles branch creation and squashing commits into a single well-formatted commit

import type { PanicContextData } from "./context-parser.js";
import type { SandboxManager } from "./sandbox.js";

export interface CreateBranchParams {
  sessionName: string;
  branchName: string;
}

export interface CreateBranchResult {
  success: boolean;
  error?: string;
}

export interface SquashCommitsParams {
  sessionName: string;
  contextData: PanicContextData;
}

export interface SquashResult {
  success: boolean;
  error?: string;
}

/**
 * Create and checkout a new branch in the sandbox.
 *
 * @param params - Session name and branch name
 * @param sandbox - Sandbox manager for running commands
 * @returns Result indicating success or failure
 */
export async function createBranch(
  params: CreateBranchParams,
  sandbox: SandboxManager
): Promise<CreateBranchResult> {
  const { sessionName, branchName } = params;

  const result = await sandbox.runInSession(
    sessionName,
    `git checkout -b ${branchName}`
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: `Failed to create branch: ${result.stderr}`,
    };
  }

  return { success: true };
}

/**
 * Wrap text to a maximum line width, preserving words.
 * Lines are broken at word boundaries when possible.
 */
function wrapText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) {
    return text;
  }

  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.join("\n");
}

const SUBJECT_MAX_WIDTH = 72;
const BODY_MAX_WIDTH = 72;

/**
 * Build a formatted commit message from panic context data.
 * Subject line is truncated at 72 chars, body lines are wrapped at 72 chars.
 */
export function buildCommitMessage(contextData: PanicContextData): string {
  const subject = `fix: ${contextData.panic_message}`;
  const truncatedSubject =
    subject.length > SUBJECT_MAX_WIDTH
      ? subject.slice(0, SUBJECT_MAX_WIDTH - 3) + "..."
      : subject;

  const lines = [
    truncatedSubject,
    "",
    wrapText(`Location: ${contextData.panic_location}`, BODY_MAX_WIDTH),
    wrapText(`Bug: ${contextData.bug_description ?? ""}`, BODY_MAX_WIDTH),
    wrapText(`Fix: ${contextData.fix_description ?? ""}`, BODY_MAX_WIDTH),
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

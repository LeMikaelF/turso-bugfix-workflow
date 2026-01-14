// Pull request creation for the panic-fix workflow
// Uses GitHub CLI (gh) to create draft PRs with labels

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import type { PanicContextData } from "./context-parser.js";
import type { SandboxManager } from "./sandbox.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface CreatePullRequestParams {
  sessionName: string;
  contextData: PanicContextData;
}

/**
 * Load the PR body template from the templates directory.
 */
export async function loadPrTemplate(): Promise<string> {
  const templatePath = join(__dirname, "../../templates/pr-body.md");
  return readFile(templatePath, "utf-8");
}

/**
 * Format the PR body by replacing template placeholders with context data.
 * Placeholders are in the format {{field_name}}.
 */
export function formatPrBody(
  template: string,
  contextData: PanicContextData
): string {
  const replacements: Record<string, string> = {
    panic_location: contextData.panic_location,
    panic_message: contextData.panic_message,
    tcl_test_file: contextData.tcl_test_file,
    failing_seed: String(contextData.failing_seed ?? ""),
    why_simulator_missed: contextData.why_simulator_missed ?? "",
    simulator_changes: contextData.simulator_changes ?? "",
    bug_description: contextData.bug_description ?? "",
    fix_description: contextData.fix_description ?? "",
  };

  let body = template;
  for (const [key, value] of Object.entries(replacements)) {
    body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return body;
}

/**
 * Build the label flags for gh pr create.
 * Returns flags like: --label "label1" --label "label2"
 */
export function buildLabelFlags(labels: string[]): string {
  return labels.map((label) => `--label "${label}"`).join(" ");
}

/**
 * Escape a string for safe use in a shell command.
 * Uses single quotes and escapes any single quotes in the string.
 */
function escapeForShell(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Extract the PR URL from gh pr create output.
 * gh outputs the URL as the last line on success.
 */
export function extractPrUrl(output: string): string | null {
  // gh pr create outputs the URL on stdout
  // Example: https://github.com/owner/repo/pull/123
  const urlMatch = output.match(
    /https:\/\/github\.com\/[^\s]+\/pull\/\d+/
  );
  return urlMatch?.[0] ?? null;
}

/**
 * Create a draft pull request using GitHub CLI.
 *
 * @param params - Session name and context data
 * @param sandbox - Sandbox manager for running commands
 * @param config - Configuration with reviewer and labels
 * @returns The PR URL
 * @throws Error if PR creation fails
 */
export async function createPullRequest(
  params: CreatePullRequestParams,
  sandbox: SandboxManager,
  config: Pick<Config, "prReviewer" | "prLabels">
): Promise<string> {
  const { sessionName, contextData } = params;

  // Load and format template
  const template = await loadPrTemplate();
  const body = formatPrBody(template, contextData);

  // Build title
  const title = `fix: ${contextData.panic_message}`;

  // Build label flags
  const labelFlags = buildLabelFlags(config.prLabels);

  // Escape title and body for shell
  const escapedTitle = escapeForShell(title);
  const escapedBody = escapeForShell(body);

  // Build the gh pr create command
  const command = [
    "gh pr create",
    `--title ${escapedTitle}`,
    `--body ${escapedBody}`,
    "--draft",
    `--reviewer "${config.prReviewer}"`,
    labelFlags,
  ]
    .filter((part) => part.length > 0)
    .join(" ");

  const result = await sandbox.runInSession(sessionName, command);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create PR: ${result.stderr}`);
  }

  const prUrl = extractPrUrl(result.stdout);
  if (!prUrl) {
    throw new Error(
      `Failed to extract PR URL from output: ${result.stdout}`
    );
  }

  return prUrl;
}

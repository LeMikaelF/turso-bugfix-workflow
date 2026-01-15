// AgentFS session management - create, run commands, and delete sessions

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { unlink, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";

const execAsync = promisify(exec);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunInSessionOptions {
  timeoutMs?: number;
  cwd?: string;
}

/**
 * Run a command in an AgentFS session.
 * Sessions are created implicitly on first use.
 *
 * @param sessionName - The session name (e.g., "fix-panic-src-vdbe.c-1234")
 * @param command - The command to run inside the session
 * @param options - Optional timeout and working directory
 * @returns ExecResult with stdout, stderr, and exit code
 */
export async function runInSession(
  sessionName: string,
  command: string,
  options: RunInSessionOptions = {}
): Promise<ExecResult> {
  const { timeoutMs, cwd } = options;

  // Build the agentfs run command
  const agentfsCommand = `agentfs run --session ${sessionName} ${command}`;

  try {
    const execOptions: { timeout?: number; cwd?: string } = {};
    if (timeoutMs !== undefined) {
      execOptions.timeout = timeoutMs;
    }
    if (cwd !== undefined) {
      execOptions.cwd = cwd;
    }

    const { stdout, stderr } = await execAsync(agentfsCommand, execOptions);

    return {
      stdout,
      stderr,
      exitCode: 0,
    };
  } catch (error) {
    // exec throws on non-zero exit code
    if (isExecError(error)) {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        exitCode: error.code ?? 1,
      };
    }
    throw error;
  }
}

/**
 * Delete an AgentFS session by removing its database file.
 * Sessions are stored at .agentfs/{sessionName}.db
 *
 * @param sessionName - The session name to delete
 * @param agentfsDir - The directory containing .agentfs (defaults to cwd)
 */
export async function deleteSession(
  sessionName: string,
  agentfsDir: string = process.cwd()
): Promise<void> {
  const sessionPath = join(agentfsDir, ".agentfs", `${sessionName}.db`);

  try {
    await unlink(sessionPath);
  } catch (error) {
    // Ignore ENOENT - session already deleted or never existed
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

/**
 * Check if an AgentFS session exists.
 *
 * @param sessionName - The session name to check
 * @param agentfsDir - The directory containing .agentfs (defaults to cwd)
 * @returns true if the session exists, false otherwise
 */
export async function sessionExists(
  sessionName: string,
  agentfsDir: string = process.cwd()
): Promise<boolean> {
  const sessionPath = join(agentfsDir, ".agentfs", `${sessionName}.db`);

  try {
    await access(sessionPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Type guard for exec errors (exit code is a number)
interface ExecError extends Error {
  code?: number;
  stdout?: string;
  stderr?: string;
}

function isExecError(error: unknown): error is ExecError {
  return (
    error instanceof Error &&
    "code" in error &&
    (typeof (error as ExecError).code === "number" || (error as ExecError).code === undefined)
  );
}

// Type guard for Node.js errors with code (e.g., ENOENT, EACCES)
interface NodeError extends Error {
  code?: string;
}

function isNodeError(error: unknown): error is NodeError {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as NodeError).code === "string"
  );
}

// Sandbox manager interface for dependency injection
export interface SandboxManager {
  runInSession: (
    sessionName: string,
    command: string,
    options?: RunInSessionOptions
  ) => Promise<ExecResult>;
  deleteSession: (sessionName: string) => Promise<void>;
  sessionExists: (sessionName: string) => Promise<boolean>;
}

/**
 * Create a sandbox manager with configured defaults.
 *
 * @param config - Configuration with baseRepoPath
 * @returns SandboxManager instance
 */
export function createSandboxManager(
  config: Pick<Config, "baseRepoPath">
): SandboxManager {
  return {
    runInSession: (sessionName, command, options = {}) =>
      runInSession(sessionName, command, {
        cwd: config.baseRepoPath,
        ...options,
      }),
    deleteSession: (sessionName) => deleteSession(sessionName, config.baseRepoPath),
    sessionExists: (sessionName) => sessionExists(sessionName, config.baseRepoPath),
  };
}

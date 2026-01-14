// Validate fix (fast) tool for panic-fix-workflow
// Runs `make test-single` to quickly validate that a fix passes the single TCL test

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Default timeout for make test-single (5 minutes)
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB buffer

/**
 * Type guard for exec error objects from child_process.
 */
interface ExecError {
  code?: number;
  stdout?: string;
  stderr?: string;
  killed?: boolean;
  signal?: string;
}

function isExecError(error: unknown): error is ExecError {
  return (
    typeof error === "object" &&
    error !== null &&
    ("code" in error || "stdout" in error || "stderr" in error || "killed" in error)
  );
}

/**
 * Result of the fast validation process (make test-single).
 */
export interface ValidateFixFastResult {
  /** True if `make test-single` completed with exit code 0 */
  passed: boolean;
  /** Error message describing what failed (only set when passed is false) */
  error?: string;
  /** Standard output from the command */
  stdout?: string;
  /** Standard error from the command */
  stderr?: string;
}

/**
 * Run `make test-single` to quickly validate that a fix passes the single TCL test.
 *
 * This is the fast validation used by the Fixer agent for quick iteration.
 * The single TCL test is created during Repo Setup and tests the specific panic.
 *
 * @returns Result indicating if the test passed
 */
export async function validateFixFast(): Promise<ValidateFixFastResult> {
  try {
    const { stdout, stderr } = await execAsync("make test-single", {
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });

    return {
      passed: true,
      stdout,
      stderr,
    };
  } catch (error: unknown) {
    if (!isExecError(error)) {
      return {
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const stdout = error.stdout ?? "";
    const stderr = error.stderr ?? "";

    // Check if this was a timeout
    if (error.killed && error.signal === "SIGTERM") {
      return {
        passed: false,
        error: "Test timed out",
        stdout,
        stderr,
      };
    }

    // Non-zero exit code indicates test failure
    return {
      passed: false,
      error: stderr || `Test failed with exit code ${error.code ?? 1}`,
      stdout,
      stderr,
    };
  }
}

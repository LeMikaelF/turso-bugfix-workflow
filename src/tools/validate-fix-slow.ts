// Validate fix (slow) tool for panic-fix-workflow
// Runs `make test` + simulator 10x to thoroughly validate a fix

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { runSimulator } from "./run-simulator.js";

const execAsync = promisify(exec);

// Default timeout for make test (30 minutes)
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB buffer
const SIM_RUNS = 10; // Number of simulator runs to verify fix
const MAX_SEED = 2147483647; // Max 32-bit signed integer

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

export interface ValidateFixSlowParams {
  /** The seed that originally triggered the panic (non-negative 32-bit integer) */
  failing_seed: number;
}

/**
 * Result of the slow validation process.
 *
 * Valid state combinations:
 * - `passed: false, make_test_passed: false, sim_runs_passed: false` - Parameter validation or make test failed
 * - `passed: false, make_test_passed: true, sim_runs_passed: false` - Make test passed but simulator found panic
 * - `passed: true, make_test_passed: true, sim_runs_passed: true` - All validation passed
 *
 * Note: `sim_runs_passed` is only meaningful when `make_test_passed` is true.
 */
export interface ValidateFixSlowResult {
  /** True if all validation passed (make test + simulator runs) */
  passed: boolean;
  /** True if `make test` completed successfully */
  make_test_passed: boolean;
  /** True if all 10 simulator runs completed without finding a panic */
  sim_runs_passed: boolean;
  /** Error message describing what failed (only set when passed is false) */
  error?: string;
}

/**
 * Validate the failing_seed parameter.
 */
export function validateFailingSeed(seed: unknown): number {
  if (seed === undefined || seed === null) {
    throw new Error("Missing required parameter: failing_seed");
  }

  if (typeof seed !== "number") {
    throw new Error(`Invalid failing_seed: must be a number, got ${typeof seed}`);
  }

  if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
    throw new Error(`Invalid failing_seed: must be a finite integer, got ${seed}`);
  }

  if (seed < 0 || seed > MAX_SEED) {
    throw new Error(`Invalid failing_seed: must be between 0 and ${MAX_SEED}, got ${seed}`);
  }

  return seed;
}

/**
 * Run `make test` and return whether it passed.
 */
async function runMakeTest(): Promise<{ passed: boolean; error?: string }> {
  try {
    await execAsync("make test", {
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });

    return { passed: true };
  } catch (error: unknown) {
    if (!isExecError(error)) {
      return {
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const stderr = error.stderr ?? "";

    // Check if this was a timeout
    if (error.killed && error.signal === "SIGTERM") {
      return {
        passed: false,
        error: "make test timed out",
      };
    }

    return {
      passed: false,
      error: stderr || `make test failed with exit code ${error.code ?? 1}`,
    };
  }
}

/**
 * Run the full validation suite: make test + simulator runs.
 *
 * This is the slow validation used by the Fixer agent for final validation.
 * It runs the full test suite and then runs the simulator 10 times with
 * the failing seed to ensure the panic no longer occurs.
 *
 * @param params - Validation parameters including the failing seed
 * @returns Result indicating if validation passed
 */
export async function validateFixSlow(params: ValidateFixSlowParams): Promise<ValidateFixSlowResult> {
  // Validate failing_seed
  let seed: number;
  try {
    seed = validateFailingSeed(params.failing_seed);
  } catch (error) {
    return {
      passed: false,
      make_test_passed: false,
      sim_runs_passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Run make test
  const makeResult = await runMakeTest();
  if (!makeResult.passed) {
    return {
      passed: false,
      make_test_passed: false,
      sim_runs_passed: false,
      error: makeResult.error ?? "make test failed",
    };
  }

  // Run simulator 10 times with failing seed
  for (let i = 0; i < SIM_RUNS; i++) {
    const simResult = await runSimulator({ seed });

    if (simResult.panic_found) {
      return {
        passed: false,
        make_test_passed: true,
        sim_runs_passed: false,
        error: `Panic still occurs on simulator run ${i + 1} of ${SIM_RUNS}`,
      };
    }

    // If simulator had an error (not a panic), report it
    if (simResult.error) {
      return {
        passed: false,
        make_test_passed: true,
        sim_runs_passed: false,
        error: `Simulator error on run ${i + 1}: ${simResult.error}`,
      };
    }
  }

  return {
    passed: true,
    make_test_passed: true,
    sim_runs_passed: true,
  };
}

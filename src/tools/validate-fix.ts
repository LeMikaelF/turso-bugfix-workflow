// Unified validate-fix tool for panic-fix-workflow
// Runs fast validation (make test-single) then slow validation (make test + simulator 10x)

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { runSimulator } from "./run-simulator.js";

const execAsync = promisify(exec);

// Timeouts
const FAST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for make test-single
const SLOW_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes for make test
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

export interface ValidateFixParams {
  /** The seed that originally triggered the panic (non-negative 32-bit integer) */
  failing_seed: number;
}

/**
 * Result of the unified validation process.
 *
 * Field presence by validation stage:
 * - `passed`, `fast_validation_passed`: Always present
 * - `slow_validation_passed`, `make_test_passed`: Present if fast validation passed
 * - `sim_runs_passed`: Present only if make test passed (simulators actually ran)
 * - `error`: Present when validation fails
 * - `stdout`, `stderr`: Present on fast validation failure (for debugging)
 */
export interface ValidateFixResult {
  /** True if all validation passed (fast + slow) */
  passed: boolean;
  /** True if fast validation (make test-single) passed */
  fast_validation_passed: boolean;
  /** True if slow validation passed. Only present if fast validation passed. */
  slow_validation_passed?: boolean;
  /** True if make test passed. Only present if fast validation passed. */
  make_test_passed?: boolean;
  /** True if all simulator runs passed. Only present if make test passed. */
  sim_runs_passed?: boolean;
  /** Error message describing what failed. Only present when passed is false. */
  error?: string;
  /** Standard output from the failing command. Only present on fast validation failure. */
  stdout?: string;
  /** Standard error from the failing command. Only present on fast validation failure. */
  stderr?: string;
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
 * Run fast validation (make test-single).
 */
async function runFastValidation(): Promise<{ passed: boolean; error?: string; stdout?: string; stderr?: string }> {
  try {
    const { stdout, stderr } = await execAsync("make test-single", {
      timeout: FAST_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });

    return { passed: true, stdout, stderr };
  } catch (error: unknown) {
    if (!isExecError(error)) {
      return {
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const stdout = error.stdout ?? "";
    const stderr = error.stderr ?? "";

    if (error.killed && error.signal === "SIGTERM") {
      return {
        passed: false,
        error: "Fast validation timed out",
        stdout,
        stderr,
      };
    }

    return {
      passed: false,
      error: stderr || `Fast validation failed with exit code ${error.code ?? 1}`,
      stdout,
      stderr,
    };
  }
}

/**
 * Run make test.
 */
async function runMakeTest(): Promise<{ passed: boolean; error?: string }> {
  try {
    await execAsync("make test", {
      timeout: SLOW_TIMEOUT_MS,
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
 * Run the unified validation: fast (make test-single) then slow (make test + simulator 10x).
 *
 * This runs fast validation first for quick iteration. If fast validation passes,
 * it proceeds to slow validation (full test suite + simulator runs).
 *
 * @param params - Validation parameters including the failing seed
 * @returns Result indicating if all validation passed
 */
export async function validateFix(params: ValidateFixParams): Promise<ValidateFixResult> {
  // Validate failing_seed
  let seed: number;
  try {
    seed = validateFailingSeed(params.failing_seed);
  } catch (error) {
    return {
      passed: false,
      fast_validation_passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Run fast validation (make test-single)
  const fastResult = await runFastValidation();
  if (!fastResult.passed) {
    const result: ValidateFixResult = {
      passed: false,
      fast_validation_passed: false,
      error: fastResult.error ?? "Fast validation failed",
    };
    if (fastResult.stdout !== undefined) {
      result.stdout = fastResult.stdout;
    }
    if (fastResult.stderr !== undefined) {
      result.stderr = fastResult.stderr;
    }
    return result;
  }

  // Run slow validation: make test
  const makeResult = await runMakeTest();
  if (!makeResult.passed) {
    return {
      passed: false,
      fast_validation_passed: true,
      slow_validation_passed: false,
      make_test_passed: false,
      // Note: sim_runs_passed is intentionally omitted (simulators never ran)
      error: makeResult.error ?? "make test failed",
    };
  }

  // Run simulator 10 times with failing seed
  for (let i = 0; i < SIM_RUNS; i++) {
    const simResult = await runSimulator({ seed });

    if (simResult.panic_found) {
      return {
        passed: false,
        fast_validation_passed: true,
        slow_validation_passed: false,
        make_test_passed: true,
        sim_runs_passed: false,
        error: `Panic still occurs on simulator run ${i + 1} of ${SIM_RUNS}`,
      };
    }

    // If simulator had an error (not a panic), report it
    if (simResult.error) {
      return {
        passed: false,
        fast_validation_passed: true,
        slow_validation_passed: false,
        make_test_passed: true,
        sim_runs_passed: false,
        error: `Simulator error on run ${i + 1}: ${simResult.error}`,
      };
    }
  }

  return {
    passed: true,
    fast_validation_passed: true,
    slow_validation_passed: true,
    make_test_passed: true,
    sim_runs_passed: true,
  };
}

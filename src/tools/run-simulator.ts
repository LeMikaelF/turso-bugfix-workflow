// Run simulator tool for panic-fix-workflow
// Executes the simulator with an optional seed, sends IPC callbacks to pause/resume timeout tracking

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Default IPC port for orchestrator
const DEFAULT_IPC_PORT = 9100;
const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 3600; // 1 hour max
const MAX_SEED = 2147483647; // Max 32-bit signed integer
const MAX_PANIC_MESSAGE_LENGTH = 5000; // Limit panic message length

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
 * Validate and sanitize seed value.
 * Returns a valid seed or throws an error.
 */
export function validateSeed(seed: number | undefined): number {
  if (seed === undefined) {
    return Math.floor(Math.random() * 1000000);
  }

  // Check for NaN, Infinity, or non-integer
  if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
    throw new Error(`Invalid seed: must be a finite integer, got ${seed}`);
  }

  // Check range
  if (seed < 0 || seed > MAX_SEED) {
    throw new Error(`Invalid seed: must be between 0 and ${MAX_SEED}, got ${seed}`);
  }

  return seed;
}

/**
 * Validate timeout value.
 * Returns a valid timeout in seconds.
 */
export function validateTimeout(timeout: number | undefined): number {
  if (timeout === undefined) {
    return DEFAULT_TIMEOUT_SECONDS;
  }

  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`Invalid timeout: must be a positive number, got ${timeout}`);
  }

  if (timeout > MAX_TIMEOUT_SECONDS) {
    throw new Error(`Invalid timeout: must not exceed ${MAX_TIMEOUT_SECONDS} seconds, got ${timeout}`);
  }

  return timeout;
}

export interface RunSimulatorParams {
  seed?: number | undefined;
  timeout_seconds?: number | undefined;
}

export interface RunSimulatorResult {
  panic_found: boolean;
  seed_used: number;
  panic_message?: string | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  error?: string | undefined;
}

/**
 * Send IPC callback to orchestrator to pause/resume timeout tracking.
 * Failures are logged but do not stop the simulator run.
 */
async function sendIpcCallback(endpoint: "started" | "finished", panicLocation: string, port: number): Promise<void> {
  const urlSafe = encodeURIComponent(panicLocation);
  const url = `http://localhost:${port}/sim/${urlSafe}/${endpoint}`;

  try {
    const response = await fetch(url, { method: "POST" });
    if (!response.ok) {
      console.error(`IPC callback ${endpoint} returned status ${response.status}`);
    }
  } catch (error) {
    // IPC failures should not stop the simulator run
    // The orchestrator may not be running (e.g., during testing)
    console.error(`IPC callback ${endpoint} failed:`, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Extract panic message from simulator output.
 * Looks for common panic patterns in the output.
 */
export function extractPanicMessage(output: string): string | undefined {
  // Look for common panic patterns:
  // - "PANIC: <message>"
  // - "assertion failed: <message>"
  // - "panic: <message>"

  const patterns = [
    /PANIC:\s*(.+?)(?:\n|$)/i,
    /assertion failed:\s*(.+?)(?:\n|$)/i,
    /panic:\s*(.+?)(?:\n|$)/i,
    /SIGABRT.*?:\s*(.+?)(?:\n|$)/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match && match[1]) {
      const message = match[1].trim();
      // Truncate very long panic messages to avoid memory issues
      if (message.length > MAX_PANIC_MESSAGE_LENGTH) {
        return message.substring(0, MAX_PANIC_MESSAGE_LENGTH) + "... (truncated)";
      }
      return message;
    }
  }

  return undefined;
}

/**
 * Check if output indicates a panic occurred.
 */
export function detectPanic(output: string, exitCode: number): boolean {
  // A panic is indicated by:
  // 1. Non-zero exit code combined with panic-related output
  // 2. Explicit panic markers in output

  if (exitCode !== 0) {
    const panicIndicators = [
      /PANIC/i,
      /assertion failed/i,
      /SIGABRT/i,
      /panic:/i,
      /abort/i,
    ];

    for (const indicator of panicIndicators) {
      if (indicator.test(output)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Run the simulator with optional seed.
 *
 * @param params - Simulator parameters
 * @returns Result indicating if panic was found
 */
export async function runSimulator(params: RunSimulatorParams = {}): Promise<RunSimulatorResult> {
  // Get panic location from environment (set by orchestrator)
  const panicLocation = process.env.PANIC_LOCATION;
  const ipcPort = parseInt(process.env.IPC_PORT ?? String(DEFAULT_IPC_PORT), 10);

  // Validate and sanitize inputs to prevent command injection
  let seed: number;
  let timeoutSeconds: number;

  try {
    seed = validateSeed(params.seed);
    timeoutSeconds = validateTimeout(params.timeout_seconds);
  } catch (error) {
    return {
      panic_found: false,
      seed_used: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Notify orchestrator that simulator is starting (pause timeout)
  if (panicLocation) {
    await sendIpcCallback("started", panicLocation, ipcPort);
  }

  try {
    // Execute simulator
    const command = `./simulator --seed ${seed}`;
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutSeconds * 1000,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    const combinedOutput = stdout + stderr;
    const panicFound = detectPanic(combinedOutput, 0);

    return {
      panic_found: panicFound,
      seed_used: seed,
      panic_message: panicFound ? extractPanicMessage(combinedOutput) : undefined,
      stdout,
      stderr,
    };
  } catch (error: unknown) {
    // Handle execution error (could be panic exit, timeout, or other error)
    if (!isExecError(error)) {
      // Unknown error type - return generic error
      return {
        panic_found: false,
        seed_used: seed,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const stdout = error.stdout ?? "";
    const stderr = error.stderr ?? "";
    const combinedOutput = stdout + stderr;
    const exitCode = error.code ?? 1;

    // Check if this was a timeout
    if (error.killed && error.signal === "SIGTERM") {
      return {
        panic_found: false,
        seed_used: seed,
        error: `Simulator timed out after ${timeoutSeconds} seconds`,
        stdout,
        stderr,
      };
    }

    // Check if the error indicates a panic
    const panicFound = detectPanic(combinedOutput, exitCode);

    return {
      panic_found: panicFound,
      seed_used: seed,
      panic_message: panicFound ? extractPanicMessage(combinedOutput) : undefined,
      stdout,
      stderr,
      error: !panicFound ? `Simulator exited with code ${exitCode}` : undefined,
    };
  } finally {
    // Always notify orchestrator that simulator finished (resume timeout)
    if (panicLocation) {
      await sendIpcCallback("finished", panicLocation, ipcPort);
    }
  }
}

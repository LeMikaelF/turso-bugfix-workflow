// Run simulator tool for panic-fix-workflow
// Executes the simulator with an optional seed, sends IPC callbacks to pause/resume timeout tracking

import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
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
  output_file?: string | undefined;
  roadmap?: string | undefined;
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
 * Write simulator output to a file for later inspection.
 * Returns the path to the output file.
 */
export async function writeOutputFile(seed: number, stdout: string, stderr: string): Promise<string> {
  const filename = `simulator_output_${seed}.txt`;
  const outputPath = path.join(process.cwd(), filename);
  const content = `=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderr}`;
  await fs.writeFile(outputPath, content, "utf-8");
  return outputPath;
}

/**
 * Get roadmap instructions for parsing simulator output.
 * Returns static guidance text to help agents understand the output format.
 */
export function getRoadmap(): string {
  return `## Simulator Output Roadmap

The output file contains the SQL execution trace from limbo_sim. Each line is a single SQL interaction.

### Output structure:
1. **Header** (lines 1-25): ASCII art logo, skip this
2. **Seed info**: Look for \`INFO limbo_sim: XXX: seed=NNNNN\`
3. **SQL trace**: Lines starting with \`INFO execute_interaction_turso{conn_index=N interaction=...\`

### Log line format:
\`INFO execute_interaction_turso{conn_index=N interaction=SQL_STATEMENT; -- N}: limbo_sim::runner::execution: 202:\`
- \`conn_index=N\`: Which connection (0-9) executed the query
- \`interaction=...\`: The SQL statement

### Key patterns to grep for:
- \`interaction=CREATE TABLE\` - Table creation
- \`interaction=INSERT INTO\` - Data insertion
- \`interaction=UPDATE .* SET\` - Updates
- \`interaction=DELETE FROM\` - Deletions
- \`interaction=BEGIN\` / \`COMMIT\` / \`ROLLBACK\` - Transactions
- \`interaction=DROP TABLE\` - Table drops
- \`-- FAULT\` - Simulated failures (DISCONNECT, FAULTY QUERY)
- \`-- ASSERT\` - Assertion checks
- \`-- ASSUME\` - Precondition checks

### Lines to skip:
- Lines 1-25 (ASCII art header)
- Lines containing only \`-- ASSERT\` or \`-- ASSUME\` (metadata, not SQL)

### On failure:
- **Check the last ~20 lines first** - failure details (panic message, stack trace) appear at the end
- Use \`tail -20 <output_file>\` to see failure context immediately

### Tips:
- Output is verbose (66KB+ for 100 interactions) - use grep, don't read sequentially
- Compare SQL patterns with those in panic_context.md
- Look for similar table structures, WHERE clauses, or transaction patterns
- Connection indices (conn_index) show concurrent execution patterns`;
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

    // On failure (panic not found), save output to file and provide roadmap
    if (!panicFound) {
      const outputFile = await writeOutputFile(seed, stdout, stderr);
      return {
        panic_found: false,
        seed_used: seed,
        stdout,
        stderr,
        output_file: outputFile,
        roadmap: getRoadmap(),
      };
    }

    return {
      panic_found: true,
      seed_used: seed,
      panic_message: extractPanicMessage(combinedOutput),
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
      const outputFile = await writeOutputFile(seed, stdout, stderr);
      return {
        panic_found: false,
        seed_used: seed,
        error: `Simulator timed out after ${timeoutSeconds} seconds`,
        stdout,
        stderr,
        output_file: outputFile,
        roadmap: getRoadmap(),
      };
    }

    // Check if the error indicates a panic
    const panicFound = detectPanic(combinedOutput, exitCode);

    // On failure (panic not found), save output to file and provide roadmap
    if (!panicFound) {
      const outputFile = await writeOutputFile(seed, stdout, stderr);
      return {
        panic_found: false,
        seed_used: seed,
        stdout,
        stderr,
        error: `Simulator exited with code ${exitCode}`,
        output_file: outputFile,
        roadmap: getRoadmap(),
      };
    }

    return {
      panic_found: true,
      seed_used: seed,
      panic_message: extractPanicMessage(combinedOutput),
      stdout,
      stderr,
    };
  } finally {
    // Always notify orchestrator that simulator finished (resume timeout)
    if (panicLocation) {
      await sendIpcCallback("finished", panicLocation, ipcPort);
    }
  }
}

/**
 * Context JSON file utilities for panic-fix-workflow.
 *
 * The workflow maintains machine-readable context in panic_context.json (this module)
 * and human-readable documentation in panic_context.md (separate).
 *
 * This separation allows:
 * - Tools to work with structured JSON without parsing markdown
 * - Humans to read a nicely formatted markdown summary
 * - Workflow state machine to validate and transition based on complete data
 *
 * Typical lifecycle:
 * 1. repo-setup creates initial JSON with panic_location, panic_message, tcl_test_file
 * 2. reproducer adds failing_seed, why_simulator_missed, simulator_changes
 * 3. fixer adds bug_description, fix_description
 * 4. shipping reads all fields, deletes both files, and creates PR
 */

import * as fs from "fs/promises";
import * as path from "path";

export const CONTEXT_JSON_FILE = "panic_context.json";

export interface PanicContextData {
  panic_location: string;
  panic_message: string;
  tcl_test_file: string;
  failing_seed?: number;
  why_simulator_missed?: string;
  simulator_changes?: string;
  bug_description?: string;
  fix_description?: string;
}

export interface ReadResult {
  success: boolean;
  data?: PanicContextData;
  error?: string;
  notFound?: boolean; // True if file doesn't exist (vs corrupted)
}

/**
 * Read and parse panic_context.json from the current working directory.
 */
export async function readContextJson(): Promise<ReadResult> {
  const filePath = path.join(process.cwd(), CONTEXT_JSON_FILE);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content) as PanicContextData;
    return { success: true, data };
  } catch (err) {
    // Distinguish between "file not found" and "file corrupted"
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return { success: false, notFound: true, error: `File not found: ${filePath}` };
    }
    if (err instanceof SyntaxError) {
      return { success: false, error: `Invalid JSON in ${CONTEXT_JSON_FILE}: ${err.message}` };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to read ${CONTEXT_JSON_FILE}: ${message}` };
  }
}

/**
 * Write panic_context.json to the current working directory.
 */
export async function writeContextJson(
  data: PanicContextData
): Promise<{ success: boolean; error?: string }> {
  const filePath = path.join(process.cwd(), CONTEXT_JSON_FILE);
  try {
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, content);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to write ${CONTEXT_JSON_FILE}: ${message}` };
  }
}

/**
 * Update specific fields in panic_context.json, preserving existing data.
 *
 * IMPORTANT: This function requires the file to exist and be valid JSON.
 * If the file is missing or corrupted, it returns an error to prevent
 * accidentally overwriting data with a partial update.
 */
export async function updateContextJson(
  updates: Partial<PanicContextData>
): Promise<{ success: boolean; error?: string }> {
  const readResult = await readContextJson();

  // If file doesn't exist, return error - caller should use writeContextJson for initial creation
  if (readResult.notFound) {
    return { success: false, error: `Cannot update: ${CONTEXT_JSON_FILE} does not exist` };
  }

  // If file is corrupted, return the error - don't silently overwrite
  if (!readResult.success) {
    return readResult;
  }

  const mergedData = { ...readResult.data, ...updates } as PanicContextData;

  return writeContextJson(mergedData);
}

/**
 * Generate the initial JSON content for panic_context.json.
 */
export function generateInitialContextJson(
  panicLocation: string,
  panicMessage: string,
  tclTestFile: string
): PanicContextData {
  return {
    panic_location: panicLocation,
    panic_message: panicMessage,
    tcl_test_file: tclTestFile,
  };
}

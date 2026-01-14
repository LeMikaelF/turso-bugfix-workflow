// Describe simulator fix tool for panic-fix-workflow
// Used by the Reproducer agent to document what changes were made to the simulator

import { updateContextJson } from "../orchestrator/context-json.js";

export interface DescribeSimFixParams {
  failing_seed: number;          // The seed that reproduced the panic
  why_simulator_missed: string;  // Why the simulator didn't catch this panic before
  what_was_added: string;        // What was added to make it generate the triggering statements
}

export interface DescribeSimFixResult {
  success: boolean;
  error?: string;
}

/**
 * Document simulator fix and update panic_context.json.
 *
 * The Reproducer agent calls this tool after extending the simulator
 * to reproduce a panic. This:
 * 1. Validates the documentation parameters
 * 2. Updates panic_context.json with:
 *    - failing_seed
 *    - why_simulator_missed
 *    - simulator_changes (from what_was_added)
 *
 * @param params - Documentation parameters
 * @returns Result indicating if documentation was saved successfully
 */
export async function describeSimFix(params: DescribeSimFixParams): Promise<DescribeSimFixResult> {
  // Validate failing_seed
  if (params.failing_seed === undefined || params.failing_seed === null || typeof params.failing_seed !== "number") {
    return {
      success: false,
      error: "Missing required field: failing_seed (must be a number)",
    };
  }

  if (!Number.isFinite(params.failing_seed) || !Number.isInteger(params.failing_seed) || params.failing_seed < 0) {
    return {
      success: false,
      error: "failing_seed must be a non-negative integer",
    };
  }

  // Validate why_simulator_missed
  if (params.why_simulator_missed === undefined || params.why_simulator_missed === null || typeof params.why_simulator_missed !== "string") {
    return {
      success: false,
      error: "Missing required field: why_simulator_missed",
    };
  }

  if (params.why_simulator_missed.trim().length === 0) {
    return {
      success: false,
      error: "Field why_simulator_missed cannot be empty",
    };
  }

  // Validate what_was_added
  if (params.what_was_added === undefined || params.what_was_added === null || typeof params.what_was_added !== "string") {
    return {
      success: false,
      error: "Missing required field: what_was_added",
    };
  }

  if (params.what_was_added.trim().length === 0) {
    return {
      success: false,
      error: "Field what_was_added cannot be empty",
    };
  }

  // Update panic_context.json using the shared utility
  return updateContextJson({
    failing_seed: params.failing_seed,
    why_simulator_missed: params.why_simulator_missed,
    simulator_changes: params.what_was_added,
  });
}

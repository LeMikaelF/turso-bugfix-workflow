// Describe simulator fix tool for panic-fix-workflow
// Used by the Reproducer agent to document what changes were made to the simulator

export interface DescribeSimFixParams {
  why_simulator_missed: string;  // Why the simulator didn't catch this panic before
  what_was_added: string;        // What was added to make it generate the triggering statements
}

export interface DescribeSimFixResult {
  success: boolean;
  error?: string;
}

/**
 * Validate and acknowledge simulator fix documentation.
 *
 * The Reproducer agent calls this tool after extending the simulator
 * to reproduce a panic. This documents:
 * - Why the simulator didn't catch this panic before
 * - What was added to make it generate the triggering statements
 *
 * @param params - Documentation parameters
 * @returns Result indicating if documentation was valid
 */
export function describeSimFix(params: DescribeSimFixParams): DescribeSimFixResult {
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

  return { success: true };
}

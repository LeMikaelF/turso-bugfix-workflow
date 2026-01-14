// Describe fix tool for panic-fix-workflow
// Used by the Fixer agent to document the bug fix

export interface DescribeFixParams {
  bug_description: string;  // What the bug was
  fix_description: string;  // How the bug was fixed
}

export interface DescribeFixResult {
  success: boolean;
  error?: string;
}

/**
 * Validate and acknowledge bug fix documentation.
 *
 * The Fixer agent calls this tool after fixing a panic. This documents:
 * - What the bug was (root cause)
 * - How the bug was fixed
 *
 * @param params - Documentation parameters
 * @returns Result indicating if documentation was valid
 */
export function describeFix(params: DescribeFixParams): DescribeFixResult {
  // Validate bug_description
  if (params.bug_description === undefined || params.bug_description === null || typeof params.bug_description !== "string") {
    return {
      success: false,
      error: "Missing required field: bug_description",
    };
  }

  if (params.bug_description.trim().length === 0) {
    return {
      success: false,
      error: "Field bug_description cannot be empty",
    };
  }

  // Validate fix_description
  if (params.fix_description === undefined || params.fix_description === null || typeof params.fix_description !== "string") {
    return {
      success: false,
      error: "Missing required field: fix_description",
    };
  }

  if (params.fix_description.trim().length === 0) {
    return {
      success: false,
      error: "Field fix_description cannot be empty",
    };
  }

  return { success: true };
}

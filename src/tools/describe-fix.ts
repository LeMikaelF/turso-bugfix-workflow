// Describe fix tool for panic-fix-workflow
// Used by the Fixer agent to document the bug fix

import { updateContextJson } from "../orchestrator/context-json.js";

export interface DescribeFixParams {
  bug_description: string;  // What the bug was
  fix_description: string;  // How the bug was fixed
}

export interface DescribeFixResult {
  success: boolean;
  error?: string;
}

/**
 * Document bug fix and update panic_context.json.
 *
 * The Fixer agent calls this tool after fixing a panic. This:
 * 1. Validates the documentation parameters
 * 2. Updates panic_context.json with:
 *    - bug_description
 *    - fix_description
 *
 * @param params - Documentation parameters
 * @returns Result indicating if documentation was saved successfully
 */
export async function describeFix(params: DescribeFixParams): Promise<DescribeFixResult> {
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

  // Update panic_context.json using the shared utility
  return updateContextJson({
    bug_description: params.bug_description,
    fix_description: params.fix_description,
  });
}

// Context parser for validating panic context data
// Note: The PanicContextData interface is defined in context-json.ts for JSON file operations

// Re-export PanicContextData from context-json.ts for backwards compatibility
export type { PanicContextData } from "./context-json.js";

export type ValidationPhase = "repo_setup" | "reproducer" | "fixer" | "ship";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Import PanicContextData for internal use
import type { PanicContextData } from "./context-json.js";

const BASE_FIELDS: (keyof PanicContextData)[] = [
  "panic_location",
  "panic_message",
  "tcl_test_file",
];

const REPRODUCER_FIELDS: (keyof PanicContextData)[] = [
  ...BASE_FIELDS,
  "failing_seed",
  "why_simulator_missed",
  "simulator_changes",
];

const FIXER_AND_SHIP_FIELDS: (keyof PanicContextData)[] = [
  ...REPRODUCER_FIELDS,
  "bug_description",
  "fix_description",
];

// Required fields for each phase
const REQUIRED_FIELDS_BY_PHASE: Record<ValidationPhase, (keyof PanicContextData)[]> = {
  repo_setup: BASE_FIELDS,
  reproducer: REPRODUCER_FIELDS,
  fixer: FIXER_AND_SHIP_FIELDS,
  ship: FIXER_AND_SHIP_FIELDS,
};

/**
 * Validate that all required fields for a phase are present and non-empty.
 * Also performs type validation for specific fields.
 */
export function validateRequiredFields(
  data: PanicContextData,
  phase: ValidationPhase
): ValidationResult {
  const required = REQUIRED_FIELDS_BY_PHASE[phase];
  const errors: string[] = [];

  for (const field of required) {
    const value = data[field];
    if (value === undefined || value === null || value === "") {
      errors.push(`Missing required field: ${field}`);
    } else if (field === "failing_seed" && typeof value !== "number") {
      errors.push(`Invalid type for failing_seed: expected number, got ${typeof value}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

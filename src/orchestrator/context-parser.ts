// Context file parser for extracting and validating JSON from panic_context.md

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

export type ValidationPhase = "repo_setup" | "reproducer" | "fixer" | "ship";

export interface ParseResult {
  success: boolean;
  data?: PanicContextData;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Regex to match the first ```json code block
const JSON_BLOCK_REGEX = /```json\s*\n([\s\S]*?)\n```/;

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
 * Extract the first JSON code block from markdown content.
 * Returns the JSON string or null if not found.
 */
export function extractJsonBlock(content: string): string | null {
  const match = JSON_BLOCK_REGEX.exec(content);
  return match?.[1] ?? null;
}

/**
 * Parse a panic_context.md file and extract the JSON data.
 */
export function parseContextFile(content: string): ParseResult {
  const jsonStr = extractJsonBlock(content);
  if (jsonStr === null) {
    return { success: false, error: "No JSON block found in content" };
  }

  try {
    const data = JSON.parse(jsonStr) as PanicContextData;
    return { success: true, data };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Invalid JSON: ${error}` };
  }
}

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

/**
 * Parse and validate a context file in one step.
 */
export function parseAndValidate(
  content: string,
  phase: ValidationPhase
): ParseResult & ValidationResult {
  const parseResult = parseContextFile(content);

  if (!parseResult.success || !parseResult.data) {
    const errorMessage = parseResult.error ?? "Parse failed";
    return {
      success: false,
      error: errorMessage,
      valid: false,
      errors: [errorMessage],
    };
  }

  const validationResult = validateRequiredFields(parseResult.data, phase);

  return {
    success: true,
    data: parseResult.data,
    valid: validationResult.valid,
    errors: validationResult.errors,
  };
}

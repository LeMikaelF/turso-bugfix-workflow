// Write fixer plan tool for panic-fix-workflow
// Used by the Fixer Planner agent to document its analysis and strategy

import { writeFile } from "node:fs/promises";
import { FIXER_PLAN_FILE, formatFixerPlan, type FixerPlan, type FileToModify } from "../orchestrator/plan-files.js";

export interface WriteFixerPlanParams {
  root_cause_analysis: string;
  code_path_trace: string;
  fix_strategy: string;
  files_to_modify: FileToModify[];
  validation_approach: string;
  risk_assessment: string;
}

export interface WriteFixerPlanResult {
  success: boolean;
  plan_file?: string;
  error?: string;
}

/**
 * Write a fixer plan to the plan file.
 *
 * The Fixer Planner agent calls this tool after analyzing the panic
 * and designing a fix strategy. This creates fixer_plan.md in the
 * current working directory.
 *
 * @param params - Plan parameters
 * @returns Result indicating if plan was saved successfully
 */
export async function writeFixerPlan(params: WriteFixerPlanParams): Promise<WriteFixerPlanResult> {
  // Validate root_cause_analysis
  if (!params.root_cause_analysis || typeof params.root_cause_analysis !== "string") {
    return {
      success: false,
      error: "Missing required field: root_cause_analysis",
    };
  }

  if (params.root_cause_analysis.trim().length === 0) {
    return {
      success: false,
      error: "Field root_cause_analysis cannot be empty",
    };
  }

  // Validate code_path_trace
  if (!params.code_path_trace || typeof params.code_path_trace !== "string") {
    return {
      success: false,
      error: "Missing required field: code_path_trace",
    };
  }

  if (params.code_path_trace.trim().length === 0) {
    return {
      success: false,
      error: "Field code_path_trace cannot be empty",
    };
  }

  // Validate fix_strategy
  if (!params.fix_strategy || typeof params.fix_strategy !== "string") {
    return {
      success: false,
      error: "Missing required field: fix_strategy",
    };
  }

  if (params.fix_strategy.trim().length === 0) {
    return {
      success: false,
      error: "Field fix_strategy cannot be empty",
    };
  }

  // Validate files_to_modify
  if (!params.files_to_modify || !Array.isArray(params.files_to_modify)) {
    return {
      success: false,
      error: "Missing required field: files_to_modify (must be an array)",
    };
  }

  if (params.files_to_modify.length === 0) {
    return {
      success: false,
      error: "Field files_to_modify cannot be empty",
    };
  }

  for (let i = 0; i < params.files_to_modify.length; i++) {
    const file = params.files_to_modify[i];
    if (!file || !file.path || typeof file.path !== "string" || file.path.trim().length === 0) {
      return {
        success: false,
        error: `files_to_modify[${i}].path is missing or empty`,
      };
    }
    if (!file.description || typeof file.description !== "string" || file.description.trim().length === 0) {
      return {
        success: false,
        error: `files_to_modify[${i}].description is missing or empty`,
      };
    }
  }

  // Validate validation_approach
  if (!params.validation_approach || typeof params.validation_approach !== "string") {
    return {
      success: false,
      error: "Missing required field: validation_approach",
    };
  }

  if (params.validation_approach.trim().length === 0) {
    return {
      success: false,
      error: "Field validation_approach cannot be empty",
    };
  }

  // Validate risk_assessment
  if (!params.risk_assessment || typeof params.risk_assessment !== "string") {
    return {
      success: false,
      error: "Missing required field: risk_assessment",
    };
  }

  if (params.risk_assessment.trim().length === 0) {
    return {
      success: false,
      error: "Field risk_assessment cannot be empty",
    };
  }

  // Create the plan object
  const plan: FixerPlan = {
    rootCauseAnalysis: params.root_cause_analysis,
    codePathTrace: params.code_path_trace,
    fixStrategy: params.fix_strategy,
    filesToModify: params.files_to_modify,
    validationApproach: params.validation_approach,
    riskAssessment: params.risk_assessment,
  };

  // Write the plan file to the current working directory
  try {
    const content = formatFixerPlan(plan);
    await writeFile(FIXER_PLAN_FILE, content, "utf-8");
    return {
      success: true,
      plan_file: FIXER_PLAN_FILE,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to write plan file: ${message}`,
    };
  }
}

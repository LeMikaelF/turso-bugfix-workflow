// Write reproducer plan tool for panic-fix-workflow
// Used by the Reproducer Planner agent to document its analysis and strategy

import { writeFile } from "node:fs/promises";
import { REPRODUCER_PLAN_FILE, formatReproducerPlan, type ReproducerPlan, type FileToModify } from "../orchestrator/plan-files.js";

export interface WriteReproducerPlanParams {
  analysis_summary: string;
  root_cause_hypothesis: string;
  sql_pattern_analysis: string;
  files_to_modify: FileToModify[];
  generation_strategy: string;
  verification_approach: string;
}

export interface WriteReproducerPlanResult {
  success: boolean;
  plan_file?: string;
  error?: string;
}

/**
 * Write a reproducer plan to the plan file.
 *
 * The Reproducer Planner agent calls this tool after analyzing the panic
 * and designing a strategy for extending the simulator. This creates
 * reproducer_plan.md in the current working directory.
 *
 * @param params - Plan parameters
 * @returns Result indicating if plan was saved successfully
 */
export async function writeReproducerPlan(params: WriteReproducerPlanParams): Promise<WriteReproducerPlanResult> {
  // Validate analysis_summary
  if (!params.analysis_summary || typeof params.analysis_summary !== "string") {
    return {
      success: false,
      error: "Missing required field: analysis_summary",
    };
  }

  if (params.analysis_summary.trim().length === 0) {
    return {
      success: false,
      error: "Field analysis_summary cannot be empty",
    };
  }

  // Validate root_cause_hypothesis
  if (!params.root_cause_hypothesis || typeof params.root_cause_hypothesis !== "string") {
    return {
      success: false,
      error: "Missing required field: root_cause_hypothesis",
    };
  }

  if (params.root_cause_hypothesis.trim().length === 0) {
    return {
      success: false,
      error: "Field root_cause_hypothesis cannot be empty",
    };
  }

  // Validate sql_pattern_analysis
  if (!params.sql_pattern_analysis || typeof params.sql_pattern_analysis !== "string") {
    return {
      success: false,
      error: "Missing required field: sql_pattern_analysis",
    };
  }

  if (params.sql_pattern_analysis.trim().length === 0) {
    return {
      success: false,
      error: "Field sql_pattern_analysis cannot be empty",
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

  // Validate generation_strategy
  if (!params.generation_strategy || typeof params.generation_strategy !== "string") {
    return {
      success: false,
      error: "Missing required field: generation_strategy",
    };
  }

  if (params.generation_strategy.trim().length === 0) {
    return {
      success: false,
      error: "Field generation_strategy cannot be empty",
    };
  }

  // Validate verification_approach
  if (!params.verification_approach || typeof params.verification_approach !== "string") {
    return {
      success: false,
      error: "Missing required field: verification_approach",
    };
  }

  if (params.verification_approach.trim().length === 0) {
    return {
      success: false,
      error: "Field verification_approach cannot be empty",
    };
  }

  // Create the plan object
  const plan: ReproducerPlan = {
    analysisSummary: params.analysis_summary,
    rootCauseHypothesis: params.root_cause_hypothesis,
    sqlPatternAnalysis: params.sql_pattern_analysis,
    filesToModify: params.files_to_modify,
    generationStrategy: params.generation_strategy,
    verificationApproach: params.verification_approach,
  };

  // Write the plan file to the current working directory
  try {
    const content = formatReproducerPlan(plan);
    await writeFile(REPRODUCER_PLAN_FILE, content, "utf-8");
    return {
      success: true,
      plan_file: REPRODUCER_PLAN_FILE,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to write plan file: ${message}`,
    };
  }
}

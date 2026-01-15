// Plan file types and utilities for planner/implementer agent workflow

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// File names for plan files (stored in repo root)
export const REPRODUCER_PLAN_FILE = "reproducer_plan.md";
export const FIXER_PLAN_FILE = "fixer_plan.md";

// Types for plan content

export interface FileToModify {
  path: string;
  description: string;
}

export interface ReproducerPlan {
  analysisSummary: string;
  rootCauseHypothesis: string;
  sqlPatternAnalysis: string;
  filesToModify: FileToModify[];
  generationStrategy: string;
  verificationApproach: string;
}

export interface FixerPlan {
  rootCauseAnalysis: string;
  codePathTrace: string;
  fixStrategy: string;
  filesToModify: FileToModify[];
  validationApproach: string;
  riskAssessment: string;
}

/**
 * Format a reproducer plan as markdown
 */
export function formatReproducerPlan(plan: ReproducerPlan): string {
  const filesToModifySection = plan.filesToModify
    .map((f) => `- \`${f.path}\`: ${f.description}`)
    .join("\n");

  return `# Reproducer Plan

## Analysis Summary
${plan.analysisSummary}

## Root Cause Hypothesis
${plan.rootCauseHypothesis}

## SQL Pattern Analysis
${plan.sqlPatternAnalysis}

## Files to Modify
${filesToModifySection}

## Generation Strategy
${plan.generationStrategy}

## Verification Approach
${plan.verificationApproach}
`;
}

/**
 * Format a fixer plan as markdown
 */
export function formatFixerPlan(plan: FixerPlan): string {
  const filesToModifySection = plan.filesToModify
    .map((f) => `- \`${f.path}\`: ${f.description}`)
    .join("\n");

  return `# Fixer Plan

## Root Cause Analysis
${plan.rootCauseAnalysis}

## Code Path Trace
${plan.codePathTrace}

## Fix Strategy
${plan.fixStrategy}

## Files to Modify
${filesToModifySection}

## Validation Approach
${plan.validationApproach}

## Risk Assessment
${plan.riskAssessment}
`;
}

/**
 * Parse a reproducer plan from markdown content
 */
function parseReproducerPlan(content: string): ReproducerPlan {
  const sections = parseSections(content);

  return {
    analysisSummary: sections["Analysis Summary"] || "",
    rootCauseHypothesis: sections["Root Cause Hypothesis"] || "",
    sqlPatternAnalysis: sections["SQL Pattern Analysis"] || "",
    filesToModify: parseFilesToModify(sections["Files to Modify"] || ""),
    generationStrategy: sections["Generation Strategy"] || "",
    verificationApproach: sections["Verification Approach"] || "",
  };
}

/**
 * Parse a fixer plan from markdown content
 */
function parseFixerPlan(content: string): FixerPlan {
  const sections = parseSections(content);

  return {
    rootCauseAnalysis: sections["Root Cause Analysis"] || "",
    codePathTrace: sections["Code Path Trace"] || "",
    fixStrategy: sections["Fix Strategy"] || "",
    filesToModify: parseFilesToModify(sections["Files to Modify"] || ""),
    validationApproach: sections["Validation Approach"] || "",
    riskAssessment: sections["Risk Assessment"] || "",
  };
}

/**
 * Parse markdown sections into a key-value map
 */
function parseSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split("\n");

  let currentSection = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    // Match ## Section Header
    const headerMatch = line.match(/^## (.+)$/);
    if (headerMatch && headerMatch[1]) {
      // Save previous section
      if (currentSection) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = headerMatch[1];
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    sections[currentSection] = currentContent.join("\n").trim();
  }

  return sections;
}

/**
 * Parse the "Files to Modify" section into FileToModify array
 */
function parseFilesToModify(content: string): FileToModify[] {
  const files: FileToModify[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // Match lines like: - `path/to/file.rs`: description
    const match = line.match(/^- `([^`]+)`:\s*(.+)$/);
    if (match && match[1] && match[2]) {
      files.push({
        path: match[1],
        description: match[2],
      });
    }
  }

  return files;
}

/**
 * Write a reproducer plan to the plan file
 *
 * @param plan - The plan content
 * @param repoRoot - The repository root directory
 */
export async function writeReproducerPlan(
  plan: ReproducerPlan,
  repoRoot: string
): Promise<void> {
  const content = formatReproducerPlan(plan);
  const filePath = join(repoRoot, REPRODUCER_PLAN_FILE);
  await writeFile(filePath, content, "utf-8");
}

/**
 * Read a reproducer plan from the plan file
 *
 * @param repoRoot - The repository root directory
 * @returns The plan content, or null if file doesn't exist
 */
export async function readReproducerPlan(
  repoRoot: string
): Promise<ReproducerPlan | null> {
  const filePath = join(repoRoot, REPRODUCER_PLAN_FILE);
  try {
    const content = await readFile(filePath, "utf-8");
    return parseReproducerPlan(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Write a fixer plan to the plan file
 *
 * @param plan - The plan content
 * @param repoRoot - The repository root directory
 */
export async function writeFixerPlan(
  plan: FixerPlan,
  repoRoot: string
): Promise<void> {
  const content = formatFixerPlan(plan);
  const filePath = join(repoRoot, FIXER_PLAN_FILE);
  await writeFile(filePath, content, "utf-8");
}

/**
 * Read a fixer plan from the plan file
 *
 * @param repoRoot - The repository root directory
 * @returns The plan content, or null if file doesn't exist
 */
export async function readFixerPlan(repoRoot: string): Promise<FixerPlan | null> {
  const filePath = join(repoRoot, FIXER_PLAN_FILE);
  try {
    const content = await readFile(filePath, "utf-8");
    return parseFixerPlan(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Check if a reproducer plan file exists
 *
 * @param repoRoot - The repository root directory
 * @returns True if the plan file exists
 */
export async function reproducerPlanExists(repoRoot: string): Promise<boolean> {
  const filePath = join(repoRoot, REPRODUCER_PLAN_FILE);
  try {
    await readFile(filePath, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a fixer plan file exists
 *
 * @param repoRoot - The repository root directory
 * @returns True if the plan file exists
 */
export async function fixerPlanExists(repoRoot: string): Promise<boolean> {
  const filePath = join(repoRoot, FIXER_PLAN_FILE);
  try {
    await readFile(filePath, "utf-8");
    return true;
  } catch {
    return false;
  }
}

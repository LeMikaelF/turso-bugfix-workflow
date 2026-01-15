import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFixerPlan } from "../write-fixer-plan.js";
import { FIXER_PLAN_FILE } from "../../orchestrator/plan-files.js";

describe("writeFixerPlan MCP tool", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await mkdtemp(join(tmpdir(), "write-fixer-plan-test-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should successfully write a plan file with valid params", async () => {
    const result = await writeFixerPlan({
      root_cause_analysis: "Root cause analysis",
      code_path_trace: "Code path trace",
      fix_strategy: "Fix strategy",
      files_to_modify: [
        { path: "core/test.rs", description: "Fix bug" },
      ],
      validation_approach: "Validation approach",
      risk_assessment: "Risk assessment",
    });

    expect(result.success).toBe(true);
    expect(result.plan_file).toBe(FIXER_PLAN_FILE);
    expect(result.error).toBeUndefined();

    // Verify file was written
    const content = await readFile(join(tempDir, FIXER_PLAN_FILE), "utf-8");
    expect(content).toContain("Root cause analysis");
    expect(content).toContain("`core/test.rs`");
  });

  it("should return error when root_cause_analysis is missing", async () => {
    const result = await writeFixerPlan({
      root_cause_analysis: "",
      code_path_trace: "Code path",
      fix_strategy: "Strategy",
      files_to_modify: [{ path: "test.rs", description: "Test" }],
      validation_approach: "Validation",
      risk_assessment: "Risk",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("root_cause_analysis");
  });

  it("should return error when code_path_trace is missing", async () => {
    const result = await writeFixerPlan({
      root_cause_analysis: "Root cause",
      code_path_trace: "",
      fix_strategy: "Strategy",
      files_to_modify: [{ path: "test.rs", description: "Test" }],
      validation_approach: "Validation",
      risk_assessment: "Risk",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("code_path_trace");
  });

  it("should return error when fix_strategy is missing", async () => {
    const result = await writeFixerPlan({
      root_cause_analysis: "Root cause",
      code_path_trace: "Code path",
      fix_strategy: "",
      files_to_modify: [{ path: "test.rs", description: "Test" }],
      validation_approach: "Validation",
      risk_assessment: "Risk",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("fix_strategy");
  });

  it("should return error when files_to_modify is empty", async () => {
    const result = await writeFixerPlan({
      root_cause_analysis: "Root cause",
      code_path_trace: "Code path",
      fix_strategy: "Strategy",
      files_to_modify: [],
      validation_approach: "Validation",
      risk_assessment: "Risk",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("files_to_modify");
  });

  it("should return error when files_to_modify has invalid entry", async () => {
    const result = await writeFixerPlan({
      root_cause_analysis: "Root cause",
      code_path_trace: "Code path",
      fix_strategy: "Strategy",
      files_to_modify: [{ path: "test.rs", description: "" }],
      validation_approach: "Validation",
      risk_assessment: "Risk",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("files_to_modify[0].description");
  });

  it("should return error when validation_approach is missing", async () => {
    const result = await writeFixerPlan({
      root_cause_analysis: "Root cause",
      code_path_trace: "Code path",
      fix_strategy: "Strategy",
      files_to_modify: [{ path: "test.rs", description: "Test" }],
      validation_approach: "",
      risk_assessment: "Risk",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("validation_approach");
  });

  it("should return error when risk_assessment is missing", async () => {
    const result = await writeFixerPlan({
      root_cause_analysis: "Root cause",
      code_path_trace: "Code path",
      fix_strategy: "Strategy",
      files_to_modify: [{ path: "test.rs", description: "Test" }],
      validation_approach: "Validation",
      risk_assessment: "",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("risk_assessment");
  });
});

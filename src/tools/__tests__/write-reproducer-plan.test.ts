import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeReproducerPlan } from "../write-reproducer-plan.js";
import { REPRODUCER_PLAN_FILE } from "../../orchestrator/plan-files.js";

describe("writeReproducerPlan MCP tool", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await mkdtemp(join(tmpdir(), "write-reproducer-plan-test-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should successfully write a plan file with valid params", async () => {
    const result = await writeReproducerPlan({
      analysis_summary: "Analysis summary",
      root_cause_hypothesis: "Root cause hypothesis",
      sql_pattern_analysis: "SQL pattern analysis",
      files_to_modify: [
        { path: "simulator/test.rs", description: "Add test" },
      ],
      generation_strategy: "Generation strategy",
      verification_approach: "Verification approach",
    });

    expect(result.success).toBe(true);
    expect(result.plan_file).toBe(REPRODUCER_PLAN_FILE);
    expect(result.error).toBeUndefined();

    // Verify file was written
    const content = await readFile(join(tempDir, REPRODUCER_PLAN_FILE), "utf-8");
    expect(content).toContain("Analysis summary");
    expect(content).toContain("`simulator/test.rs`");
  });

  it("should return error when analysis_summary is missing", async () => {
    const result = await writeReproducerPlan({
      analysis_summary: "",
      root_cause_hypothesis: "Hypothesis",
      sql_pattern_analysis: "SQL",
      files_to_modify: [{ path: "test.rs", description: "Test" }],
      generation_strategy: "Strategy",
      verification_approach: "Verification",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("analysis_summary");
  });

  it("should return error when root_cause_hypothesis is missing", async () => {
    const result = await writeReproducerPlan({
      analysis_summary: "Summary",
      root_cause_hypothesis: "",
      sql_pattern_analysis: "SQL",
      files_to_modify: [{ path: "test.rs", description: "Test" }],
      generation_strategy: "Strategy",
      verification_approach: "Verification",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("root_cause_hypothesis");
  });

  it("should return error when sql_pattern_analysis is missing", async () => {
    const result = await writeReproducerPlan({
      analysis_summary: "Summary",
      root_cause_hypothesis: "Hypothesis",
      sql_pattern_analysis: "",
      files_to_modify: [{ path: "test.rs", description: "Test" }],
      generation_strategy: "Strategy",
      verification_approach: "Verification",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("sql_pattern_analysis");
  });

  it("should return error when files_to_modify is empty", async () => {
    const result = await writeReproducerPlan({
      analysis_summary: "Summary",
      root_cause_hypothesis: "Hypothesis",
      sql_pattern_analysis: "SQL",
      files_to_modify: [],
      generation_strategy: "Strategy",
      verification_approach: "Verification",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("files_to_modify");
  });

  it("should return error when files_to_modify has invalid entry", async () => {
    const result = await writeReproducerPlan({
      analysis_summary: "Summary",
      root_cause_hypothesis: "Hypothesis",
      sql_pattern_analysis: "SQL",
      files_to_modify: [{ path: "", description: "Test" }],
      generation_strategy: "Strategy",
      verification_approach: "Verification",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("files_to_modify[0].path");
  });

  it("should return error when generation_strategy is missing", async () => {
    const result = await writeReproducerPlan({
      analysis_summary: "Summary",
      root_cause_hypothesis: "Hypothesis",
      sql_pattern_analysis: "SQL",
      files_to_modify: [{ path: "test.rs", description: "Test" }],
      generation_strategy: "",
      verification_approach: "Verification",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("generation_strategy");
  });

  it("should return error when verification_approach is missing", async () => {
    const result = await writeReproducerPlan({
      analysis_summary: "Summary",
      root_cause_hypothesis: "Hypothesis",
      sql_pattern_analysis: "SQL",
      files_to_modify: [{ path: "test.rs", description: "Test" }],
      generation_strategy: "Strategy",
      verification_approach: "",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("verification_approach");
  });
});

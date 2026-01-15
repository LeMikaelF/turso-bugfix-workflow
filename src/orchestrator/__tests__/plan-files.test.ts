import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeReproducerPlan,
  readReproducerPlan,
  writeFixerPlan,
  readFixerPlan,
  reproducerPlanExists,
  fixerPlanExists,
  REPRODUCER_PLAN_FILE,
  FIXER_PLAN_FILE,
  type ReproducerPlan,
  type FixerPlan,
} from "../plan-files.js";

describe("plan-files", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "plan-files-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("writeReproducerPlan", () => {
    it("should write a reproducer plan file", async () => {
      const plan: ReproducerPlan = {
        analysisSummary: "Test analysis",
        rootCauseHypothesis: "Test hypothesis",
        sqlPatternAnalysis: "Test SQL patterns",
        filesToModify: [
          { path: "simulator/test.rs", description: "Add test generation" },
        ],
        generationStrategy: "Test strategy",
        verificationApproach: "Test verification",
      };

      await writeReproducerPlan(plan, tempDir);

      const content = await readFile(join(tempDir, REPRODUCER_PLAN_FILE), "utf-8");
      expect(content).toContain("# Reproducer Plan");
      expect(content).toContain("Test analysis");
      expect(content).toContain("Test hypothesis");
      expect(content).toContain("Test SQL patterns");
      expect(content).toContain("`simulator/test.rs`");
      expect(content).toContain("Add test generation");
      expect(content).toContain("Test strategy");
      expect(content).toContain("Test verification");
    });

    it("should write multiple files to modify", async () => {
      const plan: ReproducerPlan = {
        analysisSummary: "Summary",
        rootCauseHypothesis: "Hypothesis",
        sqlPatternAnalysis: "SQL",
        filesToModify: [
          { path: "file1.rs", description: "Change 1" },
          { path: "file2.rs", description: "Change 2" },
        ],
        generationStrategy: "Strategy",
        verificationApproach: "Verification",
      };

      await writeReproducerPlan(plan, tempDir);

      const content = await readFile(join(tempDir, REPRODUCER_PLAN_FILE), "utf-8");
      expect(content).toContain("`file1.rs`: Change 1");
      expect(content).toContain("`file2.rs`: Change 2");
    });
  });

  describe("readReproducerPlan", () => {
    it("should read a reproducer plan file", async () => {
      const originalPlan: ReproducerPlan = {
        analysisSummary: "Test analysis",
        rootCauseHypothesis: "Test hypothesis",
        sqlPatternAnalysis: "Test SQL patterns",
        filesToModify: [
          { path: "simulator/test.rs", description: "Add test generation" },
        ],
        generationStrategy: "Test strategy",
        verificationApproach: "Test verification",
      };

      await writeReproducerPlan(originalPlan, tempDir);
      const readPlan = await readReproducerPlan(tempDir);

      expect(readPlan).not.toBeNull();
      expect(readPlan!.analysisSummary).toBe("Test analysis");
      expect(readPlan!.rootCauseHypothesis).toBe("Test hypothesis");
      expect(readPlan!.sqlPatternAnalysis).toBe("Test SQL patterns");
      expect(readPlan!.filesToModify).toHaveLength(1);
      expect(readPlan!.filesToModify[0]?.path).toBe("simulator/test.rs");
      expect(readPlan!.generationStrategy).toBe("Test strategy");
      expect(readPlan!.verificationApproach).toBe("Test verification");
    });

    it("should return null when file does not exist", async () => {
      const plan = await readReproducerPlan(tempDir);
      expect(plan).toBeNull();
    });
  });

  describe("writeFixerPlan", () => {
    it("should write a fixer plan file", async () => {
      const plan: FixerPlan = {
        rootCauseAnalysis: "Root cause",
        codePathTrace: "Code path",
        fixStrategy: "Fix strategy",
        filesToModify: [
          { path: "core/test.rs", description: "Fix bug" },
        ],
        validationApproach: "Validation",
        riskAssessment: "Risk assessment",
      };

      await writeFixerPlan(plan, tempDir);

      const content = await readFile(join(tempDir, FIXER_PLAN_FILE), "utf-8");
      expect(content).toContain("# Fixer Plan");
      expect(content).toContain("Root cause");
      expect(content).toContain("Code path");
      expect(content).toContain("Fix strategy");
      expect(content).toContain("`core/test.rs`");
      expect(content).toContain("Fix bug");
      expect(content).toContain("Validation");
      expect(content).toContain("Risk assessment");
    });
  });

  describe("readFixerPlan", () => {
    it("should read a fixer plan file", async () => {
      const originalPlan: FixerPlan = {
        rootCauseAnalysis: "Root cause",
        codePathTrace: "Code path",
        fixStrategy: "Fix strategy",
        filesToModify: [
          { path: "core/test.rs", description: "Fix bug" },
        ],
        validationApproach: "Validation",
        riskAssessment: "Risk assessment",
      };

      await writeFixerPlan(originalPlan, tempDir);
      const readPlan = await readFixerPlan(tempDir);

      expect(readPlan).not.toBeNull();
      expect(readPlan!.rootCauseAnalysis).toBe("Root cause");
      expect(readPlan!.codePathTrace).toBe("Code path");
      expect(readPlan!.fixStrategy).toBe("Fix strategy");
      expect(readPlan!.filesToModify).toHaveLength(1);
      expect(readPlan!.filesToModify[0]?.path).toBe("core/test.rs");
      expect(readPlan!.validationApproach).toBe("Validation");
      expect(readPlan!.riskAssessment).toBe("Risk assessment");
    });

    it("should return null when file does not exist", async () => {
      const plan = await readFixerPlan(tempDir);
      expect(plan).toBeNull();
    });
  });

  describe("reproducerPlanExists", () => {
    it("should return true when plan file exists", async () => {
      const plan: ReproducerPlan = {
        analysisSummary: "Summary",
        rootCauseHypothesis: "Hypothesis",
        sqlPatternAnalysis: "SQL",
        filesToModify: [{ path: "test.rs", description: "Test" }],
        generationStrategy: "Strategy",
        verificationApproach: "Verification",
      };
      await writeReproducerPlan(plan, tempDir);

      const exists = await reproducerPlanExists(tempDir);
      expect(exists).toBe(true);
    });

    it("should return false when plan file does not exist", async () => {
      const exists = await reproducerPlanExists(tempDir);
      expect(exists).toBe(false);
    });
  });

  describe("fixerPlanExists", () => {
    it("should return true when plan file exists", async () => {
      const plan: FixerPlan = {
        rootCauseAnalysis: "Root cause",
        codePathTrace: "Code path",
        fixStrategy: "Fix strategy",
        filesToModify: [{ path: "test.rs", description: "Test" }],
        validationApproach: "Validation",
        riskAssessment: "Risk",
      };
      await writeFixerPlan(plan, tempDir);

      const exists = await fixerPlanExists(tempDir);
      expect(exists).toBe(true);
    });

    it("should return false when plan file does not exist", async () => {
      const exists = await fixerPlanExists(tempDir);
      expect(exists).toBe(false);
    });
  });
});

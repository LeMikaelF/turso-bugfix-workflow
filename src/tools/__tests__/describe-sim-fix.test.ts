import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { describeSimFix } from "../describe-sim-fix.js";
import * as fs from "fs/promises";
import { CONTEXT_JSON_FILE } from "../../orchestrator/context-json.js";

// Mock fs/promises
vi.mock("fs/promises");

const mockFs = vi.mocked(fs);

describe("describe-sim-fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("validation", () => {
    it("should fail when failing_seed is missing", async () => {
      const result = await describeSimFix({
        failing_seed: undefined as unknown as number,
        why_simulator_missed: "Some reason",
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: failing_seed (must be a number)");
    });

    it("should fail when failing_seed is not a number", async () => {
      const result = await describeSimFix({
        failing_seed: "123" as unknown as number,
        why_simulator_missed: "Some reason",
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: failing_seed (must be a number)");
    });

    it("should fail when failing_seed is NaN", async () => {
      const result = await describeSimFix({
        failing_seed: NaN,
        why_simulator_missed: "Some reason",
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("failing_seed must be a non-negative integer");
    });

    it("should fail when failing_seed is Infinity", async () => {
      const result = await describeSimFix({
        failing_seed: Infinity,
        why_simulator_missed: "Some reason",
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("failing_seed must be a non-negative integer");
    });

    it("should fail when failing_seed is negative", async () => {
      const result = await describeSimFix({
        failing_seed: -42,
        why_simulator_missed: "Some reason",
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("failing_seed must be a non-negative integer");
    });

    it("should fail when failing_seed is a float", async () => {
      const result = await describeSimFix({
        failing_seed: 42.5,
        why_simulator_missed: "Some reason",
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("failing_seed must be a non-negative integer");
    });

    it("should fail when why_simulator_missed is missing", async () => {
      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: undefined as unknown as string,
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: why_simulator_missed");
    });

    it("should fail when why_simulator_missed is empty string", async () => {
      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: "",
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field why_simulator_missed cannot be empty");
    });

    it("should fail when why_simulator_missed is whitespace only", async () => {
      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: "   \t\n  ",
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field why_simulator_missed cannot be empty");
    });

    it("should fail when what_was_added is missing", async () => {
      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: "Some reason",
        what_was_added: undefined as unknown as string,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: what_was_added");
    });

    it("should fail when what_was_added is empty string", async () => {
      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: "Some reason",
        what_was_added: "",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field what_was_added cannot be empty");
    });

    it("should fail when what_was_added is whitespace only", async () => {
      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: "Some reason",
        what_was_added: "   \t\n  ",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field what_was_added cannot be empty");
    });

    it("should fail when why_simulator_missed is not a string", async () => {
      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: 123 as unknown as string,
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: why_simulator_missed");
    });

    it("should fail when what_was_added is not a string", async () => {
      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: "Some reason",
        what_was_added: { foo: "bar" } as unknown as string,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: what_was_added");
    });
  });

  describe("file operations", () => {
    it("should fail when panic_context.json does not exist", async () => {
      mockFs.readFile.mockRejectedValue(new Error("ENOENT: no such file or directory"));

      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: "The simulator didn't generate UPSERT statements",
        what_was_added: "Added UPSERT generation",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Failed to read ${CONTEXT_JSON_FILE}`);
    });

    it("should fail when JSON is malformed", async () => {
      mockFs.readFile.mockResolvedValue("{invalid json}");

      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: "The simulator didn't generate UPSERT statements",
        what_was_added: "Added UPSERT generation",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Invalid JSON in ${CONTEXT_JSON_FILE}`);
    });

    it("should succeed and update JSON with all fields", async () => {
      const originalData = {
        panic_location: "src/vdbe.c:1234",
        panic_message: "assertion failed",
        tcl_test_file: "test/panic.test",
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(originalData));
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: "The simulator didn't generate UPSERT statements",
        what_was_added: "Added UPSERT generation with conflicts",
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      // Verify writeFile was called with updated content
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      const writeCall = mockFs.writeFile.mock.calls[0];
      if (!writeCall) throw new Error("writeFile not called");
      const writtenContent = writeCall[1] as string;
      const writtenJson = JSON.parse(writtenContent);

      expect(writtenJson.failing_seed).toBe(42);
      expect(writtenJson.why_simulator_missed).toBe("The simulator didn't generate UPSERT statements");
      expect(writtenJson.simulator_changes).toBe("Added UPSERT generation with conflicts");
      // Original fields should be preserved
      expect(writtenJson.panic_location).toBe("src/vdbe.c:1234");
      expect(writtenJson.panic_message).toBe("assertion failed");
      expect(writtenJson.tcl_test_file).toBe("test/panic.test");
    });

    it("should fail when writeFile fails", async () => {
      mockFs.readFile.mockResolvedValue('{"panic_location": "test", "panic_message": "test", "tcl_test_file": "test"}');
      mockFs.writeFile.mockRejectedValue(new Error("Permission denied"));

      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: "Some reason",
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Failed to write ${CONTEXT_JSON_FILE}`);
    });

    it("should handle unicode and special characters in strings", async () => {
      mockFs.readFile.mockResolvedValue('{"panic_location": "test", "panic_message": "test", "tcl_test_file": "test"}');
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: "Contains unicode: 你好 and emoji 🚀",
        what_was_added: 'Contains quotes: "hello" and newlines\nand tabs\t',
      });

      expect(result.success).toBe(true);

      // Verify JSON is valid and readable
      const writeCall = mockFs.writeFile.mock.calls[0];
      if (!writeCall) throw new Error("writeFile not called");
      const writtenContent = writeCall[1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.why_simulator_missed).toContain("你好");
      expect(parsed.why_simulator_missed).toContain("🚀");
      expect(parsed.simulator_changes).toContain('"hello"');
    });

    it("should preserve all existing fields when updating", async () => {
      const existingData = {
        panic_location: "src/vdbe.c:1234",
        panic_message: "assertion failed",
        tcl_test_file: "test/panic.test",
        extra_field: "should be preserved",
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(existingData));
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await describeSimFix({
        failing_seed: 42,
        why_simulator_missed: "Some reason",
        what_was_added: "Added something",
      });

      expect(result.success).toBe(true);

      const writeCall = mockFs.writeFile.mock.calls[0];
      if (!writeCall) throw new Error("writeFile not called");
      const writtenContent = writeCall[1] as string;
      const parsed = JSON.parse(writtenContent);

      // All original fields preserved
      expect(parsed.panic_location).toBe("src/vdbe.c:1234");
      expect(parsed.extra_field).toBe("should be preserved");
      // New fields added
      expect(parsed.failing_seed).toBe(42);
    });
  });
});

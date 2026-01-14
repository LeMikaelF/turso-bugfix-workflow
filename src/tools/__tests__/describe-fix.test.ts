import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { describeFix } from "../describe-fix.js";
import * as fs from "fs/promises";
import { CONTEXT_JSON_FILE } from "../../orchestrator/context-json.js";

// Mock fs/promises
vi.mock("fs/promises");

const mockFs = vi.mocked(fs);

describe("describe-fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("validation", () => {
    it("should fail when bug_description is missing", async () => {
      const result = await describeFix({
        bug_description: undefined as unknown as string,
        fix_description: "Fixed something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: bug_description");
    });

    it("should fail when bug_description is empty string", async () => {
      const result = await describeFix({
        bug_description: "",
        fix_description: "Fixed something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field bug_description cannot be empty");
    });

    it("should fail when bug_description is whitespace only", async () => {
      const result = await describeFix({
        bug_description: "   \t\n  ",
        fix_description: "Fixed something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field bug_description cannot be empty");
    });

    it("should fail when fix_description is missing", async () => {
      const result = await describeFix({
        bug_description: "Some bug",
        fix_description: undefined as unknown as string,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: fix_description");
    });

    it("should fail when fix_description is empty string", async () => {
      const result = await describeFix({
        bug_description: "Some bug",
        fix_description: "",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field fix_description cannot be empty");
    });

    it("should fail when fix_description is whitespace only", async () => {
      const result = await describeFix({
        bug_description: "Some bug",
        fix_description: "   \t\n  ",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field fix_description cannot be empty");
    });

    it("should fail when bug_description is not a string", async () => {
      const result = await describeFix({
        bug_description: 456 as unknown as string,
        fix_description: "Fixed something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: bug_description");
    });

    it("should fail when fix_description is not a string", async () => {
      const result = await describeFix({
        bug_description: "Some bug",
        fix_description: ["array"] as unknown as string,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: fix_description");
    });
  });

  describe("file operations", () => {
    it("should fail when panic_context.json does not exist", async () => {
      mockFs.readFile.mockRejectedValue(new Error("ENOENT: no such file or directory"));

      const result = await describeFix({
        bug_description: "Cursor was not validated",
        fix_description: "Added null check",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Failed to read ${CONTEXT_JSON_FILE}`);
    });

    it("should fail when JSON is malformed", async () => {
      mockFs.readFile.mockResolvedValue("{invalid json}");

      const result = await describeFix({
        bug_description: "Some bug",
        fix_description: "Some fix",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Invalid JSON in ${CONTEXT_JSON_FILE}`);
    });

    it("should succeed and update JSON with bug and fix descriptions", async () => {
      const existingData = {
        panic_location: "src/vdbe.c:1234",
        panic_message: "assertion failed",
        tcl_test_file: "test/panic.test",
        failing_seed: 42,
        why_simulator_missed: "Edge case",
        simulator_changes: "Added test",
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(existingData));
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await describeFix({
        bug_description: "Cursor was not validated before dereferencing",
        fix_description: "Added null check before cursor access",
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      // Verify writeFile was called with updated content
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      const writeCall = mockFs.writeFile.mock.calls[0];
      if (!writeCall) throw new Error("writeFile not called");
      const writtenContent = writeCall[1] as string;
      const writtenJson = JSON.parse(writtenContent);

      expect(writtenJson.bug_description).toBe("Cursor was not validated before dereferencing");
      expect(writtenJson.fix_description).toBe("Added null check before cursor access");
      // Original fields should be preserved
      expect(writtenJson.panic_location).toBe("src/vdbe.c:1234");
      expect(writtenJson.failing_seed).toBe(42);
      expect(writtenJson.why_simulator_missed).toBe("Edge case");
    });

    it("should fail when writeFile fails", async () => {
      mockFs.readFile.mockResolvedValue('{"panic_location": "test", "panic_message": "test", "tcl_test_file": "test"}');
      mockFs.writeFile.mockRejectedValue(new Error("Permission denied"));

      const result = await describeFix({
        bug_description: "Some bug",
        fix_description: "Some fix",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Failed to write ${CONTEXT_JSON_FILE}`);
    });

    it("should handle unicode and special characters in strings", async () => {
      mockFs.readFile.mockResolvedValue('{"panic_location": "test", "panic_message": "test", "tcl_test_file": "test"}');
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await describeFix({
        bug_description: "Contains unicode: 你好 and emoji 🚀",
        fix_description: 'Contains quotes: "hello" and newlines\nand tabs\t',
      });

      expect(result.success).toBe(true);

      // Verify JSON is valid and readable
      const writeCall = mockFs.writeFile.mock.calls[0];
      if (!writeCall) throw new Error("writeFile not called");
      const writtenContent = writeCall[1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.bug_description).toContain("你好");
      expect(parsed.bug_description).toContain("🚀");
      expect(parsed.fix_description).toContain('"hello"');
    });

    it("should preserve all existing fields when updating", async () => {
      const existingData = {
        panic_location: "src/vdbe.c:1234",
        panic_message: "assertion failed",
        tcl_test_file: "test/panic.test",
        failing_seed: 42,
        why_simulator_missed: "Edge case",
        simulator_changes: "Added test",
        extra_field: "should be preserved",
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(existingData));
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await describeFix({
        bug_description: "Bug description",
        fix_description: "Fix description",
      });

      expect(result.success).toBe(true);

      const writeCall = mockFs.writeFile.mock.calls[0];
      if (!writeCall) throw new Error("writeFile not called");
      const writtenContent = writeCall[1] as string;
      const parsed = JSON.parse(writtenContent);

      // All original fields preserved
      expect(parsed.panic_location).toBe("src/vdbe.c:1234");
      expect(parsed.failing_seed).toBe(42);
      expect(parsed.extra_field).toBe("should be preserved");
      // New fields added
      expect(parsed.bug_description).toBe("Bug description");
      expect(parsed.fix_description).toBe("Fix description");
    });

    it("should accept long descriptions", async () => {
      mockFs.readFile.mockResolvedValue('{"panic_location": "test", "panic_message": "test", "tcl_test_file": "test"}');
      mockFs.writeFile.mockResolvedValue(undefined);

      const longDescription = "y".repeat(10000);
      const result = await describeFix({
        bug_description: longDescription,
        fix_description: longDescription,
      });

      expect(result.success).toBe(true);
    });
  });
});

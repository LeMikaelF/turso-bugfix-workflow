import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  readContextJson,
  writeContextJson,
  updateContextJson,
  generateInitialContextJson,
  CONTEXT_JSON_FILE,
  type PanicContextData,
} from "../context-json.js";
import * as fs from "fs/promises";

// Mock fs/promises
vi.mock("fs/promises");

const mockFs = vi.mocked(fs);

describe("context-json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("readContextJson", () => {
    it("should read and parse valid JSON file", async () => {
      const mockData: PanicContextData = {
        panic_location: "src/vdbe.c:1234",
        panic_message: "assertion failed",
        tcl_test_file: "test/panic.test",
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockData));

      const result = await readContextJson();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockData);
      expect(result.error).toBeUndefined();
    });

    it("should read file with all optional fields", async () => {
      const mockData: PanicContextData = {
        panic_location: "src/vdbe.c:1234",
        panic_message: "assertion failed",
        tcl_test_file: "test/panic.test",
        failing_seed: 42,
        why_simulator_missed: "Missing edge case",
        simulator_changes: "Added new test path",
        bug_description: "Buffer overflow",
        fix_description: "Added bounds check",
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockData));

      const result = await readContextJson();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockData);
    });

    it("should return notFound when file does not exist", async () => {
      const enoentError = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
      enoentError.code = "ENOENT";
      mockFs.readFile.mockRejectedValue(enoentError);

      const result = await readContextJson();

      expect(result.success).toBe(false);
      expect(result.notFound).toBe(true);
      expect(result.data).toBeUndefined();
      expect(result.error).toContain("File not found");
    });

    it("should return error without notFound for other read errors", async () => {
      mockFs.readFile.mockRejectedValue(new Error("Permission denied"));

      const result = await readContextJson();

      expect(result.success).toBe(false);
      expect(result.notFound).toBeUndefined();
      expect(result.error).toContain("Failed to read");
    });

    it("should return error for invalid JSON", async () => {
      mockFs.readFile.mockResolvedValue("{invalid json}");

      const result = await readContextJson();

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toContain("Invalid JSON");
    });

    it("should return error for empty file", async () => {
      mockFs.readFile.mockResolvedValue("");

      const result = await readContextJson();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid JSON");
    });
  });

  describe("writeContextJson", () => {
    it("should write valid JSON to file", async () => {
      mockFs.writeFile.mockResolvedValue(undefined);

      const data: PanicContextData = {
        panic_location: "src/vdbe.c:1234",
        panic_message: "assertion failed",
        tcl_test_file: "test/panic.test",
      };

      const result = await writeContextJson(data);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);

      // Verify JSON is formatted with indentation
      const writeCall = mockFs.writeFile.mock.calls[0];
      expect(writeCall).toBeDefined();
      const writtenContent = writeCall![1] as string;
      expect(writtenContent).toContain("\n"); // Has newlines (formatted)
      expect(JSON.parse(writtenContent)).toEqual(data);
    });

    it("should write all fields including optional ones", async () => {
      mockFs.writeFile.mockResolvedValue(undefined);

      const data: PanicContextData = {
        panic_location: "src/vdbe.c:1234",
        panic_message: "assertion failed",
        tcl_test_file: "test/panic.test",
        failing_seed: 42,
        why_simulator_missed: "Edge case",
        simulator_changes: "Added test",
        bug_description: "Bug",
        fix_description: "Fix",
      };

      const result = await writeContextJson(data);

      expect(result.success).toBe(true);
      const writeCall = mockFs.writeFile.mock.calls[0];
      const writtenContent = writeCall![1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.failing_seed).toBe(42);
      expect(parsed.bug_description).toBe("Bug");
    });

    it("should return error when write fails", async () => {
      mockFs.writeFile.mockRejectedValue(new Error("Permission denied"));

      const data: PanicContextData = {
        panic_location: "test",
        panic_message: "test",
        tcl_test_file: "test",
      };

      const result = await writeContextJson(data);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to write");
      expect(result.error).toContain(CONTEXT_JSON_FILE);
    });
  });

  describe("updateContextJson", () => {
    it("should merge updates with existing data", async () => {
      const existingData: PanicContextData = {
        panic_location: "src/vdbe.c:1234",
        panic_message: "assertion failed",
        tcl_test_file: "test/panic.test",
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(existingData));
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await updateContextJson({
        failing_seed: 42,
        why_simulator_missed: "Missing case",
      });

      expect(result.success).toBe(true);
      const writeCall = mockFs.writeFile.mock.calls[0];
      const writtenContent = writeCall![1] as string;
      const parsed = JSON.parse(writtenContent);

      // Original fields preserved
      expect(parsed.panic_location).toBe("src/vdbe.c:1234");
      expect(parsed.panic_message).toBe("assertion failed");
      // New fields added
      expect(parsed.failing_seed).toBe(42);
      expect(parsed.why_simulator_missed).toBe("Missing case");
    });

    it("should overwrite existing fields with updates", async () => {
      const existingData: PanicContextData = {
        panic_location: "src/vdbe.c:1234",
        panic_message: "old message",
        tcl_test_file: "test/panic.test",
        failing_seed: 10,
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(existingData));
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await updateContextJson({
        panic_message: "new message",
        failing_seed: 42,
      });

      expect(result.success).toBe(true);
      const writeCall = mockFs.writeFile.mock.calls[0];
      const writtenContent = writeCall![1] as string;
      const parsed = JSON.parse(writtenContent);

      expect(parsed.panic_message).toBe("new message");
      expect(parsed.failing_seed).toBe(42);
    });

    it("should return error if file does not exist", async () => {
      const enoentError = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
      enoentError.code = "ENOENT";
      mockFs.readFile.mockRejectedValue(enoentError);

      const result = await updateContextJson({
        failing_seed: 42,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("does not exist");
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should return error for corrupted file instead of overwriting", async () => {
      mockFs.readFile.mockResolvedValue("{invalid json}");

      const result = await updateContextJson({
        failing_seed: 42,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid JSON");
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should return error when write fails", async () => {
      mockFs.readFile.mockResolvedValue('{"panic_location": "test"}');
      mockFs.writeFile.mockRejectedValue(new Error("Disk full"));

      const result = await updateContextJson({ failing_seed: 42 });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to write");
    });
  });

  describe("generateInitialContextJson", () => {
    it("should generate initial context with required fields", () => {
      const result = generateInitialContextJson(
        "src/vdbe.c:1234",
        "assertion failed: pCur->isValid",
        "test/panic-src-vdbe.c-1234.test"
      );

      expect(result).toEqual({
        panic_location: "src/vdbe.c:1234",
        panic_message: "assertion failed: pCur->isValid",
        tcl_test_file: "test/panic-src-vdbe.c-1234.test",
      });
    });

    it("should not include optional fields", () => {
      const result = generateInitialContextJson("loc", "msg", "file");

      expect(result.failing_seed).toBeUndefined();
      expect(result.why_simulator_missed).toBeUndefined();
      expect(result.simulator_changes).toBeUndefined();
      expect(result.bug_description).toBeUndefined();
      expect(result.fix_description).toBeUndefined();
    });
  });
});

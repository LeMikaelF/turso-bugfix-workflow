import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateFixFast } from "../validate-fix-fast.js";

// Use vi.hoisted to create mock before module loading
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
}));

// Mock util.promisify to return our mock exec
vi.mock("node:util", () => ({
  promisify: () => mockExecAsync,
}));

describe("validate-fix-fast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("validateFixFast", () => {
    it("should return passed: true when make test-single succeeds", async () => {
      mockExecAsync.mockResolvedValue({
        stdout: "All tests passed",
        stderr: "",
      });

      const result = await validateFixFast();

      expect(result.passed).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.stdout).toBe("All tests passed");
      expect(result.stderr).toBe("");
    });

    it("should call make test-single with correct options", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

      await validateFixFast();

      expect(mockExecAsync).toHaveBeenCalledWith("make test-single", {
        timeout: 5 * 60 * 1000, // 5 minutes
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
    });

    it("should return passed: false when test fails with non-zero exit code", async () => {
      const error = new Error("Command failed") as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      error.code = 1;
      error.stdout = "Running tests...\nFAILED: test_panic.tcl";
      error.stderr = "Error: assertion failed";
      mockExecAsync.mockRejectedValue(error);

      const result = await validateFixFast();

      expect(result.passed).toBe(false);
      expect(result.error).toBe("Error: assertion failed");
      expect(result.stdout).toBe("Running tests...\nFAILED: test_panic.tcl");
      expect(result.stderr).toBe("Error: assertion failed");
    });

    it("should return error message from stderr when test fails", async () => {
      const error = new Error("Command failed") as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      error.code = 2;
      error.stdout = "";
      error.stderr = "make: *** [test-single] Error 1";
      mockExecAsync.mockRejectedValue(error);

      const result = await validateFixFast();

      expect(result.passed).toBe(false);
      expect(result.error).toBe("make: *** [test-single] Error 1");
    });

    it("should return exit code message when stderr is empty", async () => {
      const error = new Error("Command failed") as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      error.code = 42;
      error.stdout = "Some output";
      error.stderr = "";
      mockExecAsync.mockRejectedValue(error);

      const result = await validateFixFast();

      expect(result.passed).toBe(false);
      expect(result.error).toBe("Test failed with exit code 42");
    });

    it("should handle timeout gracefully", async () => {
      const error = new Error("Timeout") as Error & {
        killed: boolean;
        signal: string;
        stdout: string;
        stderr: string;
      };
      error.killed = true;
      error.signal = "SIGTERM";
      error.stdout = "Test running...";
      error.stderr = "";
      mockExecAsync.mockRejectedValue(error);

      const result = await validateFixFast();

      expect(result.passed).toBe(false);
      expect(result.error).toBe("Test timed out");
      expect(result.stdout).toBe("Test running...");
    });

    it("should handle unknown error types gracefully", async () => {
      mockExecAsync.mockRejectedValue("Some random error");

      const result = await validateFixFast();

      expect(result.passed).toBe(false);
      expect(result.error).toBe("Some random error");
    });

    it("should handle Error instance without exec properties", async () => {
      mockExecAsync.mockRejectedValue(new Error("Generic error"));

      const result = await validateFixFast();

      expect(result.passed).toBe(false);
      expect(result.error).toBe("Generic error");
    });

    it("should include stdout and stderr in success result", async () => {
      mockExecAsync.mockResolvedValue({
        stdout: "test_panic.tcl... OK",
        stderr: "Warning: deprecated function",
      });

      const result = await validateFixFast();

      expect(result.passed).toBe(true);
      expect(result.stdout).toBe("test_panic.tcl... OK");
      expect(result.stderr).toBe("Warning: deprecated function");
    });

    it("should handle missing stdout/stderr in error", async () => {
      const error = new Error("Command failed") as Error & {
        code: number;
      };
      error.code = 1;
      mockExecAsync.mockRejectedValue(error);

      const result = await validateFixFast();

      expect(result.passed).toBe(false);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });
  });
});

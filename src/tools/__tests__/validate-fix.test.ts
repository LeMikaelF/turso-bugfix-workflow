import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateFix, validateFailingSeed } from "../validate-fix.js";

// Use vi.hoisted to create mocks before module loading
const { mockExecAsync, mockRunSimulator } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
  mockRunSimulator: vi.fn(),
}));

// Mock util.promisify to return our mock exec
vi.mock("node:util", () => ({
  promisify: () => mockExecAsync,
}));

// Mock run-simulator module
vi.mock("../run-simulator.js", () => ({
  runSimulator: mockRunSimulator,
}));

describe("validate-fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("validateFailingSeed", () => {
    it("should accept valid positive integer", () => {
      expect(validateFailingSeed(42)).toBe(42);
    });

    it("should accept zero", () => {
      expect(validateFailingSeed(0)).toBe(0);
    });

    it("should accept max valid seed", () => {
      expect(validateFailingSeed(2147483647)).toBe(2147483647);
    });

    it("should reject undefined", () => {
      expect(() => validateFailingSeed(undefined)).toThrow("Missing required parameter: failing_seed");
    });

    it("should reject null", () => {
      expect(() => validateFailingSeed(null)).toThrow("Missing required parameter: failing_seed");
    });

    it("should reject non-number types", () => {
      expect(() => validateFailingSeed("42")).toThrow("Invalid failing_seed: must be a number");
      expect(() => validateFailingSeed({ value: 42 })).toThrow("Invalid failing_seed: must be a number");
    });

    it("should reject NaN", () => {
      expect(() => validateFailingSeed(NaN)).toThrow("Invalid failing_seed: must be a finite integer");
    });

    it("should reject Infinity", () => {
      expect(() => validateFailingSeed(Infinity)).toThrow("Invalid failing_seed: must be a finite integer");
    });

    it("should reject floating point numbers", () => {
      expect(() => validateFailingSeed(3.14)).toThrow("Invalid failing_seed: must be a finite integer");
    });

    it("should reject negative numbers", () => {
      expect(() => validateFailingSeed(-1)).toThrow("Invalid failing_seed: must be between 0 and");
    });

    it("should reject seeds larger than max", () => {
      expect(() => validateFailingSeed(2147483648)).toThrow("Invalid failing_seed: must be between 0 and");
    });
  });

  describe("validateFix", () => {
    it("should return passed: true when all validations pass", async () => {
      // Fast validation (make test-single) succeeds
      mockExecAsync.mockResolvedValueOnce({ stdout: "Test passed", stderr: "" });
      // Slow validation (make test) succeeds
      mockExecAsync.mockResolvedValueOnce({ stdout: "Tests passed", stderr: "" });
      // All simulator runs pass
      mockRunSimulator.mockResolvedValue({ panic_found: false, seed_used: 12345 });

      const result = await validateFix({ failing_seed: 12345 });

      expect(result.passed).toBe(true);
      expect(result.fast_validation_passed).toBe(true);
      expect(result.slow_validation_passed).toBe(true);
      expect(result.make_test_passed).toBe(true);
      expect(result.sim_runs_passed).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should run fast validation before slow validation", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
      mockRunSimulator.mockResolvedValue({ panic_found: false, seed_used: 12345 });

      await validateFix({ failing_seed: 12345 });

      // First call should be make test-single (fast), second should be make test (slow)
      expect(mockExecAsync).toHaveBeenCalledTimes(2);
      expect(mockExecAsync.mock.calls[0]?.[0]).toBe("make test-single");
      expect(mockExecAsync.mock.calls[1]?.[0]).toBe("make test");
    });

    it("should run simulator 10 times after make test passes", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
      mockRunSimulator.mockResolvedValue({ panic_found: false, seed_used: 12345 });

      await validateFix({ failing_seed: 12345 });

      expect(mockRunSimulator).toHaveBeenCalledTimes(10);
      for (const call of mockRunSimulator.mock.calls) {
        expect(call[0]).toEqual({ seed: 12345 });
      }
    });

    it("should return error when failing_seed is invalid", async () => {
      const result = await validateFix({ failing_seed: -1 });

      expect(result.passed).toBe(false);
      expect(result.fast_validation_passed).toBe(false);
      expect(result.error).toContain("Invalid failing_seed");
      expect(mockExecAsync).not.toHaveBeenCalled();
      expect(mockRunSimulator).not.toHaveBeenCalled();
    });

    it("should return error when fast validation fails", async () => {
      const error = new Error("Command failed") as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      error.code = 2;
      error.stdout = "some output";
      error.stderr = "TCL test failed";
      mockExecAsync.mockRejectedValueOnce(error);

      const result = await validateFix({ failing_seed: 12345 });

      expect(result.passed).toBe(false);
      expect(result.fast_validation_passed).toBe(false);
      expect(result.slow_validation_passed).toBeUndefined();
      expect(result.error).toBe("TCL test failed");
      expect(result.stdout).toBe("some output");
      expect(result.stderr).toBe("TCL test failed");
      // Should not proceed to slow validation
      expect(mockExecAsync).toHaveBeenCalledTimes(1);
      expect(mockRunSimulator).not.toHaveBeenCalled();
    });

    it("should return error when fast validation times out", async () => {
      const error = new Error("Timeout") as Error & {
        killed: boolean;
        signal: string;
        stdout: string;
        stderr: string;
      };
      error.killed = true;
      error.signal = "SIGTERM";
      error.stdout = "";
      error.stderr = "";
      mockExecAsync.mockRejectedValueOnce(error);

      const result = await validateFix({ failing_seed: 12345 });

      expect(result.passed).toBe(false);
      expect(result.fast_validation_passed).toBe(false);
      expect(result.error).toBe("Fast validation timed out");
    });

    it("should return error when make test fails", async () => {
      // Fast validation succeeds
      mockExecAsync.mockResolvedValueOnce({ stdout: "", stderr: "" });
      // Slow validation (make test) fails
      const error = new Error("Command failed") as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      error.code = 2;
      error.stdout = "";
      error.stderr = "Compilation error";
      mockExecAsync.mockRejectedValueOnce(error);

      const result = await validateFix({ failing_seed: 12345 });

      expect(result.passed).toBe(false);
      expect(result.fast_validation_passed).toBe(true);
      expect(result.slow_validation_passed).toBe(false);
      expect(result.make_test_passed).toBe(false);
      // sim_runs_passed should be undefined since simulators never ran
      expect(result.sim_runs_passed).toBeUndefined();
      expect(result.error).toBe("Compilation error");
      expect(mockRunSimulator).not.toHaveBeenCalled();
    });

    it("should return error when make test times out", async () => {
      // Fast validation succeeds
      mockExecAsync.mockResolvedValueOnce({ stdout: "", stderr: "" });
      // Slow validation times out
      const error = new Error("Timeout") as Error & {
        killed: boolean;
        signal: string;
        stdout: string;
        stderr: string;
      };
      error.killed = true;
      error.signal = "SIGTERM";
      error.stdout = "";
      error.stderr = "";
      mockExecAsync.mockRejectedValueOnce(error);

      const result = await validateFix({ failing_seed: 12345 });

      expect(result.passed).toBe(false);
      expect(result.fast_validation_passed).toBe(true);
      expect(result.slow_validation_passed).toBe(false);
      expect(result.make_test_passed).toBe(false);
      expect(result.error).toBe("make test timed out");
    });

    it("should return error when panic found during simulator run", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
      // First 3 runs pass, 4th run finds panic
      mockRunSimulator
        .mockResolvedValueOnce({ panic_found: false, seed_used: 12345 })
        .mockResolvedValueOnce({ panic_found: false, seed_used: 12345 })
        .mockResolvedValueOnce({ panic_found: false, seed_used: 12345 })
        .mockResolvedValueOnce({ panic_found: true, seed_used: 12345, panic_message: "assertion failed" });

      const result = await validateFix({ failing_seed: 12345 });

      expect(result.passed).toBe(false);
      expect(result.fast_validation_passed).toBe(true);
      expect(result.slow_validation_passed).toBe(false);
      expect(result.make_test_passed).toBe(true);
      expect(result.sim_runs_passed).toBe(false);
      expect(result.error).toBe("Panic still occurs on simulator run 4 of 10");
      expect(mockRunSimulator).toHaveBeenCalledTimes(4);
    });

    it("should return error on first simulator panic", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
      mockRunSimulator.mockResolvedValue({ panic_found: true, seed_used: 12345, panic_message: "crash" });

      const result = await validateFix({ failing_seed: 12345 });

      expect(result.passed).toBe(false);
      expect(result.fast_validation_passed).toBe(true);
      expect(result.slow_validation_passed).toBe(false);
      expect(result.make_test_passed).toBe(true);
      expect(result.sim_runs_passed).toBe(false);
      expect(result.error).toBe("Panic still occurs on simulator run 1 of 10");
      expect(mockRunSimulator).toHaveBeenCalledTimes(1);
    });

    it("should return error when simulator has error (not panic)", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
      mockRunSimulator.mockResolvedValue({
        panic_found: false,
        seed_used: 12345,
        error: "Simulator crashed unexpectedly",
      });

      const result = await validateFix({ failing_seed: 12345 });

      expect(result.passed).toBe(false);
      expect(result.fast_validation_passed).toBe(true);
      expect(result.slow_validation_passed).toBe(false);
      expect(result.make_test_passed).toBe(true);
      expect(result.sim_runs_passed).toBe(false);
      expect(result.error).toBe("Simulator error on run 1: Simulator crashed unexpectedly");
    });

    it("should call make test-single with correct options", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
      mockRunSimulator.mockResolvedValue({ panic_found: false, seed_used: 12345 });

      await validateFix({ failing_seed: 12345 });

      expect(mockExecAsync.mock.calls[0]).toEqual([
        "make test-single",
        {
          timeout: 5 * 60 * 1000, // 5 minutes
          maxBuffer: 10 * 1024 * 1024, // 10MB
        },
      ]);
    });

    it("should call make test with correct options", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
      mockRunSimulator.mockResolvedValue({ panic_found: false, seed_used: 12345 });

      await validateFix({ failing_seed: 12345 });

      expect(mockExecAsync.mock.calls[1]).toEqual([
        "make test",
        {
          timeout: 30 * 60 * 1000, // 30 minutes
          maxBuffer: 10 * 1024 * 1024, // 10MB
        },
      ]);
    });

    it("should handle fast validation error without stderr", async () => {
      const error = new Error("Command failed") as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      error.code = 1;
      error.stdout = "";
      error.stderr = "";
      mockExecAsync.mockRejectedValueOnce(error);

      const result = await validateFix({ failing_seed: 12345 });

      expect(result.passed).toBe(false);
      expect(result.fast_validation_passed).toBe(false);
      expect(result.error).toBe("Fast validation failed with exit code 1");
    });

    it("should handle unknown error type from fast validation", async () => {
      mockExecAsync.mockRejectedValueOnce("Some random error");

      const result = await validateFix({ failing_seed: 12345 });

      expect(result.passed).toBe(false);
      expect(result.fast_validation_passed).toBe(false);
      expect(result.error).toBe("Some random error");
    });

    it("should handle unknown error type from make test", async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: "", stderr: "" });
      mockExecAsync.mockRejectedValueOnce("Some random error");

      const result = await validateFix({ failing_seed: 12345 });

      expect(result.passed).toBe(false);
      expect(result.fast_validation_passed).toBe(true);
      expect(result.slow_validation_passed).toBe(false);
      expect(result.error).toBe("Some random error");
    });
  });
});

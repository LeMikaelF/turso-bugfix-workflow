import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractPanicMessage,
  detectPanic,
  validateSeed,
  validateTimeout,
  runSimulator,
} from "../run-simulator.js";

// Use vi.hoisted to create mock before module loading
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
}));

// Mock util.promisify to return our mock exec
vi.mock("node:util", () => ({
  promisify: () => mockExecAsync,
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("run-simulator", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetAllMocks();
  });

  describe("extractPanicMessage", () => {
    it("should extract PANIC message", () => {
      const output = "Some output\nPANIC: assertion failed: pCur->isValid\nMore output";
      expect(extractPanicMessage(output)).toBe("assertion failed: pCur->isValid");
    });

    it("should extract lowercase panic message", () => {
      const output = "panic: memory corruption detected";
      expect(extractPanicMessage(output)).toBe("memory corruption detected");
    });

    it("should extract assertion failed message", () => {
      const output = "test output\nassertion failed: x > 0\nmore output";
      expect(extractPanicMessage(output)).toBe("x > 0");
    });

    it("should extract SIGABRT message", () => {
      const output = "SIGABRT received: null pointer dereference";
      expect(extractPanicMessage(output)).toBe("null pointer dereference");
    });

    it("should return undefined when no panic pattern found", () => {
      const output = "Normal execution completed successfully";
      expect(extractPanicMessage(output)).toBeUndefined();
    });

    it("should handle empty output", () => {
      expect(extractPanicMessage("")).toBeUndefined();
    });

    it("should truncate very long panic messages", () => {
      const longMessage = "x".repeat(6000);
      const output = `PANIC: ${longMessage}`;
      const result = extractPanicMessage(output);
      expect(result).toBeDefined();
      expect(result!.length).toBeLessThan(6000);
      expect(result).toContain("(truncated)");
    });
  });

  describe("detectPanic", () => {
    it("should detect panic with non-zero exit code and PANIC in output", () => {
      expect(detectPanic("PANIC: something went wrong", 1)).toBe(true);
    });

    it("should detect panic with assertion failed", () => {
      expect(detectPanic("assertion failed: x != null", 134)).toBe(true);
    });

    it("should detect panic with SIGABRT", () => {
      expect(detectPanic("Received SIGABRT", 6)).toBe(true);
    });

    it("should not detect panic with zero exit code", () => {
      expect(detectPanic("PANIC: false alarm", 0)).toBe(false);
    });

    it("should not detect panic without panic indicators", () => {
      expect(detectPanic("Normal error message", 1)).toBe(false);
    });

    it("should be case insensitive", () => {
      expect(detectPanic("panic occurred", 1)).toBe(true);
      expect(detectPanic("ABORT signal", 1)).toBe(true);
    });
  });

  describe("validateSeed", () => {
    it("should accept valid positive integer", () => {
      expect(validateSeed(42)).toBe(42);
    });

    it("should accept zero", () => {
      expect(validateSeed(0)).toBe(0);
    });

    it("should generate random seed when undefined", () => {
      const seed = validateSeed(undefined);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(1000000);
    });

    it("should reject negative seed", () => {
      expect(() => validateSeed(-1)).toThrow("Invalid seed");
    });

    it("should reject NaN", () => {
      expect(() => validateSeed(NaN)).toThrow("Invalid seed");
    });

    it("should reject Infinity", () => {
      expect(() => validateSeed(Infinity)).toThrow("Invalid seed");
    });

    it("should reject floating point numbers", () => {
      expect(() => validateSeed(3.14)).toThrow("Invalid seed");
    });

    it("should reject seeds larger than max 32-bit integer", () => {
      expect(() => validateSeed(2147483648)).toThrow("Invalid seed");
    });
  });

  describe("validateTimeout", () => {
    it("should accept valid positive timeout", () => {
      expect(validateTimeout(300)).toBe(300);
    });

    it("should return default when undefined", () => {
      expect(validateTimeout(undefined)).toBe(300);
    });

    it("should reject zero timeout", () => {
      expect(() => validateTimeout(0)).toThrow("Invalid timeout");
    });

    it("should reject negative timeout", () => {
      expect(() => validateTimeout(-10)).toThrow("Invalid timeout");
    });

    it("should reject timeout exceeding max", () => {
      expect(() => validateTimeout(4000)).toThrow("Invalid timeout");
    });
  });

  describe("runSimulator", () => {
    it("should use provided seed", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "Success", stderr: "" });

      const result = await runSimulator({ seed: 42 });
      expect(result.seed_used).toBe(42);
      expect(mockExecAsync).toHaveBeenCalledWith(
        "./simulator --seed 42",
        expect.any(Object)
      );
    });

    it("should generate random seed when not provided", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "Success", stderr: "" });

      const result = await runSimulator({});
      expect(result.seed_used).toBeGreaterThanOrEqual(0);
      expect(result.seed_used).toBeLessThan(1000000);
    });

    it("should send IPC callbacks when PANIC_LOCATION is set", async () => {
      process.env.PANIC_LOCATION = "src/test.c:100";
      process.env.IPC_PORT = "9100";

      mockExecAsync.mockResolvedValue({ stdout: "Success", stderr: "" });

      await runSimulator({ seed: 123 });

      // Should have called fetch twice: started and finished
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/sim/src%2Ftest.c%3A100/started"),
        { method: "POST" }
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/sim/src%2Ftest.c%3A100/finished"),
        { method: "POST" }
      );
    });

    it("should not send IPC callbacks when PANIC_LOCATION is not set", async () => {
      delete process.env.PANIC_LOCATION;

      mockExecAsync.mockResolvedValue({ stdout: "Success", stderr: "" });

      await runSimulator({ seed: 123 });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should return panic_found: true when panic is detected", async () => {
      const panicOutput = "PANIC: assertion failed: pCur->isValid";

      const error = new Error("Command failed") as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      error.code = 1;
      error.stdout = panicOutput;
      error.stderr = "";
      mockExecAsync.mockRejectedValue(error);

      const result = await runSimulator({ seed: 123 });

      expect(result.panic_found).toBe(true);
      expect(result.panic_message).toBe("assertion failed: pCur->isValid");
    });

    it("should return panic_found: false for successful execution", async () => {
      mockExecAsync.mockResolvedValue({
        stdout: "Simulation completed successfully",
        stderr: "",
      });

      const result = await runSimulator({ seed: 123 });

      expect(result.panic_found).toBe(false);
      expect(result.panic_message).toBeUndefined();
    });

    it("should always send finished callback even when simulator fails", async () => {
      process.env.PANIC_LOCATION = "src/test.c:100";

      const error = new Error("Command failed") as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      error.code = 1;
      error.stdout = "PANIC: crash";
      error.stderr = "";
      mockExecAsync.mockRejectedValue(error);

      await runSimulator({ seed: 123 });

      // Verify finished was called even after error
      const finishedCalls = mockFetch.mock.calls.filter((call) =>
        (call[0] as string).includes("/finished")
      );
      expect(finishedCalls.length).toBe(1);
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
      error.stdout = "";
      error.stderr = "";
      mockExecAsync.mockRejectedValue(error);

      const result = await runSimulator({ seed: 123, timeout_seconds: 10 });

      expect(result.panic_found).toBe(false);
      expect(result.error).toContain("timed out");
    });

    it("should handle IPC callback failure gracefully", async () => {
      process.env.PANIC_LOCATION = "src/test.c:100";

      // Mock fetch to fail
      mockFetch.mockRejectedValue(new Error("Network error"));

      mockExecAsync.mockResolvedValue({ stdout: "Success", stderr: "" });

      // Should not throw, IPC failures are logged but don't stop execution
      const result = await runSimulator({ seed: 123 });
      expect(result.panic_found).toBe(false);
    });

    it("should return error for invalid seed", async () => {
      const result = await runSimulator({ seed: -1 });

      expect(result.panic_found).toBe(false);
      expect(result.error).toContain("Invalid seed");
      expect(mockExecAsync).not.toHaveBeenCalled();
    });

    it("should return error for invalid timeout", async () => {
      const result = await runSimulator({ seed: 123, timeout_seconds: 5000 });

      expect(result.panic_found).toBe(false);
      expect(result.error).toContain("Invalid timeout");
      expect(mockExecAsync).not.toHaveBeenCalled();
    });

    it("should handle unknown error types gracefully", async () => {
      // Throw a non-ExecError (e.g., just a string)
      mockExecAsync.mockRejectedValue("Some random error");

      const result = await runSimulator({ seed: 123 });

      expect(result.panic_found).toBe(false);
      expect(result.error).toBe("Some random error");
    });
  });
});

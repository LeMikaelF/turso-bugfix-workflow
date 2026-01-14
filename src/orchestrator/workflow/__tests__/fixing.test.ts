import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleFixing } from "../states/fixing.js";
import type { WorkflowContext } from "../types.js";
import {
  createMockLogger,
  createMockDb,
  createMockIpcServer,
  createMockConfig,
  createMockPanic,
  createMockSandbox,
} from "./test-utils.js";

// Mock agents module
vi.mock("../../agents.js", () => ({
  spawnFixerAgent: vi.fn(),
}));

import { spawnFixerAgent } from "../../agents.js";
const mockSpawnFixerAgent = vi.mocked(spawnFixerAgent);

describe("handleFixing", () => {
  let ctx: WorkflowContext;

  beforeEach(() => {
    vi.clearAllMocks();

    ctx = {
      panic: createMockPanic({ panic_location: "src/test.c:100" }),
      sessionName: "test-session",
      branchName: "fix/test-branch",
      config: createMockConfig({ fixerTimeoutMs: 120000 }),
      db: createMockDb(),
      logger: createMockLogger(),
      ipcServer: createMockIpcServer(),
      sandbox: createMockSandbox(),
    };
  });

  describe("success path", () => {
    it("should return shipping when agent succeeds", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "fix applied",
        stderr: "",
        elapsedMs: 10000,
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("shipping");
      expect(result.error).toBeUndefined();
    });

    it("should call spawnFixerAgent with correct params", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      expect(mockSpawnFixerAgent).toHaveBeenCalledWith(
        "test-session",
        "src/test.c:100",
        expect.stringContaining("fixer.md"),
        ctx.config,
        ctx.ipcServer
      );
    });

    it("should log elapsed time on success", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 45000,
      });

      await handleFixing(ctx);

      expect(ctx.logger.info).toHaveBeenCalledWith(
        "src/test.c:100",
        "fixer",
        "Agent completed successfully",
        { elapsedMs: 45000 }
      );
    });

    it("should log spawning info at start", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      expect(ctx.logger.info).toHaveBeenCalledWith(
        "src/test.c:100",
        "fixer",
        "Spawning fixer agent",
        { timeoutMs: 120000 }
      );
    });
  });

  describe("error handling", () => {
    it("should return needs_human_review when agent times out", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: false,
        timedOut: true,
        exitCode: -1,
        stdout: "",
        stderr: "",
        elapsedMs: 120000,
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("timed out");
      expect(result.error).toContain("120000");
    });

    it("should return needs_human_review when agent exits with error", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: false,
        timedOut: false,
        exitCode: 1,
        stdout: "",
        stderr: "fix failed: cannot apply patch",
        elapsedMs: 5000,
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("exit code 1");
      expect(result.error).toContain("cannot apply patch");
    });

    it("should log error when agent fails", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: false,
        timedOut: false,
        exitCode: 127,
        stdout: "",
        stderr: "command not found",
        elapsedMs: 100,
      });

      await handleFixing(ctx);

      expect(ctx.logger.error).toHaveBeenCalledWith(
        "src/test.c:100",
        "fixer",
        "Agent failed",
        expect.objectContaining({ exitCode: 127 })
      );
    });

    it("should log error when agent times out", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: false,
        timedOut: true,
        exitCode: -1,
        stdout: "",
        stderr: "",
        elapsedMs: 120000,
      });

      await handleFixing(ctx);

      expect(ctx.logger.error).toHaveBeenCalledWith(
        "src/test.c:100",
        "fixer",
        "Agent timed out",
        expect.objectContaining({ elapsedMs: 120000, timeoutMs: 120000 })
      );
    });

    it("should truncate long stderr in error message", async () => {
      const longError = "x".repeat(500);
      mockSpawnFixerAgent.mockResolvedValue({
        success: false,
        timedOut: false,
        exitCode: 1,
        stdout: "",
        stderr: longError,
        elapsedMs: 1000,
      });

      const result = await handleFixing(ctx);

      // Error should be truncated to 200 chars
      expect(result.error!.length).toBeLessThan(longError.length + 100);
    });
  });
});

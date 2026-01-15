import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleReproducing } from "../states/reproducing.js";
import type { WorkflowContext } from "../types.js";
import {
  createMockLogger,
  createMockDb,
  createMockIpcServer,
  createMockConfig,
  createMockPanic,
  createMockSandbox,
  successResult,
  failureResult,
} from "./test-utils.js";

// Mock agents module
vi.mock("../../agents.js", () => ({
  setupMcpTools: vi.fn(),
  spawnReproducerAgent: vi.fn(),
}));

import { setupMcpTools, spawnReproducerAgent } from "../../agents.js";
const mockSetupMcpTools = vi.mocked(setupMcpTools);
const mockSpawnReproducerAgent = vi.mocked(spawnReproducerAgent);

describe("handleReproducing", () => {
  let ctx: WorkflowContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetupMcpTools.mockResolvedValue(undefined);

    ctx = {
      panic: createMockPanic({ panic_location: "src/test.c:100" }),
      sessionName: "test-session",
      branchName: "fix/test-branch",
      config: createMockConfig({ reproducerTimeoutMs: 60000 }),
      db: createMockDb(),
      logger: createMockLogger(),
      ipcServer: createMockIpcServer(),
      sandbox: createMockSandbox(),
    };
  });

  describe("success path", () => {
    it("should return fixing when agent succeeds", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "done",
        stderr: "",
        elapsedMs: 5000,
      });

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("fixing");
      expect(result.error).toBeUndefined();
    });

    it("should call setupMcpTools with session name", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleReproducing(ctx);

      expect(mockSetupMcpTools).toHaveBeenCalledWith("test-session");
    });

    it("should call spawnReproducerAgent with correct params", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleReproducing(ctx);

      expect(mockSpawnReproducerAgent).toHaveBeenCalledWith(
        "test-session",
        "src/test.c:100",
        expect.stringContaining("reproducer.md"),
        ctx.config,
        ctx.ipcServer
      );
    });

    it("should log elapsed time on success", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 12345,
      });

      await handleReproducing(ctx);

      expect(ctx.logger.info).toHaveBeenCalledWith(
        "src/test.c:100",
        "reproducer",
        "Agent completed successfully",
        { elapsedMs: 12345 }
      );
    });

    it("should run git add and commit after agent success", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleReproducing(ctx);

      expect(ctx.sandbox.runInSession).toHaveBeenCalledWith("test-session", "git add -A");
      expect(ctx.sandbox.runInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("git commit -m")
      );
    });

    it("should use correct commit message with panic_location", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleReproducing(ctx);

      expect(ctx.sandbox.runInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("reproducer: src/test.c:100")
      );
    });

    it("should log commit success message", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleReproducing(ctx);

      expect(ctx.logger.info).toHaveBeenCalledWith(
        "src/test.c:100",
        "reproducer",
        "Changes committed successfully"
      );
    });
  });

  describe("error handling", () => {
    it("should return needs_human_review when MCP setup fails", async () => {
      mockSetupMcpTools.mockRejectedValue(new Error("MCP connection failed"));

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to setup MCP tools");
      expect(result.error).toContain("MCP connection failed");
    });

    it("should not call spawnReproducerAgent when MCP setup fails", async () => {
      mockSetupMcpTools.mockRejectedValue(new Error("failed"));

      await handleReproducing(ctx);

      expect(mockSpawnReproducerAgent).not.toHaveBeenCalled();
    });

    it("should return needs_human_review when agent times out", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: false,
        timedOut: true,
        exitCode: -1,
        stdout: "",
        stderr: "",
        elapsedMs: 60000,
      });

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("timed out");
      expect(result.error).toContain("60000");
    });

    it("should return needs_human_review when agent exits with error", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: false,
        timedOut: false,
        exitCode: 1,
        stdout: "",
        stderr: "agent crashed",
        elapsedMs: 1000,
      });

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("exit code 1");
      expect(result.error).toContain("agent crashed");
    });

    it("should log error when agent fails", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: false,
        timedOut: false,
        exitCode: 2,
        stdout: "",
        stderr: "error details",
        elapsedMs: 500,
      });

      await handleReproducing(ctx);

      expect(ctx.logger.error).toHaveBeenCalledWith(
        "src/test.c:100",
        "reproducer",
        "Agent failed",
        expect.objectContaining({ exitCode: 2 })
      );
    });

    it("should log error when agent times out", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: false,
        timedOut: true,
        exitCode: -1,
        stdout: "",
        stderr: "",
        elapsedMs: 60000,
      });

      await handleReproducing(ctx);

      expect(ctx.logger.error).toHaveBeenCalledWith(
        "src/test.c:100",
        "reproducer",
        "Agent timed out",
        expect.objectContaining({ elapsedMs: 60000, timeoutMs: 60000 })
      );
    });

    it("should return needs_human_review when git add fails", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      const mockRunInSession = vi.fn()
        .mockResolvedValueOnce(failureResult("fatal: not a git repository"));
      ctx.sandbox = createMockSandbox(mockRunInSession);

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to stage changes");
    });

    it("should return needs_human_review when git commit fails", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      const mockRunInSession = vi.fn()
        .mockResolvedValueOnce(successResult()) // git add succeeds
        .mockResolvedValueOnce(failureResult("fatal: unable to create commit")); // git commit fails
      ctx.sandbox = createMockSandbox(mockRunInSession);

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to commit changes");
    });

    it("should log error when git commit fails", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      const mockRunInSession = vi.fn()
        .mockResolvedValueOnce(successResult())
        .mockResolvedValueOnce(failureResult("commit error"));
      ctx.sandbox = createMockSandbox(mockRunInSession);

      await handleReproducing(ctx);

      expect(ctx.logger.error).toHaveBeenCalledWith(
        "src/test.c:100",
        "reproducer",
        "Failed to commit changes",
        expect.objectContaining({ stderr: "commit error" })
      );
    });

    it("should proceed with warning when nothing to commit", async () => {
      mockSpawnReproducerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      const mockRunInSession = vi.fn()
        .mockResolvedValueOnce(successResult()) // git add succeeds
        .mockResolvedValueOnce(failureResult("nothing to commit, working tree clean"));
      ctx.sandbox = createMockSandbox(mockRunInSession);

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("fixing");
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        "src/test.c:100",
        "reproducer",
        "No changes to commit (proceeding)"
      );
    });

    it("should handle special characters in panic_location for commit message", async () => {
      ctx.panic = createMockPanic({ panic_location: "src/foo's_file.c:100" });
      mockSpawnReproducerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleReproducing(ctx);

      // Verify the commit command properly escapes the single quote
      expect(ctx.sandbox.runInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("reproducer: src/foo'\\''s_file.c:100")
      );
    });
  });
});

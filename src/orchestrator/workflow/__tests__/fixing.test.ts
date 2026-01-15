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
  successResult,
  failureResult,
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

    it("should run clippy and fmt after agent success", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      expect(ctx.sandbox.runInSession).toHaveBeenCalledWith(
        "test-session",
        "cargo clippy --fix --allow-dirty --all-features"
      );
      expect(ctx.sandbox.runInSession).toHaveBeenCalledWith(
        "test-session",
        "cargo fmt"
      );
    });

    it("should continue even if clippy fails", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      const mockRunInSession = vi.fn()
        .mockResolvedValueOnce(failureResult("clippy error")) // clippy fails
        .mockResolvedValueOnce(successResult()) // fmt succeeds
        .mockResolvedValueOnce(successResult()) // git add succeeds
        .mockResolvedValueOnce(successResult()); // git commit succeeds
      ctx.sandbox = createMockSandbox(mockRunInSession);

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("shipping");
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        "src/test.c:100",
        "fixer",
        "Clippy fix failed (continuing)",
        expect.anything()
      );
    });

    it("should continue even if fmt fails", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      const mockRunInSession = vi.fn()
        .mockResolvedValueOnce(successResult()) // clippy succeeds
        .mockResolvedValueOnce(failureResult("fmt error")) // fmt fails
        .mockResolvedValueOnce(successResult()) // git add succeeds
        .mockResolvedValueOnce(successResult()); // git commit succeeds
      ctx.sandbox = createMockSandbox(mockRunInSession);

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("shipping");
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        "src/test.c:100",
        "fixer",
        "Cargo fmt failed (continuing)",
        expect.anything()
      );
    });

    it("should run git add and commit after clippy/fmt", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      expect(ctx.sandbox.runInSession).toHaveBeenCalledWith("test-session", "git add -A");
      expect(ctx.sandbox.runInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("git commit -m")
      );
    });

    it("should use correct commit message with panic_location", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      expect(ctx.sandbox.runInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("fix: src/test.c:100")
      );
    });

    it("should log commit success message", async () => {
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
        "Changes committed successfully"
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

    it("should return needs_human_review when git add fails", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      const mockRunInSession = vi.fn()
        .mockResolvedValueOnce(successResult()) // clippy succeeds
        .mockResolvedValueOnce(successResult()) // fmt succeeds
        .mockResolvedValueOnce(failureResult("fatal: not a git repository")); // git add fails
      ctx.sandbox = createMockSandbox(mockRunInSession);

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to stage changes");
    });

    it("should return needs_human_review when git commit fails", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      const mockRunInSession = vi.fn()
        .mockResolvedValueOnce(successResult()) // clippy succeeds
        .mockResolvedValueOnce(successResult()) // fmt succeeds
        .mockResolvedValueOnce(successResult()) // git add succeeds
        .mockResolvedValueOnce(failureResult("fatal: unable to create commit")); // git commit fails
      ctx.sandbox = createMockSandbox(mockRunInSession);

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to commit changes");
    });

    it("should log error when git commit fails", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      const mockRunInSession = vi.fn()
        .mockResolvedValueOnce(successResult())
        .mockResolvedValueOnce(successResult())
        .mockResolvedValueOnce(successResult())
        .mockResolvedValueOnce(failureResult("commit error"));
      ctx.sandbox = createMockSandbox(mockRunInSession);

      await handleFixing(ctx);

      expect(ctx.logger.error).toHaveBeenCalledWith(
        "src/test.c:100",
        "fixer",
        "Failed to commit changes",
        expect.objectContaining({ stderr: "commit error" })
      );
    });

    it("should proceed with warning when nothing to commit", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      const mockRunInSession = vi.fn()
        .mockResolvedValueOnce(successResult()) // clippy succeeds
        .mockResolvedValueOnce(successResult()) // fmt succeeds
        .mockResolvedValueOnce(successResult()) // git add succeeds
        .mockResolvedValueOnce(failureResult("nothing to commit, working tree clean"));
      ctx.sandbox = createMockSandbox(mockRunInSession);

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("shipping");
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        "src/test.c:100",
        "fixer",
        "No changes to commit (proceeding)"
      );
    });

    it("should handle special characters in panic_location for commit message", async () => {
      ctx.panic = createMockPanic({ panic_location: "src/foo's_file.c:100" });
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      // Verify the commit command properly escapes the single quote
      expect(ctx.sandbox.runInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("fix: src/foo'\\''s_file.c:100")
      );
    });

    it("should run commands in correct order: clippy -> fmt -> git add -> git commit", async () => {
      mockSpawnFixerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      const callOrder: string[] = [];
      const mockRunInSession = vi.fn().mockImplementation(async (_session, command) => {
        if (command.includes("clippy")) callOrder.push("clippy");
        else if (command.includes("cargo fmt")) callOrder.push("fmt");
        else if (command.includes("git add")) callOrder.push("add");
        else if (command.includes("git commit")) callOrder.push("commit");
        return successResult();
      });
      ctx.sandbox = createMockSandbox(mockRunInSession);

      await handleFixing(ctx);

      expect(callOrder).toEqual(["clippy", "fmt", "add", "commit"]);
    });
  });
});

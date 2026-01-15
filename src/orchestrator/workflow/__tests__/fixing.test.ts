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
  spawnFixerPlannerAgent: vi.fn(),
  spawnFixerImplementerAgent: vi.fn(),
}));

import { spawnFixerPlannerAgent, spawnFixerImplementerAgent } from "../../agents.js";

const mockSpawnFixerPlannerAgent = vi.mocked(spawnFixerPlannerAgent);
const mockSpawnFixerImplementerAgent = vi.mocked(spawnFixerImplementerAgent);

describe("handleFixing", () => {
  let ctx: WorkflowContext;
  let mockRunInSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: plan file exists and all operations succeed
    mockRunInSession = vi.fn().mockImplementation(async (_, cmd: string) => {
      if (cmd.includes("test -f fixer_plan.md")) {
        return successResult("exists");
      }
      return successResult();
    });

    ctx = {
      panic: createMockPanic({ panic_location: "src/test.c:100" }),
      sessionName: "test-session",
      branchName: "fix/test-branch",
      config: createMockConfig(),
      db: createMockDb(),
      logger: createMockLogger(),
      ipcServer: createMockIpcServer(),
      sandbox: createMockSandbox(mockRunInSession),
    };
  });

  describe("success path", () => {
    it("should return shipping when both agents succeed", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "planner done",
        stderr: "",
        elapsedMs: 5000,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "implementer done",
        stderr: "",
        elapsedMs: 10000,
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("shipping");
      expect(result.error).toBeUndefined();
    });

    it("should call planner agent with correct params", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      expect(mockSpawnFixerPlannerAgent).toHaveBeenCalledWith(
        "test-session",
        "src/test.c:100",
        expect.stringContaining("fixer-planner.md"),
        ctx.config,
        ctx.ipcServer
      );
    });

    it("should call implementer agent after planner succeeds", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      expect(mockSpawnFixerImplementerAgent).toHaveBeenCalledWith(
        "test-session",
        "src/test.c:100",
        expect.stringContaining("fixer-implementer.md"),
        ctx.config,
        ctx.ipcServer
      );
    });

    it("should check if plan file exists after planner completes", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("test -f fixer_plan.md")
      );
    });

    it("should run clippy and fmt after implementer success", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        "cargo clippy --fix --allow-dirty --all-features"
      );
      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        "cargo fmt"
      );
    });

    it("should run git add and commit after clippy/fmt", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith("test-session", "git add -A");
      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("git commit -m")
      );
    });

    it("should use correct commit message with panic_location", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("fix: src/test.c:100")
      );
    });

    it("should continue even if clippy fails", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      mockRunInSession.mockImplementation(async (_, cmd: string) => {
        if (cmd.includes("test -f fixer_plan.md")) {
          return successResult("exists");
        }
        if (cmd.includes("clippy")) {
          return failureResult("clippy error");
        }
        return successResult();
      });

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
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      mockRunInSession.mockImplementation(async (_, cmd: string) => {
        if (cmd.includes("test -f fixer_plan.md")) {
          return successResult("exists");
        }
        if (cmd.includes("cargo fmt")) {
          return failureResult("fmt error");
        }
        return successResult();
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("shipping");
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        "src/test.c:100",
        "fixer",
        "Cargo fmt failed (continuing)",
        expect.anything()
      );
    });
  });

  describe("planner errors", () => {
    it("should return needs_human_review when planner times out", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: false,
        timedOut: true,
        exitCode: -1,
        stdout: "",
        stderr: "",
        elapsedMs: 900000,
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("planner agent timed out");
    });

    it("should return needs_human_review when planner fails", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: false,
        timedOut: false,
        exitCode: 1,
        stdout: "",
        stderr: "planner error",
        elapsedMs: 1000,
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("planner agent failed");
    });

    it("should return needs_human_review when plan file not created", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      // Mock plan file check to return empty (file doesn't exist)
      mockRunInSession.mockImplementation(async (_, cmd: string) => {
        if (cmd.includes("test -f fixer_plan.md")) {
          return successResult(""); // File doesn't exist
        }
        return successResult();
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("did not create fixer_plan.md");
    });

    it("should not call implementer when planner fails", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: false,
        timedOut: false,
        exitCode: 1,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleFixing(ctx);

      expect(mockSpawnFixerImplementerAgent).not.toHaveBeenCalled();
    });
  });

  describe("implementer errors", () => {
    it("should return needs_human_review when implementer times out", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: false,
        timedOut: true,
        exitCode: -1,
        stdout: "",
        stderr: "",
        elapsedMs: 2700000,
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("implementer agent timed out");
    });

    it("should return needs_human_review when implementer fails", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: false,
        timedOut: false,
        exitCode: 1,
        stdout: "",
        stderr: "implementer error",
        elapsedMs: 1000,
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("implementer agent failed");
    });
  });

  describe("git errors", () => {
    beforeEach(() => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
    });

    it("should return needs_human_review when git add fails", async () => {
      mockRunInSession.mockImplementation(async (_, cmd: string) => {
        if (cmd.includes("test -f fixer_plan.md")) {
          return successResult("exists");
        }
        if (cmd.includes("git add")) {
          return failureResult("fatal: not a git repository");
        }
        return successResult();
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to stage changes");
    });

    it("should return needs_human_review when git commit fails", async () => {
      mockRunInSession.mockImplementation(async (_, cmd: string) => {
        if (cmd.includes("test -f fixer_plan.md")) {
          return successResult("exists");
        }
        if (cmd.includes("git commit")) {
          return failureResult("fatal: unable to create commit");
        }
        return successResult();
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to commit changes");
    });

    it("should proceed with warning when nothing to commit", async () => {
      mockRunInSession.mockImplementation(async (_, cmd: string) => {
        if (cmd.includes("test -f fixer_plan.md")) {
          return successResult("exists");
        }
        if (cmd.includes("git commit")) {
          return failureResult("nothing to commit, working tree clean");
        }
        return successResult();
      });

      const result = await handleFixing(ctx);

      expect(result.nextStatus).toBe("shipping");
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        "src/test.c:100",
        "fixer",
        "No changes to commit (proceeding)"
      );
    });
  });

  describe("command order", () => {
    it("should run commands in correct order", async () => {
      mockSpawnFixerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnFixerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      const callOrder: string[] = [];
      mockRunInSession.mockImplementation(async (_, command) => {
        if (command.includes("test -f fixer_plan.md")) {
          callOrder.push("plan_check");
          return successResult("exists");
        } else if (command.includes("clippy")) callOrder.push("clippy");
        else if (command.includes("cargo fmt")) callOrder.push("fmt");
        else if (command.includes("git add")) callOrder.push("add");
        else if (command.includes("git commit")) callOrder.push("commit");
        return successResult();
      });

      await handleFixing(ctx);

      expect(callOrder).toEqual(["plan_check", "clippy", "fmt", "add", "commit"]);
    });
  });
});

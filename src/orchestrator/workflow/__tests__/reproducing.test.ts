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
  spawnReproducerPlannerAgent: vi.fn(),
  spawnReproducerImplementerAgent: vi.fn(),
}));

import { setupMcpTools, spawnReproducerPlannerAgent, spawnReproducerImplementerAgent } from "../../agents.js";

const mockSetupMcpTools = vi.mocked(setupMcpTools);
const mockSpawnReproducerPlannerAgent = vi.mocked(spawnReproducerPlannerAgent);
const mockSpawnReproducerImplementerAgent = vi.mocked(spawnReproducerImplementerAgent);

describe("handleReproducing", () => {
  let ctx: WorkflowContext;
  let mockRunInSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetupMcpTools.mockResolvedValue(undefined);

    // Default mock: plan file exists and git operations succeed
    mockRunInSession = vi.fn().mockImplementation(async (_, cmd: string) => {
      if (cmd.includes("test -f reproducer_plan.md")) {
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
    it("should return fixing when both agents succeed", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "planner done",
        stderr: "",
        elapsedMs: 5000,
      });
      mockSpawnReproducerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "implementer done",
        stderr: "",
        elapsedMs: 10000,
      });

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("fixing");
      expect(result.error).toBeUndefined();
    });

    it("should call setupMcpTools with session name", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnReproducerImplementerAgent.mockResolvedValue({
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

    it("should call planner agent with correct params", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnReproducerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleReproducing(ctx);

      expect(mockSpawnReproducerPlannerAgent).toHaveBeenCalledWith(
        "test-session",
        "src/test.c:100",
        expect.stringContaining("reproducer-planner.md"),
        ctx.config,
        ctx.ipcServer
      );
    });

    it("should call implementer agent after planner succeeds", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnReproducerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleReproducing(ctx);

      expect(mockSpawnReproducerImplementerAgent).toHaveBeenCalledWith(
        "test-session",
        "src/test.c:100",
        expect.stringContaining("reproducer-implementer.md"),
        ctx.config,
        ctx.ipcServer
      );
    });

    it("should check if plan file exists after planner completes", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnReproducerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleReproducing(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("test -f reproducer_plan.md")
      );
    });

    it("should run git add and commit after implementer success", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnReproducerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleReproducing(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith("test-session", "git add -A");
      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("git commit -m")
      );
    });

    it("should use correct commit message with panic_location", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnReproducerImplementerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleReproducing(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("reproducer: src/test.c:100")
      );
    });
  });

  describe("planner errors", () => {
    it("should return needs_human_review when MCP setup fails", async () => {
      mockSetupMcpTools.mockRejectedValue(new Error("MCP connection failed"));

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to setup MCP tools");
      expect(result.error).toContain("MCP connection failed");
    });

    it("should not call planner when MCP setup fails", async () => {
      mockSetupMcpTools.mockRejectedValue(new Error("failed"));

      await handleReproducing(ctx);

      expect(mockSpawnReproducerPlannerAgent).not.toHaveBeenCalled();
    });

    it("should return needs_human_review when planner times out", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: false,
        timedOut: true,
        exitCode: -1,
        stdout: "",
        stderr: "",
        elapsedMs: 900000,
      });

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("planner agent timed out");
    });

    it("should return needs_human_review when planner fails", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: false,
        timedOut: false,
        exitCode: 1,
        stdout: "",
        stderr: "planner error",
        elapsedMs: 1000,
      });

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("planner agent failed");
    });

    it("should return needs_human_review when plan file not created", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      // Mock plan file check to return empty (file doesn't exist)
      mockRunInSession.mockImplementation(async (_, cmd: string) => {
        if (cmd.includes("test -f reproducer_plan.md")) {
          return successResult(""); // File doesn't exist
        }
        return successResult();
      });

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("did not create reproducer_plan.md");
    });

    it("should not call implementer when planner fails", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: false,
        timedOut: false,
        exitCode: 1,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });

      await handleReproducing(ctx);

      expect(mockSpawnReproducerImplementerAgent).not.toHaveBeenCalled();
    });
  });

  describe("implementer errors", () => {
    it("should return needs_human_review when implementer times out", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnReproducerImplementerAgent.mockResolvedValue({
        success: false,
        timedOut: true,
        exitCode: -1,
        stdout: "",
        stderr: "",
        elapsedMs: 2700000,
      });

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("implementer agent timed out");
    });

    it("should return needs_human_review when implementer fails", async () => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnReproducerImplementerAgent.mockResolvedValue({
        success: false,
        timedOut: false,
        exitCode: 1,
        stdout: "",
        stderr: "implementer error",
        elapsedMs: 1000,
      });

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("implementer agent failed");
    });
  });

  describe("git errors", () => {
    beforeEach(() => {
      mockSpawnReproducerPlannerAgent.mockResolvedValue({
        success: true,
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
      });
      mockSpawnReproducerImplementerAgent.mockResolvedValue({
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
        if (cmd.includes("test -f reproducer_plan.md")) {
          return successResult("exists");
        }
        if (cmd.includes("git add")) {
          return failureResult("fatal: not a git repository");
        }
        return successResult();
      });

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to stage changes");
    });

    it("should return needs_human_review when git commit fails", async () => {
      mockRunInSession.mockImplementation(async (_, cmd: string) => {
        if (cmd.includes("test -f reproducer_plan.md")) {
          return successResult("exists");
        }
        if (cmd.includes("git commit")) {
          return failureResult("fatal: unable to create commit");
        }
        return successResult();
      });

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to commit changes");
    });

    it("should proceed with warning when nothing to commit", async () => {
      mockRunInSession.mockImplementation(async (_, cmd: string) => {
        if (cmd.includes("test -f reproducer_plan.md")) {
          return successResult("exists");
        }
        if (cmd.includes("git commit")) {
          return failureResult("nothing to commit, working tree clean");
        }
        return successResult();
      });

      const result = await handleReproducing(ctx);

      expect(result.nextStatus).toBe("fixing");
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        "src/test.c:100",
        "reproducer",
        "No changes to commit (proceeding)"
      );
    });
  });
});

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
  });
});

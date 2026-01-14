import { describe, it, expect, vi, beforeEach } from "vitest";
import { handlePreflight } from "../states/preflight.js";
import type { WorkflowContext } from "../types.js";
import type { ExecResult } from "../../sandbox.js";
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

describe("handlePreflight", () => {
  let ctx: WorkflowContext;
  let mockRunInSession: ReturnType<typeof vi.fn<(sessionName: string, command: string) => Promise<ExecResult>>>;

  beforeEach(() => {
    mockRunInSession = vi.fn<(sessionName: string, command: string) => Promise<ExecResult>>();
    ctx = {
      panic: createMockPanic(),
      sessionName: "test-session",
      branchName: "fix/test-branch",
      config: createMockConfig(),
      db: createMockDb(),
      logger: createMockLogger(),
      ipcServer: createMockIpcServer(),
      sandbox: createMockSandbox(mockRunInSession),
    };
  });

  it("should return repo_setup when build and tests succeed", async () => {
    mockRunInSession.mockResolvedValue(successResult());

    const result = await handlePreflight(ctx);

    expect(result.nextStatus).toBe("repo_setup");
    expect(result.error).toBeUndefined();
    expect(mockRunInSession).toHaveBeenCalledWith("test-session", "make");
    expect(mockRunInSession).toHaveBeenCalledWith("test-session", "make test");
  });

  it("should return needs_human_review when make fails", async () => {
    mockRunInSession.mockResolvedValueOnce(failureResult("compilation error"));

    const result = await handlePreflight(ctx);

    expect(result.nextStatus).toBe("needs_human_review");
    expect(result.error).toContain("Build failed");
    expect(result.error).toContain("compilation error");
    expect(mockRunInSession).toHaveBeenCalledTimes(1);
  });

  it("should return needs_human_review when make test fails", async () => {
    mockRunInSession
      .mockResolvedValueOnce(successResult()) // make succeeds
      .mockResolvedValueOnce(failureResult("test assertion failed")); // make test fails

    const result = await handlePreflight(ctx);

    expect(result.nextStatus).toBe("needs_human_review");
    expect(result.error).toContain("Tests failed");
    expect(result.error).toContain("test assertion failed");
  });

  it("should log info at start of preflight", async () => {
    mockRunInSession.mockResolvedValue(successResult());

    await handlePreflight(ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      ctx.panic.panic_location,
      "preflight",
      "Verifying base repo builds"
    );
  });

  it("should log error when build fails", async () => {
    mockRunInSession.mockResolvedValueOnce(failureResult("build error"));

    await handlePreflight(ctx);

    expect(ctx.logger.error).toHaveBeenCalledWith(
      ctx.panic.panic_location,
      "preflight",
      "Build failed",
      expect.objectContaining({ stderr: "build error" })
    );
  });

  it("should log error when tests fail", async () => {
    mockRunInSession
      .mockResolvedValueOnce(successResult())
      .mockResolvedValueOnce(failureResult("test error"));

    await handlePreflight(ctx);

    expect(ctx.logger.error).toHaveBeenCalledWith(
      ctx.panic.panic_location,
      "preflight",
      "Tests failed",
      expect.objectContaining({ stderr: "test error" })
    );
  });

  it("should log success when preflight passes", async () => {
    mockRunInSession.mockResolvedValue(successResult());

    await handlePreflight(ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      ctx.panic.panic_location,
      "preflight",
      "Preflight checks passed"
    );
  });

  it("should truncate long error messages", async () => {
    const longError = "x".repeat(2000);
    mockRunInSession.mockResolvedValueOnce(failureResult(longError));

    const result = await handlePreflight(ctx);

    expect(result.error!.length).toBeLessThan(longError.length);
    expect(result.error).toContain("Build failed");
  });
});

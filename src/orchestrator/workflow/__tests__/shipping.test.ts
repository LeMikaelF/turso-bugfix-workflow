import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleShipping } from "../states/shipping.js";
import type { WorkflowContext } from "../types.js";
import type { PanicContextData } from "../../context-parser.js";
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
import { CONTEXT_JSON_FILE } from "../../context-json.js";

// Mock dependencies
vi.mock("../../context-parser.js", () => ({
  validateRequiredFields: vi.fn(),
}));

vi.mock("../../git.js", () => ({
  squashCommits: vi.fn(),
}));

vi.mock("../../pr.js", () => ({
  createPullRequest: vi.fn(),
}));

import { validateRequiredFields } from "../../context-parser.js";
import { squashCommits } from "../../git.js";
import { createPullRequest } from "../../pr.js";

const mockValidateRequiredFields = vi.mocked(validateRequiredFields);
const mockSquashCommits = vi.mocked(squashCommits);
const mockCreatePullRequest = vi.mocked(createPullRequest);

const validContextData: PanicContextData = {
  panic_location: "src/test.c:100",
  panic_message: "assertion failed",
  tcl_test_file: "test/panic-test.test",
  failing_seed: 12345,
  why_simulator_missed: "edge case not covered",
  simulator_changes: "added new pattern",
  bug_description: "null pointer dereference",
  fix_description: "added null check",
};

describe("handleShipping", () => {
  let ctx: WorkflowContext;
  let mockRunInSession: ReturnType<typeof vi.fn<(sessionName: string, command: string) => Promise<ExecResult>>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunInSession = vi.fn<(sessionName: string, command: string) => Promise<ExecResult>>().mockResolvedValue(successResult());

    // Default: all operations succeed
    mockRunInSession
      .mockResolvedValueOnce(successResult(JSON.stringify(validContextData))) // cat panic_context.json
      .mockResolvedValueOnce(successResult()) // rm context files
      .mockResolvedValueOnce(successResult()) // git add -A
      .mockResolvedValueOnce(successResult()); // git push

    mockValidateRequiredFields.mockReturnValue({
      valid: true,
      errors: [],
    });

    mockSquashCommits.mockResolvedValue({ success: true });
    mockCreatePullRequest.mockResolvedValue("https://github.com/test/repo/pull/123");

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
    it("should return pr_open with contextData and prUrl on success", async () => {
      const result = await handleShipping(ctx);

      expect(result.nextStatus).toBe("pr_open");
      expect(result.contextData).toEqual(validContextData);
      expect(result.prUrl).toBe("https://github.com/test/repo/pull/123");
      expect(result.error).toBeUndefined();
    });

    it("should read panic_context.json from sandbox", async () => {
      await handleShipping(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith("test-session", `cat ${CONTEXT_JSON_FILE}`);
    });

    it("should validate context data with ship phase", async () => {
      await handleShipping(ctx);

      expect(mockValidateRequiredFields).toHaveBeenCalledWith(validContextData, "ship");
    });

    it("should delete both context files after reading", async () => {
      await handleShipping(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        `rm -f panic_context.md ${CONTEXT_JSON_FILE}`
      );
    });

    it("should squash commits with context data", async () => {
      await handleShipping(ctx);

      expect(mockSquashCommits).toHaveBeenCalledWith(
        { sessionName: "test-session", contextData: validContextData },
        ctx.sandbox
      );
    });

    it("should push branch to origin", async () => {
      await handleShipping(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        "git push -u origin fix/test-branch"
      );
    });

    it("should create pull request", async () => {
      await handleShipping(ctx);

      expect(mockCreatePullRequest).toHaveBeenCalledWith(
        { sessionName: "test-session", contextData: validContextData },
        ctx.sandbox,
        ctx.config
      );
    });
  });

  describe("error handling", () => {
    it("should return needs_human_review when context JSON file is missing", async () => {
      mockRunInSession.mockReset();
      mockRunInSession.mockResolvedValueOnce(failureResult("No such file"));

      const result = await handleShipping(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to read context JSON file");
    });

    it("should return needs_human_review when context JSON is malformed", async () => {
      mockRunInSession.mockReset();
      mockRunInSession.mockResolvedValueOnce(successResult("{invalid json}"));

      const result = await handleShipping(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to parse context JSON");
    });

    it("should return needs_human_review when context validation fails", async () => {
      mockValidateRequiredFields.mockReturnValue({
        valid: false,
        errors: ["Missing required field: bug_description"],
      });

      const result = await handleShipping(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Context validation failed");
      expect(result.error).toContain("bug_description");
    });

    it("should continue when context file deletion fails (non-critical)", async () => {
      mockRunInSession.mockReset();
      mockRunInSession
        .mockResolvedValueOnce(successResult(JSON.stringify(validContextData))) // cat
        .mockResolvedValueOnce(failureResult("permission denied")) // rm fails
        .mockResolvedValueOnce(successResult()) // git add
        .mockResolvedValueOnce(successResult()); // git push

      const result = await handleShipping(ctx);

      expect(result.nextStatus).toBe("pr_open");
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        "src/test.c:100",
        "ship",
        "Failed to delete context files",
        expect.any(Object)
      );
    });

    it("should return needs_human_review when squash fails", async () => {
      mockSquashCommits.mockResolvedValue({
        success: false,
        error: "merge conflict",
      });

      const result = await handleShipping(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("merge conflict");
    });

    it("should return needs_human_review when git push fails", async () => {
      mockRunInSession.mockReset();
      mockRunInSession
        .mockResolvedValueOnce(successResult(JSON.stringify(validContextData))) // cat
        .mockResolvedValueOnce(successResult()) // rm
        .mockResolvedValueOnce(successResult()) // git add
        .mockResolvedValueOnce(failureResult("rejected: non-fast-forward")); // push fails

      const result = await handleShipping(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to push");
      expect(result.error).toContain("non-fast-forward");
    });

    it("should return needs_human_review when PR creation fails", async () => {
      mockCreatePullRequest.mockRejectedValue(new Error("API rate limit exceeded"));

      const result = await handleShipping(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to create PR");
      expect(result.error).toContain("API rate limit exceeded");
    });
  });

  describe("logging", () => {
    it("should log progress through all phases", async () => {
      await handleShipping(ctx);

      expect(ctx.logger.info).toHaveBeenCalledWith(
        "src/test.c:100",
        "ship",
        "Reading panic_context.json"
      );
      expect(ctx.logger.info).toHaveBeenCalledWith(
        "src/test.c:100",
        "ship",
        "Context validated successfully"
      );
      expect(ctx.logger.info).toHaveBeenCalledWith(
        "src/test.c:100",
        "ship",
        "Deleting context files"
      );
      expect(ctx.logger.info).toHaveBeenCalledWith(
        "src/test.c:100",
        "ship",
        "Squashing commits"
      );
      expect(ctx.logger.info).toHaveBeenCalledWith(
        "src/test.c:100",
        "ship",
        "Pushing branch",
        { branchName: "fix/test-branch" }
      );
      expect(ctx.logger.info).toHaveBeenCalledWith(
        "src/test.c:100",
        "ship",
        "Creating pull request"
      );
    });

    it("should log PR URL on success", async () => {
      await handleShipping(ctx);

      expect(ctx.logger.info).toHaveBeenCalledWith(
        "src/test.c:100",
        "ship",
        "Pull request created",
        { prUrl: "https://github.com/test/repo/pull/123" }
      );
    });
  });
});

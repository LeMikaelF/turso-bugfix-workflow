import { describe, it, expect, vi, beforeEach } from "vitest";
import { squashCommits, buildCommitMessage } from "../git.js";
import type { PanicContextData } from "../context-parser.js";
import type { SandboxManager, ExecResult } from "../sandbox.js";

// Helper to create mock sandbox manager
function createMockSandbox(
  runInSessionMock: (sessionName: string, command: string) => Promise<ExecResult>
): SandboxManager {
  return {
    runInSession: vi.fn(runInSessionMock),
    deleteSession: vi.fn(),
    sessionExists: vi.fn(),
  };
}

// Helper to create success result
function successResult(stdout = ""): ExecResult {
  return { stdout, stderr: "", exitCode: 0 };
}

// Helper to create failure result
function failureResult(stderr: string, exitCode = 1): ExecResult {
  return { stdout: "", stderr, exitCode };
}

describe("git", () => {
  const sampleContextData: PanicContextData = {
    panic_location: "src/vdbe.c:1234",
    panic_message: "assertion failed: pCur->isValid",
    tcl_test_file: "test/panic-src-vdbe.c-1234.test",
    failing_seed: 42,
    why_simulator_missed: "Did not generate cursor operations after close",
    simulator_changes: "Added cursor state tracking",
    bug_description: "Cursor used after being closed",
    fix_description: "Added null check before cursor access",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildCommitMessage", () => {
    it("should build a formatted commit message with all fields", () => {
      const message = buildCommitMessage(sampleContextData);

      expect(message).toContain("fix: assertion failed: pCur->isValid");
      expect(message).toContain("Location: src/vdbe.c:1234");
      expect(message).toContain("Bug: Cursor used after being closed");
      expect(message).toContain("Fix: Added null check before cursor access");
      expect(message).toContain("Failing seed: 42");
      expect(message).toContain(
        "Simulator: Did not generate cursor operations after close"
      );
    });

    it("should handle missing optional fields", () => {
      const minimalData: PanicContextData = {
        panic_location: "src/main.c:100",
        panic_message: "null pointer dereference",
        tcl_test_file: "test/panic-main.test",
      };

      const message = buildCommitMessage(minimalData);

      expect(message).toContain("fix: null pointer dereference");
      expect(message).toContain("Location: src/main.c:100");
      expect(message).toContain("Bug: ");
      expect(message).toContain("Fix: ");
      expect(message).toContain("Failing seed: ");
      expect(message).toContain("Simulator: ");
    });

    it("should preserve newlines in the message format", () => {
      const message = buildCommitMessage(sampleContextData);
      const lines = message.split("\n");

      expect(lines[0]).toBe("fix: assertion failed: pCur->isValid");
      expect(lines[1]).toBe(""); // Empty line after title
    });
  });

  describe("squashCommits", () => {
    it("should run git reset and commit commands", async () => {
      const sandbox = createMockSandbox(async () => successResult());

      const result = await squashCommits(
        {
          sessionName: "test-session",
          contextData: sampleContextData,
        },
        sandbox
      );

      expect(result.success).toBe(true);
      expect(sandbox.runInSession).toHaveBeenCalledTimes(2);

      // Check reset command
      expect(sandbox.runInSession).toHaveBeenNthCalledWith(
        1,
        "test-session",
        "git reset --soft $(git merge-base HEAD main)"
      );

      // Check commit command contains escaped message
      const calls = (sandbox.runInSession as ReturnType<typeof vi.fn>).mock.calls;
      const commitCall = calls[1] as [string, string];
      expect(commitCall[0]).toBe("test-session");
      expect(commitCall[1]).toContain("git commit -m");
      expect(commitCall[1]).toContain("fix: assertion failed");
    });

    it("should return error when git reset fails", async () => {
      const sandbox = createMockSandbox(async (_, command) => {
        if (command.includes("reset")) {
          return failureResult("fatal: not a git repository");
        }
        return successResult();
      });

      const result = await squashCommits(
        {
          sessionName: "test-session",
          contextData: sampleContextData,
        },
        sandbox
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Git reset failed");
      expect(result.error).toContain("not a git repository");
      // Should not call commit after reset fails
      expect(sandbox.runInSession).toHaveBeenCalledTimes(1);
    });

    it("should return error when git commit fails", async () => {
      const sandbox = createMockSandbox(async (_, command) => {
        if (command.includes("commit")) {
          return failureResult("nothing to commit");
        }
        return successResult();
      });

      const result = await squashCommits(
        {
          sessionName: "test-session",
          contextData: sampleContextData,
        },
        sandbox
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Git commit failed");
      expect(result.error).toContain("nothing to commit");
    });

    it("should escape single quotes in commit message", async () => {
      const dataWithQuotes: PanicContextData = {
        ...sampleContextData,
        panic_message: "can't access memory",
        bug_description: "pointer wasn't initialized",
      };

      const sandbox = createMockSandbox(async () => successResult());

      await squashCommits(
        {
          sessionName: "test-session",
          contextData: dataWithQuotes,
        },
        sandbox
      );

      const calls = (sandbox.runInSession as ReturnType<typeof vi.fn>).mock.calls;
      const commitCall = calls[1] as [string, string];
      // Should properly escape the single quotes
      expect(commitCall[1]).toContain("can'\\''t");
      expect(commitCall[1]).toContain("wasn'\\''t");
    });
  });
});

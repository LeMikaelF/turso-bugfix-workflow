import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleRepoSetup } from "../states/repo-setup.js";
import { generateTclTest } from "../templates/tcl-test.js";
import { generateContextFile } from "../templates/context-file.js";
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

// Mock createBranch from git.ts
vi.mock("../../git.js", () => ({
  createBranch: vi.fn(),
}));

import { createBranch } from "../../git.js";
const mockCreateBranch = vi.mocked(createBranch);

describe("handleRepoSetup", () => {
  let ctx: WorkflowContext;
  let mockRunInSession: ReturnType<typeof vi.fn<(sessionName: string, command: string) => Promise<ExecResult>>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunInSession = vi.fn<(sessionName: string, command: string) => Promise<ExecResult>>().mockResolvedValue(successResult());
    mockCreateBranch.mockResolvedValue({ success: true });

    ctx = {
      panic: createMockPanic({
        panic_location: "src/vdbe.c:1234",
        panic_message: "assertion failed",
        sql_statements: "SELECT 1;\nINSERT INTO t1 VALUES(2);",
      }),
      sessionName: "test-session",
      branchName: "fix/panic-src-vdbe.c-1234",
      config: createMockConfig(),
      db: createMockDb(),
      logger: createMockLogger(),
      ipcServer: createMockIpcServer(),
      sandbox: createMockSandbox(mockRunInSession),
    };
  });

  describe("success path", () => {
    it("should return reproducing when all steps succeed", async () => {
      const result = await handleRepoSetup(ctx);

      expect(result.nextStatus).toBe("reproducing");
      expect(result.error).toBeUndefined();
    });

    it("should call createBranch with correct params", async () => {
      await handleRepoSetup(ctx);

      expect(mockCreateBranch).toHaveBeenCalledWith(
        { sessionName: "test-session", branchName: "fix/panic-src-vdbe.c-1234" },
        ctx.sandbox
      );
    });

    it("should create TCL test file", async () => {
      await handleRepoSetup(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("cat > 'test/panic-src-vdbe.c-1234.test'")
      );
    });

    it("should create panic_context.md", async () => {
      await handleRepoSetup(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("cat > panic_context.md")
      );
    });

    it("should stage and commit changes", async () => {
      await handleRepoSetup(ctx);

      expect(mockRunInSession).toHaveBeenCalledWith("test-session", "git add -A");
      expect(mockRunInSession).toHaveBeenCalledWith(
        "test-session",
        "git commit -m 'setup: src/vdbe.c:1234'"
      );
    });
  });

  describe("error handling", () => {
    it("should return needs_human_review when createBranch fails", async () => {
      mockCreateBranch.mockResolvedValue({ success: false, error: "branch exists" });

      const result = await handleRepoSetup(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("branch exists");
    });

    it("should return needs_human_review when TCL test creation fails", async () => {
      mockRunInSession.mockResolvedValueOnce(failureResult("permission denied"));

      const result = await handleRepoSetup(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to create TCL test");
    });

    it("should return needs_human_review when context file creation fails", async () => {
      mockRunInSession
        .mockResolvedValueOnce(successResult()) // TCL file succeeds
        .mockResolvedValueOnce(failureResult("disk full")); // context file fails

      const result = await handleRepoSetup(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Failed to create context file");
    });

    it("should return needs_human_review when git add fails", async () => {
      mockRunInSession
        .mockResolvedValueOnce(successResult()) // TCL file
        .mockResolvedValueOnce(successResult()) // context file
        .mockResolvedValueOnce(failureResult("git error")); // git add

      const result = await handleRepoSetup(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Git add failed");
    });

    it("should return needs_human_review when git commit fails", async () => {
      mockRunInSession
        .mockResolvedValueOnce(successResult()) // TCL file
        .mockResolvedValueOnce(successResult()) // context file
        .mockResolvedValueOnce(successResult()) // git add
        .mockResolvedValueOnce(failureResult("nothing to commit")); // git commit

      const result = await handleRepoSetup(ctx);

      expect(result.nextStatus).toBe("needs_human_review");
      expect(result.error).toContain("Git commit failed");
    });
  });
});

describe("generateTclTest", () => {
  it("should generate correct TCL test format", () => {
    const result = generateTclTest(
      "SELECT 1;\nINSERT INTO t1 VALUES(2);",
      "assertion failed",
      "src/vdbe.c:1234"
    );

    expect(result).toContain("# Auto-generated test for panic at src/vdbe.c:1234");
    expect(result).toContain("# Expected panic: assertion failed");
    expect(result).toContain("source $testdir/tester.tcl");
    expect(result).toContain("execsql {SELECT 1;}");
    expect(result).toContain("execsql {INSERT INTO t1 VALUES(2);}");
    expect(result).toContain("finish_test");
  });

  it("should handle empty lines in SQL", () => {
    const result = generateTclTest(
      "SELECT 1;\n\nSELECT 2;",
      "error",
      "src/test.c:1"
    );

    expect(result).not.toContain("execsql {}");
    expect(result).toContain("execsql {SELECT 1;}");
    expect(result).toContain("execsql {SELECT 2;}");
  });

  it("should trim whitespace from statements", () => {
    const result = generateTclTest(
      "  SELECT 1;  \n  SELECT 2;  ",
      "error",
      "src/test.c:1"
    );

    expect(result).toContain("execsql {SELECT 1;}");
    expect(result).toContain("execsql {SELECT 2;}");
  });
});

describe("generateContextFile", () => {
  it("should generate correct context file format", async () => {
    const panic = createMockPanic({
      panic_location: "src/vdbe.c:1234",
      panic_message: "assertion failed",
      sql_statements: "SELECT 1;",
    });

    const result = await generateContextFile(panic, "test/panic-test.test");

    expect(result).toContain("# Panic Context: src/vdbe.c:1234");
    expect(result).toContain("**Location**: src/vdbe.c:1234");
    expect(result).toContain("**Message**: assertion failed");
    expect(result).toContain("```sql");
    expect(result).toContain("SELECT 1;");
    expect(result).toContain("```json");
    expect(result).toContain('"panic_location": "src/vdbe.c:1234"');
    expect(result).toContain('"tcl_test_file": "test/panic-test.test"');
  });

  it("should include placeholder sections for agents", async () => {
    const panic = createMockPanic();
    const result = await generateContextFile(panic, "test/test.test");

    expect(result).toContain("## Reproducer Notes");
    expect(result).toContain("## Fixer Notes");
    expect(result).toContain("<!-- Reproducer agent writes analysis here -->");
    expect(result).toContain("<!-- Fixer agent writes analysis here -->");
  });
});

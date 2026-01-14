/**
 * Integration tests for shipping state handler using real git operations.
 *
 * These tests require AgentFS to be installed and accessible in PATH.
 * They create real git repositories and run real git commands in sandboxes.
 * The PR creation is mocked to avoid hitting the GitHub API.
 *
 * Run with: npm test -- shipping.integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "node:child_process";
import { handleShipping } from "../states/shipping.js";
import type { WorkflowContext } from "../types.js";
import type { PanicContextData } from "../../context-parser.js";
import {
  checkAgentFsAvailable,
  createMockLogger,
  createMockDb,
  createMockIpcServer,
  createMockConfig,
  createMockPanic,
  createTempGitRepo,
} from "./test-utils.js";
import type { TempGitRepo } from "./test-utils.js";

// Mock only the PR creation to avoid hitting GitHub API
vi.mock("../../pr.js", () => ({
  createPullRequest: vi.fn().mockResolvedValue("https://github.com/test/repo/pull/123"),
}));

import { createPullRequest } from "../../pr.js";
const mockCreatePullRequest = vi.mocked(createPullRequest);

const agentfsAvailable = checkAgentFsAvailable();

describe.skipIf(!agentfsAvailable)("shipping integration", () => {
  const testSessionPrefix = `test-shipping-${Date.now()}`;
  let sessionCounter = 0;
  const getUniqueSessionName = () => `${testSessionPrefix}-${sessionCounter++}`;

  const createdSessions: string[] = [];
  let repo: TempGitRepo;

  const validContextData: PanicContextData = {
    panic_location: "src/test.c:100",
    panic_message: "test assertion failed",
    tcl_test_file: "test/panic-test.test",
    failing_seed: 12345,
    why_simulator_missed: "edge case not covered",
    simulator_changes: "added new pattern",
    bug_description: "null pointer dereference",
    fix_description: "added null check",
  };

  function createValidContextFile(data: PanicContextData): string {
    const jsonBlock = JSON.stringify(data, null, 2);
    return `# Panic Context: ${data.panic_location}

## Panic Info

- **Location**: ${data.panic_location}
- **Message**: ${data.panic_message}

## SQL Statements

\`\`\`sql
SELECT 1;
\`\`\`

## Reproducer Notes

Analysis here.

## Fixer Notes

Fix description here.

---

## PR Data (Machine Readable)

\`\`\`json
${jsonBlock}
\`\`\`
`;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    repo = await createTempGitRepo();
  });

  afterEach(async () => {
    for (const session of createdSessions) {
      try {
        await repo.sandbox.deleteSession(session);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdSessions.length = 0;

    await repo.cleanup();
  });

  it("should read and parse panic_context.md correctly", async () => {
    const sessionName = getUniqueSessionName();
    createdSessions.push(sessionName);

    // Create a branch and add some commits
    await repo.sandbox.runInSession(sessionName, "git checkout -b fix/test-branch");

    // Create panic_context.md
    const contextContent = createValidContextFile(validContextData);
    execSync(`cat > panic_context.md << 'EOF'\n${contextContent}\nEOF`, {
      cwd: repo.tempDir,
      stdio: "ignore",
    });
    await repo.sandbox.runInSession(sessionName, "git add panic_context.md");
    await repo.sandbox.runInSession(sessionName, "git commit -m 'add context'");

    const ctx: WorkflowContext = {
      panic: createMockPanic({ panic_location: "src/test.c:100" }),
      sessionName,
      branchName: "fix/test-branch",
      config: createMockConfig(),
      db: createMockDb(),
      logger: createMockLogger(),
      ipcServer: createMockIpcServer(),
      sandbox: repo.sandbox,
    };

    const result = await handleShipping(ctx);

    expect(result.nextStatus).toBe("pr_open");
    expect(result.contextData).toMatchObject({
      panic_location: "src/test.c:100",
      panic_message: "test assertion failed",
      failing_seed: 12345,
    });
  });

  it("should delete panic_context.md after reading", async () => {
    const sessionName = getUniqueSessionName();
    createdSessions.push(sessionName);

    await repo.sandbox.runInSession(sessionName, "git checkout -b fix/test-branch");

    const contextContent = createValidContextFile(validContextData);
    execSync(`cat > panic_context.md << 'EOF'\n${contextContent}\nEOF`, {
      cwd: repo.tempDir,
      stdio: "ignore",
    });
    await repo.sandbox.runInSession(sessionName, "git add panic_context.md");
    await repo.sandbox.runInSession(sessionName, "git commit -m 'add context'");

    const ctx: WorkflowContext = {
      panic: createMockPanic({ panic_location: "src/test.c:100" }),
      sessionName,
      branchName: "fix/test-branch",
      config: createMockConfig(),
      db: createMockDb(),
      logger: createMockLogger(),
      ipcServer: createMockIpcServer(),
      sandbox: repo.sandbox,
    };

    await handleShipping(ctx);

    // Verify file was deleted
    const checkResult = await repo.sandbox.runInSession(sessionName, "ls panic_context.md");
    expect(checkResult.exitCode).not.toBe(0);
  });

  it("should squash commits into single commit", async () => {
    const sessionName = getUniqueSessionName();
    createdSessions.push(sessionName);

    await repo.sandbox.runInSession(sessionName, "git checkout -b fix/test-branch");

    // Create multiple commits
    await repo.sandbox.runInSession(sessionName, "touch file1.txt");
    await repo.sandbox.runInSession(sessionName, "git add file1.txt");
    await repo.sandbox.runInSession(sessionName, "git commit -m 'commit 1'");

    await repo.sandbox.runInSession(sessionName, "touch file2.txt");
    await repo.sandbox.runInSession(sessionName, "git add file2.txt");
    await repo.sandbox.runInSession(sessionName, "git commit -m 'commit 2'");

    // Add context file
    const contextContent = createValidContextFile(validContextData);
    execSync(`cat > panic_context.md << 'EOF'\n${contextContent}\nEOF`, {
      cwd: repo.tempDir,
      stdio: "ignore",
    });
    await repo.sandbox.runInSession(sessionName, "git add panic_context.md");
    await repo.sandbox.runInSession(sessionName, "git commit -m 'add context'");

    const ctx: WorkflowContext = {
      panic: createMockPanic({ panic_location: "src/test.c:100" }),
      sessionName,
      branchName: "fix/test-branch",
      config: createMockConfig(),
      db: createMockDb(),
      logger: createMockLogger(),
      ipcServer: createMockIpcServer(),
      sandbox: repo.sandbox,
    };

    await handleShipping(ctx);

    // Count commits since main
    const logResult = await repo.sandbox.runInSession(
      sessionName,
      "git log main..HEAD --oneline | wc -l"
    );
    expect(logResult.stdout.trim()).toBe("1");

    // Verify commit message format
    const messageResult = await repo.sandbox.runInSession(
      sessionName,
      "git log -1 --format=%s"
    );
    expect(messageResult.stdout.trim()).toContain("fix(src/test.c:100):");
  });

  it("should handle missing context file gracefully", async () => {
    const sessionName = getUniqueSessionName();
    createdSessions.push(sessionName);

    await repo.sandbox.runInSession(sessionName, "git checkout -b fix/test-branch");
    // Don't create panic_context.md

    const ctx: WorkflowContext = {
      panic: createMockPanic({ panic_location: "src/test.c:100" }),
      sessionName,
      branchName: "fix/test-branch",
      config: createMockConfig(),
      db: createMockDb(),
      logger: createMockLogger(),
      ipcServer: createMockIpcServer(),
      sandbox: repo.sandbox,
    };

    const result = await handleShipping(ctx);

    expect(result.nextStatus).toBe("needs_human_review");
    expect(result.error).toContain("Failed to read context file");
  });

  it("should handle invalid context file format", async () => {
    const sessionName = getUniqueSessionName();
    createdSessions.push(sessionName);

    await repo.sandbox.runInSession(sessionName, "git checkout -b fix/test-branch");

    // Create invalid context file (no JSON block)
    execSync("echo 'invalid content' > panic_context.md", {
      cwd: repo.tempDir,
      stdio: "ignore",
    });
    await repo.sandbox.runInSession(sessionName, "git add panic_context.md");
    await repo.sandbox.runInSession(sessionName, "git commit -m 'add context'");

    const ctx: WorkflowContext = {
      panic: createMockPanic({ panic_location: "src/test.c:100" }),
      sessionName,
      branchName: "fix/test-branch",
      config: createMockConfig(),
      db: createMockDb(),
      logger: createMockLogger(),
      ipcServer: createMockIpcServer(),
      sandbox: repo.sandbox,
    };

    const result = await handleShipping(ctx);

    expect(result.nextStatus).toBe("needs_human_review");
    expect(result.error).toContain("Context validation failed");
  });
});

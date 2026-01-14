import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatPrBody,
  buildLabelFlags,
  extractPrUrl,
  createPullRequest,
} from "../pr.js";
import type { PanicContextData } from "../context-parser.js";
import type { SandboxManager, ExecResult } from "../sandbox.js";

// Mock fs/promises for loadPrTemplate and writeFile
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

import { readFile, writeFile } from "node:fs/promises";

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
function successResult(stdout: string): ExecResult {
  return { stdout, stderr: "", exitCode: 0 };
}

// Helper to create failure result
function failureResult(stderr: string, exitCode = 1): ExecResult {
  return { stdout: "", stderr, exitCode };
}

describe("pr", () => {
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

  const sampleTemplate = `## Summary
**Location:** {{panic_location}}
**Bug:** {{bug_description}}
**Fix:** {{fix_description}}

## Reproduction
**Failing seed:** {{failing_seed}}
**Why simulator missed:** {{why_simulator_missed}}
**Simulator changes:** {{simulator_changes}}

## Test
**TCL test file:** {{tcl_test_file}}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("formatPrBody", () => {
    it("should replace all placeholders with context data", () => {
      const body = formatPrBody(sampleTemplate, sampleContextData);

      expect(body).toContain("**Location:** src/vdbe.c:1234");
      expect(body).toContain("**Bug:** Cursor used after being closed");
      expect(body).toContain("**Fix:** Added null check before cursor access");
      expect(body).toContain("**Failing seed:** 42");
      expect(body).toContain(
        "**Why simulator missed:** Did not generate cursor operations after close"
      );
      expect(body).toContain(
        "**Simulator changes:** Added cursor state tracking"
      );
      expect(body).toContain(
        "**TCL test file:** test/panic-src-vdbe.c-1234.test"
      );
    });

    it("should handle missing optional fields", () => {
      const minimalData: PanicContextData = {
        panic_location: "src/main.c:100",
        panic_message: "null pointer",
        tcl_test_file: "test/panic-main.test",
      };

      const body = formatPrBody(sampleTemplate, minimalData);

      expect(body).toContain("**Location:** src/main.c:100");
      expect(body).toContain("**Bug:** ");
      expect(body).toContain("**Failing seed:** ");
    });

    it("should handle multiple occurrences of same placeholder", () => {
      const template =
        "Location: {{panic_location}}, again: {{panic_location}}";
      const body = formatPrBody(template, sampleContextData);

      expect(body).toBe(
        "Location: src/vdbe.c:1234, again: src/vdbe.c:1234"
      );
    });
  });

  describe("buildLabelFlags", () => {
    it("should build flags for multiple labels", () => {
      const flags = buildLabelFlags(["automated", "panic-fix"]);
      expect(flags).toBe('--label "automated" --label "panic-fix"');
    });

    it("should handle single label", () => {
      const flags = buildLabelFlags(["bug"]);
      expect(flags).toBe('--label "bug"');
    });

    it("should return empty string for empty array", () => {
      const flags = buildLabelFlags([]);
      expect(flags).toBe("");
    });

    it("should handle labels with spaces", () => {
      const flags = buildLabelFlags(["needs review", "high priority"]);
      expect(flags).toBe('--label "needs review" --label "high priority"');
    });
  });

  describe("extractPrUrl", () => {
    it("should extract PR URL from gh output", () => {
      const output =
        "https://github.com/tursodatabase/turso/pull/123\n";
      const url = extractPrUrl(output);
      expect(url).toBe("https://github.com/tursodatabase/turso/pull/123");
    });

    it("should extract URL from multi-line output", () => {
      const output = `Creating pull request for fix/panic-src-vdbe.c-1234 into main in tursodatabase/turso

https://github.com/tursodatabase/turso/pull/456`;
      const url = extractPrUrl(output);
      expect(url).toBe("https://github.com/tursodatabase/turso/pull/456");
    });

    it("should return null when no URL found", () => {
      const output = "Error: something went wrong";
      const url = extractPrUrl(output);
      expect(url).toBeNull();
    });

    it("should handle URL with different owner/repo", () => {
      const output = "https://github.com/owner/repo-name/pull/789";
      const url = extractPrUrl(output);
      expect(url).toBe("https://github.com/owner/repo-name/pull/789");
    });
  });

  describe("createPullRequest", () => {
    const config = {
      prReviewer: "@LeMikaelF",
      prLabels: ["automated", "panic-fix"],
      dryRun: false,
    };

    it("should create PR with correct gh command", async () => {
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTemplate);
      const sandbox = createMockSandbox(async () =>
        successResult("https://github.com/tursodatabase/turso/pull/123\n")
      );

      const prUrl = await createPullRequest(
        {
          sessionName: "test-session",
          contextData: sampleContextData,
        },
        sandbox,
        config
      );

      expect(prUrl).toBe("https://github.com/tursodatabase/turso/pull/123");

      // Verify gh command was called
      const runInSession = sandbox.runInSession as ReturnType<typeof vi.fn>;
      expect(runInSession).toHaveBeenCalledTimes(1);

      const calls = runInSession.mock.calls as Array<[string, string]>;
      const command = calls[0]![1];
      expect(command).toContain("gh pr create");
      expect(command).toContain("--title");
      expect(command).toContain("--body");
      expect(command).toContain("--draft");
      expect(command).toContain('--reviewer "@LeMikaelF"');
      expect(command).toContain('--label "automated"');
      expect(command).toContain('--label "panic-fix"');
    });

    it("should throw error when gh command fails", async () => {
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTemplate);
      const sandbox = createMockSandbox(async () =>
        failureResult("gh: authentication required")
      );

      await expect(
        createPullRequest(
          {
            sessionName: "test-session",
            contextData: sampleContextData,
          },
          sandbox,
          config
        )
      ).rejects.toThrow("Failed to create PR: gh: authentication required");
    });

    it("should throw error when no PR URL in output", async () => {
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTemplate);
      const sandbox = createMockSandbox(async () =>
        successResult("PR created but no URL")
      );

      await expect(
        createPullRequest(
          {
            sessionName: "test-session",
            contextData: sampleContextData,
          },
          sandbox,
          config
        )
      ).rejects.toThrow("Failed to extract PR URL");
    });

    it("should escape single quotes in title", async () => {
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTemplate);
      const sandbox = createMockSandbox(async () =>
        successResult("https://github.com/owner/repo/pull/1")
      );

      const dataWithQuotes: PanicContextData = {
        ...sampleContextData,
        panic_message: "can't access memory",
      };

      await createPullRequest(
        {
          sessionName: "test-session",
          contextData: dataWithQuotes,
        },
        sandbox,
        config
      );

      const runInSession = sandbox.runInSession as ReturnType<typeof vi.fn>;
      const calls = runInSession.mock.calls as Array<[string, string]>;
      const command = calls[0]![1];
      expect(command).toContain("can'\\''t");
    });

    it("should work with empty labels array", async () => {
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTemplate);
      const sandbox = createMockSandbox(async () =>
        successResult("https://github.com/owner/repo/pull/1")
      );

      await createPullRequest(
        {
          sessionName: "test-session",
          contextData: sampleContextData,
        },
        sandbox,
        { ...config, prLabels: [] }
      );

      const runInSession = sandbox.runInSession as ReturnType<typeof vi.fn>;
      const calls = runInSession.mock.calls as Array<[string, string]>;
      const command = calls[0]![1];
      expect(command).not.toContain("--label");
    });
  });

  describe("createPullRequest with dryRun", () => {
    const dryRunConfig = {
      prReviewer: "@LeMikaelF",
      prLabels: ["automated", "panic-fix"],
      dryRun: true,
    };

    beforeEach(() => {
      (writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });

    it("should not call sandbox.runInSession when dryRun is true", async () => {
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTemplate);
      const sandbox = createMockSandbox(async () =>
        successResult("https://github.com/owner/repo/pull/1")
      );

      await createPullRequest(
        {
          sessionName: "test-session",
          contextData: sampleContextData,
        },
        sandbox,
        dryRunConfig
      );

      const runInSession = sandbox.runInSession as ReturnType<typeof vi.fn>;
      expect(runInSession).not.toHaveBeenCalled();
    });

    it("should write body and command files to /tmp", async () => {
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTemplate);
      const sandbox = createMockSandbox(async () =>
        successResult("https://github.com/owner/repo/pull/1")
      );

      await createPullRequest(
        {
          sessionName: "test-session",
          contextData: sampleContextData,
        },
        sandbox,
        dryRunConfig
      );

      const writeFileMock = writeFile as ReturnType<typeof vi.fn>;
      expect(writeFileMock).toHaveBeenCalledTimes(2);

      // Check body file
      const bodyCall = writeFileMock.mock.calls[0] as [string, string, string];
      expect(bodyCall[0]).toMatch(/^\/tmp\/pr-dry-run-test-session-\d+-body\.md$/);
      expect(bodyCall[1]).toContain("**Location:** src/vdbe.c:1234");
      expect(bodyCall[2]).toBe("utf-8");

      // Check command file
      const commandCall = writeFileMock.mock.calls[1] as [string, string, string];
      expect(commandCall[0]).toMatch(/^\/tmp\/pr-dry-run-test-session-\d+-command\.txt$/);
      expect(commandCall[1]).toContain("gh pr create");
      expect(commandCall[1]).toContain("--draft");
      expect(commandCall[2]).toBe("utf-8");
    });

    it("should return placeholder URL when dryRun is true", async () => {
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTemplate);
      const sandbox = createMockSandbox(async () =>
        successResult("https://github.com/owner/repo/pull/1")
      );

      const prUrl = await createPullRequest(
        {
          sessionName: "test-session",
          contextData: sampleContextData,
        },
        sandbox,
        dryRunConfig
      );

      expect(prUrl).toBe("https://github.com/dry-run/pr/0");
    });
  });
});

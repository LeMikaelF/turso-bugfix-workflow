// MCP Server entry point for panic-fix-workflow tools
// Exposes tools for Claude Code agents running in AgentFS sessions

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runSimulator, type RunSimulatorResult } from "./run-simulator.js";
import { describeSimFix, type DescribeSimFixResult } from "./describe-sim-fix.js";
import { describeFix, type DescribeFixResult } from "./describe-fix.js";
import { validateFixFast, type ValidateFixFastResult } from "./validate-fix-fast.js";
import { validateFixSlow, type ValidateFixSlowResult } from "./validate-fix-slow.js";

// Tool schemas using Zod
const runSimulatorSchema = {
  seed: z.number().optional().describe("Optional seed for the simulator. If not provided, a random seed is used."),
  timeout_seconds: z.number().optional().describe("Timeout in seconds for the simulator run. Default: 300"),
};

const describeSimFixSchema = {
  why_simulator_missed: z.string().describe("Explanation of why the simulator didn't catch this panic before"),
  what_was_added: z.string().describe("Description of what was added to make the simulator generate the triggering statements"),
};

const describeFixSchema = {
  bug_description: z.string().describe("Description of what the bug was (root cause)"),
  fix_description: z.string().describe("Description of how the bug was fixed"),
};

const validateFixSlowSchema = {
  failing_seed: z.number().int().min(0).max(2147483647).describe("The seed that originally triggered the panic (must be a non-negative 32-bit integer)"),
};

/**
 * Create and configure the MCP server with all panic-fix tools.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "panic-tools",
    version: "1.0.0",
  });

  // Register run-simulator tool
  server.tool(
    "run-simulator",
    "Run the simulator to attempt to reproduce a panic. Sends IPC callbacks to the orchestrator to pause/resume timeout tracking while the simulator is running.",
    runSimulatorSchema,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result: RunSimulatorResult = await runSimulator({
        seed: params.seed,
        timeout_seconds: params.timeout_seconds,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register describe-sim-fix tool
  server.tool(
    "describe-sim-fix",
    "Document simulator changes made by the Reproducer agent. Call this after extending the simulator to reproduce a panic.",
    describeSimFixSchema,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result: DescribeSimFixResult = describeSimFix({
        why_simulator_missed: params.why_simulator_missed,
        what_was_added: params.what_was_added,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register describe-fix tool
  server.tool(
    "describe-fix",
    "Document bug fix made by the Fixer agent. Call this after fixing a panic and validating the fix.",
    describeFixSchema,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result: DescribeFixResult = describeFix({
        bug_description: params.bug_description,
        fix_description: params.fix_description,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register validate-fix-fast tool
  server.tool(
    "validate-fix-fast",
    "Run `make test-single` to quickly validate a fix passes the single TCL test. Use this for fast iteration during fix development.",
    {},
    async (): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result: ValidateFixFastResult = await validateFixFast();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register validate-fix-slow tool
  server.tool(
    "validate-fix-slow",
    "Run full validation: `make test` + simulator 10x with the failing seed. Use this for final validation before shipping the fix.",
    validateFixSlowSchema,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result: ValidateFixSlowResult = await validateFixSlow({
        failing_seed: params.failing_seed,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

/**
 * Start the MCP server with stdio transport.
 * This is the main entry point when running as a standalone process.
 */
export async function startServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run server when executed directly
startServer().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});

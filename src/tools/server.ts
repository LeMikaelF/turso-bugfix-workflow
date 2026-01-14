// MCP Server entry point for panic-fix-workflow tools
// Exposes tools for Claude Code agents running in AgentFS sessions

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runSimulator, type RunSimulatorResult } from "./run-simulator.js";

// Tool schemas using Zod
const runSimulatorSchema = {
  seed: z.number().optional().describe("Optional seed for the simulator. If not provided, a random seed is used."),
  timeout_seconds: z.number().optional().describe("Timeout in seconds for the simulator run. Default: 300"),
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

  // Placeholder for future tools (steps 16-19):
  // - describe-sim-fix
  // - describe-fix
  // - validate-fix-fast
  // - validate-fix-slow

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

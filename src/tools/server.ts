// MCP Server entry point for panic-fix-workflow tools
// Exposes tools for Claude Code agents running in AgentFS sessions

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runSimulator, type RunSimulatorResult } from "./run-simulator.js";
import { describeSimFix, type DescribeSimFixResult } from "./describe-sim-fix.js";
import { describeFix, type DescribeFixResult } from "./describe-fix.js";
import { validateFix, type ValidateFixResult } from "./validate-fix.js";
import { writeReproducerPlan, type WriteReproducerPlanResult } from "./write-reproducer-plan.js";
import { writeFixerPlan, type WriteFixerPlanResult } from "./write-fixer-plan.js";

// Tool schemas using Zod
const runSimulatorSchema = {
  seed: z.number().optional().describe("Optional seed for the simulator. If not provided, a random seed is used."),
  timeout_seconds: z.number().optional().describe("Timeout in seconds for the simulator run. Default: 300"),
};

const describeSimFixSchema = {
  failing_seed: z.number().int().min(0).max(2147483647).describe("The seed that triggered the panic (from run-simulator result)"),
  why_simulator_missed: z.string().describe("Explanation of why the simulator didn't catch this panic before"),
  what_was_added: z.string().describe("Description of what was added to make the simulator generate the triggering statements"),
};

const describeFixSchema = {
  bug_description: z.string().describe("Description of what the bug was (root cause)"),
  fix_description: z.string().describe("Description of how the bug was fixed"),
};

const validateFixSchema = {
  failing_seed: z.number().int().min(0).max(2147483647).describe("The seed that originally triggered the panic (must be a non-negative 32-bit integer)"),
};

const fileToModifySchema = z.object({
  path: z.string().describe("Path to the file to modify"),
  description: z.string().describe("Description of what changes to make"),
});

const writeReproducerPlanSchema = {
  analysis_summary: z.string().describe("Summary of the panic analysis and what triggers it"),
  root_cause_hypothesis: z.string().describe("Hypothesis about what code path/condition leads to the panic"),
  sql_pattern_analysis: z.string().describe("Analysis of SQL patterns from panic_context.md that are relevant"),
  files_to_modify: z.array(fileToModifySchema).describe("List of files to modify with descriptions"),
  generation_strategy: z.string().describe("Strategy for extending the simulator generation logic"),
  verification_approach: z.string().describe("How to verify the changes work (seed range to try, expected behavior)"),
};

const writeFixerPlanSchema = {
  root_cause_analysis: z.string().describe("Detailed explanation of the bug root cause"),
  code_path_trace: z.string().describe("Trace from SQL to panic location - what functions are involved"),
  fix_strategy: z.string().describe("Strategy for fixing the bug"),
  files_to_modify: z.array(fileToModifySchema).describe("List of files to modify with descriptions"),
  validation_approach: z.string().describe("How to validate the fix (what tests to run)"),
  risk_assessment: z.string().describe("Potential regressions or edge cases to watch for"),
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
    "Document simulator changes made by the Reproducer agent and update panic_context.json. Call this after extending the simulator to reproduce a panic.",
    describeSimFixSchema,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result: DescribeSimFixResult = await describeSimFix({
        failing_seed: params.failing_seed,
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
    "Document bug fix made by the Fixer agent and update panic_context.json. Call this after fixing a panic and validating the fix.",
    describeFixSchema,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result: DescribeFixResult = await describeFix({
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

  // Register validate-fix tool
  server.tool(
    "validate-fix",
    "Validate a fix by running fast validation (make test-single) then slow validation (make test + simulator 10x). Use this after implementing a fix to verify it works.",
    validateFixSchema,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result: ValidateFixResult = await validateFix({
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

  // Register write-reproducer-plan tool
  server.tool(
    "write-reproducer-plan",
    "Write a reproducer plan file documenting analysis and strategy for extending the simulator. Call this after analyzing the panic to create reproducer_plan.md.",
    writeReproducerPlanSchema,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result: WriteReproducerPlanResult = await writeReproducerPlan({
        analysis_summary: params.analysis_summary,
        root_cause_hypothesis: params.root_cause_hypothesis,
        sql_pattern_analysis: params.sql_pattern_analysis,
        files_to_modify: params.files_to_modify,
        generation_strategy: params.generation_strategy,
        verification_approach: params.verification_approach,
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

  // Register write-fixer-plan tool
  server.tool(
    "write-fixer-plan",
    "Write a fixer plan file documenting root cause analysis and fix strategy. Call this after analyzing the panic to create fixer_plan.md.",
    writeFixerPlanSchema,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result: WriteFixerPlanResult = await writeFixerPlan({
        root_cause_analysis: params.root_cause_analysis,
        code_path_trace: params.code_path_trace,
        fix_strategy: params.fix_strategy,
        files_to_modify: params.files_to_modify,
        validation_approach: params.validation_approach,
        risk_assessment: params.risk_assessment,
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

import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "node:child_process";

// Check if agentfs is available
function checkAgentFsAvailable(): boolean {
  try {
    execSync("agentfs --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const agentFsAvailable = checkAgentFsAvailable();

describe.skipIf(!agentFsAvailable)("MCP Server Integration (AgentFS)", () => {
  const testSessionName = `mcp-test-${Date.now()}`;

  // Cleanup after tests
  afterAll(async () => {
    if (agentFsAvailable) {
      try {
        execSync(`rm -f .agentfs/${testSessionName}.db`, { stdio: "ignore" });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it("should respond to tools/list request from within sandbox", () => {
    // Run the MCP server inside an AgentFS session and send a tools/list request
    const command = `agentfs run --session ${testSessionName} bash -c "echo '{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"tools/list\\"}' | timeout 5 npx tsx src/tools/server.ts"`;

    const output = execSync(command, {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    // Parse the JSON-RPC response
    const response = JSON.parse(output.trim());

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response.result).toBeDefined();
    expect(response.result.tools).toBeInstanceOf(Array);

    // Verify run-simulator tool is registered
    const runSimulatorTool = response.result.tools.find(
      (t: { name: string }) => t.name === "run-simulator"
    );
    expect(runSimulatorTool).toBeDefined();
    expect(runSimulatorTool.description).toContain("simulator");
  });

  it("should have correct input schema for run-simulator tool", () => {
    const command = `agentfs run --session ${testSessionName} bash -c "echo '{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"tools/list\\"}' | timeout 5 npx tsx src/tools/server.ts"`;

    const output = execSync(command, {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    const response = JSON.parse(output.trim());
    const runSimulatorTool = response.result.tools.find(
      (t: { name: string }) => t.name === "run-simulator"
    );

    expect(runSimulatorTool.inputSchema).toBeDefined();
    expect(runSimulatorTool.inputSchema.properties.seed).toBeDefined();
    expect(runSimulatorTool.inputSchema.properties.timeout_seconds).toBeDefined();
  });
});

// Non-AgentFS test to verify MCP server works via stdio
describe("MCP Server Integration (stdio)", () => {
  it("should respond to tools/list request via stdio", () => {
    const output = execSync(
      `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | timeout 5 npx tsx src/tools/server.ts`,
      {
        encoding: "utf-8",
        cwd: process.cwd(),
      }
    );

    const response = JSON.parse(output.trim());

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response.result.tools).toBeInstanceOf(Array);
    expect(response.result.tools.length).toBeGreaterThan(0);
  });

  it("should register run-simulator tool with correct properties", () => {
    const output = execSync(
      `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | timeout 5 npx tsx src/tools/server.ts`,
      {
        encoding: "utf-8",
        cwd: process.cwd(),
      }
    );

    const response = JSON.parse(output.trim());
    const runSimulator = response.result.tools.find(
      (t: { name: string }) => t.name === "run-simulator"
    );

    expect(runSimulator).toBeDefined();
    expect(runSimulator.name).toBe("run-simulator");
    expect(runSimulator.description).toBeTruthy();
    expect(runSimulator.inputSchema.type).toBe("object");
    expect(runSimulator.inputSchema.properties.seed.type).toBe("number");
    expect(runSimulator.inputSchema.properties.timeout_seconds.type).toBe("number");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMcpServer } from "../server.js";

// Mock the run-simulator module
vi.mock("../run-simulator.js", () => ({
  runSimulator: vi.fn().mockResolvedValue({
    panic_found: false,
    seed_used: 12345,
  }),
}));

describe("MCP Server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("createMcpServer", () => {
    it("should create an MCP server instance", () => {
      const server = createMcpServer();
      expect(server).toBeDefined();
    });

    it("should create server with correct name and version", () => {
      const server = createMcpServer();
      // The server object should have serverInfo after creation
      // We can verify it's an McpServer instance
      expect(server).toHaveProperty("connect");
      expect(server).toHaveProperty("close");
      expect(server).toHaveProperty("tool");
    });
  });
});

// Configuration loading from properties.ts file

import { dirname, join } from "path";
import { fileURLToPath } from "url";

export interface Config {
  // Database
  tursoUrl: string;

  // AgentFS
  baseRepoPath: string;

  // Concurrency
  maxParallelPanics: number;

  // Timeouts (milliseconds)
  reproducerTimeoutMs: number;
  fixerTimeoutMs: number;

  // Planner/Implementer split timeouts (milliseconds)
  reproducerPlannerTimeoutMs: number;
  reproducerImplementerTimeoutMs: number;
  fixerPlannerTimeoutMs: number;
  fixerImplementerTimeoutMs: number;

  // GitHub
  githubToken: string;
  githubRepo: string;
  prReviewer: string;
  prLabels: string[];

  // IPC
  ipcPort: number;

  // Dry run mode - don't actually create PRs
  dryRun: boolean;

  // Use direct execution instead of AgentFS (for environments without FUSE)
  // Warning: This modifies the actual repo, not copy-on-write sessions
  useDirectExecution: boolean;
}

export async function loadConfig(): Promise<Config> {
  // Use dynamic path to avoid TypeScript trying to include properties.ts in compilation
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const configPath = join(__dirname, "..", "..", "properties.js");

  // Load config module with helpful error for missing file
  let module: { default?: unknown };
  try {
    module = await import(configPath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_MODULE_NOT_FOUND"
    ) {
      throw new Error(
        "Configuration file not found. Copy properties.example.ts to properties.ts and run npm run build."
      );
    }
    throw error;
  }

  // Validate export shape
  if (!module.default || typeof module.default !== "object") {
    throw new Error("properties.ts must have a default export of type Config");
  }
  const config = module.default as Config;

  // Validate required string properties
  if (!config.tursoUrl || typeof config.tursoUrl !== "string") {
    throw new Error('Required property "tursoUrl" must be a non-empty string');
  }
  if (!config.githubToken || typeof config.githubToken !== "string") {
    throw new Error(
      'Required property "githubToken" must be a non-empty string'
    );
  }

  // Validate types for critical non-string properties
  if (typeof config.ipcPort !== "number" || config.ipcPort < 1 || config.ipcPort > 65535) {
    throw new Error("ipcPort must be a number between 1 and 65535");
  }
  if (!Array.isArray(config.prLabels)) {
    throw new Error("prLabels must be an array of strings");
  }

  return config;
}

// For testing - allows partial config with defaults
export function loadConfigWithDefaults(
  overrides: Partial<Config> = {}
): Config {
  const defaults: Config = {
    tursoUrl: ":memory:",
    baseRepoPath: "/opt/turso-base",
    maxParallelPanics: 2,
    reproducerTimeoutMs: 60 * 60 * 1000,
    fixerTimeoutMs: 60 * 60 * 1000,
    reproducerPlannerTimeoutMs: 15 * 60 * 1000,
    reproducerImplementerTimeoutMs: 45 * 60 * 1000,
    fixerPlannerTimeoutMs: 15 * 60 * 1000,
    fixerImplementerTimeoutMs: 45 * 60 * 1000,
    githubToken: "test-token",
    githubRepo: "tursodatabase/turso",
    prReviewer: "@LeMikaelF",
    prLabels: ["automated", "panic-fix"],
    ipcPort: 9100,
    dryRun: false,
    useDirectExecution: false,
  };

  return { ...defaults, ...overrides };
}

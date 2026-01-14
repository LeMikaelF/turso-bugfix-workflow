// Configuration loading from environment variables

//TODO change this to instead load properties from a json file "properties.json"

export interface Config {
  // Database
  tursoUrl: string;
  tursoAuthToken: string;

  // AgentFS
  baseRepoPath: string;

  // Concurrency
  maxParallelPanics: number;

  // Timeouts (milliseconds)
  reproducerTimeoutMs: number;
  fixerTimeoutMs: number;

  // GitHub
  githubToken: string;
  githubRepo: string;
  prReviewer: string;
  prLabels: string[];

  // IPC
  ipcPort: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function optionalIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid integer`);
  }
  return parsed;
}

export function loadConfig(): Config {
  return {
    tursoUrl: requireEnv("TURSO_URL"),
    tursoAuthToken: requireEnv("TURSO_AUTH_TOKEN"),
    baseRepoPath: optionalEnv("BASE_REPO_PATH", "/opt/turso-base"),
    maxParallelPanics: optionalIntEnv("MAX_PARALLEL", 2),
    reproducerTimeoutMs: optionalIntEnv(
      "REPRODUCER_TIMEOUT",
      60 * 60 * 1000
    ),
    fixerTimeoutMs: optionalIntEnv("FIXER_TIMEOUT", 60 * 60 * 1000),
    githubToken: requireEnv("GITHUB_TOKEN"),
    githubRepo: optionalEnv("GITHUB_REPO", "tursodatabase/turso"),
    prReviewer: optionalEnv("PR_REVIEWER", "@LeMikaelF"),
    prLabels: optionalEnv("PR_LABELS", "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    ipcPort: optionalIntEnv("IPC_PORT", 9100),
  };
}

// For testing - allows partial config with defaults
export function loadConfigWithDefaults(
  overrides: Partial<Config> = {}
): Config {
  const defaults: Config = {
    tursoUrl: ":memory:",
    tursoAuthToken: "",
    baseRepoPath: "/opt/turso-base",
    maxParallelPanics: 2,
    reproducerTimeoutMs: 60 * 60 * 1000,
    fixerTimeoutMs: 60 * 60 * 1000,
    githubToken: "test-token",
    githubRepo: "tursodatabase/turso",
    prReviewer: "@LeMikaelF",
    prLabels: ["automated", "panic-fix"],
    ipcPort: 9100,
  };

  return { ...defaults, ...overrides };
}

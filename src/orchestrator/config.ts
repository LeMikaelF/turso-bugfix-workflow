// Configuration loading from properties.json file

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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
}

interface PropertiesFile {
  tursoUrl?: string;
  tursoAuthToken?: string;
  baseRepoPath?: string;
  maxParallelPanics?: number;
  reproducerTimeoutMs?: number;
  fixerTimeoutMs?: number;
  reproducerPlannerTimeoutMs?: number;
  reproducerImplementerTimeoutMs?: number;
  fixerPlannerTimeoutMs?: number;
  fixerImplementerTimeoutMs?: number;
  githubToken?: string;
  githubRepo?: string;
  prReviewer?: string;
  prLabels?: string[];
  ipcPort?: number;
  dryRun?: boolean;
}

function findPropertiesFile(): string {
  // Try current working directory first
  const cwdPath = join(process.cwd(), "properties.json");
  if (existsSync(cwdPath)) {
    return cwdPath;
  }

  // Try relative to this module
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const modulePath = join(__dirname, "..", "..", "properties.json");
  if (existsSync(modulePath)) {
    return modulePath;
  }

  throw new Error(
    "properties.json not found. Please create properties.json in the project root."
  );
}

function loadPropertiesFile(): PropertiesFile {
  const filePath = findPropertiesFile();
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content) as PropertiesFile;
}

function requireProperty<T>(
  key: keyof PropertiesFile,
  value: T | undefined
): T {
  if (value === undefined || value === "") {
    throw new Error(`Required property "${key}" is not set in properties.json`);
  }
  return value;
}

export function loadConfig(): Config {
  const props = loadPropertiesFile();

  return {
    tursoUrl: requireProperty("tursoUrl", props.tursoUrl),
    tursoAuthToken: requireProperty("tursoAuthToken", props.tursoAuthToken),
    baseRepoPath: props.baseRepoPath ?? "/opt/turso-base",
    maxParallelPanics: props.maxParallelPanics ?? 2,
    reproducerTimeoutMs: props.reproducerTimeoutMs ?? 60 * 60 * 1000,
    fixerTimeoutMs: props.fixerTimeoutMs ?? 60 * 60 * 1000,
    reproducerPlannerTimeoutMs: props.reproducerPlannerTimeoutMs ?? 15 * 60 * 1000,
    reproducerImplementerTimeoutMs: props.reproducerImplementerTimeoutMs ?? 45 * 60 * 1000,
    fixerPlannerTimeoutMs: props.fixerPlannerTimeoutMs ?? 15 * 60 * 1000,
    fixerImplementerTimeoutMs: props.fixerImplementerTimeoutMs ?? 45 * 60 * 1000,
    githubToken: requireProperty("githubToken", props.githubToken),
    githubRepo: props.githubRepo ?? "tursodatabase/turso",
    prReviewer: props.prReviewer ?? "@LeMikaelF",
    prLabels: props.prLabels ?? [],
    ipcPort: props.ipcPort ?? 9100,
    dryRun: props.dryRun ?? false,
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
  };

  return { ...defaults, ...overrides };
}

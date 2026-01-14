// Panic context file template generator

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PanicFix } from "../../database.js";
import { generateInitialContextJson, type PanicContextData } from "../../context-json.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load the panic context template from the templates directory.
 */
export async function loadContextTemplate(): Promise<string> {
  const templatePath = join(__dirname, "../../../../templates/panic-context.md");
  return readFile(templatePath, "utf-8");
}

/**
 * Format the context file by replacing template placeholders.
 * Placeholders are in the format {{field_name}}.
 */
export function formatContextFile(
  template: string,
  panic: PanicFix,
  _tclTestFile: string
): string {
  const replacements: Record<string, string> = {
    panic_location: panic.panic_location,
    panic_message: panic.panic_message,
    sql_statements: panic.sql_statements,
  };

  let content = template;
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return content;
}

/**
 * Generate initial panic_context.md content.
 */
export async function generateContextFile(
  panic: PanicFix,
  tclTestFile: string
): Promise<string> {
  const template = await loadContextTemplate();
  return formatContextFile(template, panic, tclTestFile);
}

/**
 * Generate initial panic_context.json content.
 */
export function generateContextJsonData(
  panic: PanicFix,
  tclTestFile: string
): PanicContextData {
  return generateInitialContextJson(
    panic.panic_location,
    panic.panic_message,
    tclTestFile
  );
}

/**
 * Generate initial panic_context.json content as a string.
 */
export function generateContextJsonFile(
  panic: PanicFix,
  tclTestFile: string
): string {
  const data = generateContextJsonData(panic, tclTestFile);
  return JSON.stringify(data, null, 2);
}

// Panic context file template generator

import type { PanicFix } from "../../database.js";

/**
 * Generate initial panic_context.md content.
 */
export function generateContextFile(panic: PanicFix, tclTestFile: string): string {
  const jsonBlock = JSON.stringify(
    {
      panic_location: panic.panic_location,
      panic_message: panic.panic_message,
      tcl_test_file: tclTestFile,
    },
    null,
    2
  );

  return `# Panic Context: ${panic.panic_location}

## Panic Info

- **Location**: ${panic.panic_location}
- **Message**: ${panic.panic_message}

## SQL Statements

\`\`\`sql
${panic.sql_statements}
\`\`\`

## Reproducer Notes

<!-- Reproducer agent writes analysis here -->

## Fixer Notes

<!-- Fixer agent writes analysis here -->

---

## PR Data (Machine Readable)

\`\`\`json
${jsonBlock}
\`\`\`
`;
}

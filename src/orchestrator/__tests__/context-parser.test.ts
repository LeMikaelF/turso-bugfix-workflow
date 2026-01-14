import { describe, it, expect } from "vitest";
import {
  extractJsonBlock,
  parseContextFile,
  validateRequiredFields,
  parseAndValidate,
  type PanicContextData,
  type ValidationPhase,
} from "../context-parser.js";

describe("context-parser", () => {
  describe("extractJsonBlock", () => {
    it("should extract JSON from a valid markdown code block", () => {
      const content = `
# Panic Context

Some text here.

\`\`\`json
{
  "panic_location": "src/vdbe.c:1234",
  "panic_message": "assertion failed"
}
\`\`\`

More text.
`;
      const result = extractJsonBlock(content);
      expect(result).not.toBeNull();
      expect(result).toContain('"panic_location"');
      expect(result).toContain('"src/vdbe.c:1234"');
    });

    it("should return the first JSON block when multiple exist", () => {
      const content = `
\`\`\`json
{"first": true}
\`\`\`

\`\`\`json
{"second": true}
\`\`\`
`;
      const result = extractJsonBlock(content);
      expect(result).not.toBeNull();
      expect(result).toContain('"first"');
      expect(result).not.toContain('"second"');
    });

    it("should return null when no JSON block exists", () => {
      const content = `
# Panic Context

No JSON here, just text.

\`\`\`typescript
const x = 1;
\`\`\`
`;
      const result = extractJsonBlock(content);
      expect(result).toBeNull();
    });

    it("should return null for empty content", () => {
      const result = extractJsonBlock("");
      expect(result).toBeNull();
    });

    it("should handle JSON block with no content", () => {
      const content = `
\`\`\`json

\`\`\`
`;
      const result = extractJsonBlock(content);
      expect(result).toBe("");
    });

    it("should handle malformed markdown (missing closing fence)", () => {
      const content = `
\`\`\`json
{"incomplete": true}
No closing fence
`;
      const result = extractJsonBlock(content);
      expect(result).toBeNull();
    });
  });

  describe("parseContextFile", () => {
    it("should parse valid JSON from markdown", () => {
      const content = `
# Context

\`\`\`json
{
  "panic_location": "src/vdbe.c:1234",
  "panic_message": "assertion failed: pCur->isValid",
  "tcl_test_file": "test/panic_abc123.test"
}
\`\`\`
`;
      const result = parseContextFile(content);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.panic_location).toBe("src/vdbe.c:1234");
      expect(result.data!.panic_message).toBe("assertion failed: pCur->isValid");
      expect(result.data!.tcl_test_file).toBe("test/panic_abc123.test");
    });

    it("should return error for content without JSON block", () => {
      const content = "# No JSON here";
      const result = parseContextFile(content);
      expect(result.success).toBe(false);
      expect(result.error).toBe("No JSON block found in content");
    });

    it("should return error for invalid JSON syntax", () => {
      const content = `
\`\`\`json
{invalid json}
\`\`\`
`;
      const result = parseContextFile(content);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid JSON");
    });

    it("should parse complete panic context data", () => {
      const content = `
\`\`\`json
{
  "panic_location": "src/vdbe.c:1234",
  "panic_message": "assertion failed",
  "tcl_test_file": "test/panic.test",
  "failing_seed": 42,
  "why_simulator_missed": "Missing edge case",
  "simulator_changes": "Added new test path",
  "bug_description": "Buffer overflow",
  "fix_description": "Added bounds check"
}
\`\`\`
`;
      const result = parseContextFile(content);
      expect(result.success).toBe(true);
      expect(result.data!.failing_seed).toBe(42);
      expect(result.data!.why_simulator_missed).toBe("Missing edge case");
      expect(result.data!.simulator_changes).toBe("Added new test path");
      expect(result.data!.bug_description).toBe("Buffer overflow");
      expect(result.data!.fix_description).toBe("Added bounds check");
    });
  });

  describe("validateRequiredFields", () => {
    const completeData: PanicContextData = {
      panic_location: "src/vdbe.c:1234",
      panic_message: "assertion failed",
      tcl_test_file: "test/panic.test",
      failing_seed: 42,
      why_simulator_missed: "Missing edge case",
      simulator_changes: "Added new test path",
      bug_description: "Buffer overflow",
      fix_description: "Added bounds check",
    };

    describe("repo_setup phase", () => {
      it("should pass with all required fields", () => {
        const data: PanicContextData = {
          panic_location: "src/vdbe.c:1234",
          panic_message: "assertion failed",
          tcl_test_file: "test/panic.test",
        };
        const result = validateRequiredFields(data, "repo_setup");
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should fail when panic_location is missing", () => {
        const data = {
          panic_message: "assertion failed",
          tcl_test_file: "test/panic.test",
        } as PanicContextData;
        const result = validateRequiredFields(data, "repo_setup");
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Missing required field: panic_location");
      });

      it("should fail when panic_message is empty string", () => {
        const data: PanicContextData = {
          panic_location: "src/vdbe.c:1234",
          panic_message: "",
          tcl_test_file: "test/panic.test",
        };
        const result = validateRequiredFields(data, "repo_setup");
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Missing required field: panic_message");
      });
    });

    describe("reproducer phase", () => {
      it("should pass with all required fields", () => {
        const data: PanicContextData = {
          panic_location: "src/vdbe.c:1234",
          panic_message: "assertion failed",
          tcl_test_file: "test/panic.test",
          failing_seed: 42,
          why_simulator_missed: "Missing edge case",
          simulator_changes: "Added new test path",
        };
        const result = validateRequiredFields(data, "reproducer");
        expect(result.valid).toBe(true);
      });

      it("should fail when failing_seed is missing", () => {
        const data: PanicContextData = {
          panic_location: "src/vdbe.c:1234",
          panic_message: "assertion failed",
          tcl_test_file: "test/panic.test",
          why_simulator_missed: "Missing edge case",
          simulator_changes: "Added new test path",
        };
        const result = validateRequiredFields(data, "reproducer");
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Missing required field: failing_seed");
      });

      it("should report all missing fields", () => {
        const data: PanicContextData = {
          panic_location: "src/vdbe.c:1234",
          panic_message: "assertion failed",
          tcl_test_file: "test/panic.test",
        };
        const result = validateRequiredFields(data, "reproducer");
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Missing required field: failing_seed");
        expect(result.errors).toContain("Missing required field: why_simulator_missed");
        expect(result.errors).toContain("Missing required field: simulator_changes");
      });
    });

    describe("fixer phase", () => {
      it("should pass with all required fields", () => {
        const result = validateRequiredFields(completeData, "fixer");
        expect(result.valid).toBe(true);
      });

      it("should fail when bug_description is missing", () => {
        const data = { ...completeData };
        delete (data as Partial<PanicContextData>).bug_description;
        const result = validateRequiredFields(data as PanicContextData, "fixer");
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Missing required field: bug_description");
      });

      it("should fail when fix_description is missing", () => {
        const data = { ...completeData };
        delete (data as Partial<PanicContextData>).fix_description;
        const result = validateRequiredFields(data as PanicContextData, "fixer");
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Missing required field: fix_description");
      });
    });

    describe("ship phase", () => {
      it("should pass with all required fields", () => {
        const result = validateRequiredFields(completeData, "ship");
        expect(result.valid).toBe(true);
      });

      it("should have same requirements as fixer phase", () => {
        const phases: ValidationPhase[] = ["fixer", "ship"];
        for (const phase of phases) {
          const result = validateRequiredFields(completeData, phase);
          expect(result.valid).toBe(true);
        }
      });
    });

    it("should allow extra fields without error", () => {
      const dataWithExtra = {
        ...completeData,
        extra_field: "some value",
      } as PanicContextData;
      const result = validateRequiredFields(dataWithExtra, "ship");
      expect(result.valid).toBe(true);
    });
  });

  describe("parseAndValidate", () => {
    it("should parse and validate successfully", () => {
      const content = `
\`\`\`json
{
  "panic_location": "src/vdbe.c:1234",
  "panic_message": "assertion failed",
  "tcl_test_file": "test/panic.test"
}
\`\`\`
`;
      const result = parseAndValidate(content, "repo_setup");
      expect(result.success).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });

    it("should return parse error when JSON is missing", () => {
      const content = "# No JSON";
      const result = parseAndValidate(content, "repo_setup");
      expect(result.success).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("No JSON block found in content");
    });

    it("should return validation errors when fields are missing", () => {
      const content = `
\`\`\`json
{
  "panic_location": "src/vdbe.c:1234"
}
\`\`\`
`;
      const result = parseAndValidate(content, "repo_setup");
      expect(result.success).toBe(true);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: panic_message");
      expect(result.errors).toContain("Missing required field: tcl_test_file");
    });

    it("should validate for reproducer phase correctly", () => {
      const content = `
\`\`\`json
{
  "panic_location": "src/vdbe.c:1234",
  "panic_message": "assertion failed",
  "tcl_test_file": "test/panic.test",
  "failing_seed": 42,
  "why_simulator_missed": "Edge case",
  "simulator_changes": "Added test"
}
\`\`\`
`;
      const result = parseAndValidate(content, "reproducer");
      expect(result.success).toBe(true);
      expect(result.valid).toBe(true);
    });
  });
});

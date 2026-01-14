import { describe, it, expect } from "vitest";
import {
  validateRequiredFields,
  type PanicContextData,
  type ValidationPhase,
} from "../context-parser.js";

describe("context-parser", () => {
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

      it("should fail when failing_seed is not a number", () => {
        const data = {
          panic_location: "src/vdbe.c:1234",
          panic_message: "assertion failed",
          tcl_test_file: "test/panic.test",
          failing_seed: "42" as unknown as number, // String instead of number
          why_simulator_missed: "Missing edge case",
          simulator_changes: "Added new test path",
        } as PanicContextData;
        const result = validateRequiredFields(data, "reproducer");
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Invalid type for failing_seed: expected number, got string");
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
});

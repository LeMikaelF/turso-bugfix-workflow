import { describe, it, expect } from "vitest";
import { describeSimFix } from "../describe-sim-fix.js";

describe("describe-sim-fix", () => {
  describe("describeSimFix", () => {
    it("should return success when both fields are valid", () => {
      const result = describeSimFix({
        why_simulator_missed: "The simulator didn't generate UPSERT statements with conflicting constraints",
        what_was_added: "Added UPSERT generation with random constraint conflicts",
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should fail when why_simulator_missed is missing", () => {
      const result = describeSimFix({
        why_simulator_missed: undefined as unknown as string,
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: why_simulator_missed");
    });

    it("should fail when why_simulator_missed is empty string", () => {
      const result = describeSimFix({
        why_simulator_missed: "",
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field why_simulator_missed cannot be empty");
    });

    it("should fail when why_simulator_missed is whitespace only", () => {
      const result = describeSimFix({
        why_simulator_missed: "   \t\n  ",
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field why_simulator_missed cannot be empty");
    });

    it("should fail when what_was_added is missing", () => {
      const result = describeSimFix({
        why_simulator_missed: "Some reason",
        what_was_added: undefined as unknown as string,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: what_was_added");
    });

    it("should fail when what_was_added is empty string", () => {
      const result = describeSimFix({
        why_simulator_missed: "Some reason",
        what_was_added: "",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field what_was_added cannot be empty");
    });

    it("should fail when what_was_added is whitespace only", () => {
      const result = describeSimFix({
        why_simulator_missed: "Some reason",
        what_was_added: "   \t\n  ",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field what_was_added cannot be empty");
    });

    it("should fail when why_simulator_missed is not a string", () => {
      const result = describeSimFix({
        why_simulator_missed: 123 as unknown as string,
        what_was_added: "Added something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: why_simulator_missed");
    });

    it("should fail when what_was_added is not a string", () => {
      const result = describeSimFix({
        why_simulator_missed: "Some reason",
        what_was_added: { foo: "bar" } as unknown as string,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: what_was_added");
    });

    it("should accept long descriptions", () => {
      const longDescription = "x".repeat(10000);
      const result = describeSimFix({
        why_simulator_missed: longDescription,
        what_was_added: longDescription,
      });

      expect(result.success).toBe(true);
    });

    it("should preserve leading/trailing whitespace in valid strings", () => {
      const result = describeSimFix({
        why_simulator_missed: "  valid with spaces  ",
        what_was_added: "  also valid  ",
      });

      expect(result.success).toBe(true);
    });
  });
});

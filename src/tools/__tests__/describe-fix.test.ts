import { describe, it, expect } from "vitest";
import { describeFix } from "../describe-fix.js";

describe("describe-fix", () => {
  describe("describeFix", () => {
    it("should return success when both fields are valid", () => {
      const result = describeFix({
        bug_description: "Cursor was not validated before dereferencing",
        fix_description: "Added null check before cursor access",
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should fail when bug_description is missing", () => {
      const result = describeFix({
        bug_description: undefined as unknown as string,
        fix_description: "Fixed something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: bug_description");
    });

    it("should fail when bug_description is empty string", () => {
      const result = describeFix({
        bug_description: "",
        fix_description: "Fixed something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field bug_description cannot be empty");
    });

    it("should fail when bug_description is whitespace only", () => {
      const result = describeFix({
        bug_description: "   \t\n  ",
        fix_description: "Fixed something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field bug_description cannot be empty");
    });

    it("should fail when fix_description is missing", () => {
      const result = describeFix({
        bug_description: "Some bug",
        fix_description: undefined as unknown as string,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: fix_description");
    });

    it("should fail when fix_description is empty string", () => {
      const result = describeFix({
        bug_description: "Some bug",
        fix_description: "",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field fix_description cannot be empty");
    });

    it("should fail when fix_description is whitespace only", () => {
      const result = describeFix({
        bug_description: "Some bug",
        fix_description: "   \t\n  ",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Field fix_description cannot be empty");
    });

    it("should fail when bug_description is not a string", () => {
      const result = describeFix({
        bug_description: 456 as unknown as string,
        fix_description: "Fixed something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: bug_description");
    });

    it("should fail when fix_description is not a string", () => {
      const result = describeFix({
        bug_description: "Some bug",
        fix_description: ["array"] as unknown as string,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing required field: fix_description");
    });

    it("should accept long descriptions", () => {
      const longDescription = "y".repeat(10000);
      const result = describeFix({
        bug_description: longDescription,
        fix_description: longDescription,
      });

      expect(result.success).toBe(true);
    });

    it("should preserve leading/trailing whitespace in valid strings", () => {
      const result = describeFix({
        bug_description: "  valid bug description  ",
        fix_description: "  valid fix description  ",
      });

      expect(result.success).toBe(true);
    });
  });
});

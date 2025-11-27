/**
 * Tests for error handler dependency error detection
 */

import { handleCommandError } from "../../src/utils/error-handler";
import { describe, it } from "node:test";
import { expect } from "@jest/globals";
import { beforeAll, afterAll, beforeEach } from "@jest/globals";
import { jest } from "@jest/globals";

// Mock process.exit to prevent actual exit during tests
const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn() as any;
});

afterAll(() => {
  process.exit = originalExit;
});

describe("Error Handler - Dependency Errors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear any debug environment
    delete process.env.GUARDSCAN_DEBUG;
  });

  it("should detect MODULE_NOT_FOUND errors", () => {
    const error = new Error("Cannot find module 'typescript'");
    (error as any).code = "MODULE_NOT_FOUND";

    expect(() => handleCommandError(error, "Test Command")).toThrow();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("should provide helpful message for TypeScript errors", () => {
    const error = new Error("TypeScript is required but not installed");

    expect(() => handleCommandError(error, "Test Command")).toThrow();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("should detect 'cannot find module' errors", () => {
    const error = new Error("Cannot find module 'some-package'");
    (error as any).code = "MODULE_NOT_FOUND";

    expect(() => handleCommandError(error, "Test Command")).toThrow();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("should detect 'required dependency' errors", () => {
    const error = new Error(
      "Required dependency 'typescript' is not installed"
    );

    expect(() => handleCommandError(error, "Test Command")).toThrow();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("should handle other error types normally", () => {
    const error = new Error("Some other error");

    expect(() => handleCommandError(error, "Test Command")).toThrow();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

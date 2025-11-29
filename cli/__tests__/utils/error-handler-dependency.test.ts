/**
 * Tests for error handler dependency error detection
 */

import { handleCommandError } from "../../src/utils/error-handler";
import {
  describe,
  it,
  expect,
  jest,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
 
// Spy on process.exit to prevent the test runner from exiting
let exitSpy: ReturnType<typeof jest.spyOn>;
beforeAll(() => {
  exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as any);
});

afterAll(() => {
  exitSpy.mockRestore();
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
  });

  it("should provide helpful message for TypeScript errors", () => {
    const error = new Error("TypeScript is required but not installed");

    expect(() => handleCommandError(error, "Test Command")).toThrow();
  });

  it("should detect 'cannot find module' errors", () => {
    const error = new Error("Cannot find module 'some-package'");
    (error as any).code = "MODULE_NOT_FOUND";

    expect(() => handleCommandError(error, "Test Command")).toThrow();
  });

  it("should detect 'required dependency' errors", () => {
    const error = new Error(
      "Required dependency 'typescript' is not installed"
    );

    expect(() => handleCommandError(error, "Test Command")).toThrow();
  });

  it("should handle other error types normally", () => {
    const error = new Error("Some other error");

    expect(() => handleCommandError(error, "Test Command")).toThrow();
  });
});

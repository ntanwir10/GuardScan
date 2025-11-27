/**
 * Dependency Checker Utility
 *
 * Validates that required runtime dependencies are available before use.
 * Provides clear error messages with installation instructions.
 */

import { createDebugLogger } from "./debug-logger";

const logger = createDebugLogger("dependency-checker");

/**
 * Check if a dependency is available
 * @param name - Package name to check
 * @returns true if the dependency can be resolved, false otherwise
 */
export function checkDependency(name: string): boolean {
  try {
    require.resolve(name);
    logger.debug(`Dependency check passed: ${name}`);
    return true;
  } catch (error) {
    logger.debug(`Dependency check failed: ${name}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Ensure a dependency is available, throw with helpful error if not
 * @param name - Package name to check
 * @param installCommand - Command to install the dependency (e.g., "npm install typescript")
 * @throws Error with installation instructions if dependency is missing
 */
export function ensureDependency(name: string, installCommand: string): void {
  if (!checkDependency(name)) {
    const errorMessage =
      `Required dependency "${name}" is not installed.\n` +
      `Install it with: ${installCommand}\n` +
      `Or ensure it is listed in your package.json dependencies.`;

    logger.error(`Missing dependency: ${name}`, { installCommand });
    throw new Error(errorMessage);
  }
}

/**
 * Check multiple dependencies at once
 * @param dependencies - Array of {name, installCommand} objects
 * @returns Object with results for each dependency
 */
export function checkDependencies(
  dependencies: Array<{ name: string; installCommand: string }>
): {
  allAvailable: boolean;
  missing: Array<{ name: string; installCommand: string }>;
  available: string[];
} {
  const missing: Array<{ name: string; installCommand: string }> = [];
  const available: string[] = [];

  for (const dep of dependencies) {
    if (checkDependency(dep.name)) {
      available.push(dep.name);
    } else {
      missing.push(dep);
    }
  }

  return {
    allAvailable: missing.length === 0,
    missing,
    available,
  };
}

/**
 * Ensure multiple dependencies are available
 * @param dependencies - Array of {name, installCommand} objects
 * @throws Error with installation instructions for all missing dependencies
 */
export function ensureDependencies(
  dependencies: Array<{ name: string; installCommand: string }>
): void {
  const result = checkDependencies(dependencies);

  if (!result.allAvailable) {
    const missingList = result.missing
      .map((dep) => `  - ${dep.name}: ${dep.installCommand}`)
      .join("\n");

    const errorMessage =
      `Missing required dependencies:\n${missingList}\n\n` +
      `Install all missing dependencies with the commands above.`;

    logger.error("Multiple dependencies missing", { missing: result.missing });
    throw new Error(errorMessage);
  }
}

/**
 * Check if TypeScript is available
 * @returns true if TypeScript can be resolved
 */
export function isTypeScriptAvailable(): boolean {
  return checkDependency("typescript");
}

/**
 * Ensure TypeScript is available
 * @throws Error with installation instructions if TypeScript is missing
 */
export function ensureTypeScript(): void {
  ensureDependency("typescript", "npm install typescript");
}

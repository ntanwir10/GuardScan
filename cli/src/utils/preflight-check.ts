/**
 * Pre-flight Dependency Check Utility
 * 
 * Validates that all required runtime dependencies are available before
 * command execution. Provides summary of missing dependencies with
 * installation instructions.
 */

import { checkDependencies, ensureDependencies } from './dependency-checker';
import { createDebugLogger } from './debug-logger';

const logger = createDebugLogger('preflight-check');

/**
 * Required dependencies for GuardScan CLI
 */
export const REQUIRED_DEPENDENCIES = [
  {
    name: 'typescript',
    installCommand: 'npm install typescript',
    description: 'Required for AST parsing of TypeScript/JavaScript files',
  },
];

/**
 * Optional dependencies (features work without them but may be degraded)
 */
export const OPTIONAL_DEPENDENCIES = [
  // Add optional dependencies here if needed in the future
];

/**
 * Check all required dependencies
 * @returns Object with check results
 */
export function checkAllDependencies(): {
  allAvailable: boolean;
  missing: Array<{ name: string; installCommand: string; description: string }>;
  available: string[];
} {
  logger.debug('Running preflight dependency check');

  const result = checkDependencies(
    REQUIRED_DEPENDENCIES.map(dep => ({
      name: dep.name,
      installCommand: dep.installCommand,
    }))
  );

  const missingWithDescription = result.missing.map(missingDep => {
    const fullDep = REQUIRED_DEPENDENCIES.find(d => d.name === missingDep.name);
    return {
      name: missingDep.name,
      installCommand: missingDep.installCommand,
      description: fullDep?.description || 'Required dependency',
    };
  });

  return {
    allAvailable: result.allAvailable,
    missing: missingWithDescription,
    available: result.available,
  };
}

/**
 * Ensure all required dependencies are available
 * @throws Error with installation instructions if any dependencies are missing
 */
export function ensureAllDependencies(): void {
  logger.debug('Ensuring all dependencies are available');

  ensureDependencies(
    REQUIRED_DEPENDENCIES.map(dep => ({
      name: dep.name,
      installCommand: dep.installCommand,
    }))
  );
}

/**
 * Check dependencies for a specific command
 * @param commandName - Name of the command
 * @param requiredDeps - Array of dependency names required for this command
 * @returns true if all dependencies are available, false otherwise
 */
export function checkCommandDependencies(
  commandName: string,
  requiredDeps: string[]
): boolean {
  logger.debug(`Checking dependencies for command: ${commandName}`, {
    requiredDeps,
  });

  const depsToCheck = REQUIRED_DEPENDENCIES.filter(dep =>
    requiredDeps.includes(dep.name)
  );

  if (depsToCheck.length === 0) {
    return true; // No specific dependencies required
  }

  const result = checkDependencies(
    depsToCheck.map(dep => ({
      name: dep.name,
      installCommand: dep.installCommand,
    }))
  );

  if (!result.allAvailable) {
    logger.warn(`Missing dependencies for command ${commandName}`, {
      missing: result.missing,
    });
  }

  return result.allAvailable;
}

/**
 * Display dependency status to user
 * @param checkResult - Result from checkAllDependencies()
 */
export function displayDependencyStatus(checkResult: {
  allAvailable: boolean;
  missing: Array<{ name: string; installCommand: string; description: string }>;
  available: string[];
}): void {
  if (checkResult.allAvailable) {
    return; // All good, no need to display anything
  }

  console.error('\n⚠️  Missing Required Dependencies:\n');
  
  checkResult.missing.forEach(dep => {
    console.error(`  ✗ ${dep.name}`);
    console.error(`    ${dep.description}`);
    console.error(`    Install with: ${dep.installCommand}\n`);
  });

  console.error(
    'Some GuardScan features may not work correctly without these dependencies.\n'
  );
}


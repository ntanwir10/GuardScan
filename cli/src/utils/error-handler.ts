import chalk from 'chalk';
import { createDebugLogger } from './debug-logger';

const logger = createDebugLogger('error-handler');

export class GuardScanError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'GuardScanError';
  }
}

export function logError(context: string, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(`[${context}] Error:`, err.message);
}

export function handleAsyncError<T>(
  promise: Promise<T>,
  context: string,
  fallback: T
): Promise<T> {
  return promise.catch((error) => {
    logError(context, error);
    return fallback;
  });
}

/**
 * Centralized command error handler
 * Provides consistent error handling across all CLI commands
 */
export function handleCommandError(
  error: unknown,
  context: string,
  exitCode: number = 1
): never {
  // Log error with debug logger
  logger.error(`Command error in ${context}`, error);

  // Determine error type and provide appropriate message
  let userMessage: string;
  let details: string | undefined;

  if (error instanceof GuardScanError) {
    // Custom GuardScan errors
    userMessage = error.message;
    if (error.cause) {
      details = error.cause.message;
    }
  } else if (error instanceof Error) {
    // Standard JavaScript errors
    const errorMessage = error.message.toLowerCase();

    // Network errors
    if (
      errorMessage.includes('network') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('enotfound')
    ) {
      userMessage = 'Network error: Unable to connect to the service';
      details = error.message;
    }
    // File system errors
    else if (
      errorMessage.includes('enoent') ||
      errorMessage.includes('file') ||
      errorMessage.includes('directory')
    ) {
      userMessage = 'File system error: File or directory not found';
      details = error.message;
    }
    // Permission errors
    else if (
      errorMessage.includes('eperm') ||
      errorMessage.includes('eacces') ||
      errorMessage.includes('permission')
    ) {
      userMessage = 'Permission error: Insufficient permissions';
      details = error.message;
    }
    // Validation errors
    else if (
      errorMessage.includes('invalid') ||
      errorMessage.includes('validation') ||
      errorMessage.includes('required')
    ) {
      userMessage = 'Validation error: Invalid input or configuration';
      details = error.message;
    }
    // Generic error
    else {
      userMessage = error.message || 'An unexpected error occurred';
    }
  } else {
    // Unknown error type
    userMessage = String(error) || 'An unexpected error occurred';
  }

  // Display user-friendly error message
  console.error(chalk.red(`\n✗ ${context} failed: ${userMessage}`));
  if (details && process.env.GUARDSCAN_DEBUG === 'true') {
    console.error(chalk.gray(`  Details: ${details}`));
  }

  // Exit with specified code
  process.exit(exitCode);
}


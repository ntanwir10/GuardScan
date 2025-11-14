import cliProgress from 'cli-progress';
import chalk from 'chalk';

/**
 * Create a single progress bar
 */
export function createProgressBar(total: number, label: string): cliProgress.SingleBar {
  const bar = new cliProgress.SingleBar({
    format: chalk.cyan(label) + ' |{bar}| {percentage}% | {value}/{total} {status}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: true,
  });

  bar.start(total, 0, { status: '' });
  return bar;
}

/**
 * Create a multi-bar for parallel operations
 */
export function createMultiBar(): cliProgress.MultiBar {
  return new cliProgress.MultiBar({
    format: chalk.cyan('{label}') + ' |{bar}| {percentage}% | {status}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: false,
  }, cliProgress.Presets.shades_classic);
}

/**
 * Track progress for an array of promises
 */
export async function trackPromises<T>(
  promises: Promise<T>[],
  label: string,
  onProgress?: (completed: number, total: number) => void
): Promise<PromiseSettledResult<T>[]> {
  const total = promises.length;
  let completed = 0;

  const progressBar = createProgressBar(total, label);

  // Wrap each promise to track completion
  const trackedPromises = promises.map((promise, index) =>
    promise
      .then((result) => {
        completed++;
        progressBar.update(completed, { status: `Task ${completed}/${total} complete` });
        if (onProgress) onProgress(completed, total);
        return result;
      })
      .catch((error) => {
        completed++;
        progressBar.update(completed, { status: `Task ${completed}/${total} (${index + 1} failed)` });
        if (onProgress) onProgress(completed, total);
        throw error;
      })
  );

  const results = await Promise.allSettled(trackedPromises);
  progressBar.stop();

  return results;
}

/**
 * Execute sequential steps with progress tracking
 */
export async function trackSequentialSteps<T>(
  steps: Array<{ name: string; fn: () => Promise<T> }>,
  label: string
): Promise<T[]> {
  const progressBar = createProgressBar(steps.length, label);
  const results: T[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    progressBar.update(i, { status: step.name });

    try {
      const result = await step.fn();
      results.push(result);
      progressBar.update(i + 1, { status: `✓ ${step.name}` });
    } catch (error) {
      progressBar.update(i + 1, { status: `✗ ${step.name}` });
      throw error;
    }
  }

  progressBar.stop();
  return results;
}

/**
 * Create a simple percentage indicator without a bar
 */
export class PercentageTracker {
  private total: number;
  private completed: number = 0;
  private label: string;

  constructor(total: number, label: string) {
    this.total = total;
    this.label = label;
  }

  update(completed: number, status?: string): void {
    this.completed = completed;
    const percentage = Math.round((completed / this.total) * 100);
    const statusText = status ? ` - ${status}` : '';
    process.stdout.write(`\r${chalk.cyan(this.label)} ${percentage}%${statusText}`);
  }

  increment(status?: string): void {
    this.update(this.completed + 1, status);
  }

  finish(message?: string): void {
    const finalMessage = message || 'Complete';
    console.log(`\r${chalk.green('✓')} ${this.label} 100% - ${finalMessage}`);
  }
}

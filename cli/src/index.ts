#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init';
import { runCommand } from './commands/run';
import { securityCommand } from './commands/security';
import { testCommand } from './commands/test';
import { sbomCommand } from './commands/sbom';
import { perfCommand } from './commands/perf';
import { configCommand } from './commands/config';
import { statusCommand } from './commands/status';
import { resetCommand } from './commands/reset';
import { checkForUpdates } from './utils/version';

const program = new Command();

program
  .name('ai-review')
  .description('Privacy-first AI Code Review CLI')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize AI Code Review (generates client_id)')
  .action(initCommand);

program
  .command('run')
  .description('Perform code review using selected AI model')
  .option('-f, --files <patterns...>', 'Specific files or patterns to review')
  .option('--no-cloud', 'Skip cloud credit validation')
  .action(runCommand);

program
  .command('security')
  .description('Run security vulnerability scan')
  .option('-f, --files <patterns...>', 'Specific files or patterns to scan')
  .option('--licenses', 'Include license compliance scanning')
  .action(securityCommand);

program
  .command('test')
  .description('Run tests and code quality analysis')
  .option('--coverage', 'Include code coverage analysis')
  .option('--metrics', 'Analyze code metrics only')
  .option('--smells', 'Detect code smells only')
  .option('--lint', 'Run linters only')
  .option('--all', 'Run all quality checks')
  .action(testCommand);

program
  .command('sbom')
  .description('Generate Software Bill of Materials (SBOM)')
  .option('-o, --output <path>', 'Output file path')
  .option('-f, --format <format>', 'SBOM format (spdx or cyclonedx)', 'spdx')
  .action(sbomCommand);

program
  .command('perf')
  .description('Run performance testing')
  .option('--load', 'Run load test (default)')
  .option('--stress', 'Run stress test (increasing load)')
  .option('--web <url>', 'Run Lighthouse audit on URL')
  .option('--baseline', 'Save results as baseline')
  .option('--compare', 'Compare with baseline')
  .option('--duration <duration>', 'Test duration (e.g., 30s, 1m)', '30s')
  .option('--vus <number>', 'Virtual users', '10')
  .option('--url <url>', 'Target URL for load/stress test')
  .action(perfCommand);

program
  .command('config')
  .description('Configure AI provider and settings')
  .option('-p, --provider <provider>', 'Set AI provider')
  .option('-k, --key <key>', 'Set API key')
  .option('--show', 'Show current configuration')
  .action(configCommand);

program
  .command('status')
  .description('Show current credits, provider, and repo info')
  .action(statusCommand);

program
  .command('reset')
  .description('Clear local context and cache')
  .option('--all', 'Reset all configuration including client_id')
  .action(resetCommand);

// Check for updates on startup (non-blocking)
checkForUpdates().catch(() => {
  // Silent fail
});

program.parse();

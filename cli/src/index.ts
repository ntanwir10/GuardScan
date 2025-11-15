#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init';
import { runCommand } from './commands/run';
import { scanCommand } from './commands/scan';
import { securityCommand } from './commands/security';
import { testCommand } from './commands/test';
import { sbomCommand } from './commands/sbom';
import { perfCommand } from './commands/perf';
import { mutationCommand } from './commands/mutation';
import { rulesCommand } from './commands/rules';
import { configCommand } from './commands/config';
import { statusCommand } from './commands/status';
import { resetCommand } from './commands/reset';
import { commitCommand } from './commands/commit';
import { explainCommand } from './commands/explain';
import { checkForUpdates } from './utils/version';
import { displayLogo } from './utils/ascii-art';

const program = new Command();

program
  .name('guardscan')
  .description('GuardScan - Privacy-first AI Code Review CLI with comprehensive security scanning')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize GuardScan (optional - generates client_id for telemetry)')
  .action(initCommand);

program
  .command('run')
  .description('Code review (FREE tier without API key, AI-enhanced with configuration)')
  .option('-f, --files <patterns...>', 'Specific files or patterns to review')
  .option('--with-ai', 'Use AI enhancement (requires API key)', true)
  .option('--no-cloud', 'Skip cloud credit validation')
  .action(runCommand);

program
  .command('scan')
  .description('Comprehensive scan - runs all security and quality checks in parallel')
  .option('--skip-tests', 'Skip test execution and quality analysis')
  .option('--skip-perf', 'Skip performance testing')
  .option('--skip-mutation', 'Skip mutation testing')
  .option('--skip-ai', 'Skip AI code review')
  .option('--coverage', 'Include code coverage analysis')
  .option('--licenses', 'Include license compliance scanning')
  .option('--no-cloud', 'Skip cloud credit validation')
  .action(scanCommand);

program
  .command('security')
  .description('Run security vulnerability scan')
  .option('-f, --files <patterns...>', 'Specific files or patterns to scan')
  .option('--licenses', 'Include license compliance scanning')
  .option('--ai-fix', 'Generate AI-powered fix suggestions')
  .option('--interactive', 'Interactively review and apply fixes')
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
  .command('mutation')
  .description('Run mutation testing to assess test quality')
  .option('--framework <framework>', 'Mutation framework (stryker, mutmut, pitest, auto)', 'auto')
  .option('--threshold <number>', 'Minimum mutation score (0-100)', '80')
  .option('--files <files>', 'Comma-separated list of files to mutate')
  .option('--test-command <command>', 'Custom test command')
  .option('--timeout <ms>', 'Timeout per test in milliseconds', '5000')
  .action(mutationCommand);

program
  .command('rules')
  .description('Run custom rule engine with YAML-based rules')
  .option('--list', 'List all available rules')
  .option('--run', 'Run rules (default)', true)
  .option('--fix', 'Apply auto-fixes to violations')
  .option('--rule-ids <ids>', 'Comma-separated list of rule IDs to run')
  .option('--files <files>', 'Comma-separated list of files to scan')
  .option('--custom-rules <dir>', 'Directory containing custom YAML rules')
  .option('--export <rule:path>', 'Export a rule to file (format: ruleId:outputPath)')
  .action(rulesCommand);

program
  .command('config')
  .description('Configure AI provider and settings (optional - unlocks PAID tier features)')
  .option('-p, --provider <provider>', 'Set AI provider (openai, anthropic, google, ollama)')
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

program
  .command('commit')
  .description('Generate AI-powered commit messages')
  .option('--ai', 'Use AI to generate commit message', true)
  .option('--auto', 'Automatically commit with generated message')
  .option('--scope <scope>', 'Specify commit scope')
  .option('--type <type>', 'Specify commit type (feat, fix, docs, etc.)')
  .option('--no-body', 'Skip commit body (subject only)')
  .action(commitCommand);

program
  .command('explain <target>')
  .description('Explain code using AI (function, class, file, or theme)')
  .option('-l, --level <level>', 'Explanation level: brief, detailed, comprehensive', 'detailed')
  .option('-t, --type <type>', 'Target type: function, class, file, module', 'function')
  .option('-o, --output <path>', 'Save explanation to file')
  .action(explainCommand);

// Display logo when showing help or version
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h') || args.includes('--version') || args.includes('-V')) {
  displayLogo('Privacy-First AI Code Review & Security Scanning');
}

// Check for updates on startup (non-blocking)
checkForUpdates().catch(() => {
  // Silent fail
});

program.parse();

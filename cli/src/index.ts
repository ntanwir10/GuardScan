#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init";
import { runCommand } from "./commands/run";
import { scanCommand } from "./commands/scan";
import { securityCommand } from "./commands/security";
import { testCommand } from "./commands/test";
import { sbomCommand } from "./commands/sbom";
import { perfCommand } from "./commands/perf";
import { mutationCommand } from "./commands/mutation";
import { rulesCommand } from "./commands/rules";
import { configCommand } from "./commands/config";
import { statusCommand } from "./commands/status";
import { resetCommand } from "./commands/reset";
import { commitCommand } from "./commands/commit";
import { explainCommand } from "./commands/explain";
import { testGenCommand } from "./commands/test-gen";
import { docsCommand } from "./commands/docs";
import { chatCommand } from "./commands/chat";
import { refactorCommand } from "./commands/refactor";
import { threatModelCommand } from "./commands/threat-model";
import { migrateCommand } from "./commands/migrate";
import { reviewCommand } from "./commands/review";
import { checkForUpdates } from "./utils/version";
import { displayLogo } from "./utils/ascii-art";

const program = new Command();
const packageJson = require("../package.json");

program
  .name("guardscan")
  .description(
    "GuardScan - Privacy-first AI Code Review CLI with comprehensive security scanning"
  )
  .version(packageJson.version)
  .option("--no-telemetry", "Disable telemetry for this command");

program
  .command("init")
  .description(
    "Initialize GuardScan (optional - generates client_id for telemetry)"
  )
  .action(initCommand);

program
  .command("run")
  .description(
    "Code review (FREE tier without API key, AI-enhanced with configuration)"
  )
  .option("-f, --files <patterns...>", "Specific files or patterns to review")
  .option("--with-ai", "Use AI enhancement (requires API key)", true)
  .option("--no-cloud", "Skip cloud credit validation")
  .action(runCommand);

program
  .command("scan")
  .description(
    "Comprehensive scan - runs all security and quality checks in parallel"
  )
  .option("--skip-tests", "Skip test execution and quality analysis")
  .option("--skip-perf", "Skip performance testing")
  .option("--skip-mutation", "Skip mutation testing")
  .option("--skip-ai", "Skip AI code review")
  .option("--coverage", "Include code coverage analysis")
  .option("--licenses", "Include license compliance scanning")
  .option("--no-cloud", "Skip cloud credit validation")
  .action(scanCommand);

program
  .command("security")
  .description("Run security vulnerability scan")
  .option("-f, --files <patterns...>", "Specific files or patterns to scan")
  .option("--licenses", "Include license compliance scanning")
  .option("--ai-fix", "Generate AI-powered fix suggestions")
  .option("--interactive", "Interactively review and apply fixes")
  .option("--debug", "Enable verbose debug logging")
  .action((options) => {
    // Set GUARDSCAN_DEBUG environment variable if --debug flag is present
    if (options.debug) {
      process.env.GUARDSCAN_DEBUG = "true";
    }
    securityCommand(options);
  });

program
  .command("test")
  .description("Run tests and code quality analysis")
  .option("--coverage", "Include code coverage analysis")
  .option("--metrics", "Analyze code metrics only")
  .option("--smells", "Detect code smells only")
  .option("--lint", "Run linters only")
  .option("--all", "Run all quality checks")
  .action(testCommand);

program
  .command("sbom")
  .description("Generate Software Bill of Materials (SBOM)")
  .option("-o, --output <path>", "Output file path")
  .option("-f, --format <format>", "SBOM format (spdx or cyclonedx)", "spdx")
  .action(sbomCommand);

program
  .command("perf")
  .description("Run performance testing")
  .option("--load", "Run load test (default)")
  .option("--stress", "Run stress test (increasing load)")
  .option("--web <url>", "Run Lighthouse audit on URL")
  .option("--baseline", "Save results as baseline")
  .option("--compare", "Compare with baseline")
  .option("--duration <duration>", "Test duration (e.g., 30s, 1m)", "30s")
  .option("--vus <number>", "Virtual users", "10")
  .option("--url <url>", "Target URL for load/stress test")
  .action(perfCommand);

program
  .command("mutation")
  .description("Run mutation testing to assess test quality")
  .option(
    "--framework <framework>",
    "Mutation framework (stryker, mutmut, pitest, auto)",
    "auto"
  )
  .option("--threshold <number>", "Minimum mutation score (0-100)", "80")
  .option("--files <files>", "Comma-separated list of files to mutate")
  .option("--test-command <command>", "Custom test command")
  .option("--timeout <ms>", "Timeout per test in milliseconds", "5000")
  .action(mutationCommand);

program
  .command("rules")
  .description("Run custom rule engine with YAML-based rules")
  .option("--list", "List all available rules")
  .option("--run", "Run rules (default)", true)
  .option("--fix", "Apply auto-fixes to violations")
  .option("--rule-ids <ids>", "Comma-separated list of rule IDs to run")
  .option("--files <files>", "Comma-separated list of files to scan")
  .option("--custom-rules <dir>", "Directory containing custom YAML rules")
  .option(
    "--export <rule:path>",
    "Export a rule to file (format: ruleId:outputPath)"
  )
  .action(rulesCommand);

program
  .command("config")
  .description(
    "Configure AI provider and settings (optional - unlocks PAID tier features)"
  )
  .option(
    "-p, --provider <provider>",
    "Set AI provider (openai, anthropic, google, ollama)"
  )
  .option("-k, --key <key>", "Set API key")
  .option("--show", "Show current configuration")
  .action(configCommand);

program
  .command("status")
  .description("Show current credits, provider, and repo info")
  .action(statusCommand);

program
  .command("reset")
  .description("Clear local context and cache")
  .option("--all", "Reset all configuration including client_id")
  .option("--force", "Skip confirmation prompts")
  .action(resetCommand);

program
  .command("commit")
  .description("Generate AI-powered commit messages")
  .option("--ai", "Use AI to generate commit message", true)
  .option("--auto", "Automatically commit with generated message")
  .option("--scope <scope>", "Specify commit scope")
  .option("--type <type>", "Specify commit type (feat, fix, docs, etc.)")
  .option("--no-body", "Skip commit body (subject only)")
  .action(commitCommand);

program
  .command("explain <target>")
  .description("Explain code using AI (function, class, file, or theme)")
  .option(
    "-l, --level <level>",
    "Explanation level: brief, detailed, comprehensive",
    "detailed"
  )
  .option(
    "-t, --type <type>",
    "Target type: function, class, file, module",
    "function"
  )
  .option("-o, --output <path>", "Save explanation to file")
  .action(explainCommand);

program
  .command("test-gen")
  .description("Generate tests using AI (Phase 3 feature)")
  .option("--function <name>", "Generate tests for a specific function")
  .option("--class <name>", "Generate tests for a specific class")
  .option("--file <path>", "Generate tests for all exports in a file")
  .option(
    "--framework <framework>",
    "Test framework (jest, vitest, mocha, pytest, auto)",
    "auto"
  )
  .option("-o, --output <path>", "Custom output path for test file")
  .option("--coverage", "Show coverage estimation")
  .action(testGenCommand);

program
  .command("docs")
  .description("Generate documentation using AI (Phase 3 feature)")
  .option(
    "-t, --type <type>",
    "Documentation type: readme, api, architecture, contributing",
    "readme"
  )
  .option("-o, --output <path>", "Custom output path")
  .option("--diagrams", "Include architecture diagrams (Mermaid)", true)
  .option("--examples", "Include code examples", true)
  .option(
    "--audience <audience>",
    "Target audience: developer, user, contributor",
    "user"
  )
  .action(docsCommand);

program
  .command("chat")
  .description("Interactive AI chat about your codebase (Phase 4 RAG feature)")
  .option("-m, --model <model>", "Override AI model")
  .option("-t, --temperature <temp>", "Temperature 0-1", "0.7")
  .option("--rebuild", "Rebuild embeddings index")
  .option(
    "--embedding-provider <provider>",
    "Embedding provider: openai, gemini, ollama, claude, or lmstudio (auto-selected based on configured AI provider and fallback if not specified)",
    undefined
  )
  .option("--session <path>", "Load existing session from file")
  .option("--export <path>", "Export conversation to file")
  .action(chatCommand);

program
  .command("refactor")
  .description("AI-powered refactoring suggestions (Phase 5 feature)")
  .option("-f, --file <path>", "Specific file to analyze")
  .option("--function <name>", "Analyze specific function")
  .option("--class <name>", "Analyze specific class")
  .option("--smell <type>", "Target specific code smell type")
  .option("--pattern <pattern>", "Suggest specific design pattern")
  .option("--analyze", "Analyze code smells only")
  .option("--apply", "Generate refactored code")
  .option("-i, --interactive", "Interactive refactoring mode")
  .option("--report", "Generate full refactoring report")
  .option("-o, --output <path>", "Save report to file")
  .action(refactorCommand);

program
  .command("threat-model")
  .description(
    "AI-powered threat modeling with STRIDE analysis (Phase 5 feature)"
  )
  .option("-f, --file <path>", "Specific file to analyze")
  .option(
    "-c, --category <category>",
    "Focus on specific STRIDE category (spoofing, tampering, repudiation, information-disclosure, denial-of-service, elevation-of-privilege)"
  )
  .option("--flows", "Include data flow mapping", true)
  .option("--diagram", "Generate threat model diagram")
  .option(
    "--focus <area>",
    "Focus area: authentication, data-protection, api-security, or all"
  )
  .option(
    "-s, --severity <level>",
    "Minimum severity level: low, medium, high, critical"
  )
  .option("--report", "Generate full threat model report")
  .option("-o, --output <path>", "Save report to file")
  .action(threatModelCommand);

program
  .command("migrate")
  .description("AI-powered code migration assistant (Phase 5 feature)")
  .option(
    "-t, --type <type>",
    "Migration type: framework, language, modernization, dependency"
  )
  .option(
    "--target <target>",
    "Migration target (e.g., react-class-to-hooks, typescript, es5-to-es6)"
  )
  .option("--from <source>", "Source framework/language (e.g., react, es5)")
  .option("--to <target>", "Target framework/language (e.g., vue, es6)")
  .option("-f, --file <path>", "Specific file to migrate")
  .option("--dry-run", "Preview changes without applying them", true)
  .option("--auto-fix", "Automatically apply fixes")
  .option("--backup", "Create backups of original files", true)
  .option("--report", "Generate migration report")
  .option("-o, --output <path>", "Save report to file")
  .action(migrateCommand);

program
  .command("review")
  .description("AI-powered code review for git changes (Phase 5 feature)")
  .option("--base <ref>", "Base git reference (default: HEAD)", "HEAD")
  .option("--head <ref>", "Head git reference for comparison")
  .option("-f, --file <path>", "Review specific file only")
  .option(
    "-s, --severity <level>",
    "Minimum severity level: critical, high, medium, low, info"
  )
  .option(
    "-c, --category <category>",
    "Filter by category: bug, security, performance, maintainability, style, documentation, testing, accessibility, best-practice"
  )
  .option("--report", "Generate full detailed report")
  .option("-o, --output <path>", "Save report to file")
  .action(reviewCommand);

// Display logo when showing help or version
const args = process.argv.slice(2);
if (
  args.length === 0 ||
  args.includes("--help") ||
  args.includes("-h") ||
  args.includes("--version") ||
  args.includes("-V")
) {
  displayLogo("Privacy-First AI Code Review & Security Scanning");
}

// Check for updates on startup (non-blocking)
checkForUpdates().catch(() => {
  // Silent fail
});

// Parse arguments and set global telemetry flag
program.parse();
const globalOpts = program.opts();
if (globalOpts.noTelemetry) {
  // Set environment variable so telemetry can check it
  process.env.GUARDSCAN_NO_TELEMETRY = "true";
}

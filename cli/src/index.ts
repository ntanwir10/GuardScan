#!/usr/bin/env node

import { Command } from "commander";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require("../package.json") as { version: string };

function applyEarlyEnvironmentFlags(args: string[]): void {
  if (args.includes("--no-telemetry")) {
    process.env.GUARDSCAN_NO_TELEMETRY = "true";
  }

  if (args.includes("--no-cache")) {
    process.env.GUARDSCAN_NO_CACHE = "true";
  }

  if (args.includes("--offline") || args.includes("--no-cloud")) {
    process.env.GUARDSCAN_OFFLINE = "true";
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  applyEarlyEnvironmentFlags(args);

  const [
    { initCommand },
    { runCommand },
    { scanCommand },
    { securityCommand },
    { testCommand },
    { sbomCommand },
    { perfCommand },
    { mutationCommand },
    { rulesCommand },
    { configCommand },
    { statusCommand },
    { resetCommand },
    { commitCommand },
    { explainCommand },
    { testGenCommand },
    { docsCommand },
    { chatCommand },
    { refactorCommand },
    { threatModelCommand },
    { migrateCommand },
    { reviewCommand },
    { createModelsCommand },
    { createRoutingCommand },
    { createBudgetCommand },
    { createMetricsCommand },
    { createCacheCommand },
    { createTelemetryCommand },
    { createVulnerabilityCommand },
    { checkForUpdates },
    { displayLogo },
  ] = await Promise.all([
    import("./commands/init"),
    import("./commands/run"),
    import("./commands/scan"),
    import("./commands/security"),
    import("./commands/test"),
    import("./commands/sbom"),
    import("./commands/perf"),
    import("./commands/mutation"),
    import("./commands/rules"),
    import("./commands/config"),
    import("./commands/status"),
    import("./commands/reset"),
    import("./commands/commit"),
    import("./commands/explain"),
    import("./commands/test-gen"),
    import("./commands/docs"),
    import("./commands/chat"),
    import("./commands/refactor"),
    import("./commands/threat-model"),
    import("./commands/migrate"),
    import("./commands/review"),
    import("./commands/models"),
    import("./commands/routing"),
    import("./commands/budget"),
    import("./commands/metrics"),
    import("./commands/cache"),
    import("./commands/telemetry"),
    import("./commands/vuln"),
    import("./utils/version"),
    import("./utils/ascii-art"),
  ]);

  const program = new Command();

  program
    .name("guardscan")
    .description(
      "GuardScan - Privacy-first AI Code Review CLI with comprehensive security scanning"
    )
    .version(packageJson.version)
    .option("--no-telemetry", "Disable telemetry for this command")
    .option("--no-cache", "Disable response, semantic, and advisory caches for this command")
    .option("--offline", "Block cloud and GuardScan network services for this command")
    .option("--no-cloud", "Deprecated alias for --offline");

  program
    .command("init")
    .description("Initialize GuardScan local configuration")
    .action(initCommand);

  program
    .command("run")
    .description(
      "Run local code review with optional AI enhancement from your configured provider"
    )
    .option("-f, --files <patterns...>", "Specific files or patterns to review")
    .option("--with-ai", "Use AI enhancement when a provider is configured", true)
    .option("--offline", "Block cloud providers for this run")
    .option("--no-cloud", "Deprecated alias for --offline")
    .option("--cve", "Opt in to exact-version dependency vulnerability scanning")
    .option("--allow-partial", "Allow incomplete CVE coverage")
    .action(runCommand);

  program
    .command("scan")
    .description(
      "Comprehensive scan - runs security and quality checks in parallel"
    )
    .option("--skip-tests", "Skip test execution")
    .option("--skip-perf", "Skip performance testing")
    .option("--skip-mutation", "Skip mutation testing")
    .option("--skip-ai", "Skip AI code review")
    .option("--run-project-code", "Run repository tests and linters (disabled by default)")
    .option("--isolate-project-network", "Run project code in an OS network sandbox (fails if unavailable)")
    .option("--coverage", "Include code coverage analysis")
    .option("--licenses", "Include license compliance scanning")
    .option("--cve", "Include exact-version dependency vulnerability scanning")
    .option("--no-cve", "Skip dependency vulnerability scanning")
    .option("--scope <scope>", "Dependency scope for CVE scanning (all or runtime)")
    .option("--allow-partial", "Allow incomplete scanner coverage without an operational failure")
    .option("--concurrency <number>", "Maximum number of scanners to run concurrently", "4")
    .option("--ci", "Enable CI-friendly output and exit-code policy")
    .option("--offline", "Skip network-backed checks for this run")
    .option("--no-cloud", "Deprecated alias for --offline")
    .option("--no-cache", "Disable response, semantic, and vulnerability snapshot caches")
    .option("--format <format>", "Report format (markdown, json, sarif)")
    .option("-o, --output <path>", "Output file path")
    .option("--fail-on <severity>", "Fail when findings meet severity (critical, high, medium, low, info)")
    .option("--max-findings <number>", "Fail when finding count exceeds this number")
    .action(scanCommand);

  program
    .command("security")
    .description("Run local heuristic security checks")
    .option("-f, --files <patterns...>", "Specific files or patterns to scan")
    .option("--licenses", "Include license compliance scanning")
    .option("--cve", "Include exact-version dependency vulnerability scanning", true)
    .option("--no-cve", "Skip dependency vulnerability scanning")
    .option("--scope <scope>", "Dependency scope for CVE scanning (all or runtime)")
    .option("--allow-partial", "Allow incomplete scanner coverage without an operational failure")
    .option("--concurrency <number>", "Maximum number of scanners to run concurrently", "4")
    .option("--ai-fix", "Generate AI-powered fix suggestions")
    .option("--interactive", "Interactively review and apply fixes")
    .option("--debug", "Enable verbose debug logging")
    .option("--ci", "Enable CI-friendly output and exit-code policy")
    .option("--offline", "Skip network-backed checks for this run")
    .option("--no-cloud", "Deprecated alias for --offline")
    .option("--no-cache", "Disable response, semantic, and vulnerability snapshot caches")
    .option("--format <format>", "Report format (markdown, json, sarif)")
    .option("-o, --output <path>", "Output file path")
    .option("--fail-on <severity>", "Fail when findings meet severity (critical, high, medium, low, info)")
    .option("--max-findings <number>", "Fail when finding count exceeds this number")
    .action(securityCommand);

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
    .option("--offline", "Skip network-backed checks for this command")
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
    .option("--test-command <command>", "Custom mutmut test command")
    .option(
      "--allow-unsafe-test-command",
      "Allow mutmut to run a custom test command string from --test-command"
    )
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
    .description("Configure AI provider, privacy controls, and local settings")
    .option(
      "-p, --provider <provider>",
      "Set AI provider (openai, claude, gemini, ollama, lmstudio, openrouter, none)"
    )
    .option("-k, --key <key>", "Set API key")
    .option("--telemetry <enabled>", "Enable or disable telemetry (true or false)")
    .option("--offline <enabled>", "Enable or disable offline mode (true or false)")
    .option("--show", "Show current configuration")
    .action(configCommand);

  program
    .command("status")
    .description("Show provider, repository, and local configuration status")
    .option("--check-network", "Check internet connectivity")
    .action(statusCommand);

  program
    .command("reset")
    .description("Clear local context and cache")
    .option("--all", "Reset all local configuration and state")
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
    .description("Generate tests using AI")
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
    .description("Generate documentation using AI")
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
    .description("Interactive AI chat about your codebase")
    .option("-m, --model <model>", "Override AI model")
    .option("-t, --temperature <temp>", "Temperature 0-1", "0.7")
    .option("--rebuild", "Rebuild embeddings index")
    .option(
      "--embedding-provider <provider>",
      "Embedding provider: openai, gemini, ollama, claude, or lmstudio (auto-selected when omitted)",
      undefined
    )
    .option("--session <path>", "Load existing session from file")
    .option("--export <path>", "Export conversation to file")
    .action(chatCommand);

  program
    .command("refactor")
    .description("AI-powered refactoring suggestions")
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
    .description("AI-powered threat modeling with STRIDE analysis")
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
    .description("AI-powered code migration assistant")
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
    .description("AI-powered code review for git changes")
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

  program.addCommand(createModelsCommand());
  program.addCommand(createRoutingCommand());
  program.addCommand(createBudgetCommand());
  program.addCommand(createMetricsCommand());
  program.addCommand(createCacheCommand());
  program.addCommand(createTelemetryCommand());
  program.addCommand(createVulnerabilityCommand());

  if (
    args.length === 0 ||
    args.includes("--help") ||
    args.includes("-h") ||
    args.includes("--version") ||
    args.includes("-V")
  ) {
    displayLogo("Privacy-First AI Code Review & Security Scanning");
  }

  checkForUpdates().catch(() => {
    // Silent fail
  });

  program.parse();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

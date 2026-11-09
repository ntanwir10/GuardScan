# Command reference

Generated from `guardscan --help` of the built CLI (GuardScan 1.1.x). Run `guardscan <command> --help` for the same text on your machine.

## Global options

```text
Usage: guardscan [options] [command]

GuardScan - Privacy-first AI Code Review CLI with comprehensive security
scanning

Options:
  -V, --version               output the version number
  --no-telemetry              Disable telemetry for this command
  --no-cache                  Disable response, semantic, and advisory caches
                              for this command
  --offline                   Block cloud and GuardScan network services for
                              this command
  --no-cloud                  Deprecated alias for --offline
  -h, --help                  display help for command

```

## Exit codes

One table for every command. Values come from the CLI source (`cli/src/commands/scan.ts`, `security.ts`, `vuln.ts`, `run.ts`, `utils/error-handler.ts`).

| Code | Meaning | Where it applies |
|---|---|---|
| `0` | The command completed and, where a policy applies, the policy passed. | All commands |
| `1` | Findings violated the policy (`--fail-on`, `--max-findings`, `--max-vulnerabilities`). Other commands also use `1` for errors such as invalid input or missing configuration. | Policy: `scan`, `security`, `vuln`. Errors: most other commands |
| `2` | A required scanner or coverage step failed, or the command itself failed (for example an invalid option value or report format). CVE coverage that is missing, stale or incomplete also exits `2` unless `--allow-partial` is given. | `scan`, `security`, `vuln`, `run` |

When several results apply in one run, the highest code wins. Use `--ci` to opt in to the CI exit-code policy and see [Offline mode and CI](OFFLINE_AND_CI.md).

## Commands

- [`init`](#guardscan-init)
- [`run`](#guardscan-run)
- [`scan`](#guardscan-scan)
- [`security`](#guardscan-security)
- [`test`](#guardscan-test)
- [`sbom`](#guardscan-sbom)
- [`perf`](#guardscan-perf)
- [`mutation`](#guardscan-mutation)
- [`rules`](#guardscan-rules)
- [`config`](#guardscan-config)
- [`status`](#guardscan-status)
- [`reset`](#guardscan-reset)
- [`commit`](#guardscan-commit)
- [`explain`](#guardscan-explain)
- [`test-gen`](#guardscan-test-gen)
- [`docs`](#guardscan-docs)
- [`chat`](#guardscan-chat)
- [`refactor`](#guardscan-refactor)
- [`threat-model`](#guardscan-threat-model)
- [`migrate`](#guardscan-migrate)
- [`review`](#guardscan-review)
- [`models`](#guardscan-models)
- [`routing`](#guardscan-routing)
- [`budget`](#guardscan-budget)
- [`metrics`](#guardscan-metrics)
- [`cache`](#guardscan-cache)
- [`telemetry`](#guardscan-telemetry)
- [`capabilities`](#guardscan-capabilities)
- [`vuln`](#guardscan-vuln)

### `guardscan init`

```text
Usage: guardscan init [options]

Initialize GuardScan local configuration

Options:
  -h, --help  display help for command
```

### `guardscan run`

```text
Usage: guardscan run [options]

Run local code review with optional AI enhancement from your configured
provider

Options:
  -f, --files <patterns...>  Specific files or patterns to review
  --with-ai                  Use AI enhancement when a provider is configured
                             (default: true)
  --offline                  Block cloud providers for this run
  --no-cloud                 Deprecated alias for --offline
  --cve                      Opt in to exact-version dependency vulnerability
                             scanning
  --allow-partial            Allow incomplete CVE coverage
  -h, --help                 display help for command
```

### `guardscan scan`

```text
Usage: guardscan scan [options]

Comprehensive scan - runs security and quality checks in parallel

Options:
  --skip-tests               Skip test execution
  --skip-perf                Skip performance testing
  --skip-mutation            Skip mutation testing
  --skip-ai                  Skip AI code review
  --run-project-code         Run repository tests and linters (disabled by
                             default)
  --isolate-project-network  Run project code in an OS network sandbox (fails
                             if unavailable)
  --coverage                 Include code coverage analysis
  --licenses                 Include license compliance scanning
  --cve                      Include exact-version dependency vulnerability
                             scanning
  --no-cve                   Skip dependency vulnerability scanning
  --scope <scope>            Dependency scope for CVE scanning (all or runtime)
  --allow-partial            Allow incomplete scanner coverage without an
                             operational failure
  --concurrency <number>     Maximum number of scanners to run concurrently
                             (default: "4")
  --ci                       Enable CI-friendly output and exit-code policy
  --offline                  Skip network-backed checks for this run
  --no-cloud                 Deprecated alias for --offline
  --no-cache                 Disable response, semantic, and vulnerability
                             snapshot caches
  --format <format>          Report format (markdown, json, sarif)
  -o, --output <path>        Output file path
  --fail-on <severity>       Fail when findings meet severity (critical, high,
                             medium, low, info)
  --max-findings <number>    Fail when finding count exceeds this number
  -h, --help                 display help for command
```

### `guardscan security`

```text
Usage: guardscan security [options]

Run local heuristic security checks

Options:
  -f, --files <patterns...>  Specific files or patterns to scan
  --licenses                 Include license compliance scanning
  --cve                      Include exact-version dependency vulnerability
                             scanning
  --no-cve                   Skip dependency vulnerability scanning
  --scope <scope>            Dependency scope for CVE scanning (all or runtime)
  --allow-partial            Allow incomplete scanner coverage without an
                             operational failure
  --concurrency <number>     Maximum number of scanners to run concurrently
                             (default: "4")
  --ai-fix                   Generate AI-powered fix suggestions
  --interactive              Interactively review and apply fixes
  --debug                    Enable verbose debug logging
  --ci                       Enable CI-friendly output and exit-code policy
  --offline                  Skip network-backed checks for this run
  --no-cloud                 Deprecated alias for --offline
  --no-cache                 Disable response, semantic, and vulnerability
                             snapshot caches
  --format <format>          Report format (markdown, json, sarif)
  -o, --output <path>        Output file path
  --fail-on <severity>       Fail when findings meet severity (critical, high,
                             medium, low, info)
  --max-findings <number>    Fail when finding count exceeds this number
  -h, --help                 display help for command
```

### `guardscan test`

```text
Usage: guardscan test [options]

Run tests and code quality analysis

Options:
  --coverage  Include code coverage analysis
  --metrics   Analyze code metrics only
  --smells    Detect code smells only
  --lint      Run linters only
  --all       Run all quality checks
  -h, --help  display help for command
```

### `guardscan sbom`

```text
Usage: guardscan sbom [options]

Generate Software Bill of Materials (SBOM)

Options:
  -o, --output <path>    Output file path
  -f, --format <format>  SBOM format (spdx or cyclonedx) (default: "spdx")
  --offline              Skip network-backed checks for this command
  -h, --help             display help for command
```

### `guardscan perf`

```text
Usage: guardscan perf [options]

Run performance testing

Options:
  --load                 Run load test (default)
  --stress               Run stress test (increasing load)
  --web <url>            Run Lighthouse audit on URL
  --baseline             Save results as baseline
  --compare              Compare with baseline
  --duration <duration>  Test duration (e.g., 30s, 1m) (default: "30s")
  --vus <number>         Virtual users (default: "10")
  --url <url>            Target URL for load/stress test
  -h, --help             display help for command
```

### `guardscan mutation`

```text
Usage: guardscan mutation [options]

Run mutation testing to assess test quality

Options:
  --framework <framework>      Mutation framework (stryker, mutmut, pitest,
                               auto) (default: "auto")
  --threshold <number>         Minimum mutation score (0-100) (default: "80")
  --files <files>              Comma-separated list of files to mutate
  --test-command <command>     Custom mutmut test command
  --allow-unsafe-test-command  Allow mutmut to run a custom test command string
                               from --test-command
  --timeout <ms>               Timeout per test in milliseconds (default:
                               "5000")
  -h, --help                   display help for command
```

### `guardscan rules`

```text
Usage: guardscan rules [options]

Run custom rule engine with YAML-based rules

Options:
  --list                List all available rules
  --run                 Run rules (default) (default: true)
  --fix                 Apply auto-fixes to violations
  --rule-ids <ids>      Comma-separated list of rule IDs to run
  --files <files>       Comma-separated list of files to scan
  --custom-rules <dir>  Directory containing custom YAML rules
  --export <rule:path>  Export a rule to file (format: ruleId:outputPath)
  -h, --help            display help for command
```

### `guardscan config`

```text
Usage: guardscan config [options]

Configure AI provider, privacy controls, and local settings

Options:
  -p, --provider <provider>  Set AI provider (openai, claude, gemini, ollama,
                             lmstudio, openrouter, none)
  -k, --key <key>            Set API key
  --telemetry <enabled>      Enable or disable telemetry (true or false)
  --offline <enabled>        Enable or disable offline mode (true or false)
  --show                     Show current configuration
  -h, --help                 display help for command
```

### `guardscan status`

```text
Usage: guardscan status [options]

Show provider, repository, and local configuration status

Options:
  --check-network  Check internet connectivity
  -h, --help       display help for command
```

### `guardscan reset`

```text
Usage: guardscan reset [options]

Clear local context and cache

Options:
  --all       Reset all local configuration and state
  --force     Skip confirmation prompts
  -h, --help  display help for command
```

### `guardscan commit`

```text
Usage: guardscan commit [options]

Generate AI-powered commit messages

Options:
  --ai             Use AI to generate commit message (default: true)
  --auto           Automatically commit with generated message
  --scope <scope>  Specify commit scope
  --type <type>    Specify commit type (feat, fix, docs, etc.)
  --no-body        Skip commit body (subject only)
  -h, --help       display help for command
```

### `guardscan explain`

```text
Usage: guardscan explain [options] <target>

Explain code using AI (function, class, file, or theme)

Options:
  -l, --level <level>  Explanation level: brief, detailed, comprehensive
                       (default: "detailed")
  -t, --type <type>    Target type: function, class, file, module (default:
                       "function")
  -o, --output <path>  Save explanation to file
  -h, --help           display help for command
```

### `guardscan test-gen`

```text
Usage: guardscan test-gen [options]

Generate tests using AI

Options:
  --function <name>        Generate tests for a specific function
  --class <name>           Generate tests for a specific class
  --file <path>            Generate tests for all exports in a file
  --framework <framework>  Test framework (jest, vitest, mocha, pytest, auto)
                           (default: "auto")
  -o, --output <path>      Custom output path for test file
  --coverage               Show coverage estimation
  -h, --help               display help for command
```

### `guardscan docs`

```text
Usage: guardscan docs [options]

Generate documentation using AI

Options:
  -t, --type <type>      Documentation type: readme, api, architecture,
                         contributing (default: "readme")
  -o, --output <path>    Custom output path
  --diagrams             Include architecture diagrams (Mermaid) (default:
                         true)
  --examples             Include code examples (default: true)
  --audience <audience>  Target audience: developer, user, contributor
                         (default: "user")
  -h, --help             display help for command
```

### `guardscan chat`

```text
Usage: guardscan chat [options]

Interactive AI chat about your codebase

Options:
  -m, --model <model>              Override AI model
  -t, --temperature <temp>         Temperature 0-1 (default: "0.7")
  --rebuild                        Rebuild embeddings index
  --embedding-provider <provider>  Embedding provider: openai, gemini, ollama,
                                   claude, or lmstudio (auto-selected when
                                   omitted)
  --session <path>                 Load existing session from file
  --export <path>                  Export conversation to file
  -h, --help                       display help for command
```

### `guardscan refactor`

```text
Usage: guardscan refactor [options]

AI-powered refactoring suggestions

Options:
  -f, --file <path>    Specific file to analyze
  --function <name>    Analyze specific function
  --class <name>       Analyze specific class
  --smell <type>       Target specific code smell type
  --pattern <pattern>  Suggest specific design pattern
  --analyze            Analyze code smells only
  --apply              Generate refactored code
  -i, --interactive    Interactive refactoring mode
  --report             Generate full refactoring report
  -o, --output <path>  Save report to file
  -h, --help           display help for command
```

### `guardscan threat-model`

```text
Usage: guardscan threat-model [options]

AI-powered threat modeling with STRIDE analysis

Options:
  -f, --file <path>          Specific file to analyze
  -c, --category <category>  Focus on specific STRIDE category (spoofing,
                             tampering, repudiation, information-disclosure,
                             denial-of-service, elevation-of-privilege)
  --flows                    Include data flow mapping (default: true)
  --diagram                  Generate threat model diagram
  --focus <area>             Focus area: authentication, data-protection,
                             api-security, or all
  -s, --severity <level>     Minimum severity level: low, medium, high,
                             critical
  --report                   Generate full threat model report
  -o, --output <path>        Save report to file
  -h, --help                 display help for command
```

### `guardscan migrate`

```text
Usage: guardscan migrate [options]

AI-powered code migration assistant

Options:
  -t, --type <type>    Migration type: framework, language, modernization,
                       dependency
  --target <target>    Migration target (e.g., react-class-to-hooks,
                       typescript, es5-to-es6)
  --from <source>      Source framework/language (e.g., react, es5)
  --to <target>        Target framework/language (e.g., vue, es6)
  -f, --file <path>    Specific file to migrate
  --dry-run            Preview changes without applying them (default: true)
  --auto-fix           Automatically apply fixes
  --backup             Create backups of original files (default: true)
  --report             Generate migration report
  -o, --output <path>  Save report to file
  -h, --help           display help for command
```

### `guardscan review`

```text
Usage: guardscan review [options]

AI-powered code review for git changes

Options:
  --base <ref>               Base git reference (default: HEAD) (default:
                             "HEAD")
  --head <ref>               Head git reference for comparison
  -f, --file <path>          Review specific file only
  -s, --severity <level>     Minimum severity level: critical, high, medium,
                             low, info
  -c, --category <category>  Filter by category: bug, security, performance,
                             maintainability, style, documentation, testing,
                             accessibility, best-practice
  --report                   Generate full detailed report
  -o, --output <path>        Save report to file
  -h, --help                 display help for command
```

### `guardscan models`

```text
Usage: guardscan models [options] [command]

Manage AI models

Options:
  -h, --help                 display help for command

Commands:
  list [options]             List all available models
  info <model>               Get detailed information about a model
  search [options]           Search models by name or tag
  compare <model1> <model2>  Compare two models
  recommend [options]        Get model recommendation for your provider
  help [command]             display help for command
```

#### `guardscan models list`

```text
Usage: guardscan models list [options]

List all available models

Options:
  --provider <provider>  Filter by provider
  --tag <tag>            Filter by tag
  --active-only          Show only non-deprecated models
  -h, --help             display help for command
```

#### `guardscan models info`

```text
Usage: guardscan models info [options] <model>

Get detailed information about a model

Options:
  -h, --help  display help for command
```

#### `guardscan models search`

```text
Usage: guardscan models search [options]

Search models by name or tag

Options:
  --query <query>        Search query
  --tag <tag>            Filter by tag
  --provider <provider>  Filter by provider
  -h, --help             display help for command
```

#### `guardscan models compare`

```text
Usage: guardscan models compare [options] <model1> <model2>

Compare two models

Options:
  -h, --help  display help for command
```

#### `guardscan models recommend`

```text
Usage: guardscan models recommend [options]

Get model recommendation for your provider

Options:
  --priority <priority>  Priority: cost, quality, speed, balanced (default:
                         "balanced")
  -h, --help             display help for command
```

### `guardscan routing`

```text
Usage: guardscan routing [options] [command]

Manage model routing for tasks

Options:
  -h, --help              display help for command

Commands:
  list                    List routing configuration for all tasks
  set [options] <task>    Set routing for a specific task
  test <task>             Test routing for a specific task (dry run)
  clear [options] [task]  Clear routing override for a task (or all with --all)
  help [command]          display help for command
```

#### `guardscan routing list`

```text
Usage: guardscan routing list [options]

List routing configuration for all tasks

Options:
  -h, --help  display help for command
```

#### `guardscan routing set`

```text
Usage: guardscan routing set [options] <task>

Set routing for a specific task

Options:
  --model <model>        Override model for this task
  --priority <priority>  Override priority (cost, quality, speed, balanced)
  -h, --help             display help for command
```

#### `guardscan routing test`

```text
Usage: guardscan routing test [options] <task>

Test routing for a specific task (dry run)

Options:
  -h, --help  display help for command
```

#### `guardscan routing clear`

```text
Usage: guardscan routing clear [options] [task]

Clear routing override for a task (or all with --all)

Options:
  --all       Clear all overrides
  -h, --help  display help for command
```

### `guardscan budget`

```text
Usage: guardscan budget [options] [command]

Manage AI spending budgets

Options:
  -h, --help        display help for command

Commands:
  status            Show current budget status
  set [options]     Set budget limits
  report [options]  Generate budget usage report
  help [command]    display help for command
```

#### `guardscan budget status`

```text
Usage: guardscan budget status [options]

Show current budget status

Options:
  -h, --help  display help for command
```

#### `guardscan budget set`

```text
Usage: guardscan budget set [options]

Set budget limits

Options:
  --daily <amount>                 Daily budget limit in USD
  --monthly <amount>               Monthly budget limit in USD
  --per-request <amount>           Per-request budget limit in USD
  --warning-threshold <threshold>  Warning threshold (0-1)
  -h, --help                       display help for command
```

#### `guardscan budget report`

```text
Usage: guardscan budget report [options]

Generate budget usage report

Options:
  --days <days>    Number of days to report (default: "30")
  --export <path>  Export to CSV file
  -h, --help       display help for command
```

### `guardscan metrics`

```text
Usage: guardscan metrics [options] [command]

View AI operation metrics

Options:
  -h, --help        display help for command

Commands:
  show [options]    Show aggregated metrics
  export [options]  Export metrics to file
  clear [options]   Clear all collected metrics
  help [command]    display help for command
```

#### `guardscan metrics show`

```text
Usage: guardscan metrics show [options]

Show aggregated metrics

Options:
  --provider <provider>  Filter by provider
  --days <days>          Time range in days (default: "7")
  -h, --help             display help for command
```

#### `guardscan metrics export`

```text
Usage: guardscan metrics export [options]

Export metrics to file

Options:
  --format <format>  Export format: json, csv (default: "json")
  --output <path>    Output file path (default: "metrics.json")
  --days <days>      Time range in days (default: "30")
  -h, --help         display help for command
```

#### `guardscan metrics clear`

```text
Usage: guardscan metrics clear [options]

Clear all collected metrics

Options:
  --force     Skip confirmation
  -h, --help  display help for command
```

### `guardscan cache`

```text
Usage: guardscan cache [options] [command]

Manage repository-local AI, semantic, embedding, and advisory caches

Options:
  -h, --help       display help for command

Commands:
  stats            Show cache statistics
  info             Show cache configuration
  clear [options]  Clear cached source-derived data for this repository or all
                   repositories
  help [command]   display help for command
```

#### `guardscan cache stats`

```text
Usage: guardscan cache stats [options]

Show cache statistics

Options:
  -h, --help  display help for command
```

#### `guardscan cache info`

```text
Usage: guardscan cache info [options]

Show cache configuration

Options:
  -h, --help  display help for command
```

#### `guardscan cache clear`

```text
Usage: guardscan cache clear [options]

Clear cached source-derived data for this repository or all repositories

Options:
  --repo      Clear the current repository cache (default)
  --all       Clear every repository cache
  --force     Skip confirmation
  -h, --help  display help for command
```

### `guardscan telemetry`

```text
Usage: guardscan telemetry [options] [command]

Inspect and explicitly synchronize opt-in telemetry

Options:
  -h, --help       display help for command

Commands:
  status           Show telemetry consent, suppression, endpoint, and outbox
                   status
  sync             Explicitly send the oldest pending telemetry batch
  clear [options]  Delete all locally queued telemetry events
  help [command]   display help for command
```

#### `guardscan telemetry status`

```text
Usage: guardscan telemetry status [options]

Show telemetry consent, suppression, endpoint, and outbox status

Options:
  -h, --help  display help for command
```

#### `guardscan telemetry sync`

```text
Usage: guardscan telemetry sync [options]

Explicitly send the oldest pending telemetry batch

Options:
  -h, --help  display help for command
```

#### `guardscan telemetry clear`

```text
Usage: guardscan telemetry clear [options]

Delete all locally queued telemetry events

Options:
  --force     Confirm deletion
  -h, --help  display help for command
```

### `guardscan capabilities`

```text
Usage: guardscan capabilities [options]

Inspect optional runtime capabilities and safe fallback modes

Options:
  --json      Emit compact machine-readable JSON
  -h, --help  display help for command
```

### `guardscan vuln`

```text
Usage: guardscan vuln|cve [options] [command] [path]

Scan exact dependency versions for known vulnerabilities using OSV

Arguments:
  path                            Repository to scan (default: ".")

Options:
  --ecosystem <names...>          Limit scanning to npm, pip, go, ruby, cargo,
                                  or maven
  --scope <scope>                 Dependency scope (all or runtime)
  --offline                       Use a matching local vulnerability snapshot
                                  without network access
  --no-cloud                      Deprecated alias for --offline
  --refresh                       Bypass prior coverage and atomically replace
                                  the vulnerability snapshot
  --allow-partial                 Allow missing, stale, or incomplete
                                  vulnerability coverage
  --concurrency <number>          Maximum concurrent advisory detail requests
                                  (default: "4")
  --format <format>               Output format (table, json, or sarif)
                                  (default: "table")
  -o, --output <path>             Write output to a file
  --ci                            Use CI failure defaults
  --fail-on <severity>            Fail at or above critical, high, medium, or
                                  low
  --max-vulnerabilities <number>  Fail when the vulnerability count exceeds
                                  this value
  --no-cache                      Disable vulnerability snapshot reads and
                                  writes
  -h, --help                      display help for command

Commands:
  db                              Manage repository vulnerability coverage
                                  snapshots
```

#### `guardscan vuln db`

```text
Usage: guardscan vuln db [options] [command]

Manage repository vulnerability coverage snapshots

Options:
  -h, --help               display help for command

Commands:
  update [options] [path]  Fetch OSV coverage for the current exact dependency
                           inventory
  status [path]            Show vulnerability snapshot coverage and freshness
  clear [options] [path]   Delete vulnerability coverage snapshots
  help [command]           display help for command
```

##### `guardscan vuln db update`

```text
Usage: guardscan vuln db update [options] [path]

Fetch OSV coverage for the current exact dependency inventory

Options:
  --concurrency <number>  Maximum concurrent advisory detail requests (default:
                          "4")
  -h, --help              display help for command
```

##### `guardscan vuln db status`

```text
Usage: guardscan vuln db status [options] [path]

Show vulnerability snapshot coverage and freshness

Options:
  -h, --help  display help for command
```

##### `guardscan vuln db clear`

```text
Usage: guardscan vuln db clear [options] [path]

Delete vulnerability coverage snapshots

Options:
  --repo      Clear the selected repository snapshot
  --all       Clear every vulnerability snapshot
  --force     Confirm destructive deletion
  -h, --help  display help for command
```

# Edge Cases & Known Limitations

This document tracks edge cases, known limitations, and areas requiring special attention in GuardScan.

---

## Security Scanners

### 1. Secrets Detector

**Handled:**
- ✅ High-entropy string detection with Shannon entropy
- ✅ Pattern matching for 20+ secret types
- ✅ Git history scanning (last 100 commits)
- ✅ Safe pattern filtering (UUIDs, hashes, example strings)
- ✅ Masking secrets in output

**Edge Cases to Monitor:**
- ⚠️ **Base64-encoded secrets**: Currently not decoded/scanned
- ⚠️ **Obfuscated strings**: May miss split strings or hex-encoded secrets
- ⚠️ **Binary files**: Skipped entirely, may contain secrets
- ⚠️ **Large repositories**: Git history scan limited to 100 commits
- ⚠️ **False positives**: High-entropy non-secret strings (random IDs, tokens)

**Recommendations:**
- Consider adding base64 decoding before entropy analysis
- Implement hex-encoded secret detection
- Add configurable commit scan depth
- Whitelist file for false positives

### 2. Dependency Scanner

**Handled:**
- ✅ npm audit integration
- ✅ Multiple ecosystems (npm, pip, cargo, composer, bundler)
- ✅ CVE detection with severity mapping

**Edge Cases:**
- ⚠️ **Offline mode**: npm audit requires internet
- ⚠️ **Private packages**: May not have vulnerability data
- ⚠️ **Transitive dependencies**: Depth may be limited
- ⚠️ **Outdated audit databases**: Local cache may be stale

**Recommendations:**
- Cache vulnerability database for offline mode
- Add manual vulnerability specification
- Implement dependency tree visualization

### 3. OWASP Scanner

**Handled:**
- ✅ Pattern-based detection for OWASP Top 10
- ✅ Language-specific checks
- ✅ SQL injection, XSS, CSRF patterns

**Edge Cases:**
- ⚠️ **Context-aware detection**: May flag safe sanitized code
- ⚠️ **Framework-specific patterns**: May miss framework protections
- ⚠️ **Dynamic code**: eval() detection doesn't check context
- ⚠️ **Complex attack vectors**: May miss multi-step vulnerabilities

**Recommendations:**
- Add framework-aware scanning (React, Vue, etc.)
- Implement taint analysis for data flow
- Add configuration for false positive suppression

### 4. Dockerfile Scanner

**Handled:**
- ✅ Base image security
- ✅ USER instruction checks
- ✅ Secret exposure detection
- ✅ Multi-stage build analysis

**Edge Cases:**
- ⚠️ **Dynamic Dockerfile generation**: May not catch runtime issues
- ⚠️ **External script execution**: ADD/COPY from URLs not deeply analyzed
- ⚠️ **BuildKit syntax**: Modern Dockerfile features may be missed
- ⚠️ **Compose files**: Docker Compose not scanned separately

**Recommendations:**
- Add Docker Compose scanning
- Implement BuildKit syntax support
- Check for rootless Docker patterns

### 5. IaC Scanner (Terraform, K8s)

**Handled:**
- ✅ Resource exposure checks
- ✅ Encryption verification
- ✅ IAM policy analysis

**Edge Cases:**
- ⚠️ **Terraform modules**: External modules not deeply analyzed
- ⚠️ **Dynamic resources**: count/for_each patterns may be missed
- ⚠️ **Provider-specific features**: Only AWS/GCP basics covered
- ⚠️ **Helm charts**: Not currently scanned

**Recommendations:**
- Add Helm chart scanning
- Implement Terraform module resolution
- Add CloudFormation support

---

## Code Quality Analyzers

### 1. LOC Counter

**Handled:**
- ✅ 20+ languages with proper comment detection
- ✅ Block comment tracking (C-style, Python docstrings)
- ✅ .gitignore respect
- ✅ Language-aware counting

**Edge Cases:**
- ⚠️ **Mixed-language files**: JSX/TSX may confuse parser
- ⚠️ **Inline comments after code**: May be counted as code
- ⚠️ **Multi-line strings**: May be counted as code lines
- ⚠️ **Generated code**: Minified JS counts as many lines
- ⚠️ **Uncommon languages**: Defaults to "Unknown"

**Recommendations:**
- Add inline comment detection
- Filter minified files (*.min.js)
- Add more language support (Rust, Go, Swift details)
- Implement AST-based counting for accuracy

### 2. Code Metrics Analyzer

**Handled:**
- ✅ Cyclomatic complexity
- ✅ Halstead metrics
- ✅ Maintainability index

**Edge Cases:**
- ⚠️ **Nested complexity**: May undercount deeply nested logic
- ⚠️ **Functional programming**: May miscount functional patterns
- ⚠️ **Async/await**: Async complexity not fully captured
- ⚠️ **Language differences**: Thresholds may not fit all languages

**Recommendations:**
- Add language-specific complexity thresholds
- Implement cognitive complexity (Sonar)
- Add async/await pattern recognition

### 3. Code Smell Detector

**Handled:**
- ✅ 30+ code smell patterns
- ✅ God classes, long methods, duplicate code detection

**Edge Cases:**
- ⚠️ **False positives**: Test files may trigger "long method" warnings
- ⚠️ **Framework code**: May flag framework patterns as smells
- ⚠️ **Generated code**: Auto-generated code triggers smells
- ⚠️ **Language idioms**: Python list comprehensions may be flagged

**Recommendations:**
- Add test file exclusions
- Implement framework-aware detection
- Add configuration for smell thresholds
- Whitelist generated code directories

### 4. Mutation Tester

**Handled:**
- ✅ Framework auto-detection (Stryker, Mutmut, PITest)
- ✅ Test quality assessment

**Edge Cases:**
- ⚠️ **No mutation framework**: Falls back gracefully but no results
- ⚠️ **Slow tests**: May timeout on large codebases
- ⚠️ **Flaky tests**: May produce inconsistent results
- ⚠️ **Limited mutations**: Only standard mutations, not custom

**Recommendations:**
- Add timeout configuration
- Implement retry logic for flaky tests
- Add incremental mutation testing
- Cache mutation results

---

## AI Provider Integration

### 1. Token Limits

**Edge Cases:**
- ⚠️ **Large codebases**: Context limited to 5 files × 100 lines
- ⚠️ **Provider differences**: OpenAI 4K vs Claude 100K vs Gemini 1M tokens
- ⚠️ **Truncation**: Files may be cut off mid-function
- ⚠️ **Context loss**: May miss inter-file dependencies

**Recommendations:**
- Implement smart file selection (most complex first)
- Add chunking strategy for large files
- Use provider-specific token limits
- Add summary-first approach for large codebases

### 2. Rate Limiting

**Edge Cases:**
- ⚠️ **API rate limits**: May hit provider limits on large scans
- ⚠️ **Cost explosion**: No built-in cost controls
- ⚠️ **Retry logic**: Basic retry, no exponential backoff

**Recommendations:**
- Add rate limit detection and backoff
- Implement cost estimation before scan
- Add configurable retry with exponential backoff
- Cache AI responses for similar code

### 3. Local AI (Ollama/LM Studio)

**Edge Cases:**
- ⚠️ **Model availability**: Assumes model is downloaded
- ⚠️ **Performance**: Local models much slower
- ⚠️ **Quality**: Local models may produce lower quality results
- ⚠️ **Resource usage**: May overwhelm low-spec machines

**Recommendations:**
- Add model download check/prompt
- Implement streaming for better UX
- Add quality comparison warnings
- Monitor system resources

---

## Configuration & State

### 1. Config Management

**Handled:**
- ✅ YAML-based config in ~/.guardscan/
- ✅ Environment variable fallback
- ✅ Telemetry opt-out

**Edge Cases:**
- ⚠️ **Concurrent access**: Multiple processes may conflict
- ⚠️ **Config corruption**: Invalid YAML breaks CLI
- ⚠️ **Migration**: No version migration for config changes
- ⚠️ **Secrets in config**: API keys stored in plain text

**Recommendations:**
- Add file locking for concurrent access
- Validate config on load with defaults
- Implement config version and migration
- Consider keychain integration for secrets

### 2. Telemetry

**Handled:**
- ✅ Batched telemetry (max 50 events)
- ✅ Optional and anonymized
- ✅ Client-side batching

**Edge Cases:**
- ⚠️ **Network failures**: Telemetry may never sync
- ⚠️ **Disk space**: Batch file may grow unbounded
- ⚠️ **Privacy**: Repo_id hash may be reversible
- ⚠️ **Sync timing**: Auto-sync at 50 events may be too frequent

**Recommendations:**
- Add telemetry batch size limit (max file size)
- Implement retry with exponential backoff
- Add salt to repo_id hashing
- Make sync threshold configurable

---

## Network & Offline Mode

### 1. Connectivity Detection

**Handled:**
- ✅ Google ping for internet check
- ✅ Graceful degradation to offline mode

**Edge Cases:**
- ⚠️ **Restricted networks**: Google ping may fail in corporate environments
- ⚠️ **Captive portals**: May report online but API calls fail
- ⚠️ **Partial connectivity**: Internet works but API unreachable
- ⚠️ **Timeout configuration**: Fixed 5s timeout may be too short

**Recommendations:**
- Use multiple connectivity checks (Google, Cloudflare, API endpoint)
- Add configurable timeout
- Implement exponential backoff for retries
- Cache last known connectivity state

### 2. Offline Mode

**Handled:**
- ✅ Full static analysis works offline
- ✅ Local AI support (Ollama)

**Edge Cases:**
- ⚠️ **Dependency scanning**: npm audit fails offline
- ⚠️ **Version checking**: No update notifications
- ⚠️ **Credit validation**: Skipped entirely
- ⚠️ **Telemetry**: Queued but never sent

**Recommendations:**
- Cache vulnerability databases
- Add offline mode indicator
- Implement local credit tracking
- Add manual telemetry sync command

---

## Cross-Platform Compatibility

### 1. File System

**Edge Cases:**
- ⚠️ **Windows paths**: Backslashes vs forward slashes
- ⚠️ **Case sensitivity**: macOS/Linux differ
- ⚠️ **Permissions**: ~/.guardscan/ may fail on restricted systems
- ⚠️ **Home directory**: $HOME may not be set

**Recommendations:**
- Use path.normalize() consistently
- Test on Windows, macOS, Linux
- Handle permission errors gracefully
- Add fallback config locations

### 2. Git Integration

**Edge Cases:**
- ⚠️ **Git not installed**: Assumes git CLI available
- ⚠️ **Git version**: Old git may not support commands
- ⚠️ **Non-git repos**: Falls back to directory-based ID
- ⚠️ **Submodules**: Not detected separately

**Recommendations:**
- Check git availability before using
- Use isomorphic-git for pure JS implementation
- Add submodule detection
- Improve fallback repo ID generation

---

## Testing

### Current State
- ✅ Jest configuration created
- ✅ Unit tests for core modules (LOC counter, config, secrets detector)
- ✅ Provider factory tests
- ✅ Reporter tests
- ⏳ Integration tests needed
- ⏳ E2E tests needed

**Edge Cases:**
- ⚠️ **Mocking AI providers**: Tests don't hit real APIs
- ⚠️ **Fixture management**: Test repos need maintenance
- ⚠️ **Async testing**: Timeouts may be flaky
- ⚠️ **Coverage gaps**: Scanners not fully tested

**Recommendations:**
- Add integration tests with real providers (optional)
- Create comprehensive test fixtures
- Add E2E tests for all commands
- Achieve 70%+ coverage target

---

## Performance

### 1. Large Codebases

**Edge Cases:**
- ⚠️ **LOC counting**: May take minutes on huge repos
- ⚠️ **Memory usage**: Loading all files into memory
- ⚠️ **Git history**: 100 commits may not be enough
- ⚠️ **Report generation**: Charts may time out

**Recommendations:**
- Implement streaming for file processing
- Add progress indicators for long operations
- Make git history depth configurable
- Add caching for repeated scans

### 2. Concurrent Execution

**Edge Cases:**
- ⚠️ **Multiple CLI instances**: May conflict on config
- ⚠️ **Telemetry batching**: Race conditions possible
- ⚠️ **Cache corruption**: Concurrent writes

**Recommendations:**
- Add file locking
- Use atomic writes
- Implement process detection

---

## Security Considerations

### 1. Input Validation

**Edge Cases:**
- ⚠️ **Command injection**: File patterns not fully sanitized
- ⚠️ **Path traversal**: User-provided paths not validated
- ⚠️ **YAML injection**: Config file parsing may be exploited
- ⚠️ **ReDoS**: Regex patterns may be vulnerable

**Recommendations:**
- Sanitize all user inputs
- Validate file paths before access
- Use safe YAML parsing
- Audit regex for complexity

### 2. Secrets Handling

**Edge Cases:**
- ⚠️ **API keys in config**: Stored in plain text
- ⚠️ **Logs**: May accidentally log secrets
- ⚠️ **Reports**: Secrets masked but still present
- ⚠️ **Memory**: Secrets kept in memory during scan

**Recommendations:**
- Encrypt config file or use keychain
- Add secret redaction to all outputs
- Implement secure memory handling
- Add option to exclude files from scan

---

## Documentation

### Handled
- ✅ README.md
- ✅ CLAUDE.md
- ✅ BUILD_STATUS.md
- ✅ CONTRIBUTING.md
- ✅ DEPLOYMENT.md

### Needed
- ⏳ API documentation for providers
- ⏳ Architecture diagrams
- ⏳ Video tutorials
- ⏳ Example configurations

---

## Priority Recommendations

### High Priority (P0)
1. ✅ Complete test suite to 50%+ coverage
2. ✅ Fix dependency scanning offline mode
3. ✅ Add config validation
4. ✅ Implement proper error handling

### Medium Priority (P1)
5. Add base64 secret detection
6. Implement smart file selection for AI context
7. Add rate limiting for AI providers
8. Improve cross-platform compatibility

### Low Priority (P2)
9. Add Helm chart scanning
10. Implement AST-based LOC counting
11. Add caching for repeated scans
12. Create video tutorials

---

**Last Updated**: 2025-11-13
**Status**: Living document - update as edge cases discovered

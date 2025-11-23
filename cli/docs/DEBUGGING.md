# GuardScan Debugging Guide

This guide explains how to use GuardScan's debug logging and performance profiling features.

## Table of Contents

- [Enabling Debug Logging](#enabling-debug-logging)
- [Performance Profiling](#performance-profiling)
- [Interpreting Debug Output](#interpreting-debug-output)
- [Common Debugging Scenarios](#common-debugging-scenarios)
- [JSON Output for CI](#json-output-for-ci)

## Enabling Debug Logging

### Basic Debug Logging

Enable verbose debug logging by setting the `GUARDSCAN_DEBUG` environment variable:

```bash
export GUARDSCAN_DEBUG=true
guardscan init
```

This will output detailed information about:

- Configuration loading and saving
- Repository detection
- File operations
- AI provider initialization
- API calls and responses
- Error details

### Example Output

```
[2025-11-22T10:30:45.123Z] [init] Init command started
[2025-11-22T10:30:45.124Z] [init] Config exists check: false
[2025-11-22T10:30:45.125Z] [ConfigManager] Initialized ConfigManager with homeDir: /Users/username
[2025-11-22T10:30:45.126Z] [ConfigManager] configDir: /Users/username/.guardscan
[2025-11-22T10:30:45.127Z] [init] Config created
```

## Performance Profiling

Enable performance profiling to see detailed timing information:

```bash
export GUARDSCAN_PROFILE=true
guardscan scan
```

### Example Output

```
Performance Summary:
Command: guardscan scan
Total: 2.35s

  ├─ security-scans: 1.2s (51.1%)
  ├─ file-scanning: 0.8s (34.0%)
  ├─ report-generation: 0.2s (8.5%)
  └─ repository-detection: 0.15s (6.4%)
```

### What Gets Tracked

- Command execution time
- Individual operation durations
- File I/O operations
- AI API call latency
- Cache operations
- Database queries (backend)

## Interpreting Debug Output

### Debug Log Format

```
[TIMESTAMP] [COMPONENT] MESSAGE [DATA]
```

- **TIMESTAMP**: ISO 8601 format timestamp
- **COMPONENT**: Component/command name (e.g., `init`, `config`, `scan`)
- **MESSAGE**: Human-readable message
- **DATA**: Optional structured data (JSON)

### Log Levels

- **debug**: Detailed information (only shown when `GUARDSCAN_DEBUG=true`)
- **info**: General information (always shown)
- **warn**: Warning messages (always shown)
- **error**: Error messages (always shown)
- **performance**: Performance metrics (shown when `GUARDSCAN_PROFILE=true`)

## Common Debugging Scenarios

### 1. Config Initialization Issues

```bash
export GUARDSCAN_DEBUG=true
guardscan init
```

Look for:

- Home directory resolution
- Config directory creation
- File permission errors
- Path resolution issues

### 2. AI Provider Connection Problems

```bash
export GUARDSCAN_DEBUG=true
guardscan run
```

Look for:

- Provider initialization
- API endpoint configuration
- Connection test results
- Token usage

### 3. Slow Command Execution

```bash
export GUARDSCAN_PROFILE=true
guardscan scan
```

Look for:

- Operations taking >30% of total time (highlighted in red)
- File I/O bottlenecks
- Network latency
- Cache hit/miss rates

### 4. Repository Detection Issues

```bash
export GUARDSCAN_DEBUG=true
guardscan status
```

Look for:

- Repository path detection
- Git repository identification
- Branch detection
- Repo ID generation

### 5. Backend API Issues

For backend debugging, check Cloudflare Workers logs. Debug logging is automatically enabled in development mode.

## JSON Output for CI

For CI/CD pipelines, use JSON output format:

```bash
export GUARDSCAN_DEBUG=true
export GUARDSCAN_DEBUG_JSON=true
guardscan security > debug.log
```

### Example JSON Output

```json
{
  "level": "debug",
  "component": "security",
  "timestamp": "2025-11-22T10:30:45.123Z",
  "message": "Security command started",
  "data": {
    "options": {
      "licenses": true
    }
  }
}
```

### Parsing JSON Logs

```bash
# Extract all errors
cat debug.log | jq 'select(.level == "error")'

# Extract performance metrics
cat debug.log | jq 'select(.level == "performance")'

# Count operations by component
cat debug.log | jq -r '.component' | sort | uniq -c
```

## Environment Variables Reference

| Variable               | Description                        | Default        |
| ---------------------- | ---------------------------------- | -------------- |
| `GUARDSCAN_DEBUG`      | Enable verbose debug logging       | `false`        |
| `GUARDSCAN_PROFILE`    | Enable performance profiling       | `false`        |
| `GUARDSCAN_DEBUG_JSON` | Output debug logs as JSON          | `false`        |
| `GUARDSCAN_HOME`       | Override config directory location | `~/.guardscan` |

## Tips

1. **Start with debug logging** when investigating issues
2. **Use performance profiling** to identify bottlenecks
3. **Combine both** for comprehensive analysis:

   ```bash
   export GUARDSCAN_DEBUG=true
   export GUARDSCAN_PROFILE=true
   guardscan scan
   ```

4. **Save logs** for later analysis:

   ```bash
   export GUARDSCAN_DEBUG=true
   guardscan scan 2>&1 | tee debug.log
   ```

5. **Filter logs** to focus on specific components:

   ```bash
   guardscan scan 2>&1 | grep "\[scan\]"
   ```

## Troubleshooting

### Debug logging not appearing

- Verify `GUARDSCAN_DEBUG=true` is set
- Check that you're looking at stderr (debug logs go to stderr)
- Ensure you're using a recent version of GuardScan

### Performance summary not showing

- Verify `GUARDSCAN_PROFILE=true` is set
- Check that the command completed successfully
- Some commands may not have performance tracking yet

### Too much output

- Use JSON format and filter with `jq`
- Redirect to a file and analyze later
- Focus on specific components with grep

## Getting Help

If debug logging doesn't help resolve your issue:

1. Save the full debug output to a file
2. Include the GuardScan version: `guardscan --version`
3. Include your environment: OS, Node.js version
4. Open an issue on GitHub with the debug log

---

For more information, see:

- [Testing Guide](./TESTING.md)
- [Performance Guide](./PERFORMANCE.md)
- [Main README](../README.md)

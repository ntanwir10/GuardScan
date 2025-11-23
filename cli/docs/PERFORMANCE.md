# GuardScan Performance Guide

This guide explains GuardScan's performance characteristics, how to profile commands, and optimization tips.

## Table of Contents

- [Performance Expectations](#performance-expectations)
- [Profiling Commands](#profiling-commands)
- [Performance Metrics](#performance-metrics)
- [Optimization Tips](#optimization-tips)
- [Known Bottlenecks](#known-bottlenecks)

## Performance Expectations

### Typical Command Execution Times

| Command         | Small Repo (<100 files) | Medium Repo (100-1000 files) | Large Repo (>1000 files) |
| --------------- | ----------------------- | ---------------------------- | ------------------------ |
| `init`          | <1s                     | <1s                          | <1s                      |
| `config`        | <0.5s                   | <0.5s                        | <0.5s                    |
| `status`        | <0.5s                   | <0.5s                        | <0.5s                    |
| `scan`          | 2-5s                    | 10-30s                       | 60-180s                  |
| `security`      | 1-3s                    | 5-15s                        | 30-90s                   |
| `run` (with AI) | 5-15s                   | 30-90s                       | 2-5min                   |

*Times include AI API calls when applicable*

## Profiling Commands

### Enable Performance Profiling

```bash
export GUARDSCAN_PROFILE=true
guardscan scan
```

### Understanding Performance Output

```
Performance Summary:
Command: guardscan scan
Total: 2.35s

  ├─ security-scans: 1.2s (51.1%)    # Red = >30% of total time
  ├─ file-scanning: 0.8s (34.0%)     # Yellow = 15-30%
  ├─ report-generation: 0.2s (8.5%)  # Green = <15%
  └─ repository-detection: 0.15s (6.4%)
```

**Color Coding:**

- 🔴 **Red**: Operations taking >30% of total time (potential bottleneck)
- 🟡 **Yellow**: Operations taking 15-30% of total time (moderate impact)
- 🟢 **Green**: Operations taking <15% of total time (efficient)

### Export Performance Data

```bash
export GUARDSCAN_PROFILE=true
guardscan scan 2>&1 | tee perf.log
```

## Performance Metrics

### What Gets Tracked

1. **Command Execution Time**
   - Total command duration
   - Breakdown by operation

2. **File Operations**
   - File scanning time
   - File I/O operations
   - Directory traversal

3. **AI Operations**
   - API call latency
   - Token usage
   - Cache hit/miss rates
   - Response parsing time

4. **Network Operations**
   - API request duration
   - Response time
   - Retry attempts

5. **Memory Usage**
   - Heap usage
   - Memory growth
   - Garbage collection impact

### Accessing Metrics Programmatically

```typescript
import { createPerformanceTracker } from '../utils/performance-tracker';

const tracker = createPerformanceTracker('my-command');
tracker.start('operation');
// ... do work ...
tracker.end('operation');

const summary = tracker.getSummary();
console.log(summary.breakdown);
```

## Optimization Tips

### 1. Use Caching

GuardScan caches AI responses and analysis results:

```bash
# Cache is automatically used
guardscan run

# Clear cache if needed
guardscan reset
```

### 2. Parallel Operations

Many operations run in parallel automatically:

- Security scans
- File analysis
- Dependency scanning

### 3. Limit File Scope

Scan specific files instead of entire repository:

```bash
# Scan only specific files
guardscan security --files src/**/*.ts

# Scan specific directory
guardscan scan --files src/
```

### 4. Skip Optional Checks

```bash
# Skip tests
guardscan scan --skipTests

# Skip performance testing
guardscan scan --skipPerf
```

### 5. Use Offline Mode

For faster execution without telemetry:

```bash
guardscan config
# Enable offline mode
```

### 6. Optimize AI Usage

- Use local AI (Ollama) for faster responses
- Cache AI responses when possible
- Batch similar requests

## Known Bottlenecks

### 1. Large File Scanning

**Issue**: Scanning very large files (>10MB) can be slow

**Solution**:

- Use `.guardscanignore` to exclude large files
- Scan specific directories
- Use file size limits

### 2. AI API Latency

**Issue**: AI API calls can be slow (network dependent)

**Solution**:

- Use local AI (Ollama/LM Studio)
- Enable caching
- Batch requests when possible

### 3. Dependency Scanning

**Issue**: Scanning many dependencies can be slow

**Solution**:

- Use `--no-cloud` flag to skip cloud dependency checks
- Cache dependency results
- Limit to production dependencies only

### 4. Git Operations

**Issue**: Large git repositories can slow down repo detection

**Solution**:

- Use shallow clones
- Limit git history depth
- Skip git operations when not needed

## Performance Benchmarks

### Baseline Performance

Run baseline benchmarks:

```bash
export GUARDSCAN_PROFILE=true
guardscan scan > baseline.log
```

### Regression Testing

Compare performance over time:

```bash
# Before changes
guardscan scan > before.log

# After changes
guardscan scan > after.log

# Compare
diff before.log after.log
```

## Memory Usage

### Monitor Memory

```typescript
const tracker = createPerformanceTracker('command');
const memory = tracker.getMemoryUsage();
console.log(tracker.formatMemoryUsage(memory));
```

### Memory Optimization

- Use streaming for large files
- Limit concurrent operations
- Clear caches periodically

## Network Performance

### Optimize API Calls

1. **Batch Requests**: Group multiple requests
2. **Use Compression**: Enable gzip compression
3. **Connection Pooling**: Reuse connections
4. **Timeout Settings**: Set appropriate timeouts

### Monitor Network

```bash
# With network monitoring
export GUARDSCAN_DEBUG=true
guardscan run 2>&1 | grep -i "network\|api\|http"
```

## Profiling in CI

### CI Performance Tracking

```yaml
# .github/workflows/performance.yml
- name: Run performance tests
  run: |
    export GUARDSCAN_PROFILE=true
    guardscan scan > perf.log
    # Upload perf.log as artifact
```

### Performance Regression Detection

Set performance thresholds:

```typescript
it('should complete scan in under 5 seconds', async () => {
  const start = Date.now();
  await scanCommand();
  const duration = Date.now() - start;
  expect(duration).toBeLessThan(5000);
});
```

## Troubleshooting Slow Commands

### 1. Identify Bottleneck

```bash
export GUARDSCAN_PROFILE=true
guardscan scan
```

Look for operations in red (>30% of total time).

### 2. Check File Count

```bash
find . -type f | wc -l
```

Large file counts can slow down scanning.

### 3. Check Network

```bash
# Test API connectivity
curl -w "@-" -o /dev/null -s https://api.example.com <<'EOF'
     time_namelookup:  %{time_namelookup}\n
        time_connect:  %{time_connect}\n
     time_appconnect:  %{time_appconnect}\n
    time_pretransfer:  %{time_pretransfer}\n
       time_redirect:  %{time_redirect}\n
  time_starttransfer:  %{time_starttransfer}\n
                     ----------\n
          time_total:  %{time_total}\n
EOF
```

### 4. Check System Resources

```bash
# CPU usage
top

# Memory usage
free -h

# Disk I/O
iostat
```

## Best Practices

1. **Profile regularly**: Identify bottlenecks early
2. **Set performance budgets**: Define acceptable limits
3. **Monitor in production**: Track real-world performance
4. **Optimize incrementally**: Focus on biggest wins first
5. **Document expectations**: Set clear performance goals

## Performance Testing with k6

GuardScan can use **k6** for load and stress testing of APIs and web services.

### When to Use k6

Use `guardscan perf` with k6 when:

- You need to test API performance under load
- You want to find performance bottlenecks
- You need to validate scalability
- You want to detect performance regressions

### Quick Start

```bash
# Install k6 first
brew install k6  # macOS
# or see Testing Tools Guide for other platforms

# Run load test
guardscan perf --load --url https://api.example.com

# Run stress test
guardscan perf --stress --url https://api.example.com
```

### More Information

For detailed information about k6, installation instructions, and when to use it, see:

- 📖 [Testing Tools Guide](./TESTING_TOOLS.md) - Complete guide for k6 and Stryker

---

## Resources

- [Debugging Guide](./DEBUGGING.md) - For detailed logging
- [Testing Tools Guide](./TESTING_TOOLS.md) - Guide for k6 and Stryker
- [Main README](../../README.md) - General information

---

For performance issues, open an issue on GitHub with:

- Performance profile output
- Repository size (file count, LOC)
- System specifications
- Command used

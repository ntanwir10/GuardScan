# Docker & Alpine Linux Guide

> ⚠️ **Note:** This guide has been integrated into the [Comprehensive Docker Guide](../docs/DOCKER_GUIDE.md). This document is kept as a quick reference for Alpine Linux-specific information. For complete Docker documentation covering all operating systems, see the [Comprehensive Docker Guide](../docs/DOCKER_GUIDE.md).

This guide helps you use GuardScan in Docker containers, especially Alpine Linux environments.

## Quick Start

### Alpine Linux Setup

```bash
# Install dependencies first
apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
  libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git

# Install GuardScan
npm install -g guardscan

# Initialize
guardscan init
```

## Common Issues & Solutions

### Issue #1: "Configuration not found" Error

**Symptoms:**

```
Configuration not found. Run "guardscan init" first.
```

**Cause:** Alpine Linux containers may have issues with home directory detection.

**Solutions:**

1. **Set GUARDSCAN_HOME environment variable:**

   ```bash
   export GUARDSCAN_HOME=/tmp/guardscan
   guardscan init
   ```

2. **Ensure HOME is set:**

   ```bash
   export HOME=/root  # or appropriate directory
   guardscan init
   ```

3. **Enable debug mode to see what's happening:**

   ```bash
   export GUARDSCAN_DEBUG=true
   guardscan init
   ```

### Issue #2: Permission Denied Errors

**Cause:** Container may have restricted write permissions.

**Solution:** Use `/tmp` or a writeable volume:

```bash
export GUARDSCAN_HOME=/tmp/guardscan
# or mount a volume
docker run -v /path/on/host:/guardscan node:lts-alpine
export GUARDSCAN_HOME=/guardscan
```

### Issue #3: Missing Dependencies

**Cause:** Alpine uses `musl` instead of `glibc` and needs additional build tools.

**Solution:** Install all required dependencies:

```bash
apk add --no-cache \
  python3 \
  make \
  g++ \
  pkgconfig \
  cairo-dev \
  pango-dev \
  libjpeg-turbo-dev \
  giflib-dev \
  pixman-dev \
  freetype-dev \
  build-base \
  git
```

## Environment Variables

### GUARDSCAN_HOME

Override the default home directory location.

```bash
export GUARDSCAN_HOME=/custom/path
```

**Default behavior:**

- Tries `$GUARDSCAN_HOME` first
- Falls back to `$HOME`
- Falls back to `$USERPROFILE` (Windows)
- Falls back to `os.homedir()`
- Last resort: `/tmp`

### GUARDSCAN_DEBUG

Enable verbose debug logging to troubleshoot issues.

```bash
export GUARDSCAN_DEBUG=true
guardscan init  # Will show detailed logging
```

## Docker Examples

### Example 1: Basic Alpine Container

```dockerfile
FROM node:lts-alpine

# Install dependencies
RUN apk add --no-cache \
    python3 make g++ pkgconfig cairo-dev pango-dev \
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git

# Install GuardScan
RUN npm install -g guardscan

# Set up config location
ENV GUARDSCAN_HOME=/app/.guardscan

# Your code
WORKDIR /app
COPY . .

# Run GuardScan
RUN guardscan init
```

### Example 2: With Docker Compose

```yaml
version: '3.8'
services:
  guardscan:
    image: node:lts-alpine
    environment:
      - GUARDSCAN_HOME=/workspace/.guardscan
      - GUARDSCAN_DEBUG=false
    volumes:
      - ./:/workspace
    working_dir: /workspace
    command: sh -c "
      apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev 
      libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
      npm install -g guardscan &&
      guardscan scan
    "
```

### Example 3: CI/CD Pipeline (GitHub Actions)

```yaml
name: GuardScan Security Check
on: [push, pull_request]

jobs:
  security-scan:
    runs-on: ubuntu-latest
    container:
      image: node:lts-alpine
    steps:
      - uses: actions/checkout@v3
      
      - name: Install dependencies
        run: |
          apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
            libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
      
      - name: Install GuardScan
        run: npm install -g guardscan
      
      - name: Run security scan
        env:
          GUARDSCAN_HOME: ${{ github.workspace }}/.guardscan
        run: guardscan security
```

### Example 4: Read-Only Root Filesystem

For enhanced security with read-only root:

```bash
docker run --read-only --tmpfs /tmp \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine \
  sh -c "npm install -g guardscan && guardscan init"
```

## Testing Your Setup

Run the test script to verify GuardScan works in your environment:

```bash
cd cli
./test-alpine.sh
```

This will test:

- ✅ Clean Alpine environment
- ✅ Missing HOME variable
- ✅ Custom GUARDSCAN_HOME
- ✅ Read-only filesystems
- ✅ Version check behavior
- ✅ Multiple commands in sequence

## Troubleshooting Checklist

If GuardScan isn't working in your container:

- [ ] Are all dependencies installed?
- [ ] Is `$HOME` or `$GUARDSCAN_HOME` set?
- [ ] Is the target directory writable?
- [ ] Did you run with `GUARDSCAN_DEBUG=true`?
- [ ] Are you using `node:lts-alpine` or compatible image?
- [ ] Did you run `npm install -g guardscan` successfully?

## Getting Help

If you're still experiencing issues:

1. **Enable debug mode:**

   ```bash
   GUARDSCAN_DEBUG=true guardscan init 2>&1 | tee debug.log
   ```

2. **Check home directory:**

   ```bash
   node -e "console.log(require('os').homedir())"
   ```

3. **Verify write permissions:**

   ```bash
   mkdir -p ~/.guardscan && echo "test" > ~/.guardscan/test.txt
   ```

4. **Open an issue:** [GitHub Issues](https://github.com/ntanwir10/GuardScan/issues)
   - Include the debug log
   - Mention your Docker image
   - Include your Dockerfile if relevant

## Additional Resources

- [Main README](../README.md)
- [Getting Started Guide](../docs/GETTING_STARTED.md)
- [Issue #25 - Alpine Linux Fix](https://github.com/ntanwir10/GuardScan/issues/25)

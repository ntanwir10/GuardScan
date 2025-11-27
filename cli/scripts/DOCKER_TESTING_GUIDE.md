# Step-by-Step Guide: Testing GuardScan in Docker (Alpine & Debian)

This guide walks you through manually testing GuardScan CLI in both Alpine and Debian Docker environments.

## Prerequisites

1. **Docker Desktop** or Docker daemon running
2. **Node.js 18+** and **npm** installed locally
3. **GuardScan CLI** source code (this repository)

## Step 1: Build the GuardScan Package

First, build the CLI and create a distributable package:

```bash
# Navigate to the CLI directory
cd /path/to/GuardScan/cli

# Install dependencies (if not already done)
npm install

# Build the TypeScript code
npm run build

# Create a tarball package
npm pack
```

This creates a file like `guardscan-1.0.4.tgz` in the `cli` directory.

**Note the full path to this file** - you'll need it for Docker volume mounting.

Example:

```bash
~/Developer/GuardScan/cli/guardscan-1.0.4.tgz
```

## Step 2: Create a Test Project

Create a temporary directory with sample code to test:

```bash
# Create a temporary directory
TMP_DIR=$(mktemp -d)
echo "Test directory: $TMP_DIR"

# Create a test TypeScript file
cat > "$TMP_DIR/sample.ts" << 'EOF'
export function hello(name: string): string {
  return `Hello ${name}`;
}

export class Greeter {
  greet(name: string): string {
    return hello(name);
  }
}
EOF

# Create a minimal package.json
cat > "$TMP_DIR/package.json" << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF
```

## Step 3: Test in Alpine Linux

### 3.1: Basic Test - Install and Verify

```bash
# Set variables (adjust paths as needed)
PACKAGE_FILE="/path/to/GuardScan/cli/guardscan-1.0.4.tgz"
TEST_PROJECT="$TMP_DIR"

# Test installation and version check
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine sh -c '
    # Install build dependencies (required for native modules like canvas)
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
      libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
    
    # Install GuardScan globally
    npm install -g /tmp/guardscan.tgz
    
    # Verify installation
    guardscan --version
  '
```

**Expected output:**

```
GuardScan ASCII art logo
1.0.4
```

### 3.2: Test Init Command

```bash
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine sh -c '
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
      libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
    npm install -g /tmp/guardscan.tgz
    guardscan init --no-telemetry
  '
```

### 3.3: Test Security Scan

```bash
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine sh -c '
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
      libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
    npm install -g /tmp/guardscan.tgz
    guardscan security --files sample.ts --no-telemetry
  '
```

### 3.4: Test Other Commands

```bash
# Test run command
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine sh -c '
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
      libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
    npm install -g /tmp/guardscan.tgz
    guardscan run --no-telemetry
  '

# Test scan command
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine sh -c '
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
      libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
    npm install -g /tmp/guardscan.tgz
    guardscan scan --no-telemetry
  '
```

## Step 4: Test in Debian Linux

Debian images (`node:lts`) already include most build tools, so the setup is simpler:

### 4.1: Basic Test - Install and Verify

```bash
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts sh -c '
    npm install -g /tmp/guardscan.tgz
    guardscan --version
  '
```

**Expected output:**

```
GuardScan ASCII art logo
1.0.4
```

### 4.2: Test Init Command

```bash
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts sh -c '
    npm install -g /tmp/guardscan.tgz
    guardscan init --no-telemetry
  '
```

### 4.3: Test Security Scan

```bash
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts sh -c '
    npm install -g /tmp/guardscan.tgz
    guardscan security --files sample.ts --no-telemetry
  '
```

### 4.4: Test Other Commands

```bash
# Test run command
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts sh -c '
    npm install -g /tmp/guardscan.tgz
    guardscan run --no-telemetry
  '

# Test scan command
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts sh -c '
    npm install -g /tmp/guardscan.tgz
    guardscan scan --no-telemetry
  '
```

## Step 5: Quick Test Script

For convenience, here's a complete test script you can save and run:

```bash
#!/bin/bash
# Quick Docker test script for GuardScan

set -euo pipefail

# Configuration
CLI_DIR="/path/to/GuardScan/cli"  # Update this path
PACKAGE_FILE="$CLI_DIR/guardscan-1.0.4.tgz"  # Update version if needed

# Create test project
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

cat > "$TMP_DIR/sample.ts" << 'EOF'
export function hello(name: string): string {
  return `Hello ${name}`;
}
EOF

cat > "$TMP_DIR/package.json" << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF

echo "🧪 Testing GuardScan in Alpine..."
docker run --rm \
  -v "$TMP_DIR":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine sh -c '
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
      libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
    npm install -g /tmp/guardscan.tgz
    echo "✓ Alpine: guardscan --version"
    guardscan --version
  '

echo ""
echo "🧪 Testing GuardScan in Debian..."
docker run --rm \
  -v "$TMP_DIR":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts sh -c '
    npm install -g /tmp/guardscan.tgz
    echo "✓ Debian: guardscan --version"
    guardscan --version
  '

echo ""
echo "✅ All tests completed!"
```

Save this as `test-docker.sh`, make it executable (`chmod +x test-docker.sh`), and run it.

## Step 6: Using the Automated Test Script

The repository includes an automated test script that tests all commands:

```bash
# From the GuardScan root directory
cd /path/to/GuardScan

# Run all tests (local + Docker)
./cli/scripts/test-all-commands.sh

# Run only Docker tests
./cli/scripts/test-all-commands.sh --docker-only

# Run with verbose output
./cli/scripts/test-all-commands.sh --docker-only --verbose
```

## Troubleshooting

### Issue: "Cannot find module 'typescript'"

**Solution:** TypeScript should be installed automatically. If not:

```bash
# Inside Docker container
npm install -g typescript
```

### Issue: "canvas: build failed" (Alpine)

**Solution:** Ensure all build dependencies are installed:

```bash
apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
  libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
```

### Issue: "guardscan: command not found"

**Solution:** Check if guardscan is in PATH:

```bash
# Inside Docker container
which guardscan
npm list -g guardscan
npm config get prefix
```

If not found, try:

```bash
# Use full path
/usr/local/bin/guardscan --version

# Or use npx
npx guardscan --version
```

### Issue: Docker volume mount errors

**Solution:** Ensure:
1. Paths use absolute paths (not relative)
2. Files exist before mounting
3. Docker has permission to access the paths

### Issue: Slow npm install in Alpine

**Solution:** This is normal - Alpine needs to compile native modules. The first install takes longer. Subsequent runs are faster if you reuse the same container or use a pre-built image.

## Key Differences: Alpine vs Debian

| Aspect             | Alpine                           | Debian               |
| ------------------ | -------------------------------- | -------------------- |
| **Base Image**     | `node:lts-alpine`                | `node:lts`           |
| **Size**           | ~50MB                            | ~900MB               |
| **Build Tools**    | Must install manually            | Pre-installed        |
| **Install Time**   | Slower (compiles native modules) | Faster               |
| **apk Command**    | `apk add`                        | N/A (uses `apt-get`) |
| **Setup Required** | Install build deps first         | Ready to use         |

## Summary

1. **Alpine**: Requires installing build dependencies before `npm install`
2. **Debian**: Works out of the box (build tools pre-installed)
3. **Both**: Use the same Docker volume mount pattern
4. **Automated**: Use `./cli/scripts/test-all-commands.sh --docker-only` for comprehensive testing

## Next Steps

- Test all 21 CLI commands in both environments
- Test with different Node.js versions (`node:18-alpine`, `node:20-alpine`, etc.)
- Test with different flag combinations
- Integrate into CI/CD pipeline


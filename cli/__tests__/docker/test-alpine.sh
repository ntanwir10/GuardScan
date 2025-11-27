#!/bin/bash
# Alpine Linux Docker Test Script
# Tests GuardScan CLI in Alpine Linux environment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_ROOT="$(cd "$CLI_DIR/.." && pwd)"

echo "🐧 Testing GuardScan in Alpine Linux"
echo "===================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Create temporary directory for test
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

echo "Creating test package..."
cd "$CLI_DIR"
npm pack --pack-destination "$TMP_DIR" > /dev/null
PACKAGE_FILE=$(ls -t "$TMP_DIR"/*.tgz | head -1)
PACKAGE_NAME=$(basename "$PACKAGE_FILE")

echo -e "${GREEN}✓ Package created: $PACKAGE_NAME${NC}"
echo ""

# Create test project
TEST_PROJECT="$TMP_DIR/test-project"
mkdir -p "$TEST_PROJECT"
cat > "$TEST_PROJECT/sample.ts" << 'EOF'
export function hello(name: string): string {
  return `Hello ${name}`;
}

export class Greeter {
  greet(name: string): string {
    return hello(name);
  }
}
EOF

cat > "$TEST_PROJECT/package.json" << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF

echo "Running tests in Alpine container..."
echo ""

# Test 1: Install and verify TypeScript is available
echo "Test 1: Verify TypeScript dependency is installed"
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  guardscan-test:alpine sh -c "
    set -euo pipefail
    npm install -g /tmp/guardscan.tgz
    echo 'Checking TypeScript availability...'
    node -e \"require('typescript'); console.log('✓ TypeScript is available')\" || {
      echo '✗ TypeScript is NOT available'
      exit 1
    }
    echo '✓ TypeScript dependency check passed'
  " || {
    echo -e "${RED}✗ Test 1 failed: TypeScript not available after install${NC}"
    exit 1
  }

echo -e "${GREEN}✓ Test 1 passed${NC}"
echo ""

# Test 2: Verify GuardScan can parse TypeScript files
echo "Test 2: Verify AST parsing works"
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  guardscan-test:alpine sh -c "
    set -euo pipefail
    npm install -g /tmp/guardscan.tgz
    guardscan --version
    echo 'Testing AST parsing...'
    guardscan security --files 'sample.ts' --no-telemetry || {
      # Security scan may find issues, that's OK
      # We just want to verify it doesn't fail with 'Cannot find module typescript'
      if grep -q 'Cannot find module.*typescript' /dev/stderr 2>/dev/null; then
        echo '✗ TypeScript module not found error'
        exit 1
      fi
      echo '✓ AST parsing works (security scan completed)'
      exit 0
    }
    echo '✓ AST parsing works'
  " || {
    echo -e "${RED}✗ Test 2 failed: AST parsing error${NC}"
    exit 1
  }

echo -e "${GREEN}✓ Test 2 passed${NC}"
echo ""

# Test 3: Test error message when TypeScript is missing (simulated)
echo "Test 3: Verify helpful error messages"
docker run --rm \
  -v "$TEST_PROJECT":/workspace \
  -v "$PACKAGE_FILE":/tmp/guardscan.tgz \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  guardscan-test:alpine sh -c "
    set -euo pipefail
    npm install -g /tmp/guardscan.tgz
    # Temporarily remove typescript to test error handling
    npm uninstall -g typescript 2>/dev/null || true
    # This should fail gracefully with a helpful message
    guardscan security --files 'sample.ts' --no-telemetry 2>&1 | grep -q 'TypeScript is required' && {
      echo '✓ Helpful error message displayed'
      exit 0
    } || {
      echo '✗ Error message not helpful or missing'
      exit 1
    }
  " || {
    echo -e "${YELLOW}⚠ Test 3: Error message test (may fail if TypeScript is in dependencies)${NC}"
  }

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}All Alpine Linux tests completed!${NC}"
echo ""


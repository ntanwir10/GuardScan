#!/bin/bash
# Docker Test Setup Script
# Sets up a clean Docker environment for testing GuardScan CLI

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_ROOT="$(cd "$CLI_DIR/.." && pwd)"

echo "🐳 GuardScan Docker Test Setup"
echo "================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed or not in PATH${NC}"
    echo "Please install Docker to run these tests."
    exit 1
fi

echo -e "${GREEN}✓ Docker is available${NC}"

# Check if we can run Docker
if ! docker ps &> /dev/null; then
    echo -e "${RED}✗ Cannot run Docker commands${NC}"
    echo "Make sure Docker daemon is running and you have permissions."
    exit 1
fi

echo -e "${GREEN}✓ Docker daemon is running${NC}"
echo ""

# Build test image
echo "Building test Docker image..."
docker build -t guardscan-test:alpine -f "$SCRIPT_DIR/Dockerfile.test" "$PROJECT_ROOT" || {
    echo -e "${RED}✗ Failed to build Docker image${NC}"
    exit 1
}

echo -e "${GREEN}✓ Test Docker image built successfully${NC}"
echo ""

echo "Setup complete! You can now run:"
echo "  - ./test-alpine.sh - Test in Alpine Linux"
echo "  - ./test-debian.sh - Test in Debian-based Linux"
echo ""


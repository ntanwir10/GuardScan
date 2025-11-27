# Docker Test Infrastructure

This directory contains Docker test infrastructure for validating GuardScan CLI in various containerized environments.

## Overview

The Docker tests verify that:

- TypeScript dependency is correctly installed and available
- AST parsing works correctly in Docker environments
- Error messages are helpful when dependencies are missing
- Commands that require TypeScript work correctly

## Files

- `Dockerfile.test` - Test Docker image based on Alpine Linux
- `docker-compose.test.yml` - Docker Compose configuration for testing
- `docker-test-setup.sh` - Setup script to build test image
- `test-alpine.sh` - Alpine Linux specific tests
- `test-debian.sh` - Debian-based Linux tests

## Usage

### Setup

First, build the test Docker image:

```bash
./docker-test-setup.sh
```

### Run Tests

**Alpine Linux tests:**

```bash
./test-alpine.sh
```

**Debian-based tests:**

```bash
./test-debian.sh
```

### Manual Testing

You can also run manual tests:

```bash
# Build test image
docker build -t guardscan-test:alpine -f Dockerfile.test ../../

# Run interactive shell
docker run -it --rm guardscan-test:alpine sh

# Inside container:
npm install -g /path/to/guardscan.tgz
guardscan --version
guardscan security --files 'sample.ts'
```

## Test Scenarios

1. **Dependency Availability**: Verifies TypeScript is available after npm install
2. **AST Parsing**: Tests that AST parsing works correctly in Docker
3. **Error Messages**: Validates helpful error messages when dependencies are missing
4. **Command Execution**: Tests that commands requiring TypeScript work correctly

## Troubleshooting

If tests fail:

1. **Check Docker is running**: `docker ps`
2. **Verify image was built**: `docker images | grep guardscan-test`
3. **Check package was created**: Ensure `npm pack` was run in cli directory
4. **Enable debug mode**: Set `GUARDSCAN_DEBUG=true` in test scripts

## Integration with CI

These tests are designed to be run manually first. Future integration with CI/CD pipeline is planned.


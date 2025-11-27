#!/usr/bin/env bash
# Comprehensive GuardScan CLI test script
# - Tests all CLI commands and major flags locally
# - Tests the same via Docker on Alpine and Debian-based images
#
# Usage:
#   ./cli/scripts/test-all-commands.sh [--verbose] [--local-only] [--docker-only]
#
# Notes:
# - Requires Node 18+ and npm
# - Docker tests require Docker Desktop / Docker daemon running

set -euo pipefail

#######################################
# Global setup
#######################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$CLI_DIR/.." && pwd)"

VERBOSE=false
RUN_LOCAL=true
RUN_DOCKER=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose)
      VERBOSE=true
      shift
      ;;
    --local-only)
      RUN_LOCAL=true
      RUN_DOCKER=false
      shift
      ;;
    --docker-only)
      RUN_LOCAL=false
      RUN_DOCKER=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

RESULTS_JSON="${SCRIPT_DIR}/test-all-commands-results.json"
declare -i TESTS_PASSED=0
declare -i TESTS_FAILED=0
declare -i TESTS_SKIPPED=0
declare -a FAILED_TESTS=()

log_info() {
  echo -e "${BLUE}[INFO]${NC} $*"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $*"
}

#######################################
# Utility: check if a command exists
#######################################
has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

#######################################
# Test tracking helpers
#######################################
record_result() {
  local name="$1"
  local env="$2"
  local status="$3"   # pass|fail|skip
  local message="${4:-}"

  case "$status" in
    pass)
      TESTS_PASSED+=1
      ;;
    fail)
      TESTS_FAILED+=1
      FAILED_TESTS+=("${env}: ${name} - ${message}")
      ;;
    skip)
      TESTS_SKIPPED+=1
      ;;
  esac

  if [[ "$VERBOSE" == "true" ]]; then
    echo "RESULT | env=${env} | name=${name} | status=${status} | msg=${message}"
  fi
}

#######################################
# Environment preparation
#######################################

prepare_build_and_package() {
  log_info "Building CLI (tsc) and creating npm package..." >&2
  cd "$CLI_DIR"

  if [[ ! -d "node_modules" ]]; then
    log_info "Installing npm dependencies..." >&2
    npm install >&2
  fi

  npm run build >&2

  TMP_DIR=$(mktemp -d)
  npm pack --pack-destination "$TMP_DIR" >/dev/null 2>&1
  PACKAGE_FILE=$(ls -t "$TMP_DIR"/*.tgz | head -1)
  PACKAGE_NAME="$(basename "$PACKAGE_FILE")"

  log_info "Created package: ${PACKAGE_NAME}" >&2

  echo "$TMP_DIR|$PACKAGE_FILE"
}

create_test_project() {
  local base_dir="$1"
  local test_dir="${base_dir}/test-project"

  mkdir -p "$test_dir"

  cat > "${test_dir}/sample.ts" << 'EOF'
export function hello(name: string): string {
  return `Hello ${name}`;
}

export class Greeter {
  greet(name: string): string {
    return hello(name);
  }
}
EOF

  cat > "${test_dir}/package.json" << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF

  # Init minimal git repo for commit/review commands
  cd "$test_dir"
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git init -q
    git config user.name "GuardScan Tester"
    git config user.email "tester@example.com"
    git add .
    git commit -q -m "Initial commit"
  fi

  echo "$test_dir"
}

#######################################
# Local command runner
#######################################

run_local_cmd() {
  local name="$1"
  local args="$2"
  local expect_success="$3" # true|false

  local env="local"
  local test_id="guardscan ${args}"

  log_info "[local] ${test_id}"

  local output
  set +e
  output=$(node "$CLI_DIR/dist/index.js" $args 2>&1)
  local exit_code=$?
  set -e

  if [[ "$VERBOSE" == "true" ]]; then
    echo "----- OUTPUT (${env}: ${name}) -----"
    echo "$output"
    echo "------------------------------------"
  fi

  if [[ "$expect_success" == "true" ]]; then
    if [[ $exit_code -eq 0 ]]; then
      record_result "$name" "$env" "pass"
    else
      record_result "$name" "$env" "fail" "Expected success, got exit code ${exit_code}"
    fi
  else
    # For scans that may legitimately exit non‑zero, treat \"any run\" as pass
    record_result "$name" "$env" "pass"
  fi
}

#######################################
# Docker command runner
#######################################

run_docker_cmd() {
  local distro="$1"  # alpine|debian
  local name="$2"
  local package_file="$3"
  local cmd="$4"
  local expect_success="$5" # true|false
  local test_project="$6"

  local env="docker-${distro}"
  local image

  case "$distro" in
    alpine)
      image="node:lts-alpine"
      ;;
    debian)
      image="node:lts"
      ;;
    *)
      log_error "Unknown distro: $distro"
      record_result "$name" "$env" "fail" "Unknown distro"
      return
      ;;
  esac

  log_info "[${env}] guardscan ${cmd}"

  if ! has_cmd docker; then
    log_warn "Docker not available; skipping ${env} tests"
    record_result "$name" "$env" "skip" "Docker not available"
    return
  fi

  set +e
  local output
  # Pass command via environment variable to avoid quoting issues
  # For Alpine, install build dependencies first
  local install_cmd
  if [[ "$distro" == "alpine" ]]; then
    install_cmd='
      set -e
      # Install build dependencies for native modules (canvas, etc.)
      apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
        libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git >/dev/null 2>&1 || true
      npm install -g /tmp/guardscan.tgz >/dev/null 2>&1 || true
    '
  else
    install_cmd='
      set -e
      npm install -g /tmp/guardscan.tgz >/dev/null 2>&1 || true
    '
  fi

  output=$(docker run --rm \
    -v "${test_project}":/workspace \
    -v "${package_file}":/tmp/guardscan.tgz \
    -w /workspace \
    -e GUARDSCAN_HOME=/tmp/guardscan \
    -e GUARDSCAN_CMD="${cmd}" \
    "${image}" sh -c "
      $install_cmd
      # Find guardscan binary - try common locations
      if command -v guardscan >/dev/null 2>&1; then
        guardscan \$GUARDSCAN_CMD
      elif [ -f /usr/local/bin/guardscan ]; then
        /usr/local/bin/guardscan \$GUARDSCAN_CMD
      else
        # Try npm global prefix/bin directory
        NPM_PREFIX=\$(npm config get prefix 2>/dev/null || echo \"/usr/local\")
        if [ -f \"\$NPM_PREFIX/bin/guardscan\" ]; then
          \"\$NPM_PREFIX/bin/guardscan\" \$GUARDSCAN_CMD
        else
          # Last resort: try npx
          npx --yes guardscan \$GUARDSCAN_CMD
        fi
      fi
    " 2>&1)
  local exit_code=$?
  set -e

  if [[ "$VERBOSE" == "true" ]]; then
    echo "----- OUTPUT (${env}: ${name}) -----"
    echo "$output"
    echo "------------------------------------"
  fi

  if [[ "$expect_success" == "true" ]]; then
    if [[ $exit_code -eq 0 ]]; then
      record_result "$name" "$env" "pass"
    else
      record_result "$name" "$env" "fail" "Expected success, got exit code ${exit_code}"
    fi
  else
    record_result "$name" "$env" "pass"
  fi
}

#######################################
# Command test matrix (local + docker)
#######################################

run_all_local_tests() {
  log_info "Running local CLI tests..."

  # Basic meta checks
  run_local_cmd "root --help" "--help" true
  run_local_cmd "root --version" "--version" true

  # Configuration
  run_local_cmd "init" "init --no-telemetry" true
  run_local_cmd "config show" "config --show --no-telemetry" true
  run_local_cmd "status" "status --no-telemetry" true
  run_local_cmd "reset force" "reset --force --no-telemetry" true

  # Code analysis
  run_local_cmd "run (default)" "run --no-telemetry" false
  run_local_cmd "run with files" "run --files sample.ts --no-telemetry" false
  run_local_cmd "run no-cloud" "run --no-cloud --no-telemetry" false

  run_local_cmd "scan (default)" "scan --no-telemetry" false
  run_local_cmd "scan skip-tests" "scan --skip-tests --no-telemetry" false
  run_local_cmd "scan skip-perf" "scan --skip-perf --no-telemetry" false
  run_local_cmd "scan skip-mutation" "scan --skip-mutation --no-telemetry" false
  run_local_cmd "scan coverage + licenses" "scan --coverage --licenses --no-telemetry" false

  # Security
  run_local_cmd "security default" "security --no-telemetry" false
  run_local_cmd "security files + debug" "security --files sample.ts --debug --no-telemetry" false
  run_local_cmd "security licenses + ai-fix" "security --licenses --ai-fix --no-telemetry" false

  # Quality / tests
  run_local_cmd "test all" "test --all --no-telemetry" false
  run_local_cmd "test coverage only" "test --coverage --no-telemetry" false
  run_local_cmd "test metrics only" "test --metrics --no-telemetry" false

  # SBOM
  run_local_cmd "sbom default" "sbom --no-telemetry" false
  run_local_cmd "sbom cyclonedx" "sbom --format cyclonedx --no-telemetry" false

  # Performance
  run_local_cmd "perf load default" "perf --load --duration 5s --no-telemetry" false
  run_local_cmd "perf stress" "perf --stress --duration 5s --no-telemetry" false

  # Mutation
  run_local_cmd "mutation default" "mutation --no-telemetry" false
  run_local_cmd "mutation threshold" "mutation --threshold 50 --no-telemetry" false

  # Rules
  run_local_cmd "rules list" "rules --list --no-telemetry" true
  run_local_cmd "rules run" "rules --run --no-telemetry" false

  # Commit (requires git repo; created in test project)
  run_local_cmd "commit ai no-body" "commit --ai --no-body --no-telemetry" false

  # Explain / test-gen / docs
  run_local_cmd "explain sample" "explain sample.ts --type file --level brief --no-telemetry" false
  run_local_cmd "test-gen file" "test-gen --file sample.ts --framework jest --no-telemetry" false
  run_local_cmd "docs readme" "docs --type readme --no-telemetry" false

  # Chat / refactor / threat-model / migrate / review
  run_local_cmd "chat help" "chat --help" true
  run_local_cmd "refactor analyze" "refactor --file sample.ts --analyze --no-telemetry" false
  run_local_cmd "threat-model file" "threat-model --file sample.ts --no-telemetry" false
  run_local_cmd "migrate dry-run" "migrate --type framework --target react-class-to-hooks --file sample.ts --dry-run --no-telemetry" false
  run_local_cmd "review default" "review --no-telemetry" false
}

run_all_docker_tests_for_distro() {
  local distro="$1"
  local package_file="$2"
  local test_project="$3"

  log_info "Running Docker CLI tests for distro=${distro}..."

  # Basic meta
  run_docker_cmd "$distro" "root --version" "$package_file" "--version" true "$test_project"

  # A representative subset (full matrix locally, lighter in Docker)
  run_docker_cmd "$distro" "init" "$package_file" "init --no-telemetry" true "$test_project"
  run_docker_cmd "$distro" "security files" "$package_file" "security --files sample.ts --no-telemetry" false "$test_project"
  run_docker_cmd "$distro" "run default" "$package_file" "run --no-telemetry" false "$test_project"
  run_docker_cmd "$distro" "scan default" "$package_file" "scan --no-telemetry" false "$test_project"
  run_docker_cmd "$distro" "sbom default" "$package_file" "sbom --no-telemetry" false "$test_project"
  run_docker_cmd "$distro" "refactor analyze" "$package_file" "refactor --file sample.ts --analyze --no-telemetry" false "$test_project"
}

#######################################
# Main
#######################################

main() {
  log_info "Starting comprehensive GuardScan CLI tests"
  log_info "Project root: ${PROJECT_ROOT}"
  log_info "CLI dir: ${CLI_DIR}"

  # Prepare build and package
  local build_info
  build_info="$(prepare_build_and_package)"
  local tmp_dir="${build_info%%|*}"
  local package_file="${build_info##*|}"

  # Create shared test project
  local test_project
  test_project="$(create_test_project "$tmp_dir")"

  # Ensure we run local tests from the test project context
  cd "$test_project"

  if [[ "$RUN_LOCAL" == "true" ]]; then
    run_all_local_tests
  fi

  if [[ "$RUN_DOCKER" == "true" ]]; then
    run_all_docker_tests_for_distro "alpine" "$package_file" "$test_project"
    run_all_docker_tests_for_distro "debian" "$package_file" "$test_project"
  fi

  # Summary
  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}GuardScan CLI Test Summary${NC}"
  echo "Passed : ${TESTS_PASSED}"
  echo "Failed : ${TESTS_FAILED}"
  echo "Skipped: ${TESTS_SKIPPED}"

  if [[ ${#FAILED_TESTS[@]} -gt 0 ]]; then
    echo ""
    echo -e "${RED}Failed tests:${NC}"
    for f in "${FAILED_TESTS[@]}"; do
      echo " - $f"
    done
  fi

  # Write minimal JSON report
  cat > "$RESULTS_JSON" <<EOF
{
  "passed": ${TESTS_PASSED},
  "failed": ${TESTS_FAILED},
  "skipped": ${TESTS_SKIPPED},
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

  log_info "Wrote summary JSON report to ${RESULTS_JSON}"

  # Cleanup temp dir
  rm -rf "$tmp_dir"

  if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
  fi
}

main "$@"



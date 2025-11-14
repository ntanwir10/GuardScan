#!/bin/bash
# GuardScan Backend - Verify Deployment Setup
# This script verifies that your deployment is working correctly
# Usage: ./scripts/verify-setup.sh [worker-url]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Worker URL (from argument or prompt)
WORKER_URL="${1}"

if [ -z "$WORKER_URL" ]; then
    echo -e "${YELLOW}Enter your Cloudflare Worker URL:${NC}"
    echo -e "${YELLOW}Example: https://guardscan-backend.yourname.workers.dev${NC}"
    read -p "Worker URL: " WORKER_URL
fi

# Remove trailing slash if present
WORKER_URL="${WORKER_URL%/}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}GuardScan Backend - Deployment Verification${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${BLUE}Testing: ${WORKER_URL}${NC}"
echo ""

# Function to test an endpoint
test_endpoint() {
    local method=$1
    local path=$2
    local description=$3
    local data=$4

    echo -e "${BLUE}Testing: ${description}${NC}"
    echo -e "${YELLOW}${method} ${path}${NC}"

    if [ -n "$data" ]; then
        response=$(curl -s -X "$method" "${WORKER_URL}${path}" \
            -H "Content-Type: application/json" \
            -d "$data" \
            -w "\nHTTP_STATUS:%{http_code}")
    else
        response=$(curl -s -X "$method" "${WORKER_URL}${path}" \
            -w "\nHTTP_STATUS:%{http_code}")
    fi

    http_code=$(echo "$response" | grep HTTP_STATUS | cut -d: -f2)
    body=$(echo "$response" | sed '/HTTP_STATUS/d')

    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✓ Success (HTTP $http_code)${NC}"
        echo -e "${GREEN}Response: ${body}${NC}"
    elif [ "$http_code" -ge 400 ] && [ "$http_code" -lt 500 ]; then
        echo -e "${YELLOW}⚠ Client Error (HTTP $http_code)${NC}"
        echo -e "${YELLOW}Response: ${body}${NC}"
        echo -e "${YELLOW}This may be expected for some endpoints${NC}"
    else
        echo -e "${RED}✗ Error (HTTP $http_code)${NC}"
        echo -e "${RED}Response: ${body}${NC}"
    fi

    echo ""
}

# Test 1: Health Check
test_endpoint "GET" "/api/health" "Health Check"

# Test 2: Validate Endpoint (should fail with invalid client_id)
test_endpoint "POST" "/api/validate" "Credit Validation (Expected Failure)" \
    '{"client_id":"test-invalid","loc":1000}'

# Test 3: Credits Endpoint (should fail with invalid client_id)
test_endpoint "GET" "/api/credits/test-invalid" "Get Credits (Expected Failure)"

# Test 4: Telemetry Endpoint
test_endpoint "POST" "/api/telemetry" "Telemetry Ingestion" \
    '{"events":[{"client_id":"test","repo_id":"test-repo","action_type":"init","duration_ms":1000,"timestamp":"'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"}]}'

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Verification Complete${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${YELLOW}What to check:${NC}"
echo -e "  1. Health check should return HTTP 200"
echo -e "  2. Other endpoints may return errors if:"
echo -e "     - Supabase secrets not set"
echo -e "     - Database not migrated"
echo -e "     - Test client_id doesn't exist"
echo ""

echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. If health check fails: Check deployment logs with ${BLUE}wrangler tail${NC}"
echo -e "  2. If database errors: Verify Supabase setup (see SUPABASE_SETUP.md)"
echo -e "  3. If everything works: Create a real client with ${BLUE}guardscan init${NC}"
echo ""

echo -e "${GREEN}✓ Verification script complete${NC}"

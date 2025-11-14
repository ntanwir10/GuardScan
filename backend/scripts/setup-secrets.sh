#!/bin/bash
# GuardScan Backend - Setup Secrets for Cloudflare Workers
# This script helps you set up required secrets for deployment
# Usage: ./scripts/setup-secrets.sh [environment]
# Environment: development (default), staging, production

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Environment (default to development)
ENVIRONMENT="${1:-development}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}GuardScan Backend - Secrets Setup${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}Error: wrangler CLI not found${NC}"
    echo -e "${YELLOW}Install with: npm install -g wrangler${NC}"
    exit 1
fi

# Check if logged in
echo -e "${BLUE}Checking Cloudflare authentication...${NC}"
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}Not logged in to Cloudflare.${NC}"
    echo -e "${BLUE}Running 'wrangler login'...${NC}"
    wrangler login
fi

echo -e "${GREEN}✓ Authenticated${NC}"
echo ""

# Function to set a secret
set_secret() {
    local secret_name=$1
    local description=$2
    local example=$3

    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Setting: ${secret_name}${NC}"
    echo -e "${YELLOW}${description}${NC}"
    if [ -n "$example" ]; then
        echo -e "${YELLOW}Example: ${example}${NC}"
    fi
    echo ""

    # Check if secret already exists
    if wrangler secret list 2>/dev/null | grep -q "^${secret_name}"; then
        echo -e "${YELLOW}Secret '${secret_name}' already exists.${NC}"
        read -p "Do you want to update it? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}Skipping ${secret_name}${NC}"
            echo ""
            return
        fi
    fi

    # Set the secret
    if [ "$ENVIRONMENT" = "production" ]; then
        wrangler secret put "$secret_name" --env production
    elif [ "$ENVIRONMENT" = "staging" ]; then
        wrangler secret put "$secret_name" --env staging
    else
        wrangler secret put "$secret_name"
    fi

    echo -e "${GREEN}✓ ${secret_name} set successfully${NC}"
    echo ""
}

# Required secrets
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Required Secrets for GuardScan Backend${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

set_secret "SUPABASE_URL" \
    "Your Supabase Project URL" \
    "https://xxxxxxxxxxxxx.supabase.co"

set_secret "SUPABASE_KEY" \
    "Your Supabase service_role key (NOT anon key!)" \
    "eyJhbGci..."

# Optional: Stripe secrets
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Optional: Stripe Payment Integration${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

read -p "Do you want to set up Stripe secrets? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    set_secret "STRIPE_SECRET_KEY" \
        "Your Stripe Secret Key (from https://dashboard.stripe.com/apikeys)" \
        "sk_test_... or sk_live_..."

    set_secret "STRIPE_WEBHOOK_SECRET" \
        "Your Stripe Webhook Secret (from Webhooks settings)" \
        "whsec_..."
else
    echo -e "${YELLOW}Skipping Stripe setup. You can set these later with:${NC}"
    echo -e "${YELLOW}  wrangler secret put STRIPE_SECRET_KEY${NC}"
    echo -e "${YELLOW}  wrangler secret put STRIPE_WEBHOOK_SECRET${NC}"
fi

# Summary
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Secrets Setup Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${GREEN}Current secrets:${NC}"
wrangler secret list

echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Verify secrets are correct"
echo -e "  2. Run: ${BLUE}npm run deploy${NC} (or wrangler deploy)"
echo -e "  3. Test your deployment: ${BLUE}curl https://YOUR-WORKER-URL/api/health${NC}"
echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"

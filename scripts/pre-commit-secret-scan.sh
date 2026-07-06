#!/bin/bash
# ============================================================
# BizBook Pro — Pre-commit Secret Scanner
# ============================================================
# Scans staged files for common secret patterns before commit.
# If any secret is found, the commit is BLOCKED.
# Install: cp scripts/pre-commit-secret-scan.sh .git/hooks/pre-commit
#          chmod +x .git/hooks/pre-commit
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🔍 Scanning staged files for secrets..."

# Get list of staged files
FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -v -E '\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|pdf|mp4|webm)$')

if [ -z "$FILES" ]; then
    echo -e "${GREEN}✅ No text files to scan${NC}"
    exit 0
fi

SECRETS_FOUND=0

# Patterns to detect
PATTERNS=(
    "rzp_live_[a-zA-Z0-9]{10,}"
    "rzp_test_[a-zA-Z0-9]{10,}"
    "xkeysib-[a-f0-9]{20,}"
    "sk_live_[a-zA-Z0-9]{20,}"
    "sk_test_[a-zA-Z0-9]{20,}"
    "sk-ant-[a-zA-Z0-9]{20,}"
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+"
    "postgresql://[a-zA-Z0-9]+:[a-zA-Z0-9]+@.*railway"
    "postgres://[a-zA-Z0-9]+:[a-zA-Z0-9]+@.*railway"
    "AKIA[0-9A-Z]{16}"
    "ghp_[a-zA-Z0-9]{36}"
    "gho_[a-zA-Z0-9]{36}"
)

PATTERN_NAMES=(
    "Razorpay Live Key"
    "Razorpay Test Key"
    "Brevo/Sendinblue API Key"
    "Stripe Live Key"
    "Stripe Test Key"
    "Anthropic API Key"
    "JWT Token"
    "PostgreSQL Railway URL"
    "Postgres Railway URL"
    "AWS Access Key"
    "GitHub Personal Access Token"
    "GitHub OAuth Token"
)

for FILE in $FILES; do
    if [ ! -f "$FILE" ]; then
        continue
    fi

    for i in "${!PATTERNS[@]}"; do
        PATTERN="${PATTERNS[$i]}"
        NAME="${PATTERN_NAMES[$i]}"

        if grep -qE "$PATTERN" "$FILE" 2>/dev/null; then
            echo -e "${RED}❌ SECRET DETECTED: ${NAME} in ${FILE}${NC}"
            grep -nE "$PATTERN" "$FILE" 2>/dev/null | head -3
            SECRETS_FOUND=1
        fi
    done
done

if [ $SECRETS_FOUND -eq 1 ]; then
    echo ""
    echo -e "${RED}❌ COMMIT BLOCKED: Secrets detected in staged files!${NC}"
    echo -e "${YELLOW}To fix:${NC}"
    echo "  1. Remove the secret from the file"
    echo "  2. Use environment variables instead (process.env.SECRET_NAME)"
    echo "  3. Add the file to .gitignore if it's a config file"
    echo "  4. If the secret was already committed, ROTATE IT IMMEDIATELY"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ No secrets detected — commit allowed${NC}"
exit 0

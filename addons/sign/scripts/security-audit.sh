#!/bin/bash

# Security Audit Script for SynergySign
# Run this script to check privacy and encryption controls

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  SynergySign Security Audit${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to print section headers
print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

# Function to print success
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Function to print warning
print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Function to print error
print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# 1. Check Environment Variables
print_header "1. Environment Variables Security"

if [ -f .env ]; then
    # Check for NEXTAUTH_SECRET
    if grep -q "NEXTAUTH_SECRET=" .env; then
        SECRET=$(grep "NEXTAUTH_SECRET=" .env | cut -d '=' -f 2)
        if [ ${#SECRET} -ge 32 ]; then
            print_success "NEXTAUTH_SECRET is set and long enough (${#SECRET} chars)"
        else
            print_warning "NEXTAUTH_SECRET is too short (${#SECRET} chars, should be 32+)"
        fi
    else
        print_error "NEXTAUTH_SECRET is not set"
    fi

    # Check for DATABASE_URL encryption
    if grep -q "DATABASE_URL=" .env; then
        DB_URL=$(grep "DATABASE_URL=" .env | cut -d '=' -f 2)
        if [[ $DB_URL == *"sslmode=require"* ]] || [[ $DB_URL == *"ssl=true"* ]]; then
            print_success "Database connection uses SSL"
        else
            print_warning "Database connection should use SSL"
        fi
    else
        print_error "DATABASE_URL is not set"
    fi

    # Check for AWS credentials
    if grep -q "AWS_ACCESS_KEY_ID=" .env; then
        print_success "AWS credentials are configured"
    else
        print_warning "AWS credentials not found"
    fi

    # Check for Stripe keys
    if grep -q "STRIPE_SECRET_KEY=" .env; then
        STRIPE_KEY=$(grep "STRIPE_SECRET_KEY=" .env | cut -d '=' -f 2)
        if [[ $STRIPE_KEY == sk_live_* ]]; then
            print_warning "Using LIVE Stripe key (make sure this is production)"
        elif [[ $STRIPE_KEY == sk_test_* ]]; then
            print_success "Using TEST Stripe key"
        fi
    else
        print_error "STRIPE_SECRET_KEY is not set"
    fi
else
    print_error ".env file not found"
fi

echo ""

# 2. Check HTTPS Configuration
print_header "2. HTTPS/TLS Configuration"

if [ -f next.config.js ]; then
    if grep -q "redirects" next.config.js; then
        print_success "Next.js redirects configured (check if HTTP→HTTPS)"
    fi
fi

# Check NEXTAUTH_URL protocol
if [ -f .env ]; then
    NEXTAUTH_URL=$(grep "NEXTAUTH_URL=" .env | cut -d '=' -f 2 | tr -d '"' | tr -d "'")
    if [[ $NEXTAUTH_URL == https://* ]]; then
        print_success "NEXTAUTH_URL uses HTTPS"
    else
        print_warning "NEXTAUTH_URL should use HTTPS in production"
    fi
fi

echo ""

# 3. Check Database Encryption
print_header "3. Database Security"

# Check if prisma is configured
if [ -f prisma/schema.prisma ]; then
    print_success "Prisma schema found"

    # Count models (approximate security surface)
    MODEL_COUNT=$(grep -c "^model " prisma/schema.prisma || echo "0")
    print_success "Found $MODEL_COUNT database models"
else
    print_error "Prisma schema not found"
fi

echo ""

# 4. Check Dependencies for Vulnerabilities
print_header "4. Dependency Security Audit"

echo "Running npm audit..."
npm audit --production 2>&1 | head -30

echo ""
print_warning "Review vulnerabilities above and run: npm audit fix"

echo ""

# 5. Check File Permissions
print_header "5. File Permissions"

# Check .env permissions
if [ -f .env ]; then
    PERMS=$(stat -c %a .env 2>/dev/null || stat -f %A .env 2>/dev/null)
    if [ "$PERMS" = "600" ] || [ "$PERMS" = "400" ]; then
        print_success ".env file has secure permissions ($PERMS)"
    else
        print_warning ".env file permissions should be 600 (currently: $PERMS)"
        echo "  Run: chmod 600 .env"
    fi
fi

# Check for sensitive files
if [ -f "prisma/dev.db" ]; then
    print_warning "SQLite dev database found - should not be in production"
fi

if [ -d ".git" ]; then
    # Check if .env is in .gitignore
    if grep -q "^\.env$" .gitignore 2>/dev/null; then
        print_success ".env is in .gitignore"
    else
        print_error ".env should be in .gitignore"
    fi
fi

echo ""

# 6. Check Security Headers
print_header "6. Security Headers Configuration"

if [ -f next.config.js ]; then
    if grep -q "headers" next.config.js; then
        print_success "Security headers configured in next.config.js"
    else
        print_warning "Security headers not found in next.config.js"
    fi
fi

echo ""

# 7. Check Password Hashing
print_header "7. Password Security"

if grep -rq "bcrypt" package.json; then
    print_success "bcrypt library installed for password hashing"
else
    print_error "bcrypt not found - passwords may not be hashed!"
fi

# Check for plain password storage (basic check)
if grep -rq "password.*=.*req.body" app/ 2>/dev/null; then
    print_warning "Possible plain password handling found - verify hashing"
fi

echo ""

# 8. Run Security Tests
print_header "8. Running Security Tests"

if [ -f "__tests__/security/encryption.test.ts" ]; then
    echo "Running encryption tests..."
    npm test -- __tests__/security/encryption.test.ts --no-coverage 2>&1 | tail -20
else
    print_warning "Security tests not found"
fi

echo ""

# 9. Check for Secrets in Code
print_header "9. Checking for Hardcoded Secrets"

echo "Scanning for potential secrets..."

# Check for common secret patterns (simplified)
if grep -r "password.*=.*['\"]" --include="*.ts" --include="*.js" app/ lib/ 2>/dev/null | grep -v "password:" | grep -v "// password" | head -5; then
    print_warning "Found potential hardcoded passwords (review above)"
fi

if grep -r "api[_-]key.*=.*['\"]" --include="*.ts" --include="*.js" app/ lib/ 2>/dev/null | head -5; then
    print_warning "Found potential hardcoded API keys (review above)"
fi

echo ""

# 10. Summary
print_header "10. Security Audit Summary"

echo ""
echo "Recommendations:"
echo "1. Ensure NEXTAUTH_SECRET is 32+ characters"
echo "2. Use HTTPS in production (NEXTAUTH_URL)"
echo "3. Enable database encryption at rest (RDS)"
echo "4. Fix npm audit vulnerabilities"
echo "5. Set .env permissions to 600"
echo "6. Add security headers to next.config.js"
echo "7. Review any warnings above"
echo ""

print_success "Security audit complete!"
echo ""
echo "Next steps:"
echo "  1. Review findings above"
echo "  2. Run: npm test -- __tests__/security/"
echo ""

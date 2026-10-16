#!/bin/bash

# SynergySign Comprehensive Test Suite Runner
# This script runs all tests for the SynergySign application

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    print_warning "node_modules not found. Installing dependencies..."
    npm install
fi

# Check if test dependencies are installed
if ! grep -q "@testing-library/react" package.json; then
    print_warning "Test dependencies not found. Installing..."
    npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event jest jest-environment-jsdom jest-mock-extended
fi

print_header "SynergySign Test Suite"

echo ""
print_header "1. Running Unit Tests"
npm run test:unit || {
    print_error "Unit tests failed"
    exit 1
}
print_success "Unit tests passed"

echo ""
print_header "2. Running Component Tests"
npm run test:components || {
    print_error "Component tests failed"
    exit 1
}
print_success "Component tests passed"

echo ""
print_header "3. Running API Tests"
npm run test:api || {
    print_error "API tests failed"
    exit 1
}
print_success "API tests passed"

echo ""
print_header "4. Running Integration Tests"
npm run test:integration || {
    print_error "Integration tests failed"
    exit 1
}
print_success "Integration tests passed"

echo ""
print_header "5. Generating Coverage Report"
npm run test:coverage || {
    print_error "Coverage report generation failed"
    exit 1
}
print_success "Coverage report generated"

echo ""
print_header "Test Summary"
echo ""
print_success "All test suites passed successfully!"
echo ""
echo "Coverage report available at: coverage/lcov-report/index.html"
echo ""
print_header "Test Run Complete"

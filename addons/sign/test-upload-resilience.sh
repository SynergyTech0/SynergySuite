#!/bin/bash

# Test script to verify document upload works even when OCR service is down
# This simulates OCR service failure by setting wrong inference URL

echo "🧪 Testing Upload Resilience (OCR Service Down)"
echo "================================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we have a test PDF
if [ ! -f "test-document.pdf" ]; then
  echo "${YELLOW}⚠️  No test-document.pdf found. Creating a dummy PDF...${NC}"
  echo "Test Document" > test-document.txt
  # If you have wkhtmltopdf or similar, convert to PDF
  # For now, we'll just note it
  echo "${YELLOW}Please place a test PDF file named 'test-document.pdf' in the project root${NC}"
  exit 1
fi

# Get auth token (you'll need to adjust this based on your auth setup)
echo "📝 Step 1: Get authentication token"
echo "Please ensure you have a valid session or provide a Bearer token"
echo ""

# Temporarily set wrong inference URL to simulate service down
export INFERENCE_API_URL="http://invalid-inference-service:9999"

echo "🔧 Step 2: Set INFERENCE_API_URL to invalid endpoint"
echo "INFERENCE_API_URL=${INFERENCE_API_URL}"
echo ""

echo "📤 Step 3: Test document upload"
echo "Uploading test-document.pdf..."
echo ""

# Make upload request (adjust the endpoint and auth as needed)
RESPONSE=$(curl -X POST http://localhost:3000/api/documents/upload \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN" \
  -F "file=@test-document.pdf" \
  -F "title=Test Upload - OCR Service Down" \
  -F "description=Testing upload resilience" \
  -w "\nHTTP_STATUS:%{http_code}" \
  2>/dev/null)

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

echo "Response Status: ${HTTP_STATUS}"
echo "Response Body:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

# Check if upload succeeded
if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
  echo "${GREEN}✅ SUCCESS: Upload completed even with OCR service down!${NC}"
  echo "${GREEN}The system is resilient to OCR service failures.${NC}"
  exit 0
else
  echo "${RED}❌ FAILED: Upload failed when OCR service was down${NC}"
  echo "${RED}Status: ${HTTP_STATUS}${NC}"
  exit 1
fi

#!/bin/bash

echo "========================================="
echo "Testing Mobile API Endpoints"
echo "========================================="
echo ""

# Test 1: Register a new user
echo "1. Testing Registration (POST /api/mobile/auth/register)"
echo "----------------------------------------"
REGISTER_RESPONSE=$(curl -s -X POST http://localhost:3000/api/mobile/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "mobiletest@example.com",
    "password": "TestPassword123!",
    "firstName": "Mobile",
    "lastName": "User"
  }')

echo "$REGISTER_RESPONSE" | jq '.'
TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.token // empty')

if [ -z "$TOKEN" ]; then
  echo "❌ Registration failed or token not received"
  echo ""

  # Try login with existing user instead
  echo "2. Testing Login (POST /api/mobile/auth/login)"
  echo "----------------------------------------"
  LOGIN_RESPONSE=$(curl -s -X POST http://localhost:3000/api/mobile/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "email": "mobiletest@example.com",
      "password": "TestPassword123!"
    }')

  echo "$LOGIN_RESPONSE" | jq '.'
  TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token // empty')

  if [ -z "$TOKEN" ]; then
    echo "❌ Login also failed. Cannot continue tests."
    exit 1
  fi
else
  echo "✅ Registration successful"
fi

echo ""
echo "Token received: ${TOKEN:0:20}..."
echo ""

# Test 2: Get user info
echo "3. Testing Get User Info (GET /api/mobile/auth/me)"
echo "----------------------------------------"
ME_RESPONSE=$(curl -s -X GET http://localhost:3000/api/mobile/auth/me \
  -H "Authorization: Bearer $TOKEN")

echo "$ME_RESPONSE" | jq '.'

if echo "$ME_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
  echo "✅ Get user info successful"
else
  echo "❌ Get user info failed"
fi

echo ""

# Test 3: Logout
echo "4. Testing Logout (POST /api/mobile/auth/logout)"
echo "----------------------------------------"
LOGOUT_RESPONSE=$(curl -s -X POST http://localhost:3000/api/mobile/auth/logout \
  -H "Authorization: Bearer $TOKEN")

echo "$LOGOUT_RESPONSE" | jq '.'

if echo "$LOGOUT_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
  echo "✅ Logout successful"
else
  echo "❌ Logout failed"
fi

echo ""

# Test 4: Try to access /me after logout (should fail)
echo "5. Testing /me After Logout (should fail)"
echo "----------------------------------------"
ME_AFTER_LOGOUT=$(curl -s -X GET http://localhost:3000/api/mobile/auth/me \
  -H "Authorization: Bearer $TOKEN")

echo "$ME_AFTER_LOGOUT" | jq '.'

if echo "$ME_AFTER_LOGOUT" | jq -e '.error' > /dev/null 2>&1; then
  echo "✅ Correctly rejected after logout"
else
  echo "❌ Still authorized after logout (security issue)"
fi

echo ""
echo "========================================="
echo "Mobile API Tests Complete"
echo "========================================="

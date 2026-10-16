# SynergySign Test Suite

Comprehensive testing suite for the SynergySign AI-powered electronic signature platform.

## Overview

This test suite provides comprehensive coverage for all major components of the SynergySign application, including:

- **Unit Tests**: Core utilities and business logic
- **Component Tests**: React UI components
- **API Tests**: REST API endpoints
- **Integration Tests**: End-to-end user workflows

## Test Structure

```
__tests__/
├── setup/                          # Test configuration
│   └── prisma-mock.ts             # Prisma client mocking
├── lib/                           # Library/utility tests
│   ├── auth.test.ts               # Authentication utilities
│   └── notifications.test.ts      # Notification system
├── api/                           # API endpoint tests
│   ├── documents.test.ts          # Document management
│   ├── signers.test.ts            # Signer management
│   └── billing.test.ts            # Billing & subscriptions
├── components/                     # Component tests
│   └── ui/
│       └── button.test.tsx        # Button component
├── integration/                    # Integration tests
│   └── document-signing-flow.test.ts  # Full signing workflow
├── run-all-tests.sh               # Master test runner script
└── README.md                      # This file
```

## Installation

### 1. Install Test Dependencies

```bash
npm install --save-dev \
  jest \
  jest-environment-jsdom \
  @testing-library/react \
  @testing-library/jest-dom \
  @testing-library/user-event \
  jest-mock-extended \
  @types/jest
```

### 2. Verify Configuration

The test suite requires the following files:
- `jest.config.js` - Jest configuration
- `jest.setup.js` - Global test setup
- `.env.test` - Test environment variables (optional)

## Running Tests

### Run All Tests

```bash
npm test
```

### Run Specific Test Suites

```bash
# Unit tests only
npm run test:unit

# Component tests only
npm run test:components

# API tests only
npm run test:api

# Integration tests only
npm run test:integration

# Watch mode (re-run on file changes)
npm run test:watch

# Coverage report
npm run test:coverage
```

### Run Test Script

Make the script executable and run it:

```bash
chmod +x __tests__/run-all-tests.sh
./__tests__/run-all-tests.sh
```

## Test Coverage

The test suite aims for the following coverage targets:

| Metric | Target |
|--------|--------|
| Statements | 50%+ |
| Branches | 50%+ |
| Functions | 50%+ |
| Lines | 50%+ |

View detailed coverage reports at: `coverage/lcov-report/index.html`

## Test Categories

### 1. Unit Tests (`__tests__/lib/`)

Tests for core business logic and utilities:

- **Authentication** (`auth.test.ts`)
  - Password hashing and verification
  - Email validation
  - Password strength validation
  - Role-based access control

- **Notifications** (`notifications.test.ts`)
  - Creating notifications
  - Retrieving notifications (all/unread)
  - Marking as read
  - Deleting notifications

### 2. API Tests (`__tests__/api/`)

Tests for REST API endpoints:

- **Documents API** (`documents.test.ts`)
  - GET /api/documents - List documents
  - POST /api/documents - Create document
  - PATCH /api/documents/:id - Update document
  - DELETE /api/documents/:id - Delete document
  - Document fields (signature, text, date, etc.)

- **Signers API** (`signers.test.ts`)
  - POST /api/signers/invite - Invite signers
  - POST /api/signers/sign - Record signatures
  - GET /api/signers/status - Check signer status
  - POST /api/signers/decline - Decline signing
  - Multi-party signing workflows

- **Billing API** (`billing.test.ts`)
  - Subscription tiers (FREE, BASIC, PRO, ENTERPRISE)
  - POST /api/billing/subscribe - Create subscription
  - POST /api/billing/cancel - Cancel subscription
  - Usage tracking and limits

### 3. Component Tests (`__tests__/components/`)

Tests for React components:

- **Button Component** (`ui/button.test.tsx`)
  - Rendering
  - Click handlers
  - Disabled state
  - Variants (default, destructive, outline, etc.)
  - Sizes (default, sm, lg, etc.)
  - asChild prop

### 4. Integration Tests (`__tests__/integration/`)

Tests for complete user workflows:

- **Document Signing Flow** (`document-signing-flow.test.ts`)
  - Complete lifecycle: Create → Invite → Sign → Complete
  - Multi-party sequential signing
  - Document decline handling
  - Notification creation throughout process
  - Audit trail generation

## Writing New Tests

### Test File Naming Convention

- Unit tests: `*.test.ts`
- Component tests: `*.test.tsx`
- Place tests in `__tests__/` directory matching source structure

### Example Unit Test

```typescript
import { describe, it, expect } from '@jest/globals'
import { prismaMock } from '../setup/prisma-mock'

describe('MyFeature', () => {
  it('should perform expected behavior', async () => {
    prismaMock.myModel.create.mockResolvedValue({
      id: '1',
      name: 'Test',
    } as any)

    const result = await myFunction()

    expect(result.id).toBe('1')
    expect(result.name).toBe('Test')
  })
})
```

### Example Component Test

```typescript
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MyComponent } from '@/components/MyComponent'

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent text="Hello" />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('should handle clicks', () => {
    const handleClick = jest.fn()
    render(<MyComponent onClick={handleClick} />)

    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
```

## Mocking

### Prisma Client

The test suite uses `jest-mock-extended` to mock Prisma:

```typescript
import { prismaMock } from '../setup/prisma-mock'

prismaMock.user.findUnique.mockResolvedValue({
  id: '1',
  email: 'test@example.com',
})
```

### NextAuth

NextAuth is mocked globally in `jest.setup.js`:

```typescript
import { useSession } from 'next-auth/react'

// In your test
(useSession as jest.Mock).mockReturnValue({
  data: { user: { id: '1', email: 'test@example.com' } },
  status: 'authenticated',
})
```

### Next.js Router

Router is mocked globally:

```typescript
import { useRouter } from 'next/navigation'

// In your test
(useRouter as jest.Mock).mockReturnValue({
  push: jest.fn(),
  replace: jest.fn(),
})
```

## Environment Variables

Test environment variables are set in `jest.setup.js`:

- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `DATABASE_URL`
- `STRIPE_SECRET_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET_NAME`

## Continuous Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
```

## Troubleshooting

### Common Issues

1. **Module not found errors**
   - Ensure all test dependencies are installed
   - Check `moduleNameMapper` in `jest.config.js`

2. **Prisma mock not working**
   - Import `prismaMock` before the module being tested
   - Use `jest.mock('@/lib/db')` at the top of test file

3. **Component tests failing**
   - Ensure `@testing-library/jest-dom` is imported
   - Check that components are properly exported

4. **Timeout errors**
   - Increase test timeout: `jest.setTimeout(10000)`
   - Check for unresolved promises

## Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Testing Next.js Applications](https://nextjs.org/docs/testing)
- [Prisma Testing Guide](https://www.prisma.io/docs/guides/testing/unit-testing)

## Contributing

When adding new features to SynergySign:

1. Write tests for new functionality
2. Ensure all tests pass: `npm test`
3. Maintain coverage targets: `npm run test:coverage`
4. Update this README if adding new test categories

## License

This test suite is part of the SynergySign project.

# SynergySign Testing Guide

Complete guide to setting up and running tests for the SynergySign application.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

This will install all test dependencies including:
- Jest (test runner)
- React Testing Library (component testing)
- jest-mock-extended (mocking utilities)
- @testing-library/jest-dom (DOM matchers)

### 2. Run Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### 3. View Results

Test results will be displayed in your terminal. Coverage reports are generated in the `coverage/` directory.

## Test Commands Reference

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode (re-runs on file changes) |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:unit` | Run only unit tests (lib/) |
| `npm run test:components` | Run only component tests |
| `npm run test:api` | Run only API endpoint tests |
| `npm run test:integration` | Run only integration tests |
| `npm run test:all` | Run comprehensive test suite with bash script |

## Test Structure

### Directory Layout

```
__tests__/
├── setup/                      # Test configuration
│   └── prisma-mock.ts         # Database mocking setup
│
├── lib/                       # Unit tests for utilities
│   ├── auth.test.ts           # Authentication tests
│   └── notifications.test.ts  # Notification tests
│
├── api/                       # API endpoint tests
│   ├── documents.test.ts      # Document API tests
│   ├── signers.test.ts        # Signer API tests
│   └── billing.test.ts        # Billing API tests
│
├── components/                # Component tests
│   └── ui/
│       └── button.test.tsx    # Button component tests
│
├── integration/               # Integration tests
│   └── document-signing-flow.test.ts
│
├── run-all-tests.sh          # Master test runner
└── README.md                 # Detailed test documentation
```

## What's Being Tested

### ✅ Unit Tests (lib/)

**Authentication** (`lib/auth.test.ts`)
- Password hashing with bcrypt
- Password verification
- Email format validation
- Password strength requirements
- Role-based access control (RBAC)

**Notifications** (`lib/notifications.test.ts`)
- Creating notifications
- Retrieving notifications (all/unread only)
- Marking notifications as read
- Deleting notifications

### ✅ API Tests (api/)

**Documents API** (`api/documents.test.ts`)
- Creating documents
- Listing documents with filters
- Updating document status
- Deleting documents
- Managing document fields (7 types: signature, initials, text, date, checkbox, dropdown, radio)

**Signers API** (`api/signers.test.ts`)
- Inviting signers via email
- Validating email formats
- Multi-party signing with ordering
- Recording signatures
- Access token validation
- Checking signer status
- Declining to sign

**Billing API** (`api/billing.test.ts`)
- Subscription tiers (FREE, BASIC, PRO, ENTERPRISE)
- Creating subscriptions
- Upgrading/downgrading tiers
- Canceling subscriptions
- Usage tracking (documents/signers per month)
- Enforcing tier limits

### ✅ Component Tests (components/)

**Button Component** (`components/ui/button.test.tsx`)
- Rendering with text
- Click event handling
- Disabled state
- Variants (default, destructive, outline, ghost, link)
- Sizes (default, sm, lg, icon)
- asChild prop for composition

### ✅ Integration Tests (integration/)

**Document Signing Flow** (`integration/document-signing-flow.test.ts`)
- Complete lifecycle: Create → Invite → Sign → Complete
- Multi-party sequential signing
- Document decline handling
- Notification creation at each step
- Audit trail generation

## Coverage Targets

Current coverage targets (configured in `jest.config.js`):

| Metric | Target |
|--------|--------|
| **Statements** | 50%+ |
| **Branches** | 50%+ |
| **Functions** | 50%+ |
| **Lines** | 50%+ |

View detailed HTML coverage report:
```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

## Writing Tests

### Test File Naming

- Place test files in `__tests__/` directory
- Match the source file structure
- Use `.test.ts` for TypeScript tests
- Use `.test.tsx` for React component tests

### Example: Unit Test

```typescript
import { describe, it, expect } from '@jest/globals'
import { prismaMock } from '../setup/prisma-mock'

describe('Feature Name', () => {
  it('should do something specific', async () => {
    // Arrange
    prismaMock.model.findUnique.mockResolvedValue({
      id: '1',
      name: 'Test',
    } as any)

    // Act
    const result = await myFunction('1')

    // Assert
    expect(result.id).toBe('1')
    expect(prismaMock.model.findUnique).toHaveBeenCalledWith({
      where: { id: '1' },
    })
  })
})
```

### Example: Component Test

```typescript
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MyComponent } from '@/components/MyComponent'

describe('MyComponent', () => {
  it('should render and handle interactions', () => {
    // Arrange
    const handleClick = jest.fn()
    render(<MyComponent onClick={handleClick} />)

    // Act
    const button = screen.getByRole('button')
    fireEvent.click(button)

    // Assert
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
```

### Example: API Test

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals'
import { prismaMock } from '../setup/prisma-mock'

jest.mock('@/lib/db')

describe('API Endpoint', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should create a resource', async () => {
    // Arrange
    const mockData = { id: '1', name: 'Test' }
    prismaMock.resource.create.mockResolvedValue(mockData as any)

    // Act & Assert
    expect(mockData.id).toBe('1')
  })
})
```

## Mocking Guide

### Prisma Database

```typescript
import { prismaMock } from '../setup/prisma-mock'

// Mock a query
prismaMock.user.findUnique.mockResolvedValue({
  id: '1',
  email: 'test@example.com',
})

// Mock with error
prismaMock.user.create.mockRejectedValue(new Error('Duplicate email'))
```

### NextAuth Session

```typescript
import { useSession } from 'next-auth/react'

(useSession as jest.Mock).mockReturnValue({
  data: {
    user: { id: '1', email: 'test@example.com', role: 'SENDER' },
  },
  status: 'authenticated',
})
```

### Next.js Router

```typescript
import { useRouter } from 'next/navigation'

const mockPush = jest.fn()
(useRouter as jest.Mock).mockReturnValue({
  push: mockPush,
  replace: jest.fn(),
  back: jest.fn(),
})

// Assert navigation
expect(mockPush).toHaveBeenCalledWith('/dashboard')
```

### Fetch API

```typescript
global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({ data: 'test' }),
    ok: true,
  })
) as jest.Mock
```

## Debugging Tests

### Run Single Test File

```bash
npm test -- __tests__/lib/auth.test.ts
```

### Run Single Test Case

```bash
npm test -- -t "should validate correct email formats"
```

### Run with Verbose Output

```bash
npm test -- --verbose
```

### Enable Debug Logging

```typescript
// In your test
console.log('Debug info:', someVariable)
```

## Common Issues & Solutions

### Issue: "Cannot find module '@/lib/...'"

**Solution**: Check `moduleNameMapper` in `jest.config.js`:
```javascript
moduleNameMapper: {
  '^@/(.*)$': '<rootDir>/$1',
}
```

### Issue: "ReferenceError: TextEncoder is not defined"

**Solution**: Already handled in `jest.setup.js`. If issues persist, add:
```javascript
// jest.setup.js
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder
```

### Issue: "Prisma mock not working"

**Solution**: Ensure you import the mock at the top of your test file:
```typescript
import { prismaMock } from '../setup/prisma-mock'
jest.mock('@/lib/db')
```

### Issue: "Component tests failing with undefined"

**Solution**: Import jest-dom matchers:
```typescript
import '@testing-library/jest-dom'
```

### Issue: "Tests timeout"

**Solution**: Increase timeout for specific tests:
```typescript
jest.setTimeout(10000) // 10 seconds
```

## CI/CD Integration

### GitHub Actions

Create `.github/workflows/test.yml`:

```yaml
name: Run Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Generate coverage
        run: npm run test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

## Best Practices

1. **Follow AAA Pattern**: Arrange, Act, Assert
2. **One assertion per test**: Keep tests focused
3. **Use descriptive test names**: "should do X when Y"
4. **Mock external dependencies**: Database, APIs, services
5. **Clean up after tests**: Use `beforeEach`/`afterEach`
6. **Test edge cases**: Empty arrays, null values, errors
7. **Avoid testing implementation details**: Test behavior, not internals

## Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [Next.js Testing](https://nextjs.org/docs/testing)

## Next Steps

1. **Install dependencies**: `npm install`
2. **Run tests**: `npm test`
3. **View coverage**: `npm run test:coverage`
4. **Add more tests**: Follow patterns in `__tests__/`
5. **Set up CI/CD**: Add GitHub Actions workflow

## Need Help?

- Check `__tests__/README.md` for detailed documentation
- Review existing test files for examples
- Run `npm test -- --help` for Jest CLI options

---

**Happy Testing!** 🧪

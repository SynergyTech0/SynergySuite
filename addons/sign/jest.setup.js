import '@testing-library/jest-dom'

// Mock environment variables
process.env.SIGN_PUBLIC_URL = 'http://localhost:3300'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.STRIPE_SECRET_KEY = 'sk_test_mock'
process.env.AWS_ACCESS_KEY_ID = 'test'
process.env.AWS_SECRET_ACCESS_KEY = 'test'
process.env.AWS_S3_BUCKET_NAME = 'test-bucket'

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
      pathname: '/',
      query: {},
      asPath: '/',
    }
  },
  useSearchParams() {
    return new URLSearchParams()
  },
  usePathname() {
    return '/'
  },
}))

// The browser side of the suite sign-in
jest.mock('@/lib/session-client', () => ({
  useSession: jest.fn(() => ({
    data: null,
    status: 'unauthenticated',
  })),
  signIn: jest.fn(),
  signOut: jest.fn(),
}))

// Global fetch mock
global.fetch = jest.fn()

// Mock window.matchMedia — browser-only. Guarded so this setup also works under the `node`
// test environment: an API ROUTE test needs the node env (Next route handlers are built on the
// web fetch globals, which jsdom does not provide), and an unguarded `window` here threw before
// a single route test could run. That is why no test ever invoked an API handler.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  })
}

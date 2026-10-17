/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals'
import { signFileQuery, verifyFileQuery } from '@/lib/file-links'

const parse = (q: string) => Object.fromEntries(new URLSearchParams(q)) as { exp: string; sig: string }

describe('signed file links (lib/file-links)', () => {
  it('opens the file it was made for until it expires', () => {
    process.env.SIGN_LINK_SECRET = 'k1'
    const now = Date.now()
    const { exp, sig } = parse(signFileQuery('documents/a.pdf', 300, now))
    expect(verifyFileQuery('documents/a.pdf', exp, sig, now)).toBe(true)
    expect(verifyFileQuery('documents/a.pdf', exp, sig, now + 301_000)).toBe(false)
  })

  it('does not open another file, a changed expiry or a link signed with another secret', () => {
    process.env.SIGN_LINK_SECRET = 'k1'
    const { exp, sig } = parse(signFileQuery('documents/a.pdf', 300))
    expect(verifyFileQuery('documents/b.pdf', exp, sig)).toBe(false)
    expect(verifyFileQuery('documents/a.pdf', String(Number(exp) + 1000), sig)).toBe(false)
    expect(verifyFileQuery('documents/a.pdf', exp, null)).toBe(false)
    process.env.SIGN_LINK_SECRET = 'k2'
    expect(verifyFileQuery('documents/a.pdf', exp, sig)).toBe(false)
  })
})

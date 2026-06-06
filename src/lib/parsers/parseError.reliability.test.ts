import { describe, it, expect } from 'vitest'
import { ParseError } from '../errors'

/**
 * Regression test for ParseError structured error handling (PR #174)
 * Ensures parser errors produce user-friendly messages for different failure modes.
 */
describe('ParseError', () => {
  it('should produce user-friendly message for encrypted files', () => {
    const err = new ParseError('File is encrypted', 'EPUB', 'encrypted')
    expect(err.getUserMessage()).toContain('DRM-protected')
    expect(err.reason).toBe('encrypted')
    expect(err.format).toBe('EPUB')
  })

  it('should produce user-friendly message for corrupt files', () => {
    const err = new ParseError('Invalid ZIP structure', 'EPUB', 'corrupt')
    expect(err.getUserMessage()).toContain('corrupted')
    expect(err.reason).toBe('corrupt')
  })

  it('should produce user-friendly message for unsupported formats', () => {
    const err = new ParseError('Unknown format', 'PDF', 'unsupported')
    expect(err.getUserMessage()).toContain('not supported')
    expect(err.getUserMessage()).toContain('PDF')
  })

  it('should produce user-friendly message for empty files', () => {
    const err = new ParseError('No content', 'TXT', 'empty')
    expect(err.getUserMessage()).toContain('no readable content')
  })

  it('should fall back to generic message for unknown reasons', () => {
    const err = new ParseError('Something went wrong', 'HTML', 'unknown')
    expect(err.getUserMessage()).toContain('HTML')
    expect(err.getUserMessage()).toContain('Something went wrong')
  })

  it('should preserve original error', () => {
    const original = new Error('zip error')
    const err = new ParseError('Failed to parse', 'EPUB', 'corrupt', original)
    expect(err.originalError).toBe(original)
  })

  it('should set proper error code', () => {
    const err = new ParseError('test', 'EPUB', 'encrypted')
    expect(err.code).toBe('PARSE_ENCRYPTED')
  })
})

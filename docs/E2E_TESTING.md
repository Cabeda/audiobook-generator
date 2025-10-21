# E2E Testing with Playwright

## Overview

End-to-end tests validate the complete audiobook generation workflow in a real browser environment using Playwright. These tests ensure that the entire pipeline works correctly from EPUB upload to audio file download.

## Running E2E Tests

### Prerequisites

```bash
# Install dependencies (includes Playwright)
npm install

# Install Playwright browsers (first time only)
npx playwright install chromium
```

### Run Tests

```bash
# Run all E2E tests (headless)
npm run test:e2e

# Run tests with UI (interactive)
npm run test:e2e:ui

# Run tests in headed mode (see browser)
npm run test:e2e:headed

# Run specific test file
npx playwright test e2e/audiobook-generation.spec.ts

# Run single test
npx playwright test -g "should generate single chapter as MP3"
```

## Test Coverage

### 1. Application Loading

- ✅ Loads the application
- ✅ Displays correct title
- ✅ Shows main UI components

### 2. EPUB Upload

- ✅ Uploads EPUB file
- ✅ Parses book metadata
- ✅ Displays book title and author
- ✅ Shows chapter count

### 3. Single Chapter Generation

**MP3 Format:**

- ✅ Generates single chapter as MP3
- ✅ Selects 192 kbps bitrate
- ✅ Downloads file with .mp3 extension
- ✅ Verifies file size is reasonable

**M4B Format:**

- ✅ Generates single chapter as M4B
- ✅ Selects 256 kbps bitrate
- ✅ Downloads file with .m4b extension
- ✅ Includes book metadata

### 4. Multiple Chapter Generation

**Two Chapters as MP3:**

- ✅ Selects multiple chapters
- ✅ Shows progress for each chapter
- ✅ Concatenates chapters correctly
- ✅ Downloads combined MP3 file
- ✅ File size larger than single chapter

**Two Chapters as M4B:**

- ✅ Generates two chapters
- ✅ Uses high bitrate (320 kbps)
- ✅ Includes book title in filename
- ✅ Embeds metadata (title, author)

### 5. UI Features

- ✅ Format dropdown (MP3, M4B, WAV)
- ✅ Bitrate selection (128, 192, 256, 320 kbps)
- ✅ Progress messages during generation
- ✅ Cancellation support

### 6. Chapter Order

- ✅ Preserves chapter order from EPUB
- ✅ Concatenates in correct sequence

### 7. Quality Settings

- ✅ Different bitrates produce different file sizes
- ✅ Higher bitrate = larger file
- ✅ Format selection affects output

## Test Structure

```typescript
test.describe('Audiobook Generation E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to app and wait for load
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('test name', async ({ page }) => {
    // 1. Upload EPUB
    // 2. Select chapters
    // 3. Choose format/bitrate
    // 4. Generate audiobook
    // 5. Verify download
  })
})
```

## Configuration

### playwright.config.ts

```typescript
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
```

## Test Data

Uses the example EPUB file:

```
example/The_Life_and_Adventures_of_Robinson_Crusoe.epub
```

- **Title**: The Life and Adventures of Robinson Crusoe
- **Author**: Daniel Defoe
- **Chapters**: 22
- **Format**: EPUB 2.0

## Timeouts

Different operations have different timeouts:

| Operation                 | Timeout  | Reason                         |
| ------------------------- | -------- | ------------------------------ |
| EPUB parsing              | 10s      | Fast operation                 |
| Single chapter generation | 120s     | TTS model loading + generation |
| Two chapter generation    | 180s     | Multiple TTS calls             |
| M4B generation            | 180s     | MP3 encoding + metadata        |
| Download wait             | 120-180s | File preparation               |

## Debugging

### View Test Results

```bash
# Open HTML report
npx playwright show-report
```

### Debug Specific Test

```bash
# Run with debugger
npx playwright test --debug

# Run specific test with debugger
npx playwright test -g "should generate single chapter" --debug
```

### Screenshots

Failed tests automatically capture:

- Screenshot of failure
- Error context
- Browser console logs

Located in: `test-results/`

### Trace Viewer

```bash
# View trace for failed test
npx playwright show-trace test-results/.../trace.zip
```

## CI Integration

### GitHub Actions

```yaml
- name: Install Playwright
  run: npx playwright install --with-deps chromium

- name: Run E2E tests
  run: npm run test:e2e

- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report
    path: playwright-report/
```

## Common Issues

### Port already in use

**Problem**: Dev server can't start on port 5173

**Solution**:

```bash
# Kill process on port 5173
lsof -ti:5173 | xargs kill -9

# Or use different port
PORT=5174 npm run test:e2e
```

### Browser not installed

**Problem**: Chromium browser not found

**Solution**:

```bash
npx playwright install chromium
```

### Timeout errors

**Problem**: Tests timeout waiting for generation

**Solution**:

1. Check if dev server is running
2. Verify Kokoro model loads correctly
3. Increase timeout in test
4. Check browser console for errors

### Download not triggered

**Problem**: Download event not fired

**Solution**:

1. Verify format selection is correct
2. Check browser download settings
3. Ensure pop-ups are not blocked
4. Verify audioConcat function works

## Performance

### Test Duration

| Test               | Duration | Notes                |
| ------------------ | -------- | -------------------- |
| Upload EPUB        | ~2s      | Fast                 |
| Single chapter MP3 | ~30-60s  | Model loading        |
| Single chapter M4B | ~30-60s  | MP3 encoding         |
| Two chapters MP3   | ~60-120s | Multiple generations |
| Two chapters M4B   | ~60-120s | + Metadata           |

### Optimization Tips

1. **Reuse dev server**: Set `reuseExistingServer: true`
2. **Run in parallel**: Use multiple workers
3. **Skip heavy tests in CI**: Use `test.skip` for slow tests
4. **Cache model**: Kokoro model cached after first load

## Best Practices

### 1. Wait Strategies

```typescript
// ❌ Bad: Fixed wait
await page.waitForTimeout(5000)

// ✅ Good: Wait for specific element
await page.waitForSelector('text=Complete')
```

### 2. Selectors

```typescript
// ❌ Bad: Fragile CSS selector
await page.locator('.btn-primary')

// ✅ Good: Semantic selector
await page.locator('button:has-text("Generate")')
```

### 3. Assertions

```typescript
// ❌ Bad: No timeout
expect(await page.textContent('h1')).toBe('Title')

// ✅ Good: Built-in retry
await expect(page.locator('h1')).toHaveText('Title')
```

### 4. Test Independence

```typescript
// ✅ Each test should work independently
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // Fresh state for each test
})
```

## Future Enhancements

- [ ] Test WAV format generation
- [ ] Test voice selection
- [ ] Test speed control
- [ ] Test error handling
- [ ] Test large EPUBs (100+ chapters)
- [ ] Test concurrent generations
- [ ] Mobile browser testing
- [ ] Cross-browser testing (Firefox, Safari)
- [ ] Performance benchmarking
- [ ] Visual regression testing

## References

- [Playwright Documentation](https://playwright.dev/)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Test Assertions](https://playwright.dev/docs/test-assertions)
- [Debugging Tests](https://playwright.dev/docs/debug)

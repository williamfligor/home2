# Browser Extension

Pi extension providing web browsing capabilities including HTML/PDF extraction, GitHub URL support, and DDG search integration.

## Testing

Run tests with timeout (tests include timeout-sensitive operations):

```bash
timeout 30 bun test
```

Or with explicit timeout flag:

```bash
bun test --timeout=30000
```

**Note:** Always use a timeout when running tests. The `content/fetch.test.ts` includes timeout tests that take ~100ms, and without a timeout, the test runner may hang.

## Project Structure

```
browser/
├── index.ts              # Main extension entry point
├── constants.ts          # Configuration constants
├── types.ts              # TypeScript type definitions
├── content/              # Content extraction module
│   ├── index.ts          # Barrel exports
│   ├── fetch.ts          # URL fetching with GitHub routing
│   ├── html-to-markdown.ts # HTML to MD conversion
│   └── pdf.ts            # PDF to MD conversion
├── github/               # GitHub integration
│   ├── index.ts          # Barrel exports
│   ├── parse-url.ts      # GitHub URL parser
│   ├── clone-manager.ts  # Session-scoped git clone cache
│   ├── api-view.ts       # Lightweight API views for large repos
│   └── format.ts         # Markdown formatters
├── tools/                # Tool implementations
│   ├── index.ts          # Barrel exports
│   ├── open-tool.ts      # Open page tool
│   ├── find-tool.ts      # Find/search tool
│   └── search-tool.ts    # DDG search tool
├── ddgs/                 # DuckDuckGo integration
│   ├── search.ts         # Search via ddgs CLI
│   └── extract.ts        # Extract via ddgs CLI
└── utils/                # Utilities
    ├── cache.ts          # LRU page cache
    └── formatter.ts      # Search result formatters
```

## Key Features

### GitHub URL Support
- Parses GitHub URLs (root/tree/blob/commit types)
- Clones repos locally for exploration with `read` and `bash`
- Falls back to API views for repos >350MB
- Session-scoped clone cache with cleanup

### Content Extraction
- HTML pages via Mozilla Readability + Turndown
- PDFs via pdf-parse
- Plain text support
- Fallback to DDG extract for short content

### Tools
- **open**: Extract page content as markdown
- **find**: Search within cached pages or cloned GitHub repos
- **search**: DDG search via ddgs CLI

## Important Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_CONTENT_LENGTH` | 80,000 | Max characters before truncation |
| `GITHUB_SIZE_THRESHOLD_MB` | 350 | MB threshold for API vs clone |
| `GITHUB_CLONE_TIMEOUT_MS` | 120,000 | 2 min clone timeout |
| `GITHUB_API_TIMEOUT_MS` | 30,000 | API call timeout |
| `MAX_CACHE_SIZE` | 20 | LRU cache size |
| `MAX_FIND_MATCHES` | 50 | Max search matches to show |

## Dependencies

### Runtime
- `@mozilla/readability` - HTML article extraction
- `turndown` - HTML to Markdown conversion
- `pdf-parse` - PDF text extraction
- `jsdom` - HTML parsing

### Dev
- `@sinclair/typebox` - Tool parameter schemas
- `@types/bun` - Bun type definitions
- `@mariozechner/pi-tui` - Terminal UI components

## Common Tasks

### Run all tests
```bash
timeout 30 bun test
```

### Run specific test file
```bash
timeout 30 bun test content/fetch.test.ts
```

### Watch mode
```bash
bun test --watch
```
## Linting and Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting.

### Commands

**Check code (lint + format):**
```bash
bun run lint
```

**Auto-fix issues:**
```bash
bun run lint:fix
```

**Format code only:**
```bash
bun run format
```

### Configuration

See `biome.json` for linting rules and formatter configuration. Key rules:
- `noUnusedVariables`: Error on unused variables
- `noExplicitAny`: Warn on `any` type usage
- `useImportsFirst`: Enforce imports at top of files
- `noSecrets`: Warn on potential secrets in code

Test files have relaxed rules for `noSecrets` and `noExplicitAny`.

## GitHub Integration Details

The `github/` module provides:

1. **parse-url.ts**: Extracts owner, repo, ref, path from GitHub URLs
2. **clone-manager.ts**: Manages shallow clones with caching
3. **api-view.ts**: Provides lightweight views for large repos
4. **format.ts**: Formats repo content as markdown

Usage flow:
1. `extractContent()` detects GitHub URLs
2. Routes to `github/extract()` for processing
3. Checks repo size via API
4. Clones if <350MB, uses API view otherwise
5. Returns markdown with local path for further exploration
## Error Handling Philosophy

This project has a clear boundary between **appropriate** and **excessive** error handling. Follow these principles:

### Appropriate: Guard clauses for expected failure modes

Guard clauses validate preconditions and handle known failure paths where the code has a meaningful fallback or alternative.

```typescript
// ✅ GOOD: Input validation at entry points
if (!html || typeof html !== "string") {
  throw new Error("html parameter must be a non-empty string");
}
if (html.length > MAX_HTML_SIZE) {
  throw new Error(`HTML exceeds maximum size limit of ${MAX_HTML_SIZE} bytes`);
}
```

These are appropriate because:
- They fail fast with a clear, specific message
- They protect against real misuse (null/undefined, DoS-sized inputs)
- They run before any expensive work (JSDOM parsing)
- The caller gets an actionable message about what went wrong

### Appropriate: Null checks with meaningful fallbacks

```typescript
// ✅ GOOD: Readability.parse() can return null — handle it with a fallback
if (article) {
  contentHtml = article.content;
  title = article.title || "";
  byline = article.byline || "";
} else {
  contentHtml = getBodyContent(document, html); // fallback to whole body
}
```

This is appropriate because:
- `Readability.parse()` returning `null` is a **documented, expected** case
- There's a **real fallback strategy** (use the whole body instead)
- The fallback produces a useful result, not just a different error

### Excessive: Re-wrapping errors with less information

```typescript
// ❌ BAD: Outer try/catch that obscures the real error
try {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  // ... Readability logic ...
  const turndown = getTurndown();
  let markdown = turndown.turndown(contentHtml);
  return markdown;
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  throw new Error(`Failed to convert HTML to markdown: ${errorMessage}`);
}
```

This is excessive because:
- **It discards the original stack trace.** The real error location is buried; the caller only sees the wrapper message.
- **It adds no recovery.** The catch doesn't retry, fallback, or partially recover — it just re-throws a worse error.
- **It conflates unrelated failures.** A JSDOM parse error, a Readability failure, and a Turndown error are all very different problems, but they all become `"Failed to convert HTML to markdown: ..."`.
- **The expected failure paths are already handled.** Readability null checks, `isProbablyReaderable`, and empty-content guards already cover the known cases. Any remaining exception is truly unexpected and should propagate with its original type and trace.

### The rule of thumb

| Pattern | Appropriate? | Why |
|---------|-------------|-----|
| Input validation (type, empty, size) | ✅ Yes | Fails fast with a specific, actionable message |
| Null/undefined checks with fallback logic | ✅ Yes | Handles expected edge cases with real alternatives |
| try/catch that **recovers** (retry, fallback, partial result) | ✅ Yes | The catch does meaningful work |
| try/catch that only **re-wraps** the error | ❌ No | Discards stack trace, obscures cause, adds no value |
| `instanceof Error` check to extract `.message` | ❌ No | Loses the original error object; if you must wrap, use `cause` |
| Catching errors you can't meaningfully handle | ❌ No | Let them propagate naturally to callers who can |

### When wrapping IS appropriate

If you must wrap an error (e.g., to add context), always preserve the original error as `cause`:

```typescript
// ✅ Acceptable wrapping: preserves the original error
try {
  const dom = new JSDOM(html, { url });
} catch (error) {
  throw new Error(`Failed to parse HTML from ${url}`, { cause: error });
}
```

Even then, ask: does the added context help the caller? Or does the original error message already say enough?

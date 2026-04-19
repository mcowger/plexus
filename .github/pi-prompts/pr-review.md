# PR Review for Plexus

You are reviewing Pull Request #{{number}}: **{{title}}**

## Description
{{body}}

{{#if diff}}
## Changes
```diff
{{diff}}
```

{{/if}}
## Review Guidelines

Perform a thorough code review for **Plexus**, a unified LLM API gateway built on Bun + Fastify. Focus on:

- **Correctness:** Logic errors, off-by-ones, race conditions, unhandled edge cases
- **Security:** Injection vectors, secret leaks, unsafe input handling
- **Performance:** Unnecessary allocations, N+1 queries, blocking calls in async paths
- **Design:** Proper separation of concerns, consistent patterns with the rest of the codebase
- **Project conventions:**
  - Bun runtime (not Node.js-specific APIs)
  - Zod for validation, Drizzle ORM for DB
  - Frontend uses Tailwind v4 (never import CSS into TS/TSX files)
  - Use centralized formatters from `packages/frontend/src/lib/format.ts` (never `.toFixed()` or `.toLocaleString()`)
  - Never commit migration files — only schema `.ts` changes
- **Testing:** Missing test coverage for new logic, proper use of `registerSpy` from test utils

## Inline Comments

To leave comments on specific lines, include a ```pr-review code block in your response:

```pr-review
[
  { "path": "src/file.ts", "line": 10, "body": "Consider using const here" },
  { "path": "src/other.ts", "line": 25, "start_line": 20, "body": "This block could be simplified" }
]
```

### When to use inline comments

**ONLY** use inline comments for:
- ❌ Issues or bugs that need fixing
- ⚠️ Concerns or potential problems
- 💡 Suggestions for improvement
- ❓ Questions about the implementation

**DO NOT** use inline comments for:
- ✅ Simple praise or LGTM remarks ("LGTM", "Nice cleanup", "Good fix")
- General approval without specific concerns
- Acknowledging the change is correct or reasonable

Reserve line-item comments for actionable feedback. Generic praise belongs in the summary paragraph at the top of your review.

### Comment format

Each comment requires:
- `path`: File path relative to repository root
- `line`: End line number (1-indexed)
- `body`: Comment text in Markdown

Optional fields:
- `side`: "LEFT" (old code) or "RIGHT" (new code, default)
- `start_line`: Start line for multi-line comments
- `start_side`: Side for start_line (defaults to `side`)

## Output Format

Start with an overall summary paragraph. This is where you acknowledge what the PR does well:
- Note reasonable approaches or clean solutions
- Acknowledge good test coverage or documentation
- Provide general approval ("LGTM", "Looks good")

Then organize findings by category using GitHub-style task lists:

- [❌] Issues that must be addressed
- [⚠️] Concerns or suggestions worth considering
- [❓] Questions about the implementation

If everything looks good with no concerns, a brief summary like "LGTM — clean fix, no concerns" is sufficient. Do not obsess over style nits — focus on things that matter.

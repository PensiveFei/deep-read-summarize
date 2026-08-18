# Contributing to deep-read-summarize

Thanks for your interest! Here's how to contribute.

## Development Setup

```bash
npm install        # dev deps
npm test           # fixture-driven tests
npm run lint       # node --check on all .js files
```

## Adding a Parser Plugin

1. Create `parsers/<name>.js` (or `custom-parsers/<name>.js` for personal overrides)
2. Implement the interface: `{ name, types, buildPrompt(input, opts) }`
3. Add a fixture test in `tests/`
4. Run `npm test`

## Pull Request Standards

- Clear purpose and description
- Tests pass and don't break existing behavior
- Code style consistent with the project
- No unrelated changes
- No security issues introduced (no secrets, no arbitrary script execution)

## Security

- Never commit secrets, tokens, or local absolute paths
- Network operations must respect sandbox/approval policies
- No copyrighted content in the repo

## License

By contributing, you agree that your contributions are licensed under the MIT License.
# Contributing

Issues and pull requests are welcome.

## Setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

Format with `npm run format` before you push. CI runs the type check, the tests, the
format check and the build on Node 18, 20 and 22.

## The API's shape

`spec/openapi.json` is the API's published OpenAPI document. `src/__tests__/coverage.test.ts`
checks that the client has a method for every operation and that `src/types.ts` names every
field. When the API changes:

```bash
npm run spec:update   # refresh spec/openapi.json
npm test              # the coverage test names what to add to src/types.ts
```

## Releasing

Maintainers only. Releases are published by hand from a clean `main`:

1. Bump `version` in `package.json` and `VERSION` in `src/client.ts`, and add the entry to
   `CHANGELOG.md`.
2. Commit, then tag: `git tag v0.1.0 && git push --tags`.
3. `npm publish --access public` (runs the type check, tests and build first).
4. Create a GitHub release from the tag with the changelog entry.

Never commit credentials. Tests run against a fake `fetch` and need no API key.

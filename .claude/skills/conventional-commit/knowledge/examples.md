# Conventional Commit Examples

Each example shows a diff summary on the left and the commit message that
fits it on the right. Use these as anchors when classifying ambiguous
changes.

## feat

```
+ src/auth/oauth-callback.ts
+ src/auth/oauth-callback.test.ts
```

```
feat(auth): add Google OAuth callback handler

Wires the OIDC callback to the existing session store. Falls back to
local password auth when the provider is unconfigured.
```

## fix

```
~ src/parser/json.ts (1 hunk)
+ src/parser/json.test.ts (1 hunk)
```

```
fix(parser): handle UTF-8 BOM in JSON input

The parser silently truncated the first key when the file began with a
BOM. Strip the BOM before handing the buffer to JSON.parse.

Closes #142
```

## refactor

```
~ src/utils/path-helpers.ts
~ src/cli/index.ts
```

```
refactor(utils): extract path-normalization into a shared helper

No functional change. Removes duplication between cli/index.ts and
worker/runner.ts.
```

## BREAKING CHANGE

```
~ src/api/client.ts
~ README.md
```

```
feat(api)!: rename `client.send()` to `client.dispatch()`

The old name was ambiguous with WebSocket `send`. Update all callers.

BREAKING CHANGE: client.send() has been removed. Use client.dispatch()
instead. Codemod available at scripts/migrate-v2.js.
```

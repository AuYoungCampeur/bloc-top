---
name: verify
description: Validate changes in the BlocTop pnpm workspace before committing or releasing, using the repository's actual checks and preserving unrelated work.
---

# BlocTop verification

Use the workspace scripts in [development documentation](../../../docs/DEVELOPMENT.md) and [CI](../../../.github/workflows/ci.yml). Commands run from the repository root unless a package is explicitly selected. Check `git status` first; preserve unrelated changes and untracked files.

- For a focused fix, run the relevant package's `test:run` with a Vitest file filter, its typecheck, and ESLint from the application directory. Example: `pnpm --filter @bloctop/editor test:run src/hooks/use-beta-management.test.ts`.
- Before releasing application behavior, run `pnpm lint`, `pnpm typecheck`, `pnpm test:run`, `pnpm test:ct`, and `pnpm build`. Run independent checks concurrently when appropriate; do not run builds and route type generation against the same application's `.next` directory concurrently.
- Use `nvm use` for the repository's Node version and `pnpm install --frozen-lockfile` when dependencies change. CI also checks the production Node version. A clean source snapshot must exclude local env files and unrelated untracked features when verifying the committed release.
- Browser component tests need Chromium: `pnpm --filter @bloctop/pwa exec playwright install chromium`. They do not validate complete PWA/Editor workflows.
- Do not invoke pre-push as an ordinary verification command: it temporarily stashes work. Commit hooks lint both apps, not shared; push hooks do not run ESLint or production builds.
- Keep API/auth tests isolated. Do not seed production or create real records/accounts merely to verify a change. Database, email, Passkey, R2, browser offline and production behavior require explicit evidence beyond passing mocked/component tests.

Resolve failures relevant to the change and rerun affected checks. Report passed commands, material warnings, cache reuse and unverified behavior accurately. Check `git diff --check` and documentation links before committing. Verification alone does not authorize commit, push or deployment.

# Raidex AI Workflow

## Daily Flow

1. Start the AI platform.
2. Build/update the local RAG index.
3. Update project memory.
4. Run automated checks.
5. Generate evidence-backed reports.
6. Review agent recommendations.
7. Create a branch for any code changes.
8. Run tests, typecheck, security scan, performance comparison, and build verification.
9. Open a pull request for review.

## Commands

```powershell
python .\raidex-ai\scripts\raidex_ai.py checks
python .\raidex-ai\scripts\raidex_ai.py index
python .\raidex-ai\scripts\raidex_ai.py memory-update
python .\raidex-ai\scripts\raidex_ai.py daily-report
python .\raidex-ai\scripts\raidex_ai.py daily-bug-report
python .\raidex-ai\scripts\raidex_ai.py weekly-architecture-report
python .\raidex-ai\scripts\raidex_ai.py security-report
python .\raidex-ai\scripts\raidex_ai.py performance-report
python .\raidex-ai\scripts\raidex_ai.py agent architect
python .\raidex-ai\scripts\raidex_ai.py agent qa
python .\raidex-ai\scripts\raidex_ai.py agent security
python .\raidex-ai\scripts\raidex_ai.py benchmark-report
python .\raidex-ai\scripts\raidex_ai.py continuous --interval 1800
```

## Safe Development Rules

AI may:

- Create issues
- Generate code
- Create branches
- Run tests
- Build locally
- Generate pull request drafts

AI must not:

- Push directly to `main`
- Deploy automatically
- Delete production data
- Modify production databases
- Execute real payments
- Issue refunds
- Change production secrets

## Required Before Review

Every generated code change must pass:

- Backend tests
- Frontend tests
- Typecheck
- Lint when configured
- Security scan
- Build verification for the touched platform

## Reports

Reports are stored in `raidex-ai/reports`. They are local artifacts and can be deleted or archived when no longer needed.

Every report must include measured inputs or retrieved files. If evidence is missing, the agent must say which evidence is missing instead of guessing.

## Continuous Watch

```powershell
python .\raidex-ai\scripts\raidex_ai.py watch --interval 60
```

The watcher records:

- Git status changes
- Backend log changes
- Frontend log changes
- Dependency file changes through git snapshots

## Continuous Improvement Flow

When a check fails:

1. The continuous cycle writes an evidence-backed issue section.
2. A human can ask the AI to create a branch.
3. The AI may implement a fix on that branch.
4. The AI runs tests, typecheck, security scan, and build verification.
5. The AI can prepare a PR, but never merges or deploys automatically.

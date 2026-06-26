# Raidex AI Workflow

## Daily Flow

1. Start the AI platform.
2. Run automated checks.
3. Generate the daily engineering report.
4. Review agent recommendations.
5. Create a branch for any code changes.
6. Run tests, typecheck, security scan, and build verification.
7. Open a pull request for review.

## Commands

```powershell
python .\raidex-ai\scripts\raidex_ai.py checks
python .\raidex-ai\scripts\raidex_ai.py daily-report
python .\raidex-ai\scripts\raidex_ai.py weekly-architecture-report
python .\raidex-ai\scripts\raidex_ai.py security-report
python .\raidex-ai\scripts\raidex_ai.py performance-report
python .\raidex-ai\scripts\raidex_ai.py agent architect
python .\raidex-ai\scripts\raidex_ai.py agent qa
python .\raidex-ai\scripts\raidex_ai.py agent security
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

## Continuous Watch

```powershell
python .\raidex-ai\scripts\raidex_ai.py watch --interval 60
```

The watcher records:

- Git status changes
- Backend log changes
- Frontend log changes
- Dependency file changes through git snapshots

# Raidex AI Agents

Agents are configured in `config/agents.json` and use local Ollama models from `config/models.json`.

## AI CTO

Reviews project health, sets priorities, and generates daily engineering reports.

## AI Architect

Reviews architecture, detects technical debt, and suggests refactoring.

## AI Backend Engineer

Reviews FastAPI backend, business logic, API behavior, database usage, and backend bugs.

## AI Frontend Engineer

Reviews React Native screens, UI/UX, accessibility, navigation, API handling, and rendering performance.

## AI QA Engineer

Runs automated tests, watches failures, and generates bug reports.

## AI Security Engineer

Runs dependency scans, reviews secrets, authentication, storage, rate limiting, and security-sensitive code.

## AI DevOps Engineer

Reviews CI/CD, builds, EAS/local Android readiness, deployment health, and release discipline.

## AI Product Analyst

Reviews analytics, funnels, user feedback, retention, booking conversion, and product opportunities.

## Access Model

Read access:

- Git repository
- Local filesystem
- Test output
- Logs
- Dependency metadata
- Database docs and local dev DB in read-only mode by default

Write access:

- Reports under `raidex-ai/reports`
- Generated proposals
- Branches only when a human asks for code changes

Forbidden:

- Direct push to `main`
- Automatic deployments
- Production database mutation
- Destructive filesystem cleanup

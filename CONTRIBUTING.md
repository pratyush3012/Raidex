# Contributing To Raidex

## Development Rules

- Do not add business logic to route handlers.
- Add feature code under `backend/features/<domain>` or `frontend/src/features/<domain>`.
- Keep route handlers thin.
- Add tests with every behavioral change.
- Do not change UI during architecture-only work.

## Backend Module Shape

Each backend feature should grow toward:

- `router.py`
- `service.py`
- `repository.py`
- `schemas.py`
- `models.py`
- `validators.py`
- `tests/`

## Frontend Feature Shape

Each frontend feature should grow toward:

- `api/`
- `components/`
- `hooks/`
- `screens/`
- `types.ts`
- `tests/`

## Verification

Run frontend tests, frontend typecheck, and backend tests before handing off changes.

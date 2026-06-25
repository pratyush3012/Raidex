# Raidex Migrations

Migration files should be named `YYYYMMDDHHMM_description.py`.

Each migration exports:

```python
async def upgrade(db):
    ...

async def rollback(db):
    ...
```

Applied migrations are tracked in `schema_migrations`.

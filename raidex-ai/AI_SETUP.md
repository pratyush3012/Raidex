# Raidex AI Setup

`raidex-ai/` is a separate local AI engineering workspace. It does not belong to the customer-facing Raidex mobile app.

## Requirements

- Windows
- Python 3.12+
- Git
- Node/npm for frontend checks
- Ollama for local models
- Recommended RAM: 16 GB+

## Install

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\raidex-ai\scripts\setup.ps1
```

Or double-click:

```text
raidex-ai\setup-ai.bat
```

The setup script:

- Installs Ollama with winget if missing.
- Starts the Ollama local server.
- Detects hardware capacity.
- Pulls hardware-compatible models.
- Runs a platform doctor check.
- Creates local memory and RAG directories on first run.

## Start

```powershell
powershell -ExecutionPolicy Bypass -File .\raidex-ai\scripts\start.ps1
```

Or:

```text
raidex-ai\start-ai.bat
```

This starts Ollama if needed and watches local git changes.

## Stop

```powershell
powershell -ExecutionPolicy Bypass -File .\raidex-ai\scripts\stop.ps1
```

## Manual Commands

```powershell
python .\raidex-ai\scripts\raidex_ai.py doctor
python .\raidex-ai\scripts\raidex_ai.py pull-models
python .\raidex-ai\scripts\raidex_ai.py index
python .\raidex-ai\scripts\raidex_ai.py search "booking payment failures"
python .\raidex-ai\scripts\raidex_ai.py memory-update
python .\raidex-ai\scripts\raidex_ai.py checks
python .\raidex-ai\scripts\raidex_ai.py daily-report
python .\raidex-ai\scripts\raidex_ai.py daily-bug-report
python .\raidex-ai\scripts\raidex_ai.py weekly-architecture-report
python .\raidex-ai\scripts\raidex_ai.py security-report
python .\raidex-ai\scripts\raidex_ai.py performance-report
python .\raidex-ai\scripts\raidex_ai.py weekly-product-report
python .\raidex-ai\scripts\raidex_ai.py benchmark-report
python .\raidex-ai\scripts\raidex_ai.py monthly-technical-debt-report
python .\raidex-ai\scripts\raidex_ai.py monthly-roadmap
python .\raidex-ai\scripts\raidex_ai.py continuous-once
python .\raidex-ai\scripts\raidex_ai.py continuous --interval 1800
python .\raidex-ai\scripts\raidex_ai.py agent security
python .\raidex-ai\scripts\raidex_ai.py watch --interval 60
```

Reports are written to:

```text
raidex-ai\reports\
```

## Optional Scheduled Reports

Install Windows scheduled tasks:

```powershell
powershell -ExecutionPolicy Bypass -File .\raidex-ai\scripts\install-scheduled-tasks.ps1
```

This creates:

- Daily engineering report
- Daily bug report
- Weekly architecture report
- Weekly security report
- Weekly product report
- Monthly technical debt report

## Email Reports

Reports are addressed to `pratyushsharma1209@gmail.com` by default, but the platform does not hardcode SMTP secrets.

Set these environment variables to enable delivery:

```powershell
$env:RAIDEX_AI_REPORT_EMAIL="pratyushsharma1209@gmail.com"
$env:SMTP_HOST="smtp.example.com"
$env:SMTP_PORT="587"
$env:SMTP_USER="..."
$env:SMTP_PASSWORD="..."
$env:SMTP_FROM="..."
```

If SMTP is unavailable, reports are saved locally and marked as not emailed.

## Memory And RAG

- Memory file: `raidex-ai\memory\project-memory.json`
- Event log: `raidex-ai\memory\events.jsonl`
- Local index: `raidex-ai\index\code-index.jsonl`

The index stores local hashed token embeddings. No code is sent to a third-party embedding service.

## Safety

The platform may inspect code, run tests, generate reports, and propose changes. It must not push to `main`, deploy automatically, delete production data, or modify production databases.

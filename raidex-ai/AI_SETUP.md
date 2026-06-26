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
python .\raidex-ai\scripts\raidex_ai.py checks
python .\raidex-ai\scripts\raidex_ai.py daily-report
python .\raidex-ai\scripts\raidex_ai.py weekly-architecture-report
python .\raidex-ai\scripts\raidex_ai.py security-report
python .\raidex-ai\scripts\raidex_ai.py performance-report
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
- Weekly architecture report
- Weekly security report

## Safety

The platform may inspect code, run tests, generate reports, and propose changes. It must not push to `main`, deploy automatically, delete production data, or modify production databases.

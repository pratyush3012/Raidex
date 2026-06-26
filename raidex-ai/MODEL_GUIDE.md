# Model Guide

Raidex AI uses Ollama local models. Model names are configured in `config/models.json`.

## Hardware Policy

This machine currently has about 16 GB RAM and no detected NVIDIA GPU. Large models can be slow or fail to load, so the platform chooses smaller compatible models by default.

## Selected Defaults

| Role | Requested family | Default | Why |
| --- | --- | --- | --- |
| Primary coding | Qwen 3 | `qwen3:1.7b` | Fast enough for always-on local coding assistance on 16 GB RAM |
| Reasoning | DeepSeek R1 | `deepseek-r1:8b` | Strong local reasoning model, installed successfully |
| General assistant | Llama 3.x Instruct | `llama3.2:3b` | Fast summaries, reports, and planning, installed successfully |
| Lightweight fallback | Phi | `phi4-mini` | Fast fallback for small tasks, installed successfully |

## Larger Optional Models

Use only if the machine has enough RAM/VRAM:

- `qwen3:8b`
- `qwen3:4b`
- `qwen3-coder:30b`
- `qwen3:32b`

The platform will not force models that are likely too large for the detected hardware.

## Verify Models

```powershell
ollama list
python .\raidex-ai\scripts\raidex_ai.py doctor
```

## Installed On This Machine

Verified locally:

- `qwen3:1.7b`
- `deepseek-r1:8b`
- `deepseek-r1:1.5b`
- `llama3.2:3b`
- `llama3.2:1b`
- `phi4-mini`
- `phi3:mini`

## Pull Models

```powershell
python .\raidex-ai\scripts\raidex_ai.py pull-models
```

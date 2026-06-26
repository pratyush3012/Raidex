#!/usr/bin/env python3
"""Raidex AI Engineering Platform runner.

This tool is intentionally local-first. It can read the repository, run checks,
ask local Ollama models for analysis, and write reports under raidex-ai/reports.
It does not push to main, deploy, or touch production databases.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AI_ROOT = ROOT / "raidex-ai"
CONFIG_DIR = AI_ROOT / "config"
REPORTS_DIR = AI_ROOT / "reports"
LOGS_DIR = AI_ROOT / "logs"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def run(cmd: list[str], cwd: Path = ROOT, timeout: int = 120) -> dict:
    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=timeout,
            shell=False,
        )
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
        return {
            "cmd": " ".join(cmd),
            "exit_code": proc.returncode,
            "seconds": round(time.time() - started, 2),
            "stdout": stdout[-12000:],
            "stderr": stderr[-12000:],
        }
    except FileNotFoundError as exc:
        return {"cmd": " ".join(cmd), "exit_code": 127, "seconds": 0, "stdout": "", "stderr": str(exc)}
    except subprocess.TimeoutExpired as exc:
        return {
            "cmd": " ".join(cmd),
            "exit_code": 124,
            "seconds": timeout,
            "stdout": (exc.stdout or "")[-12000:] if isinstance(exc.stdout, str) else "",
            "stderr": (exc.stderr or "")[-12000:] if isinstance(exc.stderr, str) else "Timed out",
        }


def ollama_request(path: str, payload: dict | None = None, timeout: int = 60) -> dict:
    host = load_json(CONFIG_DIR / "models.json")["ollama_host"].rstrip("/")
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{host}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="GET" if payload is None else "POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def ollama_ok() -> bool:
    try:
        ollama_request("/api/tags", timeout=5)
        return True
    except Exception:
        return False


def installed_models() -> set[str]:
    try:
        data = ollama_request("/api/tags", timeout=10)
        return {m["name"] for m in data.get("models", [])}
    except Exception:
        return set()

def ollama_exe() -> str | None:
    found = shutil.which("ollama")
    if found:
        return found
    candidates = []
    if platform.system().lower() == "windows":
        local = os.environ.get("LOCALAPPDATA")
        program_files = os.environ.get("ProgramFiles")
        if local:
            candidates.append(Path(local) / "Programs" / "Ollama" / "ollama.exe")
            candidates.append(Path(local) / "Ollama" / "ollama.exe")
        if program_files:
            candidates.append(Path(program_files) / "Ollama" / "ollama.exe")
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def ram_gb() -> float | None:
    if platform.system().lower() == "windows":
        result = run(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"], timeout=20)
        try:
            return round(int(result["stdout"].strip()) / (1024 ** 3), 1)
        except Exception:
            return None
    return None


def selected_models() -> list[str]:
    cfg = load_json(CONFIG_DIR / "models.json")
    ram = ram_gb() or 0
    models: list[str] = []
    for spec in cfg["models"].values():
        preferred = spec["preferred"]
        fallback = spec.get("fallback")
        if ram and ram < 12 and fallback:
            models.append(fallback)
        else:
            models.append(preferred)
    return models


def pull_models() -> None:
    exe = ollama_exe()
    if not exe:
        print("Ollama CLI not found. Run raidex-ai/scripts/setup.ps1 first.")
        sys.exit(1)
    if not ollama_ok():
        subprocess.Popen([exe, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(5)
    wanted = selected_models()
    present = installed_models()
    for model in wanted:
        if model in present:
            print(f"[OK] {model} already installed")
            continue
        print(f"[PULL] {model}")
        proc = subprocess.run([exe, "pull", model], text=True)
        if proc.returncode != 0:
            print(f"[WARN] Could not pull {model}. Try fallback manually or check Ollama library tags.")


def ask_model(model: str, prompt: str, timeout: int = 180) -> str:
    payload = {"model": model, "prompt": prompt, "stream": False}
    try:
        data = ollama_request("/api/generate", payload, timeout=timeout)
        return data.get("response", "").strip()
    except urllib.error.URLError as exc:
        return f"Ollama unavailable: {exc}"
    except Exception as exc:
        return f"Model request failed: {exc}"


def repo_snapshot() -> str:
    files = {
        "README": ROOT / "README.md",
        "BACKEND_DOC": ROOT / "docs" / "BACKEND.md",
        "FRONTEND_DOC": ROOT / "docs" / "FRONTEND.md",
        "DATABASE_DOC": ROOT / "docs" / "DATABASE.md",
        "PACKAGE": ROOT / "frontend" / "package.json",
        "PYTEST": ROOT / "pytest.ini",
    }
    parts = []
    for name, path in files.items():
        if path.exists():
            parts.append(f"\n## {name}\n{path.read_text(encoding='utf-8', errors='ignore')[:5000]}")
    git = run(["git", "status", "--short"], timeout=20)
    parts.append(f"\n## GIT STATUS\n{git['stdout'] or 'clean'}")
    return "\n".join(parts)


def checks() -> dict:
    return {
        "backend_tests": run(["pytest"], timeout=180),
        "frontend_tests": run(["npm.cmd", "test", "--", "--runInBand"], cwd=ROOT / "frontend", timeout=180),
        "frontend_typecheck": run(["npm.cmd", "run", "typecheck"], cwd=ROOT / "frontend", timeout=180),
        "frontend_audit": run(["npm.cmd", "audit", "--audit-level=moderate"], cwd=ROOT / "frontend", timeout=120),
        "python_compile": run(["python", "-m", "py_compile", "backend/server.py", "backend/server_sqlite.py"], timeout=120),
    }


def security_scan() -> dict:
    return {
        "frontend_audit": run(["npm.cmd", "audit", "--json"], cwd=ROOT / "frontend", timeout=180),
        "python_dependency_audit": run(["python", "-m", "pip", "audit", "-r", "backend/requirements.txt", "-f", "json"], timeout=180),
        "secret_scan": run(["git", "grep", "-n", "-I", r"password\|secret\|api_key\|token\|private_key"], timeout=60),
    }


def performance_scan() -> dict:
    return {
        "large_backend_files": run(["powershell", "-NoProfile", "-Command", "Get-ChildItem backend -Recurse -Filter *.py | Sort-Object Length -Descending | Select-Object -First 15 FullName,Length | Format-Table -AutoSize"], timeout=60),
        "large_frontend_files": run(["powershell", "-NoProfile", "-Command", "Get-ChildItem frontend\\app,frontend\\src -Recurse -Include *.tsx,*.ts | Sort-Object Length -Descending | Select-Object -First 15 FullName,Length | Format-Table -AutoSize"], timeout=60),
        "frontend_dependency_size": run(["powershell", "-NoProfile", "-Command", "if (Test-Path frontend\\node_modules) { '{0:N1} MB' -f ((Get-ChildItem frontend\\node_modules -Recurse -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB) } else { 'node_modules missing' }"], timeout=120),
    }


def write_report(name: str, content: str) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = REPORTS_DIR / f"{stamp}-{name}.md"
    path.write_text(content, encoding="utf-8")
    return path


def agent_prompt(agent: dict, snapshot: str, check_data: dict | None = None) -> str:
    safe_rules = load_json(CONFIG_DIR / "agents.json")["safe_development_rules"]
    return f"""You are {agent['name']} for the Raidex vehicle rental platform.
Raidex is a vehicle rental marketplace for cars and bikes. Do not describe it as a property, hotel, or real-estate rental product.

Your duties: {', '.join(agent['duties'])}

Safe rules:
- May: {', '.join(safe_rules['may'])}
- Must not: {', '.join(safe_rules['must_not'])}
- Checks before review: {', '.join(safe_rules['required_checks_before_review'])}

Give a concise, evidence-based report with:
1. Current health
2. Top risks
3. Recommended next actions
4. Files or systems to inspect next

Repository snapshot:
{snapshot}

Check data:
{json.dumps(check_data or {}, indent=2)[:12000]}
"""


def run_agent(agent_id: str) -> Path:
    cfg = load_json(CONFIG_DIR / "agents.json")
    model_cfg = load_json(CONFIG_DIR / "models.json")["models"]
    agents = {a["id"]: a for a in cfg["agents"]}
    if agent_id not in agents:
        raise SystemExit(f"Unknown agent: {agent_id}")
    agent = agents[agent_id]
    model = model_cfg[agent["model_role"]]["preferred"]
    if model not in installed_models():
        fallback = model_cfg[agent["model_role"]].get("fallback")
        if fallback and fallback in installed_models():
            model = fallback
    prompt = agent_prompt(agent, repo_snapshot())
    response = ask_model(model, prompt)
    return write_report(f"{agent_id}-agent-report", f"# {agent['name']} Report\n\nModel: `{model}`\n\n{response}\n")


def daily_report() -> Path:
    check_data = checks()
    cto = next(a for a in load_json(CONFIG_DIR / "agents.json")["agents"] if a["id"] == "cto")
    model = load_json(CONFIG_DIR / "models.json")["models"][cto["model_role"]]["preferred"]
    check_summary = {
        name: {"exit_code": result["exit_code"], "seconds": result["seconds"]}
        for name, result in check_data.items()
    }
    prompt = agent_prompt(cto, repo_snapshot(), check_summary)
    response = ask_model(model, prompt, timeout=360)
    body = "# Raidex Daily Engineering Report\n\n"
    body += f"Generated: {datetime.now().isoformat(timespec='seconds')}\n\n"
    body += "## Automated Checks\n\n"
    for name, result in check_data.items():
        body += f"- `{name}`: exit `{result['exit_code']}` in `{result['seconds']}s`\n"
    body += "\n## AI CTO Notes\n\n" + response + "\n"
    return write_report("daily-engineering-report", body)


def themed_report(agent_id: str, report_name: str, scan_data: dict | None = None) -> Path:
    cfg = load_json(CONFIG_DIR / "agents.json")
    model_cfg = load_json(CONFIG_DIR / "models.json")["models"]
    agent = next(a for a in cfg["agents"] if a["id"] == agent_id)
    model = model_cfg[agent["model_role"]]["preferred"]
    fallback = model_cfg[agent["model_role"]].get("fallback")
    present = installed_models()
    if model not in present and fallback in present:
        model = fallback
    prompt = agent_prompt(agent, repo_snapshot(), scan_data)
    response = ask_model(model, prompt)
    body = f"# Raidex {report_name}\n\nGenerated: {datetime.now().isoformat(timespec='seconds')}\n\n"
    if scan_data:
        body += "## Measured Inputs\n\n"
        for name, result in scan_data.items():
            body += f"- `{name}`: exit `{result.get('exit_code')}` in `{result.get('seconds')}s`\n"
    body += f"\n## {agent['name']} Notes\n\n{response}\n"
    return write_report(report_name.lower().replace(" ", "-"), body)


def doctor() -> None:
    print("Raidex AI Doctor")
    print(f"Repository: {ROOT}")
    print(f"RAM: {ram_gb()} GB")
    print(f"Ollama CLI: {ollama_exe() or 'missing'}")
    print(f"Ollama API: {'ok' if ollama_ok() else 'not running'}")
    print("Selected models:")
    for model in selected_models():
        print(f" - {model}")
    present = installed_models()
    if present:
        print("Installed models:")
        for model in sorted(present):
            print(f" - {model}")


def watch(interval: int) -> None:
    last_status = ""
    last_backend_log_size = -1
    last_frontend_log_size = -1
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    print("Watching git changes, logs, and dependency files. Press Ctrl+C to stop.")
    while True:
        status = run(["git", "status", "--short"], timeout=20)["stdout"]
        if status != last_status:
            last_status = status
            path = write_report("git-change-snapshot", f"# Git Change Snapshot\n\n```text\n{status or 'clean'}\n```\n")
            print(f"Wrote {path}")
        backend_logs = sorted((ROOT / "backend").glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
        if backend_logs:
            size = backend_logs[0].stat().st_size
            if size != last_backend_log_size:
                last_backend_log_size = size
                excerpt = backend_logs[0].read_text(encoding="utf-8", errors="ignore")[-8000:]
                path = write_report("backend-log-snapshot", f"# Backend Log Snapshot\n\nSource: `{backend_logs[0]}`\n\n```text\n{excerpt}\n```\n")
                print(f"Wrote {path}")
        frontend_logs = sorted((ROOT / "frontend").glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
        if frontend_logs:
            size = frontend_logs[0].stat().st_size
            if size != last_frontend_log_size:
                last_frontend_log_size = size
                excerpt = frontend_logs[0].read_text(encoding="utf-8", errors="ignore")[-8000:]
                path = write_report("frontend-log-snapshot", f"# Frontend Log Snapshot\n\nSource: `{frontend_logs[0]}`\n\n```text\n{excerpt}\n```\n")
                print(f"Wrote {path}")
        time.sleep(interval)


def main() -> None:
    parser = argparse.ArgumentParser(description="Raidex AI Engineering Platform")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor")
    sub.add_parser("pull-models")
    sub.add_parser("checks")
    sub.add_parser("daily-report")
    sub.add_parser("weekly-architecture-report")
    sub.add_parser("security-report")
    sub.add_parser("performance-report")
    agent_parser = sub.add_parser("agent")
    agent_parser.add_argument("agent_id")
    watch_parser = sub.add_parser("watch")
    watch_parser.add_argument("--interval", type=int, default=60)
    args = parser.parse_args()

    if args.cmd == "doctor":
        doctor()
    elif args.cmd == "pull-models":
        pull_models()
    elif args.cmd == "checks":
        path = write_report("checks", json.dumps(checks(), indent=2))
        print(path)
    elif args.cmd == "daily-report":
        print(daily_report())
    elif args.cmd == "weekly-architecture-report":
        print(themed_report("architect", "Weekly Architecture Report"))
    elif args.cmd == "security-report":
        print(themed_report("security", "Security Report", security_scan()))
    elif args.cmd == "performance-report":
        print(themed_report("devops", "Performance Report", performance_scan()))
    elif args.cmd == "agent":
        print(run_agent(args.agent_id))
    elif args.cmd == "watch":
        watch(args.interval)


if __name__ == "__main__":
    main()

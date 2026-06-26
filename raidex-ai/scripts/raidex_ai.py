#!/usr/bin/env python3
"""Raidex AI Engineering Platform runner.

This tool is intentionally local-first. It can read the repository, run checks,
ask local Ollama models for analysis, and write reports under raidex-ai/reports.
It does not push to main, deploy, or touch production databases.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import json
import os
import platform
import smtplib
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AI_ROOT = ROOT / "raidex-ai"
CONFIG_DIR = AI_ROOT / "config"
REPORTS_DIR = AI_ROOT / "reports"
LOGS_DIR = AI_ROOT / "logs"
MEMORY_DIR = AI_ROOT / "memory"
INDEX_DIR = AI_ROOT / "index"
STATE_DIR = AI_ROOT / "state"

INDEX_FILE = INDEX_DIR / "code-index.jsonl"
MEMORY_FILE = MEMORY_DIR / "project-memory.json"
EVENTS_FILE = MEMORY_DIR / "events.jsonl"

INCLUDED_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".yml", ".yaml", ".ini", ".toml", ".sql"}
EXCLUDED_PARTS = {".git", "node_modules", ".venv", "__pycache__", "android", ".expo", ".pytest_cache", "reports", "logs", "memory", "index", "state"}
EMBED_DIM = 512


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_ai_dirs() -> None:
    for path in (REPORTS_DIR, LOGS_DIR, MEMORY_DIR, INDEX_DIR, STATE_DIR):
        path.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def path_allowed(path: Path) -> bool:
    rel_parts = set(path.relative_to(ROOT).parts)
    if rel_parts & EXCLUDED_PARTS:
        return False
    if path.suffix.lower() not in INCLUDED_SUFFIXES:
        return False
    try:
        return path.stat().st_size <= 400_000
    except OSError:
        return False


def iter_project_files() -> list[Path]:
    files: list[Path] = []
    for base in ("backend", "frontend", "docs", ".github", "tests", "load-tests", "scripts", "raidex-ai"):
        root = ROOT / base
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.is_file() and path_allowed(path):
                files.append(path)
    for path in (ROOT / "README.md", ROOT / "pytest.ini"):
        if path.exists() and path_allowed(path):
            files.append(path)
    files = sorted(set(files), key=lambda p: (str(p).count(os.sep), str(p)))
    return files[:450]


def tokenize(text: str) -> list[str]:
    out: list[str] = []
    token = []
    for ch in text.lower():
        if ch.isalnum() or ch in "_-":
            token.append(ch)
        elif token:
            value = "".join(token)
            if len(value) > 2:
                out.append(value)
            token = []
    if token:
        value = "".join(token)
        if len(value) > 2:
            out.append(value)
    return out


def embed_text(text: str) -> dict[str, float]:
    counts: Counter[int] = Counter()
    for tok in tokenize(text):
        idx = int(hashlib.sha256(tok.encode("utf-8")).hexdigest()[:8], 16) % EMBED_DIM
        counts[idx] += 1
    norm = math.sqrt(sum(v * v for v in counts.values())) or 1.0
    return {str(k): round(v / norm, 6) for k, v in counts.items()}


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(v * b.get(k, 0.0) for k, v in a.items())


def file_fingerprint(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha256(data).hexdigest()


def build_index() -> Path:
    ensure_ai_dirs()
    records = []
    previous = {}
    if INDEX_FILE.exists():
        for line in INDEX_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.strip():
                row = json.loads(line)
                previous[row["path"]] = row
    for path in iter_project_files():
        text = path.read_text(encoding="utf-8", errors="ignore")
        rel = str(path.relative_to(ROOT)).replace("\\", "/")
        sha = file_fingerprint(path)
        if rel in previous and previous[rel].get("sha256") == sha:
            records.append(previous[rel])
            continue
        records.append({
            "path": rel,
            "sha256": sha,
            "bytes": path.stat().st_size,
            "indexed_at": now_iso(),
            "embedding": embed_text(rel + "\n" + text[:20000]),
            "preview": text[:600].replace("\x00", ""),
        })
    INDEX_FILE.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in records), encoding="utf-8")
    record_event("index_built", {"files": len(records), "index": str(INDEX_FILE.relative_to(ROOT))})
    return INDEX_FILE


def load_index() -> list[dict]:
    if not INDEX_FILE.exists():
        build_index()
    rows = []
    for line in INDEX_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def search_index(query: str, limit: int = 8) -> list[dict]:
    q = embed_text(query)
    scored = []
    for row in load_index():
        score = cosine(q, row.get("embedding", {}))
        if score > 0:
            scored.append({k: row[k] for k in ("path", "sha256", "bytes", "preview")} | {"score": round(score, 4)})
    return sorted(scored, key=lambda r: r["score"], reverse=True)[:limit]


def default_memory() -> dict:
    return {
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "architecture": {},
        "database_schema": {},
        "api_contracts": {},
        "frontend_structure": {},
        "backend_services": {},
        "coding_conventions": {},
        "testing_strategy": {},
        "past_bug_fixes": [],
        "past_pull_requests": [],
        "rejected_approaches": [],
        "performance_history": [],
        "security_findings": [],
        "last_index": None,
        "last_checks": None,
    }


def load_memory() -> dict:
    ensure_ai_dirs()
    if MEMORY_FILE.exists():
        return json.loads(MEMORY_FILE.read_text(encoding="utf-8"))
    memory = default_memory()
    save_memory(memory)
    return memory


def save_memory(memory: dict) -> None:
    ensure_ai_dirs()
    memory["updated_at"] = now_iso()
    MEMORY_FILE.write_text(json.dumps(memory, indent=2), encoding="utf-8")


def record_event(kind: str, payload: dict) -> None:
    ensure_ai_dirs()
    with EVENTS_FILE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({"at": now_iso(), "kind": kind, "payload": payload}, ensure_ascii=False) + "\n")


def update_project_memory() -> Path:
    memory = load_memory()
    memory["architecture"] = {
        "backend": "FastAPI backend in backend/server.py plus platform service modules under backend/raidex_platform and backend/features.",
        "frontend": "Expo React Native app under frontend/app and frontend/src.",
        "ai_platform": "Local AI engineering OS under raidex-ai.",
    }
    memory["database_schema"] = {
        "primary": "MongoDB in full backend; SQLite fallback server_sqlite.py for local verification.",
        "docs": "docs/DATABASE.md",
    }
    memory["api_contracts"] = {
        "auth": "/api/auth/*",
        "vehicles": "/api/vehicles*",
        "bookings": "/api/bookings*",
        "payments": "/api/payments*",
        "admin": "/api/admin/*",
    }
    memory["frontend_structure"] = {
        "routes": "frontend/app",
        "context": "frontend/src/context",
        "api_client": "frontend/src/api/client.ts",
        "features": "frontend/src/features",
    }
    memory["backend_services"] = {
        "entrypoint": "backend/server.py",
        "local_sqlite": "backend/server_sqlite.py",
        "tests": "backend/tests",
    }
    memory["coding_conventions"] = {
        "frontend": "Expo Router + TypeScript + existing theme tokens.",
        "backend": "FastAPI route handlers with Pydantic models and pytest tests.",
        "safety": "No direct push to main from AI workflows; no production DB mutation.",
    }
    memory["testing_strategy"] = {
        "backend": "pytest",
        "frontend": "jest + typecheck",
        "security": "npm audit and pip audit when available",
    }
    memory["last_index"] = str(INDEX_FILE.relative_to(ROOT)) if INDEX_FILE.exists() else None
    save_memory(memory)
    record_event("memory_updated", {"file": str(MEMORY_FILE.relative_to(ROOT))})
    return MEMORY_FILE


def memory_summary() -> str:
    memory = load_memory()
    return json.dumps(memory, indent=2)[:8000]

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
    parts.append(f"\n## PROJECT MEMORY\n{memory_summary()}")
    return "\n".join(parts)


def checks() -> dict:
    return {
        "backend_tests": run(["pytest"], timeout=180),
        "frontend_tests": run(["npm.cmd", "test", "--", "--runInBand"], cwd=ROOT / "frontend", timeout=180),
        "frontend_typecheck": run(["npm.cmd", "run", "typecheck"], cwd=ROOT / "frontend", timeout=180),
        "frontend_audit": run(["npm.cmd", "audit", "--audit-level=moderate"], cwd=ROOT / "frontend", timeout=120),
        "python_compile": run(["python", "-m", "py_compile", "backend/server.py", "backend/server_sqlite.py"], timeout=120),
    }


def coverage_scan() -> dict:
    return {
        "backend_coverage": run(["pytest", "--cov=backend", "--cov-report=term"], timeout=240),
        "frontend_coverage": run(["npm.cmd", "test", "--", "--runInBand", "--coverage"], cwd=ROOT / "frontend", timeout=240),
    }


def smoke_scan() -> dict:
    return {
        "backend_compile": run(["python", "-m", "py_compile", "backend/server.py", "backend/server_sqlite.py"], timeout=120),
        "git_status": run(["git", "status", "--short"], timeout=30),
        "github_status": run(["gh", "auth", "status"], timeout=30),
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


def bug_scan() -> dict:
    data = checks()
    data["recent_backend_logs"] = collect_log_excerpt(ROOT / "backend")
    data["recent_frontend_logs"] = collect_log_excerpt(ROOT / "frontend")
    return data


def collect_log_excerpt(folder: Path) -> dict:
    logs = sorted(folder.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not logs:
        return {"exit_code": 0, "seconds": 0, "stdout": "No local log files found.", "stderr": ""}
    path = logs[0]
    return {
        "cmd": f"read {path}",
        "exit_code": 0,
        "seconds": 0,
        "stdout": path.read_text(encoding="utf-8", errors="ignore")[-12000:],
        "stderr": "",
    }


def write_report(name: str, content: str) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = REPORTS_DIR / f"{stamp}-{name}.md"
    path.write_text(content, encoding="utf-8")
    record_event("report_written", {"name": name, "path": str(path.relative_to(ROOT))})
    return path


def send_email_report(path: Path) -> str:
    recipient = os.getenv("RAIDEX_AI_REPORT_EMAIL", "pratyushsharma1209@gmail.com")
    host = os.getenv("SMTP_HOST")
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM", user or "raidex-ai@localhost")
    port = int(os.getenv("SMTP_PORT", "587"))
    if not host or not user or not password:
        note = (
            "\n\nEmail delivery not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, "
            "SMTP_PASSWORD, SMTP_FROM, and RAIDEX_AI_REPORT_EMAIL to enable delivery.\n"
        )
        with path.open("a", encoding="utf-8") as fh:
            fh.write(note)
        return "email_not_configured"
    msg = EmailMessage()
    msg["Subject"] = f"Raidex AI Report: {path.stem}"
    msg["From"] = sender
    msg["To"] = recipient
    msg.set_content(path.read_text(encoding="utf-8", errors="ignore"))
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.send_message(msg)
    record_event("email_sent", {"path": str(path.relative_to(ROOT)), "recipient": recipient})
    return "sent"


def online() -> bool:
    try:
        urllib.request.urlopen("https://github.com", timeout=5)
        return True
    except Exception:
        return False


def github_sync_status() -> dict:
    if not online():
        return {"online": False, "issues": "offline", "pull_requests": "offline"}
    return {
        "online": True,
        "auth": run(["gh", "auth", "status"], timeout=30),
        "issues": run(["gh", "issue", "list", "--limit", "20"], timeout=45),
        "pull_requests": run(["gh", "pr", "list", "--limit", "20"], timeout=45),
    }


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

Never invent facts. If evidence is missing, write "Evidence missing" and say what command/data is needed.

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
    retrieved = search_index(" ".join(agent["duties"]), limit=8)
    rag = "\n".join(f"- {r['path']} score={r['score']}" for r in retrieved)
    prompt = agent_prompt(agent, repo_snapshot() + "\n\n## RETRIEVED FILES\n" + rag)
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
    path = write_report("daily-engineering-report", body)
    send_email_report(path)
    return path


def themed_report(agent_id: str, report_name: str, scan_data: dict | None = None) -> Path:
    cfg = load_json(CONFIG_DIR / "agents.json")
    model_cfg = load_json(CONFIG_DIR / "models.json")["models"]
    agent = next(a for a in cfg["agents"] if a["id"] == agent_id)
    model = model_cfg[agent["model_role"]]["preferred"]
    fallback = model_cfg[agent["model_role"]].get("fallback")
    present = installed_models()
    if model not in present and fallback in present:
        model = fallback
    retrieved = search_index(report_name + " " + " ".join(agent["duties"]), limit=10)
    rag = "\n".join(f"- {r['path']} score={r['score']}" for r in retrieved)
    slim_scan = {}
    for name, result in (scan_data or {}).items():
        if isinstance(result, dict):
            slim_scan[name] = {
                "exit_code": result.get("exit_code"),
                "seconds": result.get("seconds"),
                "stdout_excerpt": str(result.get("stdout", ""))[-1200:],
                "stderr_excerpt": str(result.get("stderr", ""))[-800:],
            }
        else:
            slim_scan[name] = result
    prompt = agent_prompt(agent, repo_snapshot() + "\n\n## RETRIEVED FILES\n" + rag, slim_scan)
    response = ask_model(model, prompt, timeout=360)
    body = f"# Raidex {report_name}\n\nGenerated: {datetime.now().isoformat(timespec='seconds')}\n\n"
    if scan_data:
        body += "## Measured Inputs\n\n"
        for name, result in scan_data.items():
            body += f"- `{name}`: exit `{result.get('exit_code')}` in `{result.get('seconds')}s`\n"
    body += f"\n## {agent['name']} Notes\n\n{response}\n"
    path = write_report(report_name.lower().replace(" ", "-"), body)
    send_email_report(path)
    return path


def daily_bug_report() -> Path:
    return themed_report("qa", "Daily Bug Report", bug_scan())


def weekly_product_report() -> Path:
    scan = {"github": github_sync_status(), "rag": {"results": search_index("bookings conversion retention search payments maps owner admin feedback", 12)}}
    return themed_report("product", "Weekly Product Report", scan)


def benchmark_report() -> Path:
    config = load_json(CONFIG_DIR / "benchmarking.json")
    scan = {
        "online": online(),
        "benchmarking_policy": config,
        "raidex_retrieved_context": search_index("maps booking flow search filters trust payments owner dashboard", 12),
    }
    return themed_report("frontend", "Mobility Benchmark Report", scan)


def monthly_technical_debt_report() -> Path:
    scan = performance_scan() | {"security": security_scan(), "coverage": coverage_scan()}
    return themed_report("architect", "Monthly Technical Debt Report", scan)


def monthly_roadmap() -> Path:
    scan = {"github": github_sync_status(), "memory": load_memory(), "checks": checks()}
    return themed_report("cto", "Monthly Roadmap", scan)


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


def safe_branch_name(prefix: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"codex/{prefix}-{stamp}"


def start_fix_branch(reason: str) -> dict:
    status = run(["git", "status", "--short"], timeout=30)
    if status["stdout"].strip():
        return {"created": False, "reason": "working tree is not clean", "status": status["stdout"]}
    branch = safe_branch_name("ai-fix")
    create = run(["git", "checkout", "-b", branch], timeout=60)
    record_event("fix_branch_requested", {"reason": reason, "branch": branch, "exit_code": create["exit_code"]})
    return {"created": create["exit_code"] == 0, "branch": branch, "result": create}


def regression_report(before: dict, after: dict) -> str:
    lines = ["# Regression Report", ""]
    for key in sorted(set(before) | set(after)):
        b = before.get(key, {}).get("exit_code")
        a = after.get(key, {}).get("exit_code")
        lines.append(f"- `{key}`: before `{b}` -> after `{a}`")
    return "\n".join(lines)


def continuous_once() -> Path:
    ensure_ai_dirs()
    index_path = build_index()
    memory_path = update_project_memory()
    check_data = checks()
    memory = load_memory()
    memory["last_checks"] = {k: {"exit_code": v["exit_code"], "seconds": v["seconds"]} for k, v in check_data.items()}
    save_memory(memory)

    failing = {name: result for name, result in check_data.items() if result["exit_code"] != 0}
    body = "# Raidex AI Continuous Cycle\n\n"
    body += f"Generated: {datetime.now().isoformat(timespec='seconds')}\n\n"
    body += f"- Online: `{online()}`\n"
    body += f"- Index: `{index_path.relative_to(ROOT)}`\n"
    body += f"- Memory: `{memory_path.relative_to(ROOT)}`\n"
    body += "\n## Checks\n\n"
    for name, result in check_data.items():
        body += f"- `{name}`: exit `{result['exit_code']}` in `{result['seconds']}s`\n"
    if failing:
        body += "\n## Detected Issues\n\n"
        for name, result in failing.items():
            body += f"### {name}\n\n```text\n{(result.get('stderr') or result.get('stdout') or '')[-2000:]}\n```\n"
        body += "\nAI may create a fix branch with `python .\\raidex-ai\\scripts\\raidex_ai.py start-fix \"reason\"`, but it will not merge or deploy automatically.\n"
    else:
        body += "\n## Detected Issues\n\nNo failing required checks in this cycle.\n"
    path = write_report("continuous-cycle", body)
    send_email_report(path)
    return path


def continuous_loop(interval: int) -> None:
    print("Raidex AI Engineering OS running. Press Ctrl+C to stop.")
    while True:
        try:
            path = continuous_once()
            print(f"Wrote {path}")
        except Exception as exc:
            record_event("continuous_cycle_failed", {"error": str(exc)})
            print(f"Cycle failed: {exc}")
        time.sleep(interval)


def main() -> None:
    parser = argparse.ArgumentParser(description="Raidex AI Engineering Platform")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor")
    sub.add_parser("pull-models")
    sub.add_parser("index")
    search_parser = sub.add_parser("search")
    search_parser.add_argument("query")
    search_parser.add_argument("--limit", type=int, default=8)
    sub.add_parser("memory-update")
    sub.add_parser("memory-show")
    sub.add_parser("checks")
    sub.add_parser("daily-report")
    sub.add_parser("daily-bug-report")
    sub.add_parser("weekly-architecture-report")
    sub.add_parser("security-report")
    sub.add_parser("performance-report")
    sub.add_parser("weekly-product-report")
    sub.add_parser("benchmark-report")
    sub.add_parser("monthly-technical-debt-report")
    sub.add_parser("monthly-roadmap")
    sub.add_parser("continuous-once")
    continuous_parser = sub.add_parser("continuous")
    continuous_parser.add_argument("--interval", type=int, default=1800)
    fix_parser = sub.add_parser("start-fix")
    fix_parser.add_argument("reason")
    email_parser = sub.add_parser("send-report")
    email_parser.add_argument("path")
    agent_parser = sub.add_parser("agent")
    agent_parser.add_argument("agent_id")
    watch_parser = sub.add_parser("watch")
    watch_parser.add_argument("--interval", type=int, default=60)
    args = parser.parse_args()

    if args.cmd == "doctor":
        doctor()
    elif args.cmd == "pull-models":
        pull_models()
    elif args.cmd == "index":
        print(build_index())
    elif args.cmd == "search":
        print(json.dumps(search_index(args.query, args.limit), indent=2))
    elif args.cmd == "memory-update":
        print(update_project_memory())
    elif args.cmd == "memory-show":
        print(memory_summary())
    elif args.cmd == "checks":
        path = write_report("checks", json.dumps(checks(), indent=2))
        print(path)
    elif args.cmd == "daily-report":
        print(daily_report())
    elif args.cmd == "daily-bug-report":
        print(daily_bug_report())
    elif args.cmd == "weekly-architecture-report":
        print(themed_report("architect", "Weekly Architecture Report"))
    elif args.cmd == "security-report":
        print(themed_report("security", "Security Report", security_scan()))
    elif args.cmd == "performance-report":
        print(themed_report("devops", "Performance Report", performance_scan()))
    elif args.cmd == "weekly-product-report":
        print(weekly_product_report())
    elif args.cmd == "benchmark-report":
        print(benchmark_report())
    elif args.cmd == "monthly-technical-debt-report":
        print(monthly_technical_debt_report())
    elif args.cmd == "monthly-roadmap":
        print(monthly_roadmap())
    elif args.cmd == "continuous-once":
        print(continuous_once())
    elif args.cmd == "continuous":
        continuous_loop(args.interval)
    elif args.cmd == "start-fix":
        print(json.dumps(start_fix_branch(args.reason), indent=2))
    elif args.cmd == "send-report":
        print(send_email_report(Path(args.path)))
    elif args.cmd == "agent":
        print(run_agent(args.agent_id))
    elif args.cmd == "watch":
        watch(args.interval)


if __name__ == "__main__":
    main()

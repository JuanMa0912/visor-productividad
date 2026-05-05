"""
Smoke E2E contra la app Next en local (Playwright + Python).

Uso (servidor ya levantado, p. ej. `npm run dev`):
  python scripts/playwright_smoke.py

URL fija:
  set PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000
  python scripts/playwright_smoke.py

Sin PLAYWRIGHT_BASE_URL: lee `.next/dev/lock`, luego escanea 127.0.0.1:3000-3109.
Opcional: PLAYWRIGHT_PROJECT_ROOT si no ejecutas desde la raíz del repo.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

from playwright.sync_api import Page, expect, sync_playwright


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _lock_search_roots() -> List[Path]:
    roots: List[Path] = []
    extra = os.environ.get("PLAYWRIGHT_PROJECT_ROOT", "").strip()
    if extra:
        roots.append(Path(extra))
    roots.append(Path.cwd())
    roots.append(_repo_root())
    out: List[Path] = []
    seen: set[Path] = set()
    for r in roots:
        try:
            rp = r.resolve()
        except OSError:
            continue
        if rp in seen:
            continue
        seen.add(rp)
        out.append(rp)
    return out


def _base_url_from_next_dev_lock() -> str | None:
    """Lee `.next/dev/lock` (Next 15+) donde está `appUrl` / `port`."""
    for root in _lock_search_roots():
        lock_path = root / ".next" / "dev" / "lock"
        if not lock_path.is_file():
            continue
        try:
            raw = json.loads(lock_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        data: Dict[str, Any] = raw if isinstance(raw, dict) else {}
        app_url = str(data.get("appUrl") or "").strip()
        if app_url.startswith("http"):
            return app_url.rstrip("/")
        port = data.get("port")
        host = str(data.get("hostname") or "127.0.0.1").strip() or "127.0.0.1"
        if isinstance(port, int) and port > 0:
            return f"http://{host}:{port}"
    return None


def _port_is_open(host: str, port: int, timeout_s: float = 0.08) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout_s)
    try:
        return s.connect_ex((host, port)) == 0
    except OSError:
        return False
    finally:
        s.close()


def _http_root_ok(url: str, timeout_s: float = 0.6) -> bool:
    try:
        req = urllib.request.Request(
            f"{url}/",
            headers={"User-Agent": "playwright-smoke/1"},
        )
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            return r.status in (200, 301, 302, 307, 308)
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def discover_base_url() -> str:
    env = os.environ.get("PLAYWRIGHT_BASE_URL", "").strip()
    if env:
        return env.rstrip("/")
    from_lock = _base_url_from_next_dev_lock()
    if from_lock:
        return from_lock
    # Puerto aleatorio fuera de 3000-3109 o sin lock: barrido rápido con socket + HEAD HTTP
    host = "127.0.0.1"
    for port in range(3000, 3110):
        if not _port_is_open(host, port):
            continue
        url = f"http://{host}:{port}"
        if _http_root_ok(url):
            return url
    raise RuntimeError(
        "No hay servidor HTTP en 127.0.0.1:3000-3109. "
        "Levanta la app (npm run dev) o define PLAYWRIGHT_BASE_URL "
        "(si el puerto es otro, copia la URL de «Local» en la terminal de next dev)."
    )


def attach_console_collector(page: Page) -> List[str]:
    errors: List[str] = []

    def on_console(msg) -> None:
        if msg.type == "error":
            errors.append(msg.text)

    page.on("console", on_console)
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    return errors


def smoke_home(page: Page, base: str, console_errors: List[str]) -> None:
    # "load" evita colgarse con HMR / peticiones largas; el smoke solo comprueba que renderiza.
    page.goto(f"{base}/", wait_until="load", timeout=60_000)
    expect(page.locator("body")).to_be_visible()
    html = page.content()
    assert len(html) > 200, "home: HTML demasiado corto"


def smoke_rotacion(page: Page, base: str, console_errors: List[str]) -> None:
    page.goto(f"{base}/rotacion", wait_until="load", timeout=90_000)
    expect(page.locator("body")).to_be_visible()
    # Texto visible típico de la vista (español); relajado si hay login
    combined = page.locator("body").inner_text().lower()
    assert (
        "rotaci" in combined
        or "iniciar" in combined
        or "sesión" in combined
        or "login" in combined
    ), "rotacion: no se encontró texto esperado"


def main() -> int:
    try:
        base = discover_base_url()
    except RuntimeError as e:
        print(str(e), file=sys.stderr, flush=True)
        return 2
    print(f"BASE_URL={base}", flush=True)

    severe: List[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        console_errors = attach_console_collector(page)

        try:
            smoke_home(page, base, console_errors)
            smoke_rotacion(page, base, console_errors)
        finally:
            browser.close()

        severe = [
            e
            for e in console_errors
            if "favicon" not in e.lower() and "ResizeObserver" not in e
        ]
        if severe:
            print("Errores de consola (no fatales para el smoke):", flush=True)
            for e in severe[:20]:
                print(f"  - {e}", flush=True)
            if any("ReferenceError" in e or "TypeError" in e for e in severe):
                print(
                    "FAIL: error JS grave en consola.",
                    file=sys.stderr,
                    flush=True,
                )
                return 1

    print("OK: smoke Playwright pasó (home + /rotacion).", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

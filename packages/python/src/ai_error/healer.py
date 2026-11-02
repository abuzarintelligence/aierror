import ast
import functools
import importlib
import inspect
import json
import os
import pathlib
import re
import sys
import textwrap
import time
import traceback

from .providers import resolve_provider
from .redact import redact

PKG_DIR = str(pathlib.Path(__file__).resolve().parent)

SYSTEM_PROMPT = """You are a conservative code-repair engine.
You receive ONE Python function that raised an exception, plus the exception and a short traceback. Secrets are redacted.
Return ONLY a JSON object. No prose, no markdown fences. Keys:
  "canFix" (boolean)
  "replacement" (string: the complete corrected function source, including decorators and the def line and the original indentation, or null)
  "explanation" (short string)
  "userAdvice" (short string: what a developer must do if canFix is false; never include secrets)
Change only this function. If the fix needs other files, configuration, dependencies, missing data or secrets, set canFix to false.
Never invent credentials or URLs. Never add network calls, shell commands, or file deletion the function did not already contain."""


class AIHealError(Exception):
    """Raised when a failure could not be repaired automatically. str(err) explains how to fix it."""

    def __init__(self, message, code="ERROR", file=None):
        super().__init__(message)
        self.code = code
        self.file = file


def _find_frame(exc, allowed_roots):
    roots = [str(pathlib.Path(r).resolve()) for r in allowed_roots]
    for fr in reversed(traceback.extract_tb(exc.__traceback__)):
        path = str(pathlib.Path(fr.filename).resolve())
        if path.startswith(PKG_DIR) or "site-packages" in path or "dist-packages" in path:
            continue
        if any(path.startswith(root + os.sep) for root in roots):
            return path, fr.lineno
    return None


def _innermost_function(tree, line):
    best = None
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            start = min([node.lineno] + [d.lineno for d in node.decorator_list])
            if start <= line <= node.end_lineno and (best is None or start >= best[0]):
                best = (start, node)
    return best


def _is_single_function(src):
    try:
        tree = ast.parse(textwrap.dedent(src))
    except SyntaxError:
        return False
    return len(tree.body) == 1 and isinstance(tree.body[0], (ast.FunctionDef, ast.AsyncFunctionDef))


def _parse_json(text):
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", str(text or "").strip())
    try:
        return json.loads(t)
    except ValueError:
        pass
    m = re.search(r"\{.*\}", t, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except ValueError:
            return None
    return None


def _reload_function(file, name):
    target = pathlib.Path(file).resolve()
    main_file = getattr(sys.modules.get("__main__"), "__file__", None)
    if main_file and pathlib.Path(main_file).resolve() == target:
        return None  # never re-run the entry script
    module = None
    for m in list(sys.modules.values()):
        f = getattr(m, "__file__", None)
        if f and pathlib.Path(f).resolve() == target:
            module = m
            break
    if module is None:
        return None
    module = importlib.reload(module)
    obj = getattr(module, name, None)
    return getattr(obj, "__ai_error_raw__", obj) if obj is not None else None


def _heal(exc, cfg, state):
    def bail(code, advice, file=None):
        raise AIHealError(redact(f"[ai_error] {cfg['name']} was not auto-fixed. {advice}"), code, file) from exc

    if state["fixes"] >= cfg["max_fixes"]:
        bail("BUDGET", "The automatic fix budget for this process is used up.")

    frame = _find_frame(exc, cfg["allowed_roots"])
    if frame is None:
        bail("SCOPE", "The error comes from outside the allowed scope (allowed_roots). Check the traceback and fix that file manually.")
    file, line = frame

    source = pathlib.Path(file).read_text(encoding="utf-8")
    try:
        tree = ast.parse(source)
    except SyntaxError:
        bail("SCOPE", "The source file does not parse, so no change was made.", file)
    found = _innermost_function(tree, line)
    if found is None:
        bail("SCOPE", "Could not isolate the failing function, so no change was made.", file)
    start, node = found

    lines = source.splitlines()
    fn_src = "\n".join(lines[start - 1:node.end_lineno])
    if len(lines[start - 1:node.end_lineno]) > cfg["max_lines"]:
        bail("SCOPE", f"The function is longer than max_lines ({cfg['max_lines']}), so no change was made.", file)

    try:
        complete = resolve_provider(provider=cfg["provider"], model=cfg["model"], api_key=cfg["api_key"],
                                    base_url=cfg["base_url"], complete=cfg["complete"])
    except RuntimeError as e:
        bail("PROVIDER", str(e), file)

    tb_lines = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)).splitlines()[-12:]
    prompt = redact("\n".join([
        f"File: {pathlib.Path(file).name} (line {line})",
        f"Error: {type(exc).__name__}: {exc}",
        "Traceback (last lines):",
        "\n".join(tb_lines).replace(os.getcwd(), "."),
        "Failing function:",
        "```python",
        fn_src,
        "```",
    ]))

    try:
        raw = complete(SYSTEM_PROMPT, prompt)
    except Exception as e:
        bail("LLM", str(e), file)

    verdict = _parse_json(raw)
    if not verdict:
        bail("LLM", "The model did not return valid JSON, so no change was made.", file)
    replacement = verdict.get("replacement")
    if not verdict.get("canFix") or not isinstance(replacement, str) or not replacement.strip():
        bail("UNFIXABLE", verdict.get("userAdvice") or "The fix needs changes outside this function. Fix it manually.", file)

    replacement = replacement.rstrip()
    if len(replacement) > len(fn_src) * 3 + 500 or not _is_single_function(replacement):
        bail("REJECTED", "The proposed patch was not a single reasonable function, so no change was made.", file)

    orig_lines = source.splitlines(keepends=True)
    new_source = "".join(orig_lines[:start - 1]) + replacement + "\n" + "".join(orig_lines[node.end_lineno:])
    try:
        ast.parse(new_source)
    except SyntaxError:
        bail("REJECTED", "The proposed patch has a syntax error, so no change was made.", file)

    state_dir = pathlib.Path(cfg["state_dir"])
    if cfg["dry_run"]:
        proposals = state_dir / "proposals"
        proposals.mkdir(parents=True, exist_ok=True)
        out = proposals / f"{pathlib.Path(file).name}.{int(time.time() * 1000)}.py"
        out.write_text(new_source, encoding="utf-8")
        bail("DRY_RUN", f"Dry run: proposed fix saved to {out}. {verdict.get('explanation', '')}", file)

    backups = state_dir / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    backup = backups / f"{pathlib.Path(file).name}.{int(time.time() * 1000)}.bak"
    backup.write_text(source, encoding="utf-8")
    pathlib.Path(file).write_text(new_source, encoding="utf-8")
    state["fixes"] += 1
    if cfg["on_fix"]:
        cfg["on_fix"]({"file": file, "backup": str(backup), "explanation": verdict.get("explanation", "")})

    try:
        nxt = _reload_function(file, cfg["name"])
    except Exception as e:
        pathlib.Path(file).write_text(source, encoding="utf-8")  # roll back a patch that breaks loading
        bail("LOAD", f"The patched file failed to load and was rolled back: {e}", file)
    if nxt is None:
        bail("RESTART", f"Fix saved to {file} (backup: {backup}). Restart the process to load it.", file)
    return nxt


def _next_callable(exc, cfg, state, attempt):
    if not cfg["enabled"] or isinstance(exc, AIHealError) or (cfg["should_heal"] and not cfg["should_heal"](exc)):
        raise exc
    if attempt > cfg["max_attempts"]:
        raise AIHealError(redact(f"[ai_error] {cfg['name']} still fails after {cfg['max_attempts']} fix attempts. Fix it manually."),
                          "EXHAUSTED") from exc
    return _heal(exc, cfg, state)


def ai_error(func=None, *, provider=None, model=None, api_key=None, base_url=None, complete=None,
             name=None, max_attempts=3, max_fixes=10, max_lines=200, dry_run=None,
             allowed_roots=None, state_dir=None, on_fix=None, should_heal=None):
    """Decorator. On exception, repairs the failing function in scope, reloads it and retries.

    Usage: @ai_error  or  @ai_error(provider="anthropic", dry_run=True)
    """

    def decorate(f):
        cfg = {
            "enabled": os.environ.get("AI_ERROR_DISABLE") != "1",
            "name": name or f.__name__,
            "provider": provider,
            "model": model,
            "api_key": api_key,
            "base_url": base_url,
            "complete": complete,
            "max_attempts": max_attempts,
            "max_fixes": max_fixes,
            "max_lines": max_lines,
            "dry_run": dry_run if dry_run is not None else os.environ.get("AI_ERROR_DRY_RUN") == "1",
            "allowed_roots": allowed_roots or [os.getcwd()],
            "state_dir": state_dir or os.path.join(os.getcwd(), ".ai-error"),
            "on_fix": on_fix,
            "should_heal": should_heal,
        }
        state = {"fixes": 0}

        if inspect.iscoroutinefunction(f):
            @functools.wraps(f)
            async def async_wrapper(*args, **kwargs):
                current, attempt = f, 1
                while True:
                    try:
                        return await current(*args, **kwargs)
                    except Exception as exc:
                        current = _next_callable(exc, cfg, state, attempt)
                        attempt += 1
            async_wrapper.__ai_error_raw__ = f
            return async_wrapper

        @functools.wraps(f)
        def wrapper(*args, **kwargs):
            current, attempt = f, 1
            while True:
                try:
                    return current(*args, **kwargs)
                except Exception as exc:
                    current = _next_callable(exc, cfg, state, attempt)
                    attempt += 1

        wrapper.__ai_error_raw__ = f
        return wrapper

    return decorate if func is None else decorate(func)

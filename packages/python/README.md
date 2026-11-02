# ai-error — AI Self-Healing Error Handling for Python

**ai-error** (`ai_error`) is a decorator that makes Python code repair itself. Decorate a function with `@ai_error`. When it raises, an LLM (OpenAI, Anthropic Claude, Google Gemini, Groq, Mistral, Ollama, or any OpenAI-compatible endpoint) rewrites **only the failing function**, the module is reloaded, and the call is retried. If the fix belongs outside that function, you get an `AIHealError` that explains exactly what to change, with secrets redacted.

Keywords: self-healing Python, AI auto-fix, LLM exception handling, AI debugging, automatic bug fixing, OpenAI Python error handling, Claude Python error handling, Gemini Python error recovery, PyPI self-healing library.

## Install

```bash
pip install ai-error
```

Requires Python 3.9+. There are **no runtime dependencies**. It uses only the standard library.

## Quick start

```python
from ai_error import ai_error

@ai_error  # set OPENAI_API_KEY (or ANTHROPIC_API_KEY, GEMINI_API_KEY, ...) first
def parse_price(order):
    return float(order["amount"].replace("$", "")) * 1.2  # KeyError if "amount" is missing

parse_price({"amount": "$10"})   # 12.0
parse_price({"total": "$10"})    # repaired in place, reloaded, retried
```

Works with plain functions, `async def` functions, and in `@ai_error(provider="anthropic", max_attempts=2)` form.

## How the self-healing loop works

1. Your function runs normally.
2. On exception, the traceback is searched for the innermost frame inside your project. The AST (Python's `ast` module) isolates the smallest function containing that line.
3. The function source, the exception, and the last traceback lines go to the configured LLM. Secrets are redacted first.
4. The model returns a replacement for that function. ai-error checks that it is one valid function and that the whole file still parses.
5. The original file is backed up to `.ai-error/backups/`, then the patch is written.
6. The module is reloaded with `importlib.reload`, and the call is retried. This repeats up to `max_attempts`.
7. If the model says the fix is elsewhere, or a step fails, `AIHealError` is raised with plain-language advice and no secrets.

## Providers

| Provider | Environment variable | Usage |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `@ai_error(provider="openai")` |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | `@ai_error(provider="anthropic")` |
| Google Gemini | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | `@ai_error(provider="gemini")` |
| Groq | `GROQ_API_KEY` | `@ai_error(provider="groq")` |
| Mistral | `MISTRAL_API_KEY` | `@ai_error(provider="mistral")` |
| DeepSeek | `DEEPSEEK_API_KEY` | `@ai_error(provider="deepseek")` |
| xAI (Grok) | `XAI_API_KEY` | `@ai_error(provider="xai")` |
| OpenRouter | `OPENROUTER_API_KEY` | `@ai_error(provider="openrouter", model="anthropic/claude-3.5-haiku")` |
| Together AI | `TOGETHER_API_KEY` | `@ai_error(provider="together")` |
| Fireworks AI | `FIREWORKS_API_KEY` | `@ai_error(provider="fireworks")` |
| Perplexity | `PERPLEXITY_API_KEY` | `@ai_error(provider="perplexity")` |
| Cerebras | `CEREBRAS_API_KEY` | `@ai_error(provider="cerebras")` |
| Ollama (local) | none | `@ai_error(provider="ollama")` |
| Any OpenAI-compatible API | yours | `@ai_error(provider="custom", base_url="https://my-host/v1", model="my-model", api_key="...")` |
| Any LLM (full control) | yours | `@ai_error(complete=lambda system, prompt: "...")` |

You can pass `api_key="..."` directly for any provider instead of (or alongside) an env var:

```python
@ai_error(provider="groq", api_key="gsk_...", model="llama-3.3-70b-versatile")
def parse_price(order): ...
```

Autodetection follows the environment keys. Override the model with `model=` or `AI_ERROR_MODEL`. Choose the provider with `AI_ERROR_PROVIDER`.

## Options

| Option | Default | Purpose |
|---|---|---|
| `name` | function name | Attribute name used to reload the patched function |
| `max_attempts` | `3` | Fix-and-retry rounds per call |
| `max_fixes` | `10` | Total automatic fixes per decorated function |
| `max_lines` | `200` | Refuse to edit longer functions |
| `allowed_roots` | `[os.getcwd()]` | Only files under these folders can change |
| `dry_run` | `False` | Save proposals to `.ai-error/proposals/` instead of applying |
| `should_heal` | `None` | Predicate that decides which exceptions are eligible |
| `on_fix` | `None` | Callback after each applied fix |

Set `AI_ERROR_DISABLE=1` to turn it off everywhere, or `AI_ERROR_DRY_RUN=1` to force dry runs.

## Safety model

- **Scope:** only the innermost failing function is edited. Files outside `allowed_roots`, and anything in `site-packages`, are never touched.
- **Validation:** patches must be one syntactically valid function, and the whole file must parse afterwards.
- **Backups and rollback:** every change is backed up first, and a patch that breaks module import is reverted automatically.
- **Redaction:** environment secrets, key-shaped strings, and absolute paths are removed before anything leaves your machine.
- **No arguments sent:** function arguments are never sent to the model.
- **Budgets:** `max_attempts` and `max_fixes` cap the loop.

Use `dry_run=True` while evaluating, and review `.ai-error/backups/` in version control. Add `.ai-error/` to `.gitignore`. Do not enable this unattended in production without review.

## Limitations

- Patches apply to **module-level** functions (or functions reachable by `name` in their module). Methods and closures cause a restart request.
- Other modules holding references to the old function keep using it. The decorated wrapper always calls the fixed version.
- Reloading re-runs the module's top-level code.
- `async` functions run the healing step synchronously, which briefly blocks the event loop.
- The entry script (`__main__`) is never reloaded.

## Error codes

`AIHealError.code`: `SCOPE`, `UNFIXABLE`, `REJECTED`, `LLM`, `PROVIDER`, `BUDGET`, `LOAD`, `DRY_RUN`, `RESTART`, `EXHAUSTED`. The original exception is chained as `__cause__` for local debugging.

## FAQ

**Is this a replacement for try/except?** It is a recovery layer. Unfixable errors still reach your code as `AIHealError`.

**Does it cost money?** Only when an exception occurs. Each attempt is one request containing one function.

**Are fixes deterministic?** No. Scope, validation, and backups are there because model output varies.

## Development

```bash
git clone https://github.com/YOUR_USER/ai-error.git
cd ai-error/packages/python
pip install -e .
python -m unittest discover -s tests -v
```

## License

MIT

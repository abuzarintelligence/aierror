# ai-error: Self-Healing Error Handling for JavaScript and Python

**ai-error** gives your code an AI-powered error-recovery layer. Wrap a function with `aiError` in JavaScript or `@ai_error` in Python. When it throws, an LLM repairs **only the failing function**, reloads it, and retries automatically. If the fix needs changes outside that function, you get a clear, secret-free message telling you what to do.

Works with **OpenAI, Anthropic Claude, Google Gemini, Groq, Mistral, Ollama**, and any OpenAI-compatible endpoint.

[![CI](https://github.com/YOUR_USER/ai-error/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USER/ai-error/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ai-error.svg)](https://www.npmjs.com/package/ai-error)
[![PyPI](https://img.shields.io/pypi/v/ai-error.svg)](https://pypi.org/project/ai-error/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Keywords:** self-healing code, AI auto-fix, automatic bug fixing, LLM error handling, AI debugging tool, exception recovery, OpenAI error handling, Claude error handling, Gemini error handling, self-healing JavaScript, self-healing Python, Node.js error recovery, PyPI library, npm package.

---

## Contents

- [Why ai-error](#why-ai-error)
- [Install](#install)
- [Quick start: JavaScript](#quick-start-javascript)
- [Quick start: Python](#quick-start-python)
- [How the self-healing loop works](#how-the-self-healing-loop-works)
- [Choose a model and provider](#choose-a-model-and-provider)
- [Safety](#safety)
- [Configuration reference](#configuration-reference)
- [Repository layout](#repository-layout)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

## Why ai-error

Most error handling stops at `try/catch` or `try/except`: log the error, show a message, and hope someone fixes it later. ai-error adds an automated middle step:

- **Repairs in scope.** Only the innermost failing function is changed. The rest of your codebase is untouched.
- **Retries with the fix.** The module is reloaded and the call runs again with the corrected logic.
- **Refuses to guess.** Fixes that need other files, configuration, or secrets become a precise message such as "set the VALUE field in the caller", not a silent edit.
- **Never leaks secrets.** API keys, tokens, and absolute paths are redacted before anything reaches a model or an error message.
- **Reversible.** Every change is backed up to `.ai-error/backups/`, and a patch that fails to load is rolled back automatically.

## Install

```bash
npm install ai-error        # Node.js 18+
pip install ai-error        # Python 3.9+, zero runtime dependencies
```

## Quick start: JavaScript

```js
const { aiError } = require('ai-error');

function parsePrice(order) {
  return Number(order.amount.replace('$', '')) * 1.2; // crashes when "amount" is missing
}

// export OPENAI_API_KEY=...   (or ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, ...)
const safeParsePrice = aiError(parsePrice, { name: 'parsePrice' });

await safeParsePrice({ amount: '$10' });  // 12
await safeParsePrice({ total: '$10' });   // repaired in parsePrice.js, reloaded, retried
```

Full docs: [packages/npm/README.md](packages/npm/README.md).

## Quick start: Python

```python
from ai_error import ai_error

@ai_error  # export OPENAI_API_KEY=...   (or ANTHROPIC_API_KEY, GEMINI_API_KEY, ...)
def parse_price(order):
    return float(order["amount"].replace("$", "")) * 1.2  # KeyError when "amount" is missing

parse_price({"amount": "$10"})  # 12.0
parse_price({"total": "$10"})   # repaired in place, reloaded, retried
```

Full docs: [packages/python/README.md](packages/python/README.md).

## How the self-healing loop works

```
call function ──► success ──► return result
      │
      └─ exception
            │
            ▼
   locate innermost failing function (AST, in your project only)
            │
            ▼
   send function + error (redacted) to the configured LLM
            │
     ┌──────┴────────────────┐
     ▼                       ▼
  canFix = true          canFix = false
     │                       │
  validate patch          raise AIHealError
  backup file             (code + how to fix,
  write patch              no secrets)
  reload module
  retry (up to N times)
```

## Choose a model and provider

| Provider | Environment variable | Example |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `provider: 'openai'` |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | `provider: 'anthropic'` |
| Google Gemini | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `provider: 'gemini'` |
| Groq | `GROQ_API_KEY` | `provider: 'groq'` |
| Mistral | `MISTRAL_API_KEY` | `provider: 'mistral'` |
| Ollama (local, no key) | none | `provider: 'ollama'` |
| Any LLM | yours | `complete: async (system, prompt) => ...` |

Environment variables control the defaults: `AI_ERROR_PROVIDER` picks the provider, `AI_ERROR_MODEL` picks the model. If you set neither, ai-error uses the first provider whose key it finds. Pass `model`, `apiKey`, or `baseUrl` in code to override them.

## Safety

ai-error edits source files, so the defaults are deliberately strict:

| Guard | What it does |
|---|---|
| Scope | Only the innermost failing function is edited |
| Roots | Only files under `allowedRoots` / `allowed_roots` (default: the current directory) |
| Excluded code | `node_modules` and `site-packages` are never edited |
| Validation | A patch must be a single valid function, and the whole file must still parse |
| Backups | Originals are saved in `.ai-error/backups/` before every change |
| Rollback | A patch that fails to load is reverted automatically |
| Redaction | Secrets and absolute paths are removed before any model call or error message |
| Privacy | Function arguments are never sent to the model |
| Budgets | `maxAttempts` and `maxFixes` cap the loop |
| Dry run | `dryRun: true` saves proposals for review instead of applying them |
| Kill switch | `AI_ERROR_DISABLE=1` turns it off everywhere |

Recommended practice: start with `dryRun`, add `.ai-error/` to `.gitignore`, review backups, and keep self-healing out of production until you have reviewed its patches.

## Configuration reference

| JavaScript option | Python parameter | Default | Purpose |
|---|---|---|---|
| `name` | `name` | function name | Export name used to reload the patched function |
| `maxAttempts` | `max_attempts` | `3` | Fix-and-retry rounds per call |
| `maxFixes` | `max_fixes` | `10` | Total automatic fixes per wrapped function |
| `maxLines` | `max_lines` | `200` | Refuse to edit longer functions |
| `allowedRoots` | `allowed_roots` | current directory | Folders that may be edited |
| `dryRun` | `dry_run` | `false` | Save proposals instead of applying them |
| `shouldHeal` | `should_heal` | always | Predicate that selects eligible errors |
| `onFix` | `on_fix` | none | Callback after each applied fix |
| `provider`, `model`, `apiKey`, `baseUrl`, `complete` | same names | env-based | Model selection |

## Repository layout

```
ai-error/
├── packages/
│   ├── npm/            # JavaScript package (publish to npm)
│   │   ├── src/        # aiError, providers, healer, redaction, TypeScript types
│   │   └── test/
│   └── python/         # Python package (publish to PyPI)
│       ├── src/ai_error/
│       └── tests/
├── examples/
│   ├── javascript/     # demo that depends on packages/npm
│   └── python/         # demo that depends on packages/python
└── .github/workflows/  # CI for both packages
```

## Run the examples

```bash
# JavaScript
cd examples/javascript && npm install && OPENAI_API_KEY=... node demo.js

# Python
cd examples/python && pip install -e ../../packages/python && OPENAI_API_KEY=... python demo.py
```

## FAQ

**What is self-healing code?** Software that detects a runtime failure and uses automated repair, here an LLM editing one function, to recover without a manual fix.

**Does ai-error work with Claude, Gemini, and local models?** Yes. Anthropic, Gemini, Groq, Mistral, and Ollama are built in. Any other model can be plugged in through a `complete` function.

**Is it safe to run in production?** Use it deliberately. The guards above reduce risk, but AI-generated patches should be reviewed. Many teams use it in development and CI, or with `dryRun` and manual approval.

**Will it fix any bug?** No. It handles bugs that can be resolved inside one function. Anything broader gets a clear message about what to change.

**Does it send my data to a third party?** Only the failing function's source, the redacted error, and the short stack trace are sent, to the provider you configure. Nothing is sent otherwise.

**Why does the wrapped function become async?** The repair step makes a network call, so the wrapper returns a Promise in JavaScript. In Python, sync functions stay sync.

## Contributing

Pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

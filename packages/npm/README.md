# ai-error — AI Self-Healing Error Handling for JavaScript & Node.js

**ai-error** (`aiError`) is a drop-in replacement for ordinary error handling. Wrap any function with `aiError()`. When it throws, an LLM (OpenAI, Anthropic Claude, Google Gemini, Groq, Mistral, Ollama, or any OpenAI-compatible endpoint) repairs **only the failing function**, reloads the module, and retries. If the fix is outside that function's scope, you get a clear error that tells you exactly what to change, with secrets redacted.

[![npm version](https://img.shields.io/npm/v/ai-error.svg)](https://www.npmjs.com/package/ai-error)
[![license](https://img.shields.io/npm/l/ai-error.svg)](LICENSE)

Keywords: self-healing code, AI auto-fix, LLM error handling, AI debugging, automatic bug fixing, OpenAI error handling, Claude error handling, Gemini error handling, Node.js error recovery, TypeScript support.

## Install

```bash
npm install ai-error
```

Requires Node.js 18 or newer.

## Quick start

```js
const { aiError } = require('ai-error');

function parsePrice(order) {
  return Number(order.amount.replace('$', '')) * 1.2; // crashes if "amount" is missing
}

// Set OPENAI_API_KEY (or ANTHROPIC_API_KEY, GEMINI_API_KEY, ...) in your environment.
const safeParsePrice = aiError(parsePrice, { name: 'parsePrice' });

await safeParsePrice({ amount: '$10' });  // 12
await safeParsePrice({ total: '$10' });   // error is repaired in parsePrice.js, reloaded, retried
```

Use it with TypeScript too. The types ship in `src/index.d.ts`.

## How the self-healing loop works

1. Your function runs normally.
2. If it throws, aiError finds the innermost function in your code at the failing line. Using a real JavaScript parser (acorn), it isolates that one function.
3. The function source, error message, and short stack go to the configured LLM. Secrets and absolute paths are redacted first.
4. The model returns a replacement for that function only. aiError checks that it is one valid function and that the whole file still parses.
5. The original file is backed up to `.ai-error/backups/`, then the patch is written.
6. The module is reloaded and the call is retried with the fixed logic. This repeats up to `maxAttempts`.
7. If the model says the fix belongs elsewhere, or a step fails, aiError throws an `AIHealError` whose message says how to fix it, with no secrets.

## Choosing a provider

aiError picks the model from your environment. You can also set it in code.

| Provider | Env variable | Example |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `aiError(fn, { provider: 'openai' })` |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | `aiError(fn, { provider: 'anthropic' })` |
| Google Gemini | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `aiError(fn, { provider: 'gemini' })` |
| Groq | `GROQ_API_KEY` | `aiError(fn, { provider: 'groq' })` |
| Mistral | `MISTRAL_API_KEY` | `aiError(fn, { provider: 'mistral' })` |
| DeepSeek | `DEEPSEEK_API_KEY` | `aiError(fn, { provider: 'deepseek' })` |
| xAI (Grok) | `XAI_API_KEY` | `aiError(fn, { provider: 'xai' })` |
| OpenRouter | `OPENROUTER_API_KEY` | `aiError(fn, { provider: 'openrouter', model: 'anthropic/claude-3.5-haiku' })` |
| Together AI | `TOGETHER_API_KEY` | `aiError(fn, { provider: 'together' })` |
| Fireworks AI | `FIREWORKS_API_KEY` | `aiError(fn, { provider: 'fireworks' })` |
| Perplexity | `PERPLEXITY_API_KEY` | `aiError(fn, { provider: 'perplexity' })` |
| Cerebras | `CEREBRAS_API_KEY` | `aiError(fn, { provider: 'cerebras' })` |
| Ollama (local) | none | `aiError(fn, { provider: 'ollama' })` |
| Any OpenAI-compatible API | your choice | `aiError(fn, { provider: 'custom', baseUrl: 'https://my-host/v1', model: 'my-model', apiKey: '...' })` |
| Any LLM (full control) | your choice | `aiError(fn, { complete: async (system, prompt) => '...' })` |

You can always pass `apiKey` directly in code instead of (or in addition to) an env var, for any named provider or for `custom`:

```js
aiError(fn, { provider: 'groq', apiKey: 'gsk_...', model: 'llama-3.3-70b-versatile' });
aiError(fn, { provider: 'gemini', apiKey: 'AIza...' });
```

Override the model with `model: 'your-model'` or `AI_ERROR_MODEL`. Select the provider with `AI_ERROR_PROVIDER`.

## Options

| Option | Default | Purpose |
|---|---|---|
| `name` | function name | Export name used to reload the patched function |
| `maxAttempts` | `3` | Fix-and-retry rounds per call |
| `maxFixes` | `10` | Total automatic fixes per wrapper |
| `maxLines` | `200` | Refuse to edit functions longer than this |
| `allowedRoots` | `[process.cwd()]` | Only files under these folders can be changed |
| `dryRun` | `false` | Save proposed fixes to `.ai-error/proposals/` and do not apply them |
| `shouldHeal` | `() => true` | Predicate to choose which errors are eligible |
| `onFix` | none | Callback after each applied fix (for logging or alerts) |
| `enabled` | `true` | Set `false` or `AI_ERROR_DISABLE=1` to turn it off |

## Safety

Automatic code editing is powerful, so ai-error is conservative by default:

- **Scope.** Only the innermost failing function is changed. Files outside `allowedRoots` and anything in `node_modules` are never touched.
- **Validation.** Every patch must be one syntactically valid function, and the whole file must parse afterwards.
- **Backups and rollback.** Each change is backed up first. If the patched module fails to load, it is rolled back automatically.
- **Secret redaction.** Environment secrets, API-key shapes, and absolute paths are removed before anything is sent to a model.
- **Argument privacy.** Function arguments are never sent to the model.
- **Budgets.** `maxAttempts` and `maxFixes` cap the loop.
- **Kill switch.** `AI_ERROR_DISABLE=1` turns it off everywhere.

Recommendations: use `dryRun: true` while you evaluate it, and keep it out of production unless you have reviewed its patches. Commit `.ai-error/` to `.gitignore`.

## Limitations

- Patches apply to the **named, module-level** function. Closures and anonymous functions cannot be reloaded, so aiError asks you to restart the process.
- Code that already holds a reference to the old function keeps the old one. The wrapper always calls the fixed version.
- Reloading re-runs the module's top-level code. Avoid wrapping functions in modules with heavy side effects.
- The entry script (`require.main`) is never reloaded.

## Error codes

`AIHealError.code` is one of `SCOPE`, `UNFIXABLE`, `REJECTED`, `LLM`, `PROVIDER`, `BUDGET`, `LOAD`, `DRY_RUN`, `RESTART`, `EXHAUSTED`. The original error is available as `err.cause`, for local debugging only.

## FAQ

**Does ai-error replace try/catch?** It adds a recovery step on top. Errors that cannot be fixed still reach your code as `AIHealError`.

**Does it cost money?** Only when an error occurs. Each attempt is one LLM request with one function's source.

**Is it deterministic?** No. LLM output varies. That is why scope, validation, and backups exist.

## Development

```bash
git clone https://github.com/YOUR_USER/ai-error.git
cd ai-error/packages/npm
npm install
npm test
```

## License

MIT

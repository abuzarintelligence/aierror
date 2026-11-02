'use strict';

const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const acorn = require('acorn');
const { redact } = require('./redact');
const { resolveProvider } = require('./providers');

const OWN_DIR = path.resolve(__dirname, '..') + path.sep;
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const FRAME_RE = /(?:\(|\s)((?:file:\/\/)?[^()\s]+):(\d+):(\d+)\)?\s*$/;

const SYSTEM_PROMPT = [
  'You are a conservative code-repair engine.',
  'You receive ONE JavaScript function that threw an error, plus the error and a short stack trace. Secrets are redacted.',
  'Return ONLY a JSON object. No prose, no markdown fences. Keys:',
  '  "canFix" (boolean)',
  '  "replacement" (string: the complete corrected function source, same name and signature, or null)',
  '  "explanation" (short string)',
  '  "userAdvice" (short string: what a developer must do if canFix is false; never include secrets)',
  'Change only this function. If the fix needs other files, configuration, dependencies, missing data or secrets, set canFix to false.',
  'Never invent credentials or URLs. Never add network calls, shell commands, or file deletion that the function did not already contain.',
].join('\n');

class AIHealError extends Error {
  constructor(message, { code = 'ERROR', file, cause } = {}) {
    super(message);
    this.name = 'AIHealError';
    this.code = code;
    this.file = file;
    if (cause) this.cause = cause;
  }
}

function secretValues() {
  return Object.entries(process.env)
    .filter(([k, v]) => /KEY|SECRET|TOKEN|PASS/i.test(k) && v && v.length >= 8)
    .map(([, v]) => v);
}

function sanitize(text) {
  return redact(text, secretValues());
}

function real(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function isInside(file, roots) {
  const f = real(file);
  return roots.some((r) => {
    const root = real(r);
    return f === root || f.startsWith(root + path.sep);
  });
}

/** Find the innermost stack frame that lives in the user's allowed source roots. */
function findUserFrame(error, roots) {
  for (const line of String(error?.stack || '').split('\n')) {
    const m = line.match(FRAME_RE);
    if (!m) continue;
    let file = m[1];
    if (file.startsWith('file://')) file = fileURLToPath(file);
    if (file.startsWith('node:') || file.includes(`${path.sep}node_modules${path.sep}`)) continue;
    if (file.startsWith(OWN_DIR)) continue;
    if (!isInside(file, roots)) continue;
    return { file: real(file), line: Number(m[2]) };
  }
  return null;
}

function parseJs(src) {
  for (const sourceType of ['module', 'script']) {
    try {
      return acorn.parse(src, {
        ecmaVersion: 'latest', sourceType, locations: true,
        allowHashBang: true, allowReturnOutsideFunction: true,
      });
    } catch { /* try the next source type */ }
  }
  return null;
}

/** Smallest function node that contains the given line. */
function innermostFunction(ast, line) {
  let best = null;
  (function visit(node) {
    if (FN_TYPES.has(node.type) && node.loc.start.line <= line && node.loc.end.line >= line) best = node;
    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const v = node[key];
      if (Array.isArray(v)) {
        for (const child of v) if (child && typeof child.type === 'string') visit(child);
      } else if (v && typeof v.type === 'string') {
        visit(v);
      }
    }
  })(ast);
  return best;
}

function isSingleFunction(src) {
  const ast = parseJs(src);
  if (!ast || ast.body.length !== 1) return false;
  const stmt = ast.body[0];
  const expr = stmt.type === 'ExpressionStatement' ? stmt.expression : stmt;
  return FN_TYPES.has(expr.type);
}

function parseModelJson(text) {
  const t = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  return null;
}

function pick(mod, name) {
  const isFn = (v) => typeof v === 'function';
  const found = [mod?.[name], mod?.default?.[name]].find(isFn);
  if (found) return found;
  return isFn(mod) && mod.name === name ? mod : null;
}

/** Reload the module that holds the function and return the fresh function by name. */
async function reloadFunction(file, name) {
  const resolved = require.resolve(file);
  // Never re-run the entry script; that would restart the whole app.
  if (require.main && require.main.filename === resolved) return null;
  try {
    delete require.cache[resolved];
    return pick(require(resolved), name);
  } catch (e) {
    if (e.code !== 'ERR_REQUIRE_ESM') throw e;
  }
  return pick(await import(`${pathToFileURL(resolved).href}?v=${Date.now()}`), name);
}

async function heal(error, { cfg, state, attempt }) {
  const bail = (code, advice, file) => {
    throw new AIHealError(sanitize(`[ai-error] ${cfg.name || 'function'} was not auto-fixed. ${advice}`), { code, file, cause: error });
  };

  if (state.fixes >= cfg.maxFixes) bail('BUDGET', 'The automatic fix budget for this process is used up.');

  const frame = findUserFrame(error, cfg.allowedRoots);
  if (!frame) bail('SCOPE', 'The error comes from outside the allowed scope (allowedRoots). Check the stack trace and fix that file manually.');

  const source = fs.readFileSync(frame.file, 'utf8');
  const ast = parseJs(source);
  const target = ast && innermostFunction(ast, frame.line);
  if (!target) bail('SCOPE', 'Could not isolate the failing function, so no change was made.', frame.file);

  const fnSrc = source.slice(target.start, target.end);
  if (fnSrc.split('\n').length > cfg.maxLines) {
    bail('SCOPE', `The function is longer than maxLines (${cfg.maxLines}), so no change was made.`, frame.file);
  }

  let provider;
  try { provider = resolveProvider(cfg); } catch (e) { bail('PROVIDER', e.message, frame.file); }

  const stack = String(error?.stack || '').split(process.cwd()).join('.').split('\n').slice(0, 12).join('\n');
  const prompt = sanitize([
    `File: ${path.basename(frame.file)} (line ${frame.line})`,
    `Error: ${error?.name || 'Error'}: ${error?.message || ''}`,
    'Stack (first lines):', stack,
    'Failing function:', '```js', fnSrc, '```',
  ].join('\n'));

  let raw;
  try { raw = await provider.complete(SYSTEM_PROMPT, prompt); } catch (e) { bail('LLM', e.message, frame.file); }

  const verdict = parseModelJson(raw);
  if (!verdict) bail('LLM', 'The model did not return valid JSON, so no change was made.', frame.file);
  if (!verdict.canFix || typeof verdict.replacement !== 'string' || !verdict.replacement.trim()) {
    bail('UNFIXABLE', verdict.userAdvice || 'The fix needs changes outside this function. Fix it manually.', frame.file);
  }

  const replacement = verdict.replacement.trim();
  if (replacement.length > fnSrc.length * 3 + 500 || !isSingleFunction(replacement)) {
    bail('REJECTED', 'The proposed patch was not a single reasonable function, so no change was made.', frame.file);
  }

  const next = source.slice(0, target.start) + replacement + source.slice(target.end);
  if (!parseJs(next)) bail('REJECTED', 'The proposed patch has a syntax error, so no change was made.', frame.file);

  if (cfg.dryRun) {
    const dir = path.join(cfg.stateDir, 'proposals');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${path.basename(frame.file)}.${Date.now()}.js`);
    fs.writeFileSync(out, next);
    bail('DRY_RUN', `Dry run: proposed fix saved to ${path.relative(process.cwd(), out)}. ${verdict.explanation || ''}`, frame.file);
  }

  const backupDir = path.join(cfg.stateDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `${path.basename(frame.file)}.${Date.now()}.bak`);
  fs.writeFileSync(backup, source);
  fs.writeFileSync(frame.file, next, 'utf8');
  state.fixes += 1;
  if (cfg.onFix) cfg.onFix({ file: frame.file, backup, explanation: verdict.explanation || '', attempt });

  let nextFn = null;
  if (cfg.name) {
    try {
      nextFn = await reloadFunction(frame.file, cfg.name);
    } catch (e) {
      fs.writeFileSync(frame.file, source, 'utf8'); // roll back a patch that breaks loading
      bail('LOAD', `The patched file failed to load and was rolled back: ${e.message}`, frame.file);
    }
  }
  if (!nextFn) bail('RESTART', `Fix saved to ${frame.file} (backup: ${backup}). Restart the process to load it.`, frame.file);
  return nextFn;
}

function normalize(fn, o) {
  return {
    enabled: o.enabled !== false && process.env.AI_ERROR_DISABLE !== '1',
    dryRun: o.dryRun ?? process.env.AI_ERROR_DRY_RUN === '1',
    name: o.name ?? fn.name ?? '',
    maxAttempts: o.maxAttempts ?? 3,
    maxFixes: o.maxFixes ?? 10,
    maxLines: o.maxLines ?? 200,
    allowedRoots: o.allowedRoots ?? [process.cwd()],
    stateDir: o.stateDir ?? path.join(process.cwd(), '.ai-error'),
    shouldHeal: o.shouldHeal ?? (() => true),
    onFix: o.onFix,
    provider: o.provider,
    model: o.model,
    apiKey: o.apiKey,
    baseUrl: o.baseUrl,
    complete: o.complete,
  };
}

/**
 * aiError(fn, options) wraps fn. When fn throws, the failing function is repaired
 * by an LLM (only inside allowedRoots), the module is reloaded, and fn is retried.
 * If the fix is out of scope or fails, an AIHealError with plain-language advice is thrown.
 */
function aiError(fn, options = {}) {
  if (typeof fn !== 'function') throw new TypeError('aiError(fn, options): fn must be a function');
  const cfg = normalize(fn, options);
  const state = { fixes: 0 };

  return async function aiErrorWrapped(...args) {
    let current = fn;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await current.apply(this, args);
      } catch (error) {
        if (!cfg.enabled || error instanceof AIHealError || !cfg.shouldHeal(error)) throw error;
        if (attempt > cfg.maxAttempts) {
          throw new AIHealError(`[ai-error] ${cfg.name || 'function'} still fails after ${cfg.maxAttempts} fix attempts. Fix it manually.`, { code: 'EXHAUSTED', cause: error });
        }
        current = await heal(error, { cfg, state, attempt });
      }
    }
  };
}

module.exports = { aiError, AIHealError };

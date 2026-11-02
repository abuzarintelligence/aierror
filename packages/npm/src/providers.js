'use strict';

const PROVIDERS = {
  openai:     { kind: 'openai',    env: ['OPENAI_API_KEY'],                baseUrl: 'https://api.openai.com/v1',                       model: 'gpt-4o-mini',              needsKey: true },
  anthropic:  { kind: 'anthropic', env: ['ANTHROPIC_API_KEY'],             baseUrl: 'https://api.anthropic.com',                       model: 'claude-3-5-haiku-latest',  needsKey: true },
  gemini:     { kind: 'gemini',    env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash',       needsKey: true },
  groq:       { kind: 'openai',    env: ['GROQ_API_KEY'],                  baseUrl: 'https://api.groq.com/openai/v1',                  model: 'llama-3.1-70b-versatile',  needsKey: true },
  mistral:    { kind: 'openai',    env: ['MISTRAL_API_KEY'],               baseUrl: 'https://api.mistral.ai/v1',                       model: 'mistral-small-latest',     needsKey: true },
  deepseek:   { kind: 'openai',    env: ['DEEPSEEK_API_KEY'],              baseUrl: 'https://api.deepseek.com/v1',                     model: 'deepseek-chat',            needsKey: true },
  xai:        { kind: 'openai',    env: ['XAI_API_KEY'],                   baseUrl: 'https://api.x.ai/v1',                             model: 'grok-2-latest',            needsKey: true },
  openrouter: { kind: 'openai',    env: ['OPENROUTER_API_KEY'],            baseUrl: 'https://openrouter.ai/api/v1',                    model: 'openai/gpt-4o-mini',       needsKey: true },
  together:   { kind: 'openai',    env: ['TOGETHER_API_KEY'],              baseUrl: 'https://api.together.xyz/v1',                     model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', needsKey: true },
  fireworks:  { kind: 'openai',    env: ['FIREWORKS_API_KEY'],             baseUrl: 'https://api.fireworks.ai/inference/v1',           model: 'accounts/fireworks/models/llama-v3p1-70b-instruct', needsKey: true },
  perplexity: { kind: 'openai',    env: ['PERPLEXITY_API_KEY'],            baseUrl: 'https://api.perplexity.ai',                       model: 'sonar',                    needsKey: true },
  cerebras:   { kind: 'openai',    env: ['CEREBRAS_API_KEY'],              baseUrl: 'https://api.cerebras.ai/v1',                      model: 'llama3.1-70b',             needsKey: true },
  ollama:     { kind: 'openai',    env: [],                                baseUrl: 'http://localhost:11434/v1',                       model: 'llama3.1',                 needsKey: false },
  custom:     { kind: 'openai',    env: [],                                baseUrl: '',                                                model: '',                         needsKey: false },
};

// Order used when no provider is named and autodetection runs.
const AUTO_ORDER = ['openai', 'anthropic', 'gemini', 'groq', 'mistral', 'deepseek', 'xai', 'openrouter', 'together', 'fireworks', 'perplexity', 'cerebras'];

function firstEnv(names) {
  for (const name of names) if (process.env[name]) return process.env[name];
  return undefined;
}

async function callProvider(p, system, prompt) {
  const signal = AbortSignal.timeout(60_000);
  const json = { 'content-type': 'application/json' };
  let res;

  if (p.kind === 'anthropic') {
    res = await fetch(`${p.baseUrl}/v1/messages`, {
      method: 'POST', signal,
      headers: { ...json, 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: p.model, max_tokens: 2000, temperature: 0, system, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`${p.name} request failed with HTTP ${res.status}`);
    const data = await res.json();
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  if (p.kind === 'gemini') {
    res = await fetch(`${p.baseUrl}/models/${p.model}:generateContent`, {
      method: 'POST', signal,
      headers: { ...json, 'x-goog-api-key': p.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2000 },
      }),
    });
    if (!res.ok) throw new Error(`${p.name} request failed with HTTP ${res.status}`);
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.map((part) => part.text || '').join('');
  }

  // OpenAI-compatible (OpenAI, Groq, Mistral, Ollama, and any compatible gateway)
  const headers = { ...json };
  if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
  res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: 'POST', signal, headers,
    body: JSON.stringify({ model: p.model, temperature: 0, max_tokens: 2000, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`${p.name} request failed with HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Resolve which model/provider to use.
 * Priority: opts.complete (custom function) > opts.provider > AI_ERROR_PROVIDER > autodetect from env keys.
 */
function resolveProvider(opts = {}) {
  if (typeof opts.complete === 'function') {
    return { name: 'custom', complete: opts.complete };
  }

  let name = (opts.provider || process.env.AI_ERROR_PROVIDER || '').toLowerCase();
  if (!name) name = AUTO_ORDER.find((p) => firstEnv(PROVIDERS[p].env)) || '';
  if (!name) {
    throw new Error('no AI provider configured: set OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY or another supported key');
  }

  const spec = PROVIDERS[name];
  if (!spec) throw new Error(`unknown provider "${name}". Use one of ${Object.keys(PROVIDERS).join(', ')}, or pass baseUrl with provider: 'custom'.`);

  const apiKey = opts.apiKey || firstEnv(spec.env);
  if (spec.needsKey && !apiKey) throw new Error(`missing API key for ${name}: set ${spec.env.join(' or ')}`);

  const baseUrl = opts.baseUrl || spec.baseUrl;
  if (name === 'custom' && !baseUrl) throw new Error(`provider "custom" requires baseUrl (an OpenAI-compatible /chat/completions endpoint)`);
  const model = opts.model || process.env.AI_ERROR_MODEL || spec.model;
  if (name === 'custom' && !model) throw new Error(`provider "custom" requires model`);

  const p = {
    name,
    kind: opts.kind || spec.kind,
    model,
    baseUrl,
    apiKey,
  };
  return { name, complete: (system, prompt) => callProvider(p, system, prompt) };
}

module.exports = { PROVIDERS, resolveProvider };

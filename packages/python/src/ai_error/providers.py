import json
import os
import urllib.error
import urllib.request

PROVIDERS = {
    "openai": {"kind": "openai", "env": ["OPENAI_API_KEY"], "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini", "needs_key": True},
    "anthropic": {"kind": "anthropic", "env": ["ANTHROPIC_API_KEY"], "base_url": "https://api.anthropic.com", "model": "claude-3-5-haiku-latest", "needs_key": True},
    "gemini": {"kind": "gemini", "env": ["GEMINI_API_KEY", "GOOGLE_API_KEY"], "base_url": "https://generativelanguage.googleapis.com/v1beta", "model": "gemini-1.5-flash", "needs_key": True},
    "groq": {"kind": "openai", "env": ["GROQ_API_KEY"], "base_url": "https://api.groq.com/openai/v1", "model": "llama-3.1-70b-versatile", "needs_key": True},
    "mistral": {"kind": "openai", "env": ["MISTRAL_API_KEY"], "base_url": "https://api.mistral.ai/v1", "model": "mistral-small-latest", "needs_key": True},
    "deepseek": {"kind": "openai", "env": ["DEEPSEEK_API_KEY"], "base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat", "needs_key": True},
    "xai": {"kind": "openai", "env": ["XAI_API_KEY"], "base_url": "https://api.x.ai/v1", "model": "grok-2-latest", "needs_key": True},
    "openrouter": {"kind": "openai", "env": ["OPENROUTER_API_KEY"], "base_url": "https://openrouter.ai/api/v1", "model": "openai/gpt-4o-mini", "needs_key": True},
    "together": {"kind": "openai", "env": ["TOGETHER_API_KEY"], "base_url": "https://api.together.xyz/v1", "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo", "needs_key": True},
    "fireworks": {"kind": "openai", "env": ["FIREWORKS_API_KEY"], "base_url": "https://api.fireworks.ai/inference/v1", "model": "accounts/fireworks/models/llama-v3p1-70b-instruct", "needs_key": True},
    "perplexity": {"kind": "openai", "env": ["PERPLEXITY_API_KEY"], "base_url": "https://api.perplexity.ai", "model": "sonar", "needs_key": True},
    "cerebras": {"kind": "openai", "env": ["CEREBRAS_API_KEY"], "base_url": "https://api.cerebras.ai/v1", "model": "llama3.1-70b", "needs_key": True},
    "ollama": {"kind": "openai", "env": [], "base_url": "http://localhost:11434/v1", "model": "llama3.1", "needs_key": False},
    "custom": {"kind": "openai", "env": [], "base_url": "", "model": "", "needs_key": False},
}

AUTO_ORDER = ["openai", "anthropic", "gemini", "groq", "mistral", "deepseek", "xai", "openrouter", "together", "fireworks", "perplexity", "cerebras"]


def _first_env(names):
    for name in names:
        if os.environ.get(name):
            return os.environ[name]
    return None


def _post(url, headers, body, timeout=60):
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"content-type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Never include the response body: it can echo credentials.
        raise RuntimeError(f"provider request failed with HTTP {e.code}") from None


def _call(p, system, prompt, max_tokens=2000):
    kind = p["kind"]
    if kind == "anthropic":
        data = _post(f"{p['base_url']}/v1/messages",
                     {"x-api-key": p["api_key"], "anthropic-version": "2023-06-01"},
                     {"model": p["model"], "max_tokens": max_tokens, "temperature": 0,
                      "system": system, "messages": [{"role": "user", "content": prompt}]})
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    if kind == "gemini":
        data = _post(f"{p['base_url']}/models/{p['model']}:generateContent",
                     {"x-goog-api-key": p["api_key"]},
                     {"systemInstruction": {"parts": [{"text": system}]},
                      "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                      "generationConfig": {"temperature": 0, "maxOutputTokens": max_tokens}})
        candidates = data.get("candidates") or [{}]
        parts = candidates[0].get("content", {}).get("parts", [])
        return "".join(part.get("text", "") for part in parts)
    headers = {"authorization": f"Bearer {p['api_key']}"} if p.get("api_key") else {}
    data = _post(f"{p['base_url']}/chat/completions", headers,
                 {"model": p["model"], "temperature": 0, "max_tokens": max_tokens,
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]})
    return data["choices"][0]["message"]["content"]


def resolve_provider(provider=None, model=None, api_key=None, base_url=None, complete=None, kind=None):
    """Return a function complete(system, prompt) -> str for the chosen provider.

    Priority: complete (custom callable) > provider argument > AI_ERROR_PROVIDER > autodetect from env keys.
    Pass provider="custom" with base_url (and model) to use any OpenAI-compatible endpoint.
    """
    if complete is not None:
        return complete

    name = (provider or os.environ.get("AI_ERROR_PROVIDER") or "").lower()
    if not name:
        name = next((p for p in AUTO_ORDER if _first_env(PROVIDERS[p]["env"])), "")
    if not name:
        raise RuntimeError("no AI provider configured: set OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY or another supported key")

    spec = PROVIDERS.get(name)
    if spec is None:
        raise RuntimeError(f'unknown provider "{name}". Use one of {", ".join(PROVIDERS)}, or pass provider="custom" with base_url.')

    key = api_key or _first_env(spec["env"])
    if spec["needs_key"] and not key:
        raise RuntimeError(f"missing API key for {name}: set {' or '.join(spec['env'])}")

    resolved_base_url = base_url or spec["base_url"]
    if name == "custom" and not resolved_base_url:
        raise RuntimeError('provider "custom" requires base_url (an OpenAI-compatible /chat/completions endpoint)')
    resolved_model = model or os.environ.get("AI_ERROR_MODEL") or spec["model"]
    if name == "custom" and not resolved_model:
        raise RuntimeError('provider "custom" requires model')

    p = {
        "name": name,
        "kind": kind or spec["kind"],
        "model": resolved_model,
        "base_url": resolved_base_url,
        "api_key": key,
    }
    return lambda system, prompt: _call(p, system, prompt)

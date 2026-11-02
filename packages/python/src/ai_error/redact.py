import os
import re

_PATTERNS = [
    re.compile(r"sk-ant-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"AIza[0-9A-Za-z_\-]{20,}"),
    re.compile(r"gsk_[A-Za-z0-9]{16,}"),
    re.compile(r"\b[A-Za-z0-9_\-]{32,}\b"),
]


def secret_values():
    """Values of environment variables that look like credentials."""
    return [v for k, v in os.environ.items()
            if re.search(r"KEY|SECRET|TOKEN|PASS", k, re.I) and v and len(v) >= 8]


def redact(text, extra=None):
    """Remove secrets from text before it is shown, logged, or sent to a model."""
    out = str(text if text is not None else "")
    for secret in (extra if extra is not None else secret_values()):
        out = out.replace(secret, "[REDACTED]")
    for pattern in _PATTERNS:
        out = pattern.sub("[REDACTED]", out)
    return out

"""ai_error: AI self-healing error handling for Python."""
from .healer import ai_error, AIHealError
from .providers import resolve_provider, PROVIDERS
from .redact import redact

__version__ = "0.1.0"
__all__ = ["ai_error", "AIHealError", "resolve_provider", "PROVIDERS", "redact", "__version__"]

# Contributing to ai-error

Thanks for helping. Please:

1. Open an issue first for large changes.
2. Run the tests for the package you change:
   - JavaScript: `cd packages/npm && npm install && npm test`
   - Python: `cd packages/python && pip install -e . && python -m unittest discover -s tests -v`
3. Keep changes small and focused. Safety guards (scope, validation, redaction, backups) must not be weakened without discussion.
4. Never commit API keys, `.ai-error/` folders, or real customer code in tests or examples.

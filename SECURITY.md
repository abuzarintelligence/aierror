# Security policy

ai-error sends code excerpts to third-party LLM providers and writes to source files. Please report vulnerabilities privately through GitHub Security Advisories on this repository rather than public issues. Include steps to reproduce and the affected version.

Known design protections: secret redaction before model calls, scope limits to `allowedRoots`, validation of patches, backups, and automatic rollback.

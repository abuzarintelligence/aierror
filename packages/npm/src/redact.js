'use strict';

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /gsk_[A-Za-z0-9]{16,}/g,
  /\b[A-Za-z0-9_-]{32,}\b/g,
];

/** Remove secrets from text before it is shown, logged, or sent to a model. */
function redact(text, extraSecrets = []) {
  let out = String(text ?? '');
  for (const secret of extraSecrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[REDACTED]');
  }
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

module.exports = { redact };

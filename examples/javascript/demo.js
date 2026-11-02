// Run: OPENAI_API_KEY=... node demo.js   (or ANTHROPIC_API_KEY, GEMINI_API_KEY, ...)
const { aiError } = require('ai-error');
const { parsePrice } = require('./pricing');

const safeParsePrice = aiError(parsePrice, { name: 'parsePrice', maxAttempts: 2, dryRun: false });

(async () => {
  console.log(await safeParsePrice({ amount: '$10' }));
  console.log(await safeParsePrice({ total: '$10' })); // self-healed
})().catch((err) => console.error(err.code, err.message));

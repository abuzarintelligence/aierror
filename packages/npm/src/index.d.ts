export interface AIErrorOptions {
  /** Provider name: openai | anthropic | gemini | groq | mistral | deepseek | xai | openrouter | together | fireworks | perplexity | cerebras | ollama | custom. Autodetected from env keys if omitted. Use "custom" with baseUrl for any OpenAI-compatible endpoint. */
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  /** Custom completion function. Use this to plug in any LLM. */
  complete?: (system: string, prompt: string) => Promise<string>;
  /** Export name of the function inside its module. Needed so the patched version can be reloaded. */
  name?: string;
  /** Automatic fix attempts per call (default 3). */
  maxAttempts?: number;
  /** Total automatic fixes per wrapper (default 10). */
  maxFixes?: number;
  /** Refuse to heal functions longer than this many lines (default 200). */
  maxLines?: number;
  /** Only files under these directories may be modified (default [process.cwd()]). */
  allowedRoots?: string[];
  /** Where backups and proposals are stored (default ./.ai-error). */
  stateDir?: string;
  /** Write proposed fixes to disk for review instead of applying them. */
  dryRun?: boolean;
  enabled?: boolean;
  shouldHeal?: (error: unknown) => boolean;
  onFix?: (info: { file: string; backup: string; explanation: string; attempt: number }) => void;
}

export declare class AIHealError extends Error {
  code: string;
  file?: string;
  cause?: unknown;
}

export declare function aiError<T extends (...args: any[]) => any>(
  fn: T,
  options?: AIErrorOptions
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>>;

export declare const withAiError: typeof aiError;
export declare function redact(text: unknown, extraSecrets?: string[]): string;
export declare function resolveProvider(opts?: { provider?: string; model?: string; apiKey?: string; baseUrl?: string; complete?: (s: string, p: string) => Promise<string> }): { name: string; complete: (system: string, prompt: string) => Promise<string> };
export declare const PROVIDERS: Record<string, { kind: string; env: string[]; baseUrl: string; model: string; needsKey: boolean }>;

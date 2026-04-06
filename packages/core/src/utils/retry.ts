/**
 * Retry utility with exponential backoff and rate limit handling
 */

import { RetryConfig, RateLimitConfig } from "../types/config";

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 1,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

/**
 * Default rate limit configuration
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  respectRetryAfter: true,
  maxRetryAfterMs: 120000,
  defaultBackoffMs: 5000,
};

/**
 * Logger interface (compatible with Fastify logger)
 */
interface Logger {
  warn(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * Error with HTTP status code (Fastify error format)
 */
interface HttpError extends Error {
  statusCode?: number;
  headers?: Record<string, string>;
}

/**
 * Calculate delay for retry attempt
 *
 * For rate limit (429) with retry-after header:
 *   - Uses retry-after value if present and respectRetryAfter is true
 *   - Falls back to exponential backoff otherwise
 *
 * For other errors:
 *   - Uses exponential backoff: baseDelayMs * (backoffMultiplier ^ (attempt - 1))
 *   - Capped at maxDelayMs
 */
export function calculateDelay(
  attempt: number,
  retryAfterMs?: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  rateLimitConfig: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
): number {
  // Rate limit (429) and retry-after header is present
  if (retryAfterMs && rateLimitConfig.respectRetryAfter) {
    return Math.min(retryAfterMs, rateLimitConfig.maxRetryAfterMs);
  }

  // Exponential backoff
  const delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Parse retry-after header from response
 *
 * Supports both formats:
 *   - Seconds: "retry-after: 120" (120 seconds)
 *   - HTTP date: "retry-after: Wed, 21 Oct 2025 07:28:00 GMT"
 */
export function parseRetryAfter(headers?: Record<string, string>): number | undefined {
  if (!headers?.['retry-after']) {
    return undefined;
  }

  const value = headers['retry-after'].trim();

  // Try parsing as seconds (integer)
  const seconds = parseInt(value, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000; // Convert to milliseconds
  }

  // Try parsing as HTTP date
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    const delay = Math.max(0, date.getTime() - Date.now());
    return delay;
  }

  return undefined;
}

/**
 * Sleep utility for async delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry and exponential backoff
 *
 * The function will be called up to (maxRetries + 1) times:
 *   - 1 initial attempt + maxRetries retry attempts
 *
 * @param fn - Async function to execute
 * @param config - Retry configuration
 * @param rateLimitConfig - Rate limit specific configuration
 * @param logger - Optional logger for debug output
 * @returns Result from successful function call
 * @throws Error from last failed attempt if all retries exhausted
 *
 * @example
 * ```typescript
 * const response = await retryWithBackoff(
 *   () => sendRequest(url, body),
 *   { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2, retryableStatusCodes: [429, 500, 503] },
 *   { respectRetryAfter: true, maxRetryAfterMs: 120000, defaultBackoffMs: 5000 },
 *   fastify.log
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  rateLimitConfig: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
  logger?: Logger
): Promise<T> {
  let lastError: Error | undefined;

  // Total attempts = 1 (initial) + maxRetries (retries)
  const totalAttempts = config.maxRetries + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const httpError = error as HttpError;
      const statusCode = httpError.statusCode;
      const isRetryable = statusCode ? config.retryableStatusCodes.includes(statusCode) : false;

      // If not retryable or we've exhausted all attempts, throw
      if (!isRetryable || attempt >= totalAttempts) {
        throw error;
      }

      // Calculate delay for next retry
      const retryAfterMs = parseRetryAfter(httpError.headers);
      const delay = calculateDelay(attempt, retryAfterMs, config, rateLimitConfig);

      logger?.warn?.(
        `[Retry] ${statusCode} error (attempt ${attempt}/${totalAttempts}), retrying in ${delay}ms...`
      );

      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript requires it
  throw lastError;
}

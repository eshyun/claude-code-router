/**
 * Configuration types for retry, rate limit, and circuit breaker
 */

/**
 * Retry configuration for API requests
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 1) */
  maxRetries: number;

  /** Initial delay in milliseconds (default: 1000) */
  baseDelayMs: number;

  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;

  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier: number;

  /** HTTP status codes that should trigger retry (default: [429, 500, 502, 503, 504]) */
  retryableStatusCodes: number[];
}

/**
 * Rate limit specific configuration
 */
export interface RateLimitConfig {
  /** Whether to respect retry-after header (default: true) */
  respectRetryAfter: boolean;

  /** Maximum allowed retry-after time in milliseconds (default: 120000) */
  maxRetryAfterMs: number;

  /** Default backoff when retry-after header is missing (default: 5000) */
  defaultBackoffMs: number;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Enable circuit breaker pattern (default: true) */
  enabled: boolean;

  /** Number of consecutive failures before opening circuit (default: 3) */
  failureThreshold: number;

  /** Time in milliseconds before attempting recovery (default: 60000) */
  recoveryTimeoutMs: number;

  /** Maximum requests allowed in half-open state (default: 1) */
  halfOpenMaxRequests: number;
}

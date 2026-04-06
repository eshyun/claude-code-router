/**
 * Circuit breaker pattern implementation for provider failure tracking
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit tripped after failureThreshold, requests blocked
 * - HALF_OPEN: Testing recovery, limited requests allowed
 */

import { CircuitBreakerConfig } from "../types/config";

/**
 * Circuit breaker states
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

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
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  enabled: true,
  failureThreshold: 3,
  recoveryTimeoutMs: 60000,
  halfOpenMaxRequests: 1,
};

/**
 * Error thrown when circuit breaker is OPEN
 */
export class CircuitBreakerOpenError extends Error {
  public readonly providerKey: string;
  public readonly timeUntilRecovery?: number;

  constructor(providerKey: string, timeUntilRecovery?: number) {
    super(`Circuit breaker is OPEN for ${providerKey}`);
    this.name = 'CircuitBreakerOpenError';
    this.providerKey = providerKey;
    this.timeUntilRecovery = timeUntilRecovery;
  }
}

/**
 * Circuit breaker for a single provider
 *
 * Key format: "providerName,modelName"
 *
 * State transitions:
 * - CLOSED -> OPEN: When consecutive failures reach failureThreshold
 * - OPEN -> HALF_OPEN: After recoveryTimeoutMs elapses
 * - HALF_OPEN -> CLOSED: After halfOpenMaxRequests successful calls
 * - HALF_OPEN -> OPEN: On any failure
 */
export class CircuitBreaker {
  readonly key: string;
  private config: CircuitBreakerConfig;
  state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private lastFailureTime?: number;
  private halfOpenRequests: number = 0;
  private halfOpenSuccesses: number = 0;
  private logger?: Logger;

  constructor(key: string, config: CircuitBreakerConfig, logger?: Logger) {
    this.key = key;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Check if request can proceed through circuit breaker
   */
  canExecute(): boolean {
    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      const now = Date.now();
      if (
        this.lastFailureTime &&
        now - this.lastFailureTime >= this.config.recoveryTimeoutMs
      ) {
        // Recovery timeout elapsed -> transition to HALF_OPEN
        this.state = 'HALF_OPEN';
        this.halfOpenRequests = 0;
        this.halfOpenSuccesses = 0;
        this.logger?.debug?.(
          `[CircuitBreaker] ${this.key}: OPEN -> HALF_OPEN (recovery timeout elapsed)`
        );
        return true;
      }
      return false; // Still in recovery period -> blocked
    }

    // HALF_OPEN: allow limited requests
    return this.halfOpenRequests < this.config.halfOpenMaxRequests;
  }

  /**
   * Get time remaining until circuit transitions to HALF_OPEN
   */
  getTimeUntilRecovery(): number | null {
    if (this.state !== 'OPEN' || !this.lastFailureTime) {
      return null;
    }
    const elapsed = Date.now() - this.lastFailureTime;
    const remaining = this.config.recoveryTimeoutMs - elapsed;
    return Math.max(0, remaining);
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      const timeUntilRecovery = this.getTimeUntilRecovery() ?? undefined;
      this.logger?.warn?.(
        `[CircuitBreaker] ${this.key}: Request blocked (circuit is OPEN, ~${Math.ceil((timeUntilRecovery || 0) / 1000)}s until recovery)`
      );
      throw new CircuitBreakerOpenError(this.key, timeUntilRecovery ?? undefined);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Record successful request
   */
  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenRequests++;
      this.halfOpenSuccesses++;

      // Enough successes in HALF_OPEN -> transition to CLOSED
      if (this.halfOpenSuccesses >= this.config.halfOpenMaxRequests) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.halfOpenRequests = 0;
        this.halfOpenSuccesses = 0;
        this.lastFailureTime = undefined;
        this.logger?.info?.(
          `[CircuitBreaker] ${this.key}: HALF_OPEN -> CLOSED (recovered)`
        );
      }
    } else {
      // Reset failure count on success in CLOSED state
      this.failureCount = 0;
    }
  }

  /**
   * Record failed request
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Any failure in HALF_OPEN -> back to OPEN
      this.state = 'OPEN';
      this.logger?.warn?.(
        `[CircuitBreaker] ${this.key}: HALF_OPEN -> OPEN (failure during recovery)`
      );
    } else if (this.failureCount >= this.config.failureThreshold) {
      // Consecutive failures threshold reached -> OPEN
      this.state = 'OPEN';
      this.logger?.warn?.(
        `[CircuitBreaker] ${this.key}: CLOSED -> OPEN (${this.failureCount} consecutive failures)`
      );
    }
  }

  /**
   * Get current status summary for logging/monitoring
   */
  getStatus(): {
    state: CircuitState;
    failures: number;
    lastFailure?: number;
    timeUntilRecovery?: number | null;
  } {
    return {
      state: this.state,
      failures: this.failureCount,
      lastFailure: this.lastFailureTime,
      timeUntilRecovery: this.getTimeUntilRecovery(),
    };
  }
}

/**
 * Registry for managing circuit breakers per provider
 *
 * Key format: "providerName,modelName"
 */
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private config: CircuitBreakerConfig;
  private logger?: Logger;

  constructor(config: CircuitBreakerConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Get or create a circuit breaker for a provider key
   */
  getOrCreate(key: string): CircuitBreaker {
    if (!this.breakers.has(key)) {
      this.breakers.set(key, new CircuitBreaker(key, this.config, this.logger));
      this.logger?.debug?.(`[CircuitBreaker] Created new circuit breaker for ${key}`);
    }
    return this.breakers.get(key)!;
  }

  /**
   * Get circuit breaker state for a provider (returns CLOSED if not exists)
   */
  getState(key: string): CircuitState {
    return this.breakers.get(key)?.state ?? 'CLOSED';
  }

  /**
   * Get status summary for all circuit breakers
   */
  getAllStatus(): Record<string, ReturnType<CircuitBreaker['getStatus']>> {
    const status: Record<string, ReturnType<CircuitBreaker['getStatus']>> = {};
    for (const [key, breaker] of this.breakers) {
      status[key] = breaker.getStatus();
    }
    return status;
  }

  /**
   * Reset circuit breaker for a provider (for testing/admin purposes)
   */
  reset(key: string): void {
    this.breakers.delete(key);
    this.logger?.info?.(`[CircuitBreaker] Reset circuit breaker for ${key}`);
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.breakers.clear();
    this.logger?.info?.('[CircuitBreaker] Reset all circuit breakers');
  }
}

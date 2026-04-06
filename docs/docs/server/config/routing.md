---
sidebar_position: 3
---

# Routing Configuration

Configure how requests are routed to different models.

## Default Routing

Set the default model for all requests:

```json
{
  "Router": {
    "default": "deepseek,deepseek-chat"
  }
}
```

## Built-in Scenarios

### Background Tasks

Route background tasks to a lightweight model:

```json
{
  "Router": {
    "background": "groq,llama-3.3-70b-versatile"
  }
}
```

### Thinking Mode (Plan Mode)

Route thinking-intensive tasks to a more capable model:

```json
{
  "Router": {
    "think": "deepseek,deepseek-chat"
  }
}
```

### Long Context

Route requests with long context:

```json
{
  "Router": {
    "longContextThreshold": 100000,
    "longContext": "gemini,gemini-1.5-pro"
  }
}
```

### Web Search

Route web search tasks:

```json
{
  "Router": {
    "webSearch": "deepseek,deepseek-chat"
  }
}
```

### Image Tasks

Route image-related tasks:

```json
{
  "Router": {
    "image": "gemini,gemini-1.5-pro"
  }
}
```

## Fallback

When a request fails, you can configure a list of backup models. The system will try each model in sequence until one succeeds:

### Basic Configuration

```json
{
  "Router": {
    "default": "deepseek,deepseek-chat",
    "background": "ollama,qwen2.5-coder:latest",
    "think": "deepseek,deepseek-reasoner",
    "longContext": "openrouter,google/gemini-2.5-pro-preview",
    "longContextThreshold": 60000,
    "webSearch": "gemini,gemini-2.5-flash"
  },
  "fallback": {
    "default": [
      "aihubmix,Z/glm-4.5",
      "openrouter,anthropic/claude-sonnet-4"
    ],
    "background": [
      "ollama,qwen2.5-coder:latest"
    ],
    "think": [
      "openrouter,anthropic/claude-3.7-sonnet:thinking"
    ],
    "longContext": [
      "modelscope,Qwen/Qwen3-Coder-480B-A35B-Instruct"
    ],
    "webSearch": [
      "openrouter,anthropic/claude-sonnet-4"
    ]
  }
}
```

### How It Works

1. **Trigger**: When a model request fails for a routing scenario (HTTP error response)
2. **Auto-switch**: The system automatically checks the fallback configuration for that scenario
3. **Sequential retry**: Tries each backup model in order
4. **Success**: Once a model responds successfully, returns immediately
5. **All failed**: If all backup models fail, returns the original error

### Configuration Details

- **Format**: Each backup model format is `provider,model`
- **Validation**: Backup models must exist in the `Providers` configuration
- **Flexibility**: Different scenarios can have different fallback lists
- **Optional**: If a scenario doesn't need fallback, omit it or use an empty array

### Use Cases

#### Scenario 1: Primary Model Quota Exhausted

```json
{
  "Router": {
    "default": "openrouter,anthropic/claude-sonnet-4"
  },
  "fallback": {
    "default": [
      "deepseek,deepseek-chat",
      "aihubmix,Z/glm-4.5"
    ]
  }
}
```

Automatically switches to backup models when the primary model quota is exhausted.

#### Scenario 2: Service Reliability

```json
{
  "Router": {
    "background": "volcengine,deepseek-v3-250324"
  },
  "fallback": {
    "background": [
      "modelscope,Qwen/Qwen3-Coder-480B-A35B-Instruct",
      "dashscope,qwen3-coder-plus"
    ]
  }
}
```

Automatically switches to other providers when the primary service fails.

### Log Monitoring

The system logs detailed fallback process:

```
[warn] Request failed for default, trying 2 fallback models
[info] Trying fallback model: aihubmix,Z/glm-4.5
[warn] Fallback model aihubmix,Z/glm-4.5 failed: API rate limit exceeded
[info] Trying fallback model: openrouter,anthropic/claude-sonnet-4
[info] Fallback model openrouter,anthropic/claude-sonnet-4 succeeded
```

### Important Notes

1. **Cost consideration**: Backup models may incur different costs, configure appropriately
2. **Performance differences**: Different models may have varying response speeds and quality
3. **Quota management**: Ensure backup models have sufficient quotas
4. **Testing**: Regularly test the availability of backup models

## Retry

When a request fails with a retryable error code, the system can automatically retry the request with exponential backoff before falling back to alternative models.

### Basic Configuration

```json
{
  "retry": {
    "maxRetries": 1,
    "baseDelayMs": 1000,
    "maxDelayMs": 30000,
    "backoffMultiplier": 2,
    "retryableStatusCodes": [429, 500, 502, 503, 504]
  },
  "rateLimit": {
    "respectRetryAfter": true,
    "maxRetryAfterMs": 120000,
    "defaultBackoffMs": 5000
  }
}
```

### Configuration Details

**Retry Settings**:
- **maxRetries**: Number of retry attempts (default: 1). Total attempts = maxRetries + 1 (initial + retries)
- **baseDelayMs**: Initial delay in milliseconds before first retry (default: 1000)
- **maxDelayMs**: Maximum delay cap in milliseconds (default: 30000)
- **backoffMultiplier**: Multiplier for exponential backoff (default: 2)
- **retryableStatusCodes**: HTTP status codes that trigger retry (default: 429, 500, 502, 503, 504)

**Rate Limit Settings**:
- **respectRetryAfter**: Whether to honor the `retry-after` header from 429 responses (default: true)
- **maxRetryAfterMs**: Maximum allowed wait time from retry-after header (default: 120000ms = 2 minutes)
- **defaultBackoffMs**: Default backoff when retry-after header is missing (default: 5000ms)

### How Retry Works

1. **Initial Request**: Send request to primary model
2. **Error Detection**: Check if response status code is in `retryableStatusCodes`
3. **Delay Calculation**:
   - If status is 429 and `retry-after` header exists: use that value (capped at `maxRetryAfterMs`)
   - Otherwise: exponential backoff = `baseDelayMs * (backoffMultiplier ^ (attempt - 1))`, capped at `maxDelayMs`
4. **Retry**: Wait for calculated delay, then retry
5. **Fallback Trigger**: If all retries fail, trigger fallback mechanism

### Exponential Backoff Example

With `baseDelayMs: 1000`, `backoffMultiplier: 2`, `maxDelayMs: 30000`:

| Attempt | Delay |
|---------|-------|
| 1 (initial) | - |
| 2 (1st retry) | 1000ms (1s) |
| 3 (2nd retry) | 2000ms (2s) |
| 4 (3rd retry) | 4000ms (4s) |
| 5 (4th retry) | 8000ms (8s) |
| 6+ | 30000ms (capped at maxDelayMs) |

### Rate Limit Handling

When receiving a 429 (Too Many Requests) response:

1. Check for `retry-after` header
2. If present and `respectRetryAfter` is true:
   - Parse the value (seconds or HTTP date format)
   - Wait for specified time (up to `maxRetryAfterMs`)
3. If header is missing or parsing fails:
   - Use exponential backoff with `defaultBackoffMs`

### Use Cases

#### Scenario 1: Temporary API Glitch

```json
{
  "retry": { "maxRetries": 2, "baseDelayMs": 500 }
}
```

A 502 Bad Gateway error occurs due to temporary server maintenance. The system retries after 500ms, then 1000ms, and succeeds on the second retry.

#### Scenario 2: Rate Limit with Retry-After

```json
{
  "rateLimit": { "respectRetryAfter": true, "maxRetryAfterMs": 60000 }
}
```

API returns 429 with `retry-after: 30`. The system waits 30 seconds before retrying instead of immediately falling back.

### Log Output

```
[warn] [Retry] 429 error (attempt 1/3), retrying in 15000ms...
[warn] [Retry] 500 error (attempt 2/3), retrying in 2000ms...
[info] Request succeeded on retry 3
```

## Circuit Breaker

The circuit breaker pattern prevents repeated requests to a failing provider, reducing unnecessary API calls and improving response times.

### Configuration

```json
{
  "circuitBreaker": {
    "enabled": true,
    "failureThreshold": 3,
    "recoveryTimeoutMs": 60000,
    "halfOpenMaxRequests": 1
  }
}
```

### Circuit Breaker States

**CLOSED (Normal)**:
- Requests pass through normally
- Failure count is tracked
- Transitions to OPEN when consecutive failures reach `failureThreshold`

**OPEN (Blocked)**:
- Requests are immediately blocked
- No API calls are made
- After `recoveryTimeoutMs`, transitions to HALF_OPEN

**HALF_OPEN (Testing)**:
- Limited requests are allowed for testing
- If `halfOpenMaxRequests` succeed: transition to CLOSED (recovered)
- If any request fails: transition back to OPEN

### Configuration Details

- **enabled**: Enable/disable circuit breaker (default: true)
- **failureThreshold**: Number of consecutive failures before opening circuit (default: 3)
- **recoveryTimeoutMs**: Time in milliseconds before attempting recovery (default: 60000 = 1 minute)
- **halfOpenMaxRequests**: Number of successful requests needed to close circuit (default: 1)

### How It Works

```
Provider: deepseek,deepseek-chat

1. Request fails (500 error) -> failureCount = 1
2. Request fails (500 error) -> failureCount = 2
3. Request fails (500 error) -> failureCount = 3 -> OPEN circuit
4. New request arrives -> Circuit is OPEN -> Immediately trigger fallback
5. After 60 seconds -> HALF_OPEN (test request allowed)
6. Test request succeeds -> CLOSED (recovered)
```

### State Transitions

```
CLOSED ----(failures >= threshold)----> OPEN
  ^                                       |
  |                                       | (after recoveryTimeoutMs)
  |                                       v
  |                                  HALF_OPEN
  |                                       |
  +----(all test requests succeed)--------+
  |                                       |
  +----(any test request fails)---------->+
```

### Use Cases

#### Scenario 1: Provider Outage

```json
{
  "circuitBreaker": {
    "failureThreshold": 3,
    "recoveryTimeoutMs": 120000
  }
}
```

Provider experiences 3 consecutive 503 errors. Circuit opens, subsequent requests immediately trigger fallback without wasting time on API calls. After 2 minutes, one test request checks if service recovered.

#### Scenario 2: Intermittent Failures

Provider has occasional timeouts. Circuit breaker tracks failures per provider+model pair, so a failing model doesn't affect other models from the same provider.

### Log Output

```
[warn] [CircuitBreaker] deepseek,deepseek-chat: CLOSED -> OPEN (3 consecutive failures)
[warn] [Fallback] Triggered for default: Circuit breaker is OPEN for deepseek,deepseek-chat
[debug] [CircuitBreaker] deepseek,deepseek-chat: OPEN -> HALF_OPEN (recovery timeout elapsed)
[info] [CircuitBreaker] deepseek,deepseek-chat: HALF_OPEN -> CLOSED (recovered)
```

### Important Notes

1. **Per-provider tracking**: Circuit breaker state is tracked separately for each "provider,model" combination
2. **Fallback integration**: When circuit is OPEN, fallback is triggered immediately without API call
3. **Recovery automatic**: Circuit automatically transitions to HALF_OPEN after `recoveryTimeoutMs`
4. **State reset on success**: Any successful request resets the failure counter

## Project-Level Routing

Configure routing per project in `~/.claude/projects/<project-id>/claude-code-router.json`:

```json
{
  "Router": {
    "default": "groq,llama-3.3-70b-versatile"
  }
}
```

Project-level configuration takes precedence over global configuration.

## Custom Router

Create a custom JavaScript router function:

1. Create a router file (e.g., `custom-router.js`):

```javascript
module.exports = function(config, context) {
  // Analyze the request context
  const { scenario, projectId, tokenCount } = context;

  // Custom routing logic
  if (scenario === 'background') {
    return 'groq,llama-3.3-70b-versatile';
  }

  if (tokenCount > 100000) {
    return 'gemini,gemini-1.5-pro';
  }

  // Default
  return 'deepseek,deepseek-chat';
};
```

2. Set the `CUSTOM_ROUTER_PATH` environment variable:

```bash
export CUSTOM_ROUTER_PATH="/path/to/custom-router.js"
```

## Token Counting

The router uses `tiktoken` (cl100k_base) to estimate request token count. This is used for:

- Determining if a request exceeds `longContextThreshold`
- Custom routing logic based on token count

## Subagent Routing

Specify models for subagents using special tags:

```
<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>
Please help me analyze this code...
```

## Next Steps

- [Transformers](/docs/config/transformers) - Apply transformations to requests
- [Custom Router](/docs/advanced/custom-router) - Advanced custom routing

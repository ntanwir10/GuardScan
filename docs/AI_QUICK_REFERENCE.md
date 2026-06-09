# AI Quick Reference

## Essential Commands

### Setup

```bash
# View available models
guardscan models list

# Get model info
guardscan models info gpt-4o

# Set your model
guardscan config set model gpt-4o
```

### Model Routing

```bash
# List current routing
guardscan routing list

# Set task-specific model
guardscan routing set code-review --model gpt-4o
guardscan routing set chat --priority speed

# Test routing
guardscan routing test code-review
```

### Budget Management

```bash
# Check budget status
guardscan budget status

# Set budget limits
guardscan budget set --daily 10 --monthly 100

# View usage report
guardscan budget report --days 30
```

### Monitoring

```bash
# View metrics
guardscan metrics show --days 7

# Check cache performance
guardscan cache stats

# Export metrics
guardscan metrics export --output metrics.json
```

## Configuration Cheatsheet

### Enable All Features (Recommended)

```bash
guardscan config set retry.enabled true
guardscan config set cache.enabled true
guardscan config set circuitBreaker.enabled true
guardscan config set observability.enabled true
guardscan config set modelRouting.enabled true
guardscan budget set --daily 10 --monthly 100
```

### Cost-Optimized

```bash
guardscan config set cache.enabled true
guardscan config set cache.semanticThreshold 0.9
guardscan config set modelRouting.enabled true
guardscan config set modelRouting.strategy cost
guardscan routing set chat --model gpt-4.1-mini
```

### Quality-First

```bash
guardscan config set modelRouting.strategy quality
guardscan routing set code-review --model gpt-4o
guardscan routing set explanation --model claude-sonnet-4.5
```

### Development (Free)

```bash
guardscan config set provider ollama
guardscan config set model codellama
# All requests free, local, private
```

## Feature Quick Reference

| Feature         | Enable With                                        | Check With                |
| --------------- | -------------------------------------------------- | ------------------------- |
| Retry           | `guardscan config set retry.enabled true`          | `guardscan metrics show`  |
| Caching         | `guardscan config set cache.enabled true`          | `guardscan cache stats`   |
| Circuit Breaker | `guardscan config set circuitBreaker.enabled true` | `guardscan metrics show`  |
| Rate Limiting   | `guardscan config set rateLimit.enabled true`      | Check wait times          |
| Observability   | `guardscan config set observability.enabled true`  | `guardscan metrics show`  |
| Model Routing   | `guardscan config set modelRouting.enabled true`   | `guardscan routing list`  |
| Budgets         | `guardscan budget set --daily <amt>`               | `guardscan budget status` |

## Troubleshooting

| Problem              | Solution                                                            |
| -------------------- | ------------------------------------------------------------------- |
| Budget exceeded      | `guardscan budget set --daily <higher-amount>`                      |
| Circuit breaker open | Wait 60s or check provider status                                   |
| Low cache hit rate   | Lower threshold: `guardscan config set cache.semanticThreshold 0.9` |
| High costs           | Enable caching + routing with cost strategy                         |
| Slow performance     | Use faster models: `guardscan routing set chat --priority speed`    |
| Rate limit errors    | Enable rate limiting: `guardscan config set rateLimit.enabled true` |

## Cost Optimization Quick Wins

1. **Enable caching** (30-50% savings):
   ```bash
   guardscan config set cache.enabled true
   ```

2. **Use cheap models for simple tasks**:
   ```bash
   guardscan routing set chat --model gpt-4.1-mini
   ```

3. **Enable smart routing**:
   ```bash
   guardscan config set modelRouting.enabled true
   guardscan config set modelRouting.strategy cost
   ```

4. **Monitor and optimize**:
   ```bash
   guardscan budget report --days 7
   guardscan cache stats
   ```

## Model Comparison

### By Cost (Per 1M tokens)

| Model                 | Input  | Output  | Best For                   |
| --------------------- | ------ | ------- | -------------------------- |
| gpt-4.1-mini          | $0.15  | $0.60   | Chat, simple tasks         |
| gemini-2.5-flash-lite | $37.50 | $150    | Fast, balanced tasks       |
| gemini-2.5-flash      | $75    | $300    | Code generation            |
| gpt-4o                | $2,500 | $10,000 | Code review, quality tasks |
| claude-sonnet-4.5     | $3,000 | $15,000 | Reasoning, explanation     |

### By Context Window

| Model                | Context     | Best For           |
| -------------------- | ----------- | ------------------ |
| gemini-3-pro         | 2M tokens   | Large codebases    |
| gemini-2.5-pro/flash | 1M tokens   | Large files        |
| gpt-4o               | 128k tokens | Most use cases     |
| claude models        | 200k tokens | Long conversations |

## Default Routing

| Task            | Priority | Typical Selection               |
| --------------- | -------- | ------------------------------- |
| code-review     | quality  | gpt-4o, claude-sonnet-4.5       |
| code-generation | balanced | gemini-2.5-flash, gpt-4o        |
| chat            | speed    | gpt-4.1-mini, gemini-flash-lite |
| explanation     | quality  | claude models, gpt-4o           |
| refactoring     | balanced | gpt-4o, gemini-2.5-flash        |
| test-generation | balanced | gemini-2.5-flash, gpt-4o        |

## Performance Targets

| Metric         | Target        | Command                   |
| -------------- | ------------- | ------------------------- |
| Success Rate   | >99.5%        | `guardscan metrics show`  |
| Cache Hit Rate | >40%          | `guardscan cache stats`   |
| P95 Latency    | <2000ms       | `guardscan metrics show`  |
| Daily Budget   | Within limits | `guardscan budget status` |

## Support

- **Full Documentation**: See `docs/` folder
- **Architecture**: [AI_ARCHITECTURE.md](./AI_ARCHITECTURE.md)
- **Reliability**: [AI_RELIABILITY.md](./AI_RELIABILITY.md)
- **Cost**: [COST_OPTIMIZATION.md](./COST_OPTIMIZATION.md)
- **Models**: [MODEL_MANAGEMENT.md](./MODEL_MANAGEMENT.md)
- **Migration**: [MIGRATION_ENHANCED_AI.md](./MIGRATION_ENHANCED_AI.md)

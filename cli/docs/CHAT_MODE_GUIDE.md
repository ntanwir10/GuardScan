# GuardScan Chat Mode - Complete Guide

**Version:** 1.0.0
**Last Updated:** 2025-11-16
**Feature:** Phase 4 RAG & Chat System

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [How It Works](#how-it-works)
4. [Configuration](#configuration)
5. [Command Options](#command-options)
6. [Usage Examples](#usage-examples)
7. [Advanced Features](#advanced-features)
8. [Troubleshooting](#troubleshooting)
9. [Performance Tips](#performance-tips)
10. [Architecture](#architecture)

---

## Overview

**Chat Mode** enables you to have **interactive, context-aware conversations** about your codebase using AI. The system uses **Retrieval-Augmented Generation (RAG)** to provide accurate answers by:

- 🔍 **Searching your codebase** for relevant code snippets
- 🧠 **Understanding context** across files and functions
- 💬 **Answering questions** with specific code references
- 📊 **Maintaining conversation history** for follow-up questions

### Key Features

✅ **Privacy-First**: Never uploads source code (only vector embeddings)
✅ **Offline-Capable**: Works with local AI (Ollama)
✅ **Context-Aware**: Understands your entire codebase
✅ **Interactive**: Ask follow-up questions naturally
✅ **Accurate**: Cites specific files and line numbers

---

## Quick Start

### Prerequisites

1. **GuardScan installed**: `npm install -g guardscan`
2. **AI Provider configured**: Run `guardscan config` (required for chat)
3. **Repository initialized**: Run `guardscan init` (optional for telemetry)

### Your First Chat

```bash
# Start chat mode (uses Ollama for embeddings by default)
guardscan chat

# Or specify OpenAI for embeddings
guardscan chat --embedding-provider openai
```

The first time you run chat, the system will:
1. ✅ Analyze your codebase structure
2. ✅ Chunk code into semantic units (functions, classes, files)
3. ✅ Generate embeddings (takes a few minutes for large codebases)
4. ✅ Save embeddings to disk for future use

After indexing, you'll see the chat prompt:

```
💬 You:
```

Try asking:
- "How does authentication work in this project?"
- "Where is the database connection configured?"
- "Explain the UserService class"

---

## How It Works

### RAG Pipeline Overview

```
1. User Query
   ↓
2. Query Embedding Generation
   ↓
3. Semantic Search (cosine similarity)
   ↓
4. Context Assembly (relevant code + docs + history)
   ↓
5. AI Prompt Construction
   ↓
6. AI Response Generation
   ↓
7. Display Answer with References
```

### Embedding Generation

**What are embeddings?**
Embeddings are mathematical representations (vectors) of code that capture semantic meaning. Similar code has similar embeddings, enabling semantic search.

**Models Supported:**
- **Ollama** (default): `nomic-embed-text` - 768 dimensions, free, local
- **OpenAI**: `text-embedding-3-small` - 1536 dimensions, paid, cloud

**What gets embedded:**
- ✅ Functions and methods
- ✅ Classes and interfaces
- ✅ File-level context
- ✅ Documentation (README, comments)

**What's NOT sent to embedding providers:**
- ❌ Your entire source code files
- ❌ Sensitive data or secrets
- ❌ File paths with sensitive information

Only small code chunks (< 2000 characters) are sent to generate embeddings.

### Search & Ranking

The system uses **multi-factor ranking** to find the most relevant code:

1. **Similarity Score** (60%): How semantically similar is the code to your query?
2. **Recency Score** (20%): How recently was the code modified?
3. **Importance Score** (20%): Is the code exported, complex, or well-connected?

### Context Assembly

The RAG system assembles context with a **token budget**:

- **60%**: Relevant code snippets
- **20%**: Documentation
- **20%**: Conversation history

This ensures the AI gets the most relevant information without exceeding token limits.

---

## Configuration

### Setting Up AI Provider

Chat mode requires an AI provider for conversation (not just embeddings):

```bash
# Option 1: OpenAI (recommended for best quality)
guardscan config -p openai -k YOUR_API_KEY

# Option 2: Anthropic Claude
guardscan config -p anthropic -k YOUR_API_KEY

# Option 3: Google Gemini
guardscan config -p google -k YOUR_API_KEY

# Option 4: Ollama (local, free)
guardscan config -p ollama
# No API key needed, but you must have Ollama running locally
```

### Embedding Provider

Choose between cloud and local embeddings:

```bash
# Local embeddings (default, free, private)
guardscan chat --embedding-provider ollama

# Cloud embeddings (faster, more accurate)
guardscan chat --embedding-provider openai
```

**Recommendation:**
- **Development**: Use Ollama (free, private)
- **Production/Teams**: Use OpenAI (better quality)

---

## Command Options

```bash
guardscan chat [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-m, --model <model>` | Override AI model | Provider default |
| `-t, --temperature <temp>` | Response randomness (0-1) | `0.7` |
| `--rebuild` | Force rebuild embeddings index | `false` |
| `--embedding-provider <provider>` | `openai` or `ollama` | `ollama` |
| `--session <path>` | Load existing session from file | - |
| `--export <path>` | Export conversation to file | - |

### Examples

```bash
# Basic chat
guardscan chat

# Use specific model
guardscan chat --model gpt-4

# More creative responses
guardscan chat --temperature 0.9

# Rebuild index after code changes
guardscan chat --rebuild

# Use OpenAI embeddings
guardscan chat --embedding-provider openai

# Load previous session
guardscan chat --session ./my-chat.json

# Export chat when done
guardscan chat --export ./chat-export.json
```

---

## Usage Examples

### Example 1: Understanding Authentication

```
💬 You: How does user authentication work in this project?

🤖 Assistant:
Based on the codebase, authentication is handled by the AuthService class in
`src/services/auth.ts`. Here's how it works:

1. **Login Flow** (`auth.ts:45-67`):
   - User submits credentials
   - Password is hashed using bcrypt
   - JWT token is generated on success

2. **Token Verification** (`auth.ts:89-102`):
   - Middleware validates JWT tokens
   - User object is attached to request

Relevant files:
- src/services/auth.ts (92% relevant)
- src/middleware/authenticate.ts (85% relevant)

💬 You: How is the JWT secret configured?

🤖 Assistant:
The JWT secret is configured in `src/config/env.ts:23`:

```typescript
export const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
```

⚠️ Important: In production, ensure JWT_SECRET is set via environment variables,
not the default value shown in `env.ts`.

Referenced in:
- src/config/env.ts:23
- src/services/auth.ts:52 (usage)
```

### Example 2: Finding Database Queries

```
💬 You: Show me all database queries related to users

🤖 Assistant:
I found 5 database queries related to users:

1. **User Creation** (`repositories/user.ts:34-42`):
   ```typescript
   async create(userData: CreateUserDTO): Promise<User> {
     return await db.users.insert(userData);
   }
   ```

2. **Find by Email** (`repositories/user.ts:56-60`):
   ```typescript
   async findByEmail(email: string): Promise<User | null> {
     return await db.users.findOne({ email });
   }
   ```

[... 3 more examples ...]

All queries use the `db.users` collection defined in `src/db/schema.ts:12`.
```

### Example 3: Code Explanation

```
💬 You: Explain the ProductService class in detail

🤖 Assistant:
The **ProductService** class (`src/services/product.ts:15-120`) manages product
operations with the following responsibilities:

**Core Methods:**

1. `createProduct(data)` - Lines 28-45
   - Validates product data
   - Generates SKU automatically
   - Saves to database
   - Emits 'product:created' event

2. `updateStock(productId, quantity)` - Lines 67-82
   - Updates inventory levels
   - Handles concurrent updates with locks
   - Notifies warehouse system

3. `getPricing(productId)` - Lines 95-108
   - Applies tiered pricing rules
   - Calculates discounts
   - Returns final price

**Dependencies:**
- ProductRepository (data access)
- EventEmitter (notifications)
- PricingEngine (price calculations)

**Complexity**: 8/20 (moderate)
**Exports**: createProduct, updateStock, getPricing
```

---

## Advanced Features

### Session Management

Save and load chat sessions for later:

```bash
# During chat, use commands:
/export my-session.json    # Save current session
/stats                     # View session statistics

# Later, reload the session:
guardscan chat --session my-session.json
```

Session files contain:
- Full conversation history
- Timestamps
- Token usage statistics
- Metadata (repo ID, model used)

### In-Chat Commands

While chatting, use these commands:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/clear` | Clear conversation history |
| `/stats` | Show session statistics |
| `/export <path>` | Export session to file |
| `/exit` | Exit chat mode |

### Incremental Index Updates

When your code changes, you don't need to rebuild the entire index:

```bash
# The system automatically detects changed files
# and only re-indexes those files

# Force full rebuild if needed:
guardscan chat --rebuild
```

### Conversation Summarization

For long conversations, the system automatically summarizes older messages to save tokens while maintaining context.

---

## Troubleshooting

### "Ollama is not running"

**Problem:** Chat command exits with "Ollama is not running"

**Solution:**
```bash
# Install Ollama: https://ollama.ai
curl https://ollama.ai/install.sh | sh

# Start Ollama
ollama serve

# Pull the embedding model
ollama pull nomic-embed-text

# Try again
guardscan chat
```

### "No embeddings found - building index"

**Problem:** First-time index build takes a long time

**Solution:** This is normal for the first run. The system is:
1. Analyzing your codebase
2. Chunking code into semantic units
3. Generating embeddings for each chunk

**Progress indicators:**
- File count
- Chunk count
- Progress bar with ETA

**Time estimates:**
- Small project (< 10K LOC): 30-60 seconds
- Medium project (10K-50K LOC): 2-5 minutes
- Large project (50K-100K LOC): 5-15 minutes

Subsequent runs use the cached index and are instant.

### "Low relevance scores - results may be inaccurate"

**Problem:** AI is answering with low-confidence code references

**Causes:**
1. Query is too vague or general
2. Relevant code doesn't exist in the codebase
3. Embeddings need rebuilding after major refactor

**Solutions:**
- Be more specific in your questions
- Include file names or function names if you know them
- Rebuild index: `guardscan chat --rebuild`

### "Token limit exceeded"

**Problem:** Chat exits with token limit error

**Cause:** Conversation history + context exceeds model's max tokens

**Solution:**
- Use `/clear` to reset conversation
- Ask shorter, more focused questions
- Use a model with higher token limits (e.g., GPT-4 with 32K tokens)

---

## Performance Tips

### 1. Choose the Right Embedding Provider

**Ollama (Local)**
- ✅ Free
- ✅ Private
- ✅ No API costs
- ❌ Slower
- ❌ Less accurate

**OpenAI (Cloud)**
- ✅ Faster
- ✅ More accurate
- ✅ Better semantic understanding
- ❌ Costs ~$0.01 per 1M tokens
- ❌ Requires API key

**Recommendation**: Start with Ollama, switch to OpenAI if accuracy is critical.

### 2. Incremental Indexing

Don't rebuild the index unnecessarily:

```bash
# Good: Let the system auto-detect changes
guardscan chat

# Bad: Rebuilding every time
guardscan chat --rebuild
```

### 3. Use Specific Queries

**Bad** (vague):
- "Tell me about the code"
- "How does this work?"

**Good** (specific):
- "How does UserService.createUser() handle validation?"
- "Where is the database connection pooling configured?"
- "Explain the authentication flow in src/auth/"

### 4. Manage Conversation Length

Long conversations consume more tokens:

- Use `/clear` to reset after changing topics
- Export and reload sessions instead of keeping them running
- Ask focused questions rather than exploratory ones

### 5. Cache Location

Embeddings are cached in `~/.guardscan/cache/<repo-id>/embeddings/`

**Disk space:**
- ~1MB per 10K LOC (approximate)
- ~10MB for a 100K LOC project

To clear cache:
```bash
guardscan reset --all
```

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Chat Command                          │
│                    (commands/chat.ts)                        │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
    ┌────▼─────┐          ┌─────▼──────┐
    │ Chatbot  │          │ Embedding  │
    │  Engine  │          │  Indexer   │
    └────┬─────┘          └─────┬──────┘
         │                      │
    ┌────▼─────────┐      ┌────▼────────┐
    │ RAG Context  │      │   Chunker   │
    │   Builder    │      │             │
    └────┬─────────┘      └─────┬───────┘
         │                      │
    ┌────▼──────────┐     ┌─────▼────────┐
    │    Search     │     │  Embedding   │
    │    Engine     │     │   Provider   │
    └────┬──────────┘     └─────┬────────┘
         │                      │
    ┌────▼──────────┐     ┌─────▼────────┐
    │  Embedding    │◄────┤  Embedding   │
    │    Store      │     │    Store     │
    └───────────────┘     └──────────────┘
```

### Data Flow

1. **User asks a question** → Chat Command
2. **Query is converted to embedding** → Embedding Provider
3. **Search finds relevant code** → Search Engine (cosine similarity)
4. **Context is assembled** → RAG Context Builder (token budgeting)
5. **AI generates response** → AI Provider (OpenAI/Claude/etc.)
6. **Answer is displayed** → Chat Command (with file references)

### Storage

**Embeddings**: `~/.guardscan/cache/<repo-id>/embeddings/index.json`

Format:
```json
{
  "version": "1.0.0",
  "repoId": "hash-of-repo",
  "generatedAt": "2025-11-16T...",
  "totalEmbeddings": 1523,
  "embeddings": [
    {
      "id": "function-abc123",
      "type": "function",
      "source": "src/auth.ts",
      "startLine": 45,
      "endLine": 67,
      "content": "function authenticate() { ... }",
      "contentSummary": "function authenticate()",
      "embedding": [0.123, -0.456, ...],  // 768 or 1536 dimensions
      "metadata": {
        "language": "typescript",
        "symbolName": "authenticate",
        "complexity": 5,
        "dependencies": ["bcrypt", "jwt"],
        "exports": ["authenticate"],
        "tags": ["authentication", "security"],
        "lastModified": "2025-11-15T..."
      },
      "hash": "abc123def456"
    }
  ]
}
```

**Sessions**: Custom location (specified by user)

---

## FAQ

### Q: Is my source code sent to AI providers?

**A:**
- **Embeddings**: Only small code chunks (< 2000 chars) are sent to generate embeddings
- **Chat**: Only the relevant code snippets found by search are sent as context
- **Your entire codebase is NEVER uploaded**

### Q: Can I use chat mode offline?

**A:** Yes, if you:
1. Use Ollama for embeddings (local)
2. Use Ollama for chat AI (local)
3. Have already built the index

```bash
guardscan config -p ollama
guardscan chat --embedding-provider ollama
```

### Q: How much does it cost?

**A:** Depends on your configuration:

| Component | Ollama | OpenAI |
|-----------|--------|--------|
| Embeddings | Free | ~$0.01/1M tokens |
| Chat | Free | ~$0.50/1M tokens (GPT-3.5) |
| Storage | Free (local disk) | Free (local disk) |

**Example costs (OpenAI):**
- Indexing 50K LOC: ~$0.05-$0.10 (one-time)
- 100 chat questions: ~$0.10-$0.50 (ongoing)

### Q: How accurate is the system?

**A:** Accuracy depends on:
- **Embedding quality**: OpenAI > Ollama
- **Code organization**: Well-documented code → better results
- **Query specificity**: Specific questions → better answers

**Typical relevance scores:**
- 90-100%: Exact match found
- 75-90%: Highly relevant
- 50-75%: Somewhat relevant
- < 50%: May not be accurate

### Q: Can I customize the system prompts?

**A:** Currently, prompts are optimized internally. Custom prompts will be supported in a future release.

### Q: How do I delete my embeddings?

**A:**
```bash
guardscan reset --all
# This deletes: embeddings, cache, and configuration
```

---

## Support

For issues, questions, or feature requests:

- **GitHub Issues**: https://github.com/ntanwir10/GuardScan/issues
- **Documentation**: https://github.com/ntanwir10/GuardScan/tree/main/docs
- **Examples**: See `examples/` directory in the repository

---

**Happy Chatting!** 🚀

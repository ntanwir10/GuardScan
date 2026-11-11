# GuardScan Chat Guide

## Overview

GuardScan Chat is an interactive AI-powered feature that uses RAG (Retrieval-Augmented Generation) to answer questions about your codebase. It provides context-aware responses by retrieving relevant code snippets and documentation from your project.

### What is RAG?

RAG (Retrieval-Augmented Generation) is a technique that:

1. **Retrieves** relevant code and documentation from your codebase based on your question
2. **Augments** your question with this context
3. **Generates** accurate, codebase-specific responses

This approach ensures the AI has access to your actual code, making responses more accurate and relevant than generic AI responses.

## Getting Started

### Prerequisites

- GuardScan initialized (`guardscan init`)
- AI provider configured (`guardscan config`)
- Codebase with at least some code files

### Starting Your First Chat

```bash
guardscan chat
```

The first time you run chat, GuardScan will:

1. Index your codebase (creates embeddings for code search)
2. Create a new chat session
3. Display the welcome message with available commands
4. Wait for your first question

Subsequent runs will use the existing index (unless you use `--rebuild`).

## Interactive Commands

While in the chat interface, you can use these commands:

### `/help`

Displays a help message with:

- Available commands
- Example questions you can ask
- Usage tips

**Usage:**

```
💬 You: /help
```

### `/clear`

Clears the conversation history while keeping the session active. Useful when you want to start fresh without losing the session context.

**Usage:**

```
💬 You: /clear
✓ Conversation history cleared
```

**Note:** This only clears messages, not the session itself. The session ID and metadata remain.

### `/stats`

Shows detailed statistics about the current chat session:

- **Message count** - Total messages in the conversation
- **Total tokens** - Cumulative tokens used across all messages
- **Average tokens per message** - Average token usage
- **Duration** - How long the session has been active
- **Questions asked** - Number of user questions

**Usage:**

```
💬 You: /stats

📊 Chat Statistics:
  Messages: 5
  Total Tokens: 2,450
  Avg Tokens/Message: 490
  Duration: 12m 34s
  Questions Asked: 3
```

### `/export`

Exports the entire conversation to a markdown file. This command:

1. Displays the conversation in markdown format in the terminal
2. Automatically saves to a file in the **parent directory** of your project
3. Uses a descriptive filename with session ID and date

**Usage:**

```
💬 You: /export

[Markdown output displayed in terminal]

✓ Conversation exported to: /path/to/parent/directory/guardscan-chat-chat-abc123-2025-12-06.md
```

**File Location:**

- Saved to the **parent directory** (one level up from your project root)
- Filename format: `guardscan-chat-{sessionId}-{timestamp}.md`
- Example: `guardscan-chat-miuk2rhd-leflihb-2025-12-06.md`

**Export Format:**
The exported markdown includes:

- Session metadata (repository name, creation date, total tokens)
- All messages with timestamps
- Relevant files referenced in each response
- Conversation structure with clear separators

### `/exit` or `/quit`

Exits the chat session and returns to the command line.

**Usage:**

```
💬 You: /exit
```

## CLI Options

You can customize the chat experience using command-line options:

### `--model <model>`

Override the AI model for this chat session.

```bash
guardscan chat --model <model-id>   # a model for your configured provider, from `guardscan models list`
```

**Available models** depend on your configured AI provider. `guardscan models list` prints GuardScan's built-in static catalog, not a live availability list, and the override is passed to the provider unchanged, so confirm the exact model ID in your provider's documentation. Print the catalog with:

```bash
guardscan models list
```

Run `guardscan models list` to see the models this version knows about. The registry is defined in [`cli/src/providers/model-registry.ts`](https://github.com/ntanwir10/GuardScan/blob/main/cli/src/providers/model-registry.ts).

### `--temperature <value>`

Control the creativity/randomness of responses (0.0 to 1.0).

- **Lower values (0.0-0.3)**: More focused, deterministic responses
- **Medium values (0.4-0.7)**: Balanced (default: 0.7)
- **Higher values (0.8-1.0)**: More creative, varied responses

```bash
guardscan chat --temperature 0.5  # More focused
guardscan chat --temperature 0.9  # More creative
```

### `--rebuild`

Rebuild the embeddings index from scratch. Useful when:

- You've made significant code changes
- You want to ensure the index is up-to-date
- You're experiencing search quality issues

```bash
guardscan chat --rebuild
```

**Note:** Rebuilding can take time depending on your codebase size.

### `--embedding-provider <provider>`

Override the embedding provider for this session. Options:

- `openai` - OpenAI embeddings (1536 dimensions)
- `gemini` - Google Gemini embeddings (768 dimensions)
- `ollama` - Local Ollama embeddings (768 dimensions)
- `claude` - Claude with Ollama/LM Studio fallback (768 dimensions)
- `lmstudio` - LM Studio embeddings (768 dimensions)

```bash
guardscan chat --embedding-provider openai
```

**Note:** The embedding provider should match your AI provider's capabilities or use a compatible fallback.

### `--session <path>`

Load an existing chat session from a file.

```bash
guardscan chat --session /path/to/session.json
```

### `--export <path>`

Export the conversation to a specific file path (alternative to using `/export` command).

```bash
guardscan chat --export /path/to/my-conversation.md
```

## Example Use Cases

### Understanding Code Architecture

```
💬 You: How is authentication implemented in this project?

🤖 Assistant: [Provides detailed explanation with relevant code snippets]
```

### Finding Security Issues

```
💬 You: Are there any security vulnerabilities in the authentication code?

🤖 Assistant: [Analyzes code and identifies potential issues]
```

### Explaining Complex Functions

```
💬 You: Explain the UserService.createUser function

🤖 Assistant: [Breaks down the function with context from related files]
```

### Code Navigation

```
💬 You: Show me all functions that handle database queries

🤖 Assistant: [Lists relevant functions with file locations]
```

### Architecture Questions

```
💬 You: What are the main components of this application?

🤖 Assistant: [Provides architectural overview with component relationships]
```

## Understanding Chat Output

The chat interface provides rich, formatted output:

### Colored Text

- **File paths** - Displayed in cyan (e.g., `src/utils/auth.ts`)
- **Code snippets** - Displayed in yellow (e.g., `function authenticate()`)
- **Bold text** - Displayed in cyan for emphasis
- **Headings** - Formatted with appropriate colors and styling

### Formatted Responses

- **Code blocks** - Displayed in bordered boxes with language labels
- **Lists** - Properly formatted with bullets and numbering
- **Quotes** - Styled with visual indicators

### Response Metadata

Each response includes:

- **Relevant files** - Files referenced in the response
- **Token usage** - Tokens used for the response
- **Response time** - How long the AI took to respond
- **Model used** - Which AI model generated the response

### Thinking Indicator

When processing your question, you'll see:

```
🤔 Thinking...
```

This indicates the AI is:

1. Searching your codebase for relevant context
2. Building the RAG context
3. Generating the response

## Best Practices

### Ask Specific Questions

**Good:**

- "How does the authentication middleware validate JWT tokens?"
- "What security measures are in place for user passwords?"

**Less effective:**

- "Tell me about the code"
- "What does this do?"

### Use Follow-up Questions

Build on previous responses:

```
💬 You: How does authentication work?
🤖 Assistant: [Explains authentication]

💬 You: What about password hashing?
🤖 Assistant: [Explains password hashing in context]
```

### Export Important Conversations

Use `/export` to save valuable conversations for:

- Documentation
- Team sharing
- Future reference
- Learning notes

### Rebuild Index When Needed

If you've made significant changes:

```bash
guardscan chat --rebuild
```

This ensures the AI has access to your latest code.

### Use Appropriate Temperature

- **Code explanations**: Lower temperature (0.3-0.5) for accuracy
- **Creative suggestions**: Higher temperature (0.7-0.9) for variety
- **Security analysis**: Lower temperature (0.2-0.4) for precision

## Troubleshooting

### Chat Not Responding

**Issue:** Chat hangs or doesn't respond

**Solutions:**

1. Check your AI provider connection: `guardscan status`
2. Verify API key is valid: `guardscan config`
3. Check internet connection (if using cloud AI)
4. Try restarting the chat session

### Poor Quality Responses

**Issue:** Responses are generic or not codebase-specific

**Solutions:**

1. Rebuild the index: `guardscan chat --rebuild`
2. Ask more specific questions
3. Check that your codebase is properly indexed
4. Verify embedding provider is working

### Export Not Working

**Issue:** `/export` command fails or file not created

**Solutions:**

1. Check write permissions in parent directory
2. Verify session exists: `/stats` should show session info
3. Try using `--export` flag instead
4. Check disk space

### Slow Performance

**Issue:** Chat is slow to respond

**Solutions:**

1. Use a faster AI model (a smaller one for your configured provider, from `guardscan models list`)
2. Reduce codebase size (exclude large files in config)
3. Use local AI (Ollama) for faster responses
4. Rebuild index to optimize search

### Embedding Provider Errors

**Issue:** Errors related to embedding provider

**Solutions:**

1. Check embedding provider is running (for Ollama/LM Studio)
2. Verify API key for cloud providers
3. Try a different embedding provider: `--embedding-provider`
4. Rebuild embeddings: `--rebuild`

## Advanced Usage

### Combining Options

You can combine multiple options:

```bash
guardscan chat --model gpt-4o --temperature 0.5 --rebuild
```

### Session Management

Sessions are automatically managed, but you can:

- Use `/stats` to monitor session health
- Use `/clear` to reset conversation without losing session
- Export sessions for backup

### Integration with Other Commands

Chat works alongside other GuardScan features:

- Use `guardscan explain` for quick explanations
- Use `guardscan chat` for interactive exploration
- Export chat conversations to document findings

## Privacy and Security

### What Chat Accesses

- **Your codebase** - Indexed locally for search
- **Conversation history** - Stored locally in session
- **AI provider** - Sends context and questions (using your API key)

### What Chat Doesn't Access

- **Your API keys** - Never sent to GuardScan servers
- **Source code** - Never uploaded to GuardScan (only to your AI provider)
- **Personal data** - Only code-related context is used

### Export Files

Exported conversations contain:

- Your questions
- AI responses
- Relevant file paths
- Session metadata

**Note:** Review exported files before sharing, as they may contain code snippets.

## Next Steps

- Read the [Getting Started Guide](GETTING_STARTED.md) for basic usage
- See the [Command reference](COMMANDS.md) for every command and flag
- Run offline or in CI: [Offline mode and CI](OFFLINE_AND_CI.md)
- Review [Dependency Vulnerability Scanning](VULNERABILITY_SCANNING.md)

## Getting Help

- **Documentation**: See other guides in `docs/`
- **Issues**: [GitHub Issues](https://github.com/ntanwir10/GuardScan/issues)
- **Discussions**: [GitHub Discussions](https://github.com/ntanwir10/GuardScan/discussions)

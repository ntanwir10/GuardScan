/**
 * chat.ts - Interactive AI Chat CLI Command
 *
 * Purpose: Interactive codebase Q&A using RAG and AI.
 * Features: REPL-style chat, context-aware responses, conversation history
 */

import chalk from "chalk";
import * as readline from "readline";
import * as fs from "fs/promises";
import * as path from "path";
import { AIProvider as AIProviderType, configManager } from "../core/config";
import { repositoryManager } from "../core/repository";
import { ProviderFactory } from "../providers/factory";
import { createDebugLogger } from "../utils/debug-logger";
import { createPerformanceTracker } from "../utils/performance-tracker";
import { handleCommandError } from "../utils/error-handler";

const logger = createDebugLogger("chat");
const perfTracker = createPerformanceTracker("guardscan chat");
import { CodebaseIndexer } from "../core/codebase-indexer";
import { EmbeddingChunker } from "../core/embedding-chunker";
import { FileBasedEmbeddingStore } from "../core/embedding-store";
import { EmbeddingSearchEngine } from "../core/embedding-search";
import { RAGContextBuilder } from "../core/rag-context";
import { ChatbotEngine } from "../core/chatbot-engine";
import { EmbeddingIndexer } from "../core/embedding-indexer";
import { EmbeddingProviderFactory } from "../providers/embedding-factory";
import { OllamaEmbeddingProvider } from "../providers/embedding-ollama";
import { LMStudioEmbeddingProvider } from "../providers/embedding-lmstudio";
import { ClaudeEmbeddingProvider } from "../providers/embedding-claude";

interface ChatCommandOptions {
  model?: string; // Override AI model
  temperature?: number; // Temperature 0-1
  rebuild?: boolean; // Rebuild embeddings index
  embeddingProvider?: string; // 'openai', 'gemini', 'ollama', 'claude', or 'lmstudio'
  session?: string; // Load existing session
  export?: string; // Export conversation path
}

export async function chatCommand(options: ChatCommandOptions): Promise<void> {
  logger.debug("Chat command started", { options });
  perfTracker.start("chat-total");

  try {
    // Load config
    perfTracker.start("load-config");
    const config = configManager.loadOrInit();
    perfTracker.end("load-config");
    logger.debug("Config loaded", { provider: config.provider });

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    const repoRoot = repoInfo.path;
    const repoId = repoInfo.repoId;

    console.log(
      chalk.blue("\n💬 GuardScan AI Chat - Interactive Codebase Assistant\n")
    );

    // Check if AI provider is configured
    if (!ProviderFactory.isConfigured(config)) {
      handleCommandError(
        new Error(
          "AI provider not configured. Run `guardscan config` to set up your AI provider."
        ),
        "Chat"
      );
    }

    // Initialize components
    console.log(chalk.gray("Initializing AI chat system..."));

    // Use model from options if provided, otherwise use config.model
    const modelToUse = options.model || config.model;

    const aiProvider = ProviderFactory.createForCli(config, {
      task: 'chat',
      model: modelToUse,
    });

    // Initialize embedding provider
    const requestedEmbeddingProvider = options.embeddingProvider?.toLowerCase();
    const supportedEmbeddingProviders: Array<Exclude<AIProviderType, "none">> = [
      "openai",
      "gemini",
      "ollama",
      "lmstudio",
      "claude",
      "openrouter",
    ];
    if (
      requestedEmbeddingProvider &&
      !supportedEmbeddingProviders.includes(
        requestedEmbeddingProvider as Exclude<AIProviderType, "none">
      )
    ) {
      handleCommandError(
        new Error(
          `Unknown embedding provider: ${requestedEmbeddingProvider}. Use: ${supportedEmbeddingProviders.join(", ")}`
        ),
        "Chat"
      );
    }

    let embeddingResult;
    try {
      embeddingResult = EmbeddingProviderFactory.createForCli(config, {
        provider: requestedEmbeddingProvider as Exclude<AIProviderType, "none"> | undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      handleCommandError(
        new Error(`Failed to create embedding provider: ${message}`),
        "Chat"
      );
    }
    const embeddingProvider = embeddingResult.provider;

    // Show which provider is being used
    if (embeddingResult.isFallback && embeddingResult.fallbackReason) {
      console.log(chalk.yellow(`\nℹ️  ${embeddingResult.fallbackReason}`));
    } else {
      console.log(
        chalk.gray(
          `\nUsing embedding provider: ${embeddingProvider.getName()} (${
            embeddingResult.dimensions
          } dimensions)`
        )
      );
    }

    // Check if fallback provider is running (for Ollama/LM Studio)
    if (embeddingProvider instanceof OllamaEmbeddingProvider) {
      const isRunning = await embeddingProvider.checkOllamaRunning();
      if (!isRunning) {
        console.log(chalk.red("\n✗ Ollama is not running"));
        console.log(chalk.gray("Please start Ollama: ollama serve"));
        const instructions = embeddingProvider.getInstallationInstructions();
        console.log(chalk.gray(`Install: ${instructions.installOllama}`));
        console.log(chalk.gray(`Pull model: ${instructions.pullModel}\n`));
        process.exit(1);
      }

      const hasModel = await embeddingProvider.checkModelAvailable();
      if (!hasModel) {
        handleCommandError(
          new Error(
            `Embedding model not found. Run: ollama pull ${embeddingProvider.getModel()}`
          ),
          "Chat"
        );
      }
    } else if (embeddingProvider instanceof LMStudioEmbeddingProvider) {
      const isRunning = await embeddingProvider.checkLMStudioRunning();
      if (!isRunning) {
        console.log(chalk.red("\n✗ LM Studio is not running"));
        console.log(
          chalk.gray("Please start LM Studio and ensure the server is running")
        );
        const instructions = embeddingProvider.getInstallationInstructions();
        console.log(chalk.gray(`Install: ${instructions.installLMStudio}`));
        console.log(chalk.gray(`Load model: ${instructions.loadModel}\n`));
        process.exit(1);
      }

      const hasModel = await embeddingProvider.checkModelAvailable();
      if (!hasModel) {
        handleCommandError(
          new Error(
            `Embedding model not found in LM Studio. Load '${embeddingProvider.getModel()}' in LM Studio.`
          ),
          "Chat"
        );
      }
    } else if (embeddingProvider instanceof ClaudeEmbeddingProvider) {
      const isRunning = await embeddingProvider.checkFallbackRunning();
      if (!isRunning) {
        console.log(chalk.red("\n✗ Fallback provider is not running"));
        console.log(
          chalk.gray(embeddingProvider.getInstallationInstructions())
        );
        process.exit(1);
      }

      const hasModel = await embeddingProvider.checkModelAvailable();
      if (!hasModel) {
        handleCommandError(
          new Error(
            `Embedding model not found. ${embeddingProvider.getInstallationInstructions()}`
          ),
          "Chat"
        );
      }
    }

    // Initialize core components
    const indexer = new CodebaseIndexer(repoRoot, repoId);
    const chunker = new EmbeddingChunker(indexer, repoRoot);
    const store = new FileBasedEmbeddingStore(repoId);
    const searchEngine = new EmbeddingSearchEngine(embeddingProvider, store);
    const ragBuilder = new RAGContextBuilder(searchEngine);

    // Initialize indexing system
    const embeddingIndexer = new EmbeddingIndexer(
      indexer,
      chunker,
      embeddingProvider,
      store,
      repoRoot
    );

    // Check if embeddings exist and compatibility
    const indexStats = await embeddingIndexer.getIndexStats();

    // Check compatibility before indexing
    if (indexStats.indexed && !options.rebuild) {
      const existingIndex = await store.loadIndex();
      if (existingIndex) {
        const compatibility = store.checkCompatibility(
          embeddingProvider,
          existingIndex
        );
        if (!compatibility.compatible && compatibility.requiresRebuild) {
          console.log(chalk.red(`\n✗ Embedding compatibility error:`));
          console.log(chalk.yellow(compatibility.reason));
          console.log(
            chalk.gray(
              `\nExisting: ${compatibility.existingProvider || "unknown"} (${
                compatibility.existingDimensions
              } dims)`
            )
          );
          console.log(
            chalk.gray(
              `Current: ${embeddingProvider.getName()} (${embeddingProvider.getDimensions()} dims)`
            )
          );
          console.log(
            chalk.cyan(
              `\nUse --rebuild to regenerate embeddings with the current provider.`
            )
          );
          process.exit(1);
        } else if (!compatibility.compatible) {
          // Provider mismatch with same dimensions - warn but continue
          console.log(chalk.yellow(`\n⚠️  ${compatibility.reason}`));
          console.log(chalk.gray(`Consider using --rebuild for best results.`));
        }
      }
    }

    if (!indexStats.indexed || options.rebuild) {
      console.log(
        chalk.blue("\n🔍 Building embedding index for your codebase...")
      );
      console.log(
        chalk.gray("This is a one-time process (unless code changes)\n")
      );

      const result = await embeddingIndexer.indexCodebase({
        incremental: !options.rebuild,
        batchSize: 50,
        showProgress: true,
      });

      if (!result.success) {
        console.log(chalk.red("\n✗ Failed to build embedding index"));
        result.errors.forEach((err) => {
          console.log(chalk.red(`  - ${err.message}`));
        });
        handleCommandError(
          new Error("Failed to initialize chat system"),
          "Chat"
        );
      }
    } else {
      console.log(chalk.green("✓ Using existing embedding index"));

      // Format date/time to match screenshot: "12/4/2025, 10:00:15 PM"
      let formattedDate = "Unknown";
      if (indexStats.lastIndexed) {
        const date = indexStats.lastIndexed;
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const year = date.getFullYear();
        const hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, "0");
        const seconds = date.getSeconds().toString().padStart(2, "0");
        const ampm = hours >= 12 ? "PM" : "AM";
        const displayHours = hours % 12 || 12;

        formattedDate = `${month}/${day}/${year}, ${displayHours}:${minutes}:${seconds} ${ampm}`;
      }

      console.log(
        chalk.gray(
          `  ${indexStats.totalEmbeddings} embeddings | Last indexed: ${formattedDate}\n`
        )
      );
    }

    // Initialize chatbot engine
    const chatbot = new ChatbotEngine(
      aiProvider,
      ragBuilder,
      searchEngine,
      indexer,
      repoId,
      repoRoot
    );

    // Create or load session
    let session;
    if (options.session) {
      console.log(chalk.blue(`Loading session: ${options.session}`));
      session = await chatbot.loadSession(options.session);
    } else {
      session = await chatbot.createSession({
        projectName: repoInfo.path.split("/").pop(),
      });
    }

    // Show welcome message
    console.log(
      chalk.white.bold(
        "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      )
    );
    console.log(chalk.cyan("  Welcome to GuardScan AI Chat!"));
    console.log(
      chalk.white.bold(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
      )
    );
    console.log(
      chalk.gray("Ask me anything about your codebase. I can help you:")
    );
    console.log(chalk.gray("  • Understand how features work"));
    console.log(chalk.gray("  • Find bugs and security issues"));
    console.log(chalk.gray("  • Explain code architecture"));
    console.log(chalk.gray("  • Suggest improvements\n"));
    console.log(chalk.gray("Commands:"));
    console.log(chalk.gray("  /help    - Show this help message"));
    console.log(chalk.gray("  /clear   - Clear conversation history"));
    console.log(chalk.gray("  /stats   - Show chat statistics"));
    console.log(chalk.gray("  /export  - Export conversation"));
    console.log(chalk.gray("  /exit    - Exit chat\n"));
    console.log(
      chalk.white.bold(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
      )
    );

    // Start interactive chat loop
    await startChatLoop(chatbot, session.id, options, repoRoot);

    // Export if requested
    if (options.export) {
      console.log(
        chalk.blue(`\n💾 Exporting conversation to: ${options.export}`)
      );
      await chatbot.saveSession(session.id, options.export);
      console.log(chalk.green("✓ Conversation exported"));
    }

    console.log(chalk.gray("\n👋 Thanks for using GuardScan AI Chat!\n"));
  } catch (error) {
    handleCommandError(error, "Chat");
  }
}

/**
 * Start interactive chat loop
 */
async function startChatLoop(
  chatbot: ChatbotEngine,
  sessionId: string,
  options: ChatCommandOptions,
  repoRoot: string
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("\n💬 You: "),
  });

  // Show initial prompt
  rl.prompt();

  // Handle user input
  for await (const line of rl) {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      continue;
    }

    // Handle commands
    if (input.startsWith("/")) {
      const command = input.toLowerCase();

      if (command === "/exit" || command === "/quit") {
        rl.close();
        break;
      } else if (command === "/help") {
        showHelp();
      } else if (command === "/clear") {
        chatbot.clearSessionMessages(sessionId);
        console.log(chalk.green("✓ Conversation history cleared"));
      } else if (command === "/stats") {
        showStats(chatbot, sessionId);
      } else if (command === "/export") {
        try {
          const markdown = chatbot.exportAsMarkdown(sessionId);
          console.log("\n" + markdown);
          
          // Generate filename based on session ID and timestamp
          const session = chatbot.getSession(sessionId);
          if (session) {
            const timestamp = session.createdAt.toISOString().replace(/[:.]/g, '-').split('T')[0];
            const filename = `guardscan-chat-${sessionId}-${timestamp}.md`;
            // Save to parent directory of the project (one level up from repo root)
            const parentDir = path.dirname(repoRoot);
            const filePath = path.join(parentDir, filename);
            
            // Write to file
            await fs.writeFile(filePath, markdown, 'utf-8');
            console.log(chalk.green(`\n✓ Conversation exported to: ${filePath}`));
          }
        } catch (error) {
          console.error(chalk.red(`\n✗ Failed to export conversation: ${error instanceof Error ? error.message : String(error)}`));
        }
      } else {
        console.log(chalk.yellow(`Unknown command: ${input}`));
        console.log(chalk.gray("Type /help for available commands"));
      }

      rl.prompt();
      continue;
    }

    // Process user message
    let thinkingInterval: NodeJS.Timeout | undefined;
    try {
      // Show thinking indicator
      process.stdout.write(chalk.gray("\n🤔 Thinking"));
      thinkingInterval = setInterval(() => {
        process.stdout.write(chalk.gray("."));
      }, 500);

      const response = await chatbot.chat(sessionId, input, {
        temperature: options.temperature ?? 0.7,
        maxTokens: 1000,
        contextTokens: 4000,
        includeHistory: true,
        maxHistoryTurns: 5,
        model: options.model, // Pass model override if provided
      });

      // Clear thinking indicator
      if (thinkingInterval) {
        clearInterval(thinkingInterval);
      }
      process.stdout.write(chalk.green(" ✓\n\n"));

      // Display response with better formatting
      console.log(chalk.cyan.bold("\n" + "━".repeat(70)));
      console.log(chalk.green.bold("🤖 Assistant Response"));
      console.log(chalk.cyan("━".repeat(70)) + "\n");

      // Format and display the response content
      const formattedContent = formatAssistantResponse(
        response.message.content
      );
      console.log(formattedContent);

      // Show relevant files if available
      if (
        response.message.metadata?.relevantFiles &&
        response.message.metadata.relevantFiles.length > 0
      ) {
        console.log(chalk.cyan("\n" + "─".repeat(70)));
        console.log(chalk.blue.bold("📁 Referenced Files"));
        console.log(chalk.cyan("─".repeat(70)));
        response.message.metadata.relevantFiles.forEach((file, index) => {
          const filePath = file.startsWith("/") ? file : `./${file}`;
          console.log(chalk.gray(`  ${index + 1}. `) + chalk.cyan(filePath));
        });
      }

      // Show statistics in a formatted box with accurate values
      console.log(chalk.cyan("\n" + "─".repeat(70)));
      console.log(chalk.blue.bold("📊 Response Statistics"));
      console.log(chalk.cyan("─".repeat(70)));

      // Response Time - always accurate (measured)
      const responseTime = response.stats.responseTimeMs;
      const responseTimeFormatted =
        responseTime >= 1000
          ? `${(responseTime / 1000).toFixed(2)}s`
          : `${responseTime}ms`;
      console.log(
        chalk.gray("  ⏱️  Response Time: ") +
          chalk.white.bold(responseTimeFormatted)
      );

      // Relevant Snippets - always accurate (counted)
      console.log(
        chalk.gray("  🎯 Relevant Snippets: ") +
          chalk.white.bold(`${response.stats.relevantSnippets}`)
      );

      // Tokens Used - use actual from metadata if available, otherwise from stats
      const tokensUsed =
        response.message.metadata?.tokensUsed ?? response.stats.totalTokens;
      if (tokensUsed > 0) {
        console.log(
          chalk.gray("  🎟️  Tokens Used: ") +
            chalk.white.bold(tokensUsed.toLocaleString())
        );
      } else {
        // Show estimated if no actual count available
        const estimatedTokens =
          response.stats.promptTokens + response.stats.completionTokens;
        if (estimatedTokens > 0) {
          console.log(
            chalk.gray("  🎟️  Tokens Used: ") +
              chalk.white.bold(
                `${estimatedTokens.toLocaleString()} (estimated)`
              )
          );
        }
      }

      // Model - use actual model name from API response
      const modelName = response.message.metadata?.modelUsed || "Unknown";
      console.log(chalk.gray("  🤖 Model: ") + chalk.white.bold(modelName));

      console.log(chalk.cyan("─".repeat(70)) + "\n");
    } catch (error: any) {
      // Clear thinking indicator if still running
      if (thinkingInterval) {
        clearInterval(thinkingInterval);
        process.stdout.write("\n");
      }
      console.log(chalk.red("\n" + "━".repeat(70)));
      console.log(chalk.red.bold("✗ Error"));
      console.log(chalk.red("━".repeat(70)));
      console.log(chalk.white(error.message));
      console.log(chalk.red("━".repeat(70)) + "\n");
    }

    rl.prompt();
  }
}

/**
 * Highlight file paths in text (without backticks)
 */
function highlightFilePaths(text: string): string {
  // Pattern for file paths: ./file.ts, src/file.ts, /path/to/file.ext, file.ts
  const filePathPattern =
    /(\.?\/?[\w\-./]+\.(ts|js|tsx|jsx|py|java|cpp|c|h|go|rs|rb|php|swift|kt|scala|sh|bash|zsh|yaml|yml|json|xml|html|css|scss|sass|md|txt))/gi;

  return text.replace(filePathPattern, (match) => {
    return chalk.cyan(match);
  });
}

/**
 * Convert markdown bold (**text**) to colored bold text
 */
function convertBoldMarkdown(text: string): string {
  // Pattern to match **bold** text
  const boldPattern = /\*\*([^*]+)\*\*/g;
  
  return text.replace(boldPattern, (match, content) => {
    // Use bold cyan for emphasis
    return chalk.cyan.bold(content);
  });
}

/**
 * Highlight inline code snippets and filenames in text (without backticks)
 */
function highlightInlineCodeAndFiles(text: string): string {
  // Pattern to match inline code: `code` (single backticks, not triple)
  const inlineCodePattern = /`([^`]+)`/g;

  const highlighted = text;
  let lastIndex = 0;
  const parts: Array<{ text: string; isCode: boolean; isFilePath?: boolean }> =
    [];

  // Find all inline code matches
  let match;
  while ((match = inlineCodePattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push({
        text: text.substring(lastIndex, match.index),
        isCode: false,
      });
    }

    // Add the code snippet
    const codeContent = match[1];
    // Check if it looks like a file path
    const isFilePath =
      /^\.?\/?[\w\-./]+\.\w+$/.test(codeContent) ||
      /^[\w\-./]+\.(ts|js|tsx|jsx|py|java|cpp|c|h|go|rs|rb|php|swift|kt|scala|sh|bash|zsh|yaml|yml|json|xml|html|css|scss|sass|md|txt)$/i.test(
        codeContent
      );

    parts.push({
      text: codeContent,
      isCode: true,
      isFilePath,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({
      text: text.substring(lastIndex),
      isCode: false,
    });
  }

  // If no matches, return original text with file path highlighting
  if (parts.length === 0) {
    return highlightFilePaths(text);
  }

  // Build highlighted string (without backticks)
  return parts
    .map((part) => {
      if (part.isCode) {
        // Highlight file paths in cyan, other code in yellow (no backticks)
        if (part.isFilePath) {
          return chalk.cyan(part.text);
        } else {
          return chalk.yellow(part.text);
        }
      } else {
        // Also highlight file paths in regular text
        return highlightFilePaths(part.text);
      }
    })
    .join("");
}

/**
 * Format assistant response with better readability
 */
function formatAssistantResponse(content: string): string {
  // Split content into lines
  const lines = content.split("\n");
  const formatted: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect code block start
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        // End of code block
        formatted.push(chalk.gray("┌" + "─".repeat(68) + "┐"));
        formatted.push(
          chalk.gray("│ ") +
            chalk.blue(codeBlockLang || "code") +
            chalk.gray(" ".repeat(68 - (codeBlockLang.length + 1)) + "│")
        );
        formatted.push(chalk.gray("├" + "─".repeat(68) + "┤"));
        codeBlockLines.forEach((codeLine) => {
          formatted.push(
            chalk.gray("│ ") +
              chalk.white(codeLine.padEnd(68)) +
              chalk.gray(" │")
          );
        });
        formatted.push(chalk.gray("└" + "─".repeat(68) + "└"));
        inCodeBlock = false;
        codeBlockLines = [];
        codeBlockLang = "";
      } else {
        // Start of code block
        codeBlockLang = line.trim().replace(/```/g, "").trim() || "code";
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
    } else {
      // Format regular text
      if (line.trim().startsWith("# ")) {
        // Heading 1
        const content = convertBoldMarkdown(highlightInlineCodeAndFiles(line.substring(2)));
        formatted.push(
          chalk.cyan.bold("\n" + content)
        );
        formatted.push(chalk.cyan("─".repeat(68)));
      } else if (line.trim().startsWith("## ")) {
        // Heading 2
        const content = convertBoldMarkdown(highlightInlineCodeAndFiles(line.substring(3)));
        formatted.push(
          chalk.blue.bold("\n" + content)
        );
      } else if (line.trim().startsWith("### ")) {
        // Heading 3
        const content = convertBoldMarkdown(highlightInlineCodeAndFiles(line.substring(4)));
        formatted.push(
          chalk.blue("\n" + content)
        );
      } else if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
        // Bullet point
        const content = convertBoldMarkdown(highlightInlineCodeAndFiles(line.trim().substring(2)));
        formatted.push(
          chalk.gray("  • ") + content
        );
      } else if (
        line.trim().startsWith("1. ") ||
        /^\d+\.\s/.test(line.trim())
      ) {
        // Numbered list
        const content = convertBoldMarkdown(highlightInlineCodeAndFiles(line.trim()));
        formatted.push(
          chalk.gray("  ") + content
        );
      } else if (line.trim().startsWith("> ")) {
        // Quote
        const content = convertBoldMarkdown(highlightInlineCodeAndFiles(line.trim().substring(2)));
        formatted.push(
          chalk.gray("  │ ") + chalk.italic(content)
        );
      } else if (line.trim() === "") {
        // Empty line
        formatted.push("");
      } else {
        // Regular text with word wrap and highlighting
        const highlighted = convertBoldMarkdown(highlightInlineCodeAndFiles(line));
        const wrapped = wordWrapWithHighlighting(highlighted, 70);
        formatted.push(chalk.white(wrapped));
      }
    }
  }

  // Handle unclosed code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    formatted.push(chalk.gray("┌" + "─".repeat(68) + "┐"));
    formatted.push(
      chalk.gray("│ ") +
        chalk.blue(codeBlockLang || "code") +
        chalk.gray(" ".repeat(68 - (codeBlockLang.length + 1)) + "│")
    );
    formatted.push(chalk.gray("├" + "─".repeat(68) + "┤"));
    codeBlockLines.forEach((codeLine) => {
      formatted.push(
        chalk.gray("│ ") + chalk.white(codeLine.padEnd(68)) + chalk.gray(" │")
      );
    });
    formatted.push(chalk.gray("└" + "─".repeat(68) + "└"));
  }

  return formatted.join("\n");
}

/**
 * Word wrap text to specified width
 */
function wordWrap(text: string, width: number): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + word).length <= width) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.join("\n");
}

/**
 * Word wrap text to specified width (preserving chalk colors)
 */
function wordWrapWithHighlighting(text: string, width: number): string {
  // Split by spaces and rebuild lines while preserving ANSI color codes
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let currentLine = "";
  let currentLength = 0;

  for (const word of words) {
    // Calculate visible length (strip ANSI escape codes)
    const wordLength = word.replace(/\u001b\[[0-9;]*m/g, "").length;

    if (currentLength + wordLength <= width || currentLine === "") {
      currentLine += word;
      currentLength += wordLength;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
      currentLength = wordLength;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.join("\n");
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(chalk.white.bold("\n📖 GuardScan AI Chat - Help\n"));
  console.log(chalk.cyan("Commands:"));
  console.log(chalk.gray("  /help    - Show this help message"));
  console.log(chalk.gray("  /clear   - Clear conversation history"));
  console.log(chalk.gray("  /stats   - Show chat statistics"));
  console.log(chalk.gray("  /export  - Export conversation as markdown"));
  console.log(chalk.gray("  /exit    - Exit chat (also: /quit)\n"));

  console.log(chalk.cyan("Example Questions:"));
  console.log(
    chalk.gray('  • "How does authentication work in this project?"')
  );
  console.log(
    chalk.gray('  • "Show me all functions that handle database queries"')
  );
  console.log(chalk.gray('  • "Are there any security vulnerabilities?"'));
  console.log(chalk.gray('  • "Explain the UserService class"'));
  console.log(chalk.gray('  • "How is error handling implemented?"\n'));
}

/**
 * Show chat statistics
 */
function showStats(chatbot: ChatbotEngine, sessionId: string): void {
  const stats = chatbot.getSessionStats(sessionId);
  if (!stats) {
    console.log(chalk.yellow("No statistics available"));
    return;
  }

  console.log(chalk.white.bold("\n📊 Chat Statistics\n"));
  console.log(chalk.cyan("─".repeat(50)));
  console.log(chalk.gray(`Messages:          ${stats.messageCount}`));
  console.log(chalk.gray(`Questions Asked:   ${stats.questionsAsked}`));
  console.log(
    chalk.gray(`Total Tokens:      ${stats.totalTokens.toLocaleString()}`)
  );
  console.log(
    chalk.gray(
      `Avg Tokens/Msg:    ${Math.round(stats.averageTokensPerMessage)}`
    )
  );
  console.log(
    chalk.gray(`Duration:          ${Math.round(stats.duration / 1000)}s`)
  );
  console.log(chalk.cyan("─".repeat(50)) + "\n");
}

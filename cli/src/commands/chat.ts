/**
 * chat.ts - Interactive AI Chat CLI Command
 *
 * Purpose: Interactive codebase Q&A using RAG and AI.
 * Features: REPL-style chat, context-aware responses, conversation history
 */

import chalk from 'chalk';
import * as readline from 'readline';
import { configManager } from '../core/config';
import { repositoryManager } from '../core/repository';
import { ProviderFactory } from '../providers/factory';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('chat');
const perfTracker = createPerformanceTracker('guardscan chat');
import { CodebaseIndexer } from '../core/codebase-indexer';
import { EmbeddingChunker } from '../core/embedding-chunker';
import { FileBasedEmbeddingStore } from '../core/embedding-store';
import { EmbeddingSearchEngine } from '../core/embedding-search';
import { RAGContextBuilder } from '../core/rag-context';
import { ChatbotEngine } from '../core/chatbot-engine';
import { EmbeddingIndexer } from '../core/embedding-indexer';
import { OpenAIEmbeddingProvider } from '../providers/embedding-openai';
import { OllamaEmbeddingProvider } from '../providers/embedding-ollama';

interface ChatCommandOptions {
  model?: string;              // Override AI model
  temperature?: number;        // Temperature 0-1
  rebuild?: boolean;           // Rebuild embeddings index
  embeddingProvider?: string;  // 'openai' or 'ollama'
  session?: string;            // Load existing session
  export?: string;             // Export conversation path
}

export async function chatCommand(options: ChatCommandOptions): Promise<void> {
  logger.debug('Chat command started', { options });
  perfTracker.start('chat-total');
  
  try {
    // Load config
    perfTracker.start('load-config');
    const config = configManager.loadOrInit();
    perfTracker.end('load-config');
    logger.debug('Config loaded', { provider: config.provider });

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    const repoRoot = repoInfo.path;
    const repoId = repoInfo.repoId;

    console.log(chalk.blue('\n💬 GuardScan AI Chat - Interactive Codebase Assistant\n'));

    // Check if AI provider is configured
    if (!config.provider || config.provider === 'none' || !config.apiKey) {
      handleCommandError(new Error('AI provider not configured. Run `guardscan config` to set up your AI provider.'), 'Chat');
    }

    // Initialize components
    console.log(chalk.gray('Initializing AI chat system...'));

    const aiProvider = ProviderFactory.create(
      config.provider,
      config.apiKey,
      config.apiEndpoint
    );

    // Initialize embedding provider
    const embeddingProviderType = options.embeddingProvider || 'ollama';
    let embeddingProvider;

    if (embeddingProviderType === 'openai') {
      if (!config.apiKey) {
        handleCommandError(new Error('OpenAI API key required for OpenAI embeddings'), 'Chat');
      }
      embeddingProvider = new OpenAIEmbeddingProvider(config.apiKey || '', config.apiEndpoint);
    } else {
      embeddingProvider = new OllamaEmbeddingProvider();

      // Check if Ollama is running
      const isRunning = await embeddingProvider.checkOllamaRunning();
      if (!isRunning) {
        console.log(chalk.red('\n✗ Ollama is not running'));
        console.log(chalk.gray('Please start Ollama: ollama serve'));
        console.log(chalk.gray('Or use OpenAI embeddings: --embedding-provider=openai\n'));
        process.exit(1);
      }

      // Check if model is available
      const hasModel = await embeddingProvider.checkModelAvailable();
      if (!hasModel) {
        handleCommandError(new Error(`Embedding model not found. Run: ollama pull ${embeddingProvider.getModel()}`), 'Chat');
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

    // Check if embeddings exist
    const indexStats = await embeddingIndexer.getIndexStats();

    if (!indexStats.indexed || options.rebuild) {
      console.log(chalk.blue('\n🔍 Building embedding index for your codebase...'));
      console.log(chalk.gray('This is a one-time process (unless code changes)\n'));

      const result = await embeddingIndexer.indexCodebase({
        incremental: !options.rebuild,
        batchSize: 50,
        showProgress: true,
      });

      if (!result.success) {
        console.log(chalk.red('\n✗ Failed to build embedding index'));
        result.errors.forEach(err => {
          console.log(chalk.red(`  - ${err.message}`));
        });
        handleCommandError(new Error('Failed to initialize chat system'), 'Chat');
      }
    } else {
      console.log(chalk.green('✓ Using existing embedding index'));
      console.log(
        chalk.gray(
          `  ${indexStats.totalEmbeddings} embeddings | Last indexed: ${indexStats.lastIndexed?.toLocaleString()}\n`
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
        projectName: repoInfo.path.split('/').pop(),
      });
    }

    // Show welcome message
    console.log(chalk.white.bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('  Welcome to GuardScan AI Chat!'));
    console.log(chalk.white.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    console.log(chalk.gray('Ask me anything about your codebase. I can help you:'));
    console.log(chalk.gray('  • Understand how features work'));
    console.log(chalk.gray('  • Find bugs and security issues'));
    console.log(chalk.gray('  • Explain code architecture'));
    console.log(chalk.gray('  • Suggest improvements\n'));
    console.log(chalk.gray('Commands:'));
    console.log(chalk.gray('  /help    - Show this help message'));
    console.log(chalk.gray('  /clear   - Clear conversation history'));
    console.log(chalk.gray('  /stats   - Show chat statistics'));
    console.log(chalk.gray('  /export  - Export conversation'));
    console.log(chalk.gray('  /exit    - Exit chat\n'));
    console.log(chalk.white.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    // Start interactive chat loop
    await startChatLoop(chatbot, session.id, options);

    // Export if requested
    if (options.export) {
      console.log(chalk.blue(`\n💾 Exporting conversation to: ${options.export}`));
      await chatbot.saveSession(session.id, options.export);
      console.log(chalk.green('✓ Conversation exported'));
    }

    console.log(chalk.gray('\n👋 Thanks for using GuardScan AI Chat!\n'));
  } catch (error) {
    handleCommandError(error, 'Chat');
  }
}

/**
 * Start interactive chat loop
 */
async function startChatLoop(
  chatbot: ChatbotEngine,
  sessionId: string,
  options: ChatCommandOptions
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('\n💬 You: '),
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
    if (input.startsWith('/')) {
      const command = input.toLowerCase();

      if (command === '/exit' || command === '/quit') {
        rl.close();
        break;
      } else if (command === '/help') {
        showHelp();
      } else if (command === '/clear') {
        chatbot.clearSessionMessages(sessionId);
        console.log(chalk.green('✓ Conversation history cleared'));
      } else if (command === '/stats') {
        showStats(chatbot, sessionId);
      } else if (command === '/export') {
        const markdown = chatbot.exportAsMarkdown(sessionId);
        console.log('\n' + markdown);
      } else {
        console.log(chalk.yellow(`Unknown command: ${input}`));
        console.log(chalk.gray('Type /help for available commands'));
      }

      rl.prompt();
      continue;
    }

    // Process user message
    try {
      console.log(chalk.gray('\n🤔 Thinking...\n'));

      const response = await chatbot.chat(sessionId, input, {
        temperature: options.temperature ?? 0.7,
        maxTokens: 1000,
        contextTokens: 4000,
        includeHistory: true,
        maxHistoryTurns: 5,
      });

      // Display response
      console.log(chalk.green('\n🤖 Assistant:\n'));
      console.log(chalk.white(response.message.content));

      // Show relevant files if available
      if (
        response.message.metadata?.relevantFiles &&
        response.message.metadata.relevantFiles.length > 0
      ) {
        console.log(chalk.gray('\n📁 Relevant files:'));
        response.message.metadata.relevantFiles.forEach(file => {
          console.log(chalk.gray(`   • ${file}`));
        });
      }

      // Show statistics
      console.log(
        chalk.gray(
          `\n⏱️  ${response.stats.responseTimeMs}ms | ` +
            `🎯 ${response.stats.relevantSnippets} snippets | ` +
            `🎟️  ${response.stats.totalTokens} tokens`
        )
      );
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
    }

    rl.prompt();
  }
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(chalk.white.bold('\n📖 GuardScan AI Chat - Help\n'));
  console.log(chalk.cyan('Commands:'));
  console.log(chalk.gray('  /help    - Show this help message'));
  console.log(chalk.gray('  /clear   - Clear conversation history'));
  console.log(chalk.gray('  /stats   - Show chat statistics'));
  console.log(chalk.gray('  /export  - Export conversation as markdown'));
  console.log(chalk.gray('  /exit    - Exit chat (also: /quit)\n'));

  console.log(chalk.cyan('Example Questions:'));
  console.log(chalk.gray('  • "How does authentication work in this project?"'));
  console.log(chalk.gray('  • "Show me all functions that handle database queries"'));
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
    console.log(chalk.yellow('No statistics available'));
    return;
  }

  console.log(chalk.white.bold('\n📊 Chat Statistics\n'));
  console.log(chalk.cyan('─'.repeat(50)));
  console.log(chalk.gray(`Messages:          ${stats.messageCount}`));
  console.log(chalk.gray(`Questions Asked:   ${stats.questionsAsked}`));
  console.log(chalk.gray(`Total Tokens:      ${stats.totalTokens.toLocaleString()}`));
  console.log(
    chalk.gray(`Avg Tokens/Msg:    ${Math.round(stats.averageTokensPerMessage)}`)
  );
  console.log(
    chalk.gray(`Duration:          ${Math.round(stats.duration / 1000)}s`)
  );
  console.log(chalk.cyan('─'.repeat(50)) + '\n');
}

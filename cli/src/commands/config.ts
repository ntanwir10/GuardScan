import chalk from "chalk";
import inquirer from "inquirer";
import { configManager, AIProvider } from "../core/config";
import { ProviderFactory } from "../providers/factory";
import { createDebugLogger } from "../utils/debug-logger";
import { createPerformanceTracker } from "../utils/performance-tracker";
import { handleCommandError } from "../utils/error-handler";

interface ConfigOptions {
  provider?: AIProvider;
  key?: string;
  embeddingFallback?: string;
  show?: boolean;
}

const logger = createDebugLogger("config");
const perfTracker = createPerformanceTracker("guardscan config");

export async function configCommand(options: ConfigOptions): Promise<void> {
  logger.debug("Config command started", { options });
  perfTracker.start("config-total");

  try {
    // Show current config
    if (options.show) {
      perfTracker.start("show-config");
      showConfig();
      perfTracker.end("show-config");
      perfTracker.end("config-total");
      perfTracker.displaySummary();
      return;
    }

    // Direct config via flags
    if (options.provider || options.key) {
      perfTracker.start("direct-config");
      directConfig(options);
      perfTracker.end("direct-config");
      perfTracker.end("config-total");
      logger.debug("Config updated via flags");
      perfTracker.displaySummary();
      return;
    }

    // Check if running in non-interactive mode (no TTY)
    const isNonInteractive = !process.stdin.isTTY;
    if (isNonInteractive) {
      // In non-interactive mode, just show config
      logger.debug("Non-interactive mode detected, showing config");
      perfTracker.start("show-config");
      showConfig();
      perfTracker.end("show-config");
      perfTracker.end("config-total");
      perfTracker.displaySummary();
      return;
    }

    // Interactive config
    perfTracker.start("interactive-config");
    await interactiveConfig();
    perfTracker.end("interactive-config");
    perfTracker.end("config-total");
    logger.debug("Config updated interactively");
    perfTracker.displaySummary();
  } catch (error) {
    perfTracker.end("config-total");
    perfTracker.displaySummary();
    handleCommandError(error, "Configuration");
  }
}

function showConfig(): void {
  logger.debug("Showing current configuration");
  const config = configManager.loadOrInit();
  logger.debug("Config loaded", {
    provider: config.provider,
    telemetryEnabled: config.telemetryEnabled,
  });

  console.log(chalk.cyan.bold("\n📋 GuardScan Configuration\n"));
  console.log(chalk.gray("─".repeat(70)) + "\n");

  const mode = getModeFromProvider(config.provider);

  // 1. Operation Mode
  console.log(chalk.cyan.bold("1. Operation Mode"));
  const modeDescription =
    mode === "cloud"
      ? "AI-Enhanced Reviews mode uses cloud-based AI providers (OpenAI, Claude, Gemini, or OpenRouter) to perform intelligent code analysis, security scanning, and automated code reviews. This mode requires an internet connection and API keys."
      : mode === "local"
      ? "Local AI mode uses locally running AI models via Ollama or LM Studio. This provides privacy and cost savings by processing code analysis entirely on your machine without sending data to external services."
      : "Static Analysis Only mode performs code analysis using built-in static analysis tools without any AI assistance. This mode works completely offline and doesn't require any API keys or internet connection.";

  const modeDisplay =
    mode === "cloud"
      ? "✨ AI-Enhanced Reviews"
      : mode === "local"
      ? "🏠 Local AI (Offline)"
      : "🛡️  Static Analysis Only";

  console.log(chalk.white(`   Current: ${chalk.cyan.bold(modeDisplay)}`));
  console.log(chalk.gray(`   ${modeDescription}\n`));

  // 2. AI Provider Configuration
  if (config.provider !== "none") {
    console.log(chalk.cyan.bold("2. AI Provider Configuration"));
    console.log(chalk.white(`   Provider: ${chalk.green(config.provider)}`));

    const providerDescription =
      config.provider === "openai"
        ? "OpenAI provides access to GPT models (GPT-5.1, GPT-4o, GPT-4.1 mini, GPT-3.5) for advanced code analysis and generation capabilities."
        : config.provider === "claude"
        ? "Claude (Anthropic) offers intelligent models (Opus 4.5, Sonnet 4.5, Haiku 4.5) with strong reasoning and coding capabilities."
        : config.provider === "gemini"
        ? "Gemini (Google) provides multimodal AI models (Gemini 2.5 Flash, 2.5 Pro, 3 Pro) with excellent code understanding and generation."
        : config.provider === "openrouter"
        ? "OpenRouter provides access to multiple AI models from various providers through a unified API interface."
        : config.provider === "ollama"
        ? "Ollama runs AI models locally on your machine, providing complete privacy and no API costs."
        : config.provider === "lmstudio"
        ? "LM Studio runs AI models locally through a user-friendly interface, offering privacy and offline capabilities."
        : "AI provider for code analysis and review.";

    console.log(chalk.gray(`   ${providerDescription}`));

    if (config.model) {
      console.log(chalk.white(`   Model: ${chalk.gray(config.model)}`));
      console.log(
        chalk.gray(
          `   The specific AI model being used for code analysis and generation.`
        )
      );
    }

    if (config.apiKey) {
      console.log(
        chalk.white(
          `   API Key: ${chalk.gray("****" + config.apiKey.slice(-4))}`
        )
      );
      console.log(
        chalk.gray(
          `   Your API key for authenticating with the selected AI provider.`
        )
      );
    } else if (config.provider !== "ollama" && config.provider !== "lmstudio") {
      console.log(
        chalk.white(`   API Key: ${chalk.gray("Environment variable")}`)
      );
      console.log(
        chalk.gray(
          `   API key is loaded from environment variables for security.`
        )
      );
    }

    if (config.apiEndpoint) {
      console.log(
        chalk.white(`   API Endpoint: ${chalk.gray(config.apiEndpoint)}`)
      );
      console.log(
        chalk.gray(
          `   Custom API endpoint URL for the AI provider (if using self-hosted or custom deployment).`
        )
      );
    }

    if (config.embeddingFallback) {
      console.log(
        chalk.white(
          `   Embedding Fallback: ${chalk.gray(config.embeddingFallback)}`
        )
      );
      console.log(
        chalk.gray(
          `   Local embedding provider used for code search and RAG (Retrieval Augmented Generation) when the primary provider doesn't support embeddings natively.`
        )
      );
    }
    console.log();
  } else {
    console.log(chalk.cyan.bold("2. AI Provider Configuration"));
    console.log(
      chalk.white(`   Provider: ${chalk.gray("None (Static Analysis Only)")}`)
    );
    console.log(
      chalk.gray(
        `   No AI provider is configured. GuardScan will use only static analysis tools for code review.\n`
      )
    );
  }

  // 3. System Settings
  console.log(chalk.cyan.bold("3. System Settings"));
  console.log(chalk.white(`   Client ID: ${chalk.gray(config.clientId)}`));
  console.log(
    chalk.gray(
      `   Unique identifier for this GuardScan installation, used for telemetry and analytics (if enabled).`
    )
  );

  console.log(
    chalk.white(
      `   Telemetry: ${
        config.telemetryEnabled
          ? chalk.green("Enabled")
          : chalk.yellow("Disabled")
      }`
    )
  );
  console.log(
    chalk.gray(
      `   ${
        config.telemetryEnabled
          ? "Usage analytics and error reporting are enabled to help improve GuardScan."
          : "Usage analytics are disabled. No data is sent to external servers."
      }`
    )
  );

  console.log(
    chalk.white(
      `   Offline Mode: ${
        config.offlineMode ? chalk.yellow("Yes") : chalk.green("No")
      }`
    )
  );
  console.log(
    chalk.gray(
      `   ${
        config.offlineMode
          ? "Offline mode is enabled. Telemetry and monitoring are completely disabled."
          : "GuardScan can connect to external services for updates and telemetry (if enabled)."
      }`
    )
  );
  console.log();

  // 4. Session Information
  console.log(chalk.cyan.bold("4. Session Information"));
  console.log(
    chalk.white(
      `   Created: ${chalk.gray(new Date(config.createdAt).toLocaleString())}`
    )
  );
  console.log(
    chalk.gray(
      `   Timestamp when this GuardScan configuration was first created.`
    )
  );

  console.log(
    chalk.white(
      `   Last Used: ${chalk.gray(new Date(config.lastUsed).toLocaleString())}`
    )
  );
  console.log(
    chalk.gray(
      `   Timestamp of the last GuardScan command execution using this configuration.`
    )
  );

  console.log(chalk.gray("\n" + "─".repeat(70) + "\n"));
}

function getModeFromProvider(provider: string): "cloud" | "local" | "static" {
  if (provider === "none") return "static";
  if (provider === "ollama" || provider === "lmstudio") return "local";
  return "cloud";
}

function directConfig(options: ConfigOptions): void {
  logger.debug("Direct config update", { options });
  perfTracker.start("load-config");
  const config = configManager.loadOrInit();
  perfTracker.end("load-config");

  if (options.provider) {
    config.provider = options.provider;
    logger.debug("Provider updated", { provider: options.provider });
    console.log(chalk.green(`✓ Provider set to: ${options.provider}`));
  }

  if (options.key) {
    config.apiKey = options.key;
    logger.debug("API key updated");
    console.log(chalk.green("✓ API key updated"));
  }

  if (options.embeddingFallback) {
    if (options.embeddingFallback === "none") {
      config.embeddingFallback = undefined;
    } else if (
      options.embeddingFallback === "ollama" ||
      options.embeddingFallback === "lmstudio"
    ) {
      config.embeddingFallback = options.embeddingFallback;
    } else {
      throw new Error(
        `Invalid embedding fallback: ${options.embeddingFallback}. Must be 'ollama', 'lmstudio', or 'none'`
      );
    }
    logger.debug("Embedding fallback updated", {
      embeddingFallback: config.embeddingFallback,
    });
    console.log(
      chalk.green(
        `✓ Embedding fallback set to: ${config.embeddingFallback || "none"}`
      )
    );
  }

  perfTracker.start("save-config");
  configManager.save(config);
  perfTracker.end("save-config");
  logger.debug("Config saved");
  console.log();
}

async function interactiveConfig(): Promise<void> {
  const { displaySimpleBanner } = await import("../utils/ascii-art");
  displaySimpleBanner("config");

  const config = configManager.loadOrInit();
  const currentMode = getModeFromProvider(config.provider);

  // Show current mode
  console.log(
    chalk.gray("Current mode: ") +
      chalk.cyan(
        currentMode === "cloud"
          ? "✨ AI-Enhanced Reviews"
          : currentMode === "local"
          ? "🏠 Local AI"
          : "🛡️  Static Analysis"
      ) +
      "\n"
  );

  // Ask if they want to change mode
  const { changeMode } = await inquirer.prompt([
    {
      type: "confirm",
      name: "changeMode",
      message: "Do you want to change your mode?",
      default: false,
    },
  ]);

  if (changeMode) {
    const choices = [
      {
        name:
          chalk.cyan("✨ AI-Enhanced Reviews") +
          chalk.gray(" (Cloud AI providers)"),
        value: "cloud",
      },
      {
        name: chalk.cyan("🏠 Local AI") + chalk.gray(" (Ollama, LM Studio)"),
        value: "local",
      },
      {
        name: chalk.cyan("🛡️  Static Analysis Only") + chalk.gray(" (No AI)"),
        value: "static",
      },
    ];

    const { newMode } = await inquirer.prompt([
      {
        type: "list",
        name: "newMode",
        message: "Select new mode:",
        choices,
        default: currentMode,
      },
    ]);

    await configureModeSettings(config, newMode);
  } else {
    // Just update current mode settings
    await configureModeSettings(config, currentMode);
  }

  configManager.save(config);
  console.log(chalk.green("\n✓ Configuration saved\n"));
}

async function configureModeSettings(
  config: any,
  mode: "cloud" | "local" | "static"
): Promise<void> {
  if (mode === "cloud") {
    const cloudProviders = [
      { name: "OpenAI (GPT-4)", value: "openai" },
      { name: "Claude (Anthropic)", value: "claude" },
      { name: "Gemini (Google)", value: "gemini" },
      { name: "OpenRouter (Multi-model)", value: "openrouter" },
    ];

    const providerAnswers = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Select cloud AI provider:",
        choices: cloudProviders,
        default:
          config.provider !== "none" &&
          !["ollama", "lmstudio"].includes(config.provider)
            ? config.provider
            : "openai",
      },
    ]);

    // Ask for model selection based on provider
    let modelAnswer: { model?: string } = {};
    if (providerAnswers.provider === "gemini") {
      modelAnswer = await inquirer.prompt([
        {
          type: "list",
          name: "model",
          message: "Select Gemini model:",
          choices: [
            {
              name: "Gemini 2.5 Flash (Balanced: speed + 1M token context)",
              value: "gemini-2.5-flash",
            },
            {
              name: "Gemini 2.5 Flash-Lite (Fast and cost-efficient)",
              value: "gemini-2.5-flash-lite",
            },
            {
              name: "Gemini 2.5 Pro (Complex reasoning, 1M token context)",
              value: "gemini-2.5-pro",
            },
            {
              name: "Gemini 3 Pro (Most intelligent and capable)",
              value: "gemini-3-pro",
            },
          ],
          default: config.model || "gemini-2.5-flash",
        },
      ]);
    } else if (providerAnswers.provider === "openai") {
      modelAnswer = await inquirer.prompt([
        {
          type: "list",
          name: "model",
          message: "Select OpenAI model:",
          choices: [
            {
              name: "GPT-5.1 (Newest: coding and agentic tasks with configurable reasoning)",
              value: "gpt-5.1",
            },
            {
              name: "GPT-4o (Multimodal: audio/vision, low-latency, real-time)",
              value: "gpt-4o",
            },
            {
              name: "GPT-4.1 mini (Fast and efficient, improvement over GPT-4o mini)",
              value: "gpt-4.1-mini",
            },
            {
              name: "GPT-3.5 Turbo (Faster, lighter, basic tasks)",
              value: "gpt-3.5-turbo",
            },
          ],
          default: config.model || "gpt-4o",
        },
      ]);
    } else if (providerAnswers.provider === "claude") {
      modelAnswer = await inquirer.prompt([
        {
          type: "list",
          name: "model",
          message: "Select Claude model:",
          choices: [
            {
              name: "Claude Opus 4.5 (Most intelligent: complex tasks, professional coding)",
              value: "claude-opus-4.5",
            },
            {
              name: "Claude Sonnet 4.5 (Balanced: complex agents, coding, high intelligence)",
              value: "claude-sonnet-4.5",
            },
            {
              name: "Claude Haiku 4.5 (Fastest and cost-effective: real-time, high-volume)",
              value: "claude-haiku-4.5",
            },
          ],
          default: config.model || "claude-sonnet-4.5",
        },
      ]);
    }

    const answers = await inquirer.prompt([
      {
        type: "password",
        name: "apiKey",
        message: "Enter API key (or press Enter to use environment variable):",
        mask: "*",
        default: config.apiKey,
      },
      {
        type: "list",
        name: "embeddingFallback",
        message: "Choose embedding provider:",
        choices: [
          { name: "Use native provider (if available)", value: "none" },
          { name: "Ollama (local, free)", value: "ollama" },
          { name: "LM Studio (local)", value: "lmstudio" },
        ],
        default: config.embeddingFallback || "none",
      },
      {
        type: "confirm",
        name: "telemetry",
        message: "Enable telemetry?",
        default: config.telemetryEnabled,
      },
      {
        type: "confirm",
        name: "offlineMode",
        message: "Enable offline mode? (skip telemetry and monitoring)",
        default: config.offlineMode,
      },
    ]);

    config.provider = providerAnswers.provider;
    config.apiKey = answers.apiKey || undefined;
    config.apiEndpoint = undefined;
    // Store selected model for providers that support model selection
    config.model = modelAnswer.model || undefined;
    config.embeddingFallback =
      answers.embeddingFallback === "none"
        ? undefined
        : answers.embeddingFallback;
    config.telemetryEnabled = answers.telemetry;
    config.offlineMode = answers.offlineMode;

    // Show explanation about embeddings
    if (answers.embeddingFallback !== "none") {
      console.log(
        chalk.gray(
          "\n💡 Embeddings are used for code search. Using local provider for privacy and cost savings."
        )
      );
    }

    // Test connection (model is already set in config above)
    if (answers.apiKey) {
      console.log(chalk.gray("\nTesting connection..."));
      console.error(
        "[Config] Creating provider:",
        config.provider,
        "with model:",
        config.model || "default"
      );
      try {
        const provider = ProviderFactory.create(
          config.provider,
          config.apiKey,
          undefined,
          config.model
        );
        console.error("[Config] Provider created, calling testConnection()...");
        const isAvailable = await provider.testConnection();
        console.error("[Config] testConnection() returned:", isAvailable);
        if (isAvailable) {
          console.log(chalk.green(`✓ Connected to ${provider.getName()}`));
        } else {
          console.error(
            "[Config] testConnection returned false - this should not happen if errors are thrown"
          );
          console.log(
            chalk.yellow(`⚠ Could not connect to ${provider.getName()}`)
          );
          console.log(chalk.gray("   Common causes:"));
          console.log(chalk.gray("   • Invalid or expired API key"));
          console.log(chalk.gray("   • Network connectivity issues"));
          console.log(chalk.gray("   • API service temporarily unavailable"));
          console.log(chalk.gray("   • Model not available in your region"));
          console.log(chalk.gray("\n   Configuration will be saved anyway."));
          console.log(
            chalk.gray(
              "   You can test the connection later with: guardscan chat"
            )
          );
        }
      } catch (error: any) {
        console.error("[Config] Caught error in connection test:", error);
        console.log(chalk.yellow("⚠ Connection test failed"));

        // Always log the full error to stderr for debugging
        console.error("\n[DEBUG] Full error details:", {
          error,
          message: error?.message,
          stack: error?.stack,
          stringified: JSON.stringify(error, null, 2),
        });

        if (error?.message) {
          console.log(chalk.red(`   ${error.message}`));
        } else {
          // Log full error for debugging if no message
          logger.debug("Connection test error details", {
            error,
            errorString: String(error),
            errorJson: JSON.stringify(error, null, 2),
          });
          console.log(chalk.gray("   Common causes:"));
          console.log(chalk.gray("   • Invalid or expired API key"));
          console.log(chalk.gray("   • Network connectivity issues"));
          console.log(chalk.gray("   • API service temporarily unavailable"));
        }
        console.log(chalk.gray("\n   Configuration will be saved anyway."));
        console.log(
          chalk.gray(
            "   You can test the connection later with: guardscan chat"
          )
        );
      }
    }
  } else if (mode === "local") {
    const localProviders = [
      { name: "Ollama (http://localhost:11434)", value: "ollama" },
      { name: "LM Studio (http://localhost:1234)", value: "lmstudio" },
    ];

    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Select local AI:",
        choices: localProviders,
        default: ["ollama", "lmstudio"].includes(config.provider)
          ? config.provider
          : "ollama",
      },
      {
        type: "input",
        name: "apiEndpoint",
        message: "Enter API endpoint:",
        default: (answers: any) =>
          answers.provider === "ollama"
            ? "http://localhost:11434"
            : "http://localhost:1234",
      },
      {
        type: "confirm",
        name: "telemetry",
        message: "Enable telemetry?",
        default: config.telemetryEnabled,
      },
    ]);

    config.provider = answers.provider;
    config.apiKey = undefined;
    config.apiEndpoint = answers.apiEndpoint;
    config.telemetryEnabled = answers.telemetry;
    config.offlineMode = true;

    console.log(chalk.green("\n✓ No internet required for reviews"));
  } else {
    // static
    const answers = await inquirer.prompt([
      {
        type: "confirm",
        name: "telemetry",
        message: "Enable telemetry?",
        default: config.telemetryEnabled,
      },
    ]);

    config.provider = "none";
    config.apiKey = undefined;
    config.apiEndpoint = undefined;
    config.telemetryEnabled = answers.telemetry;
    config.offlineMode = true;

    console.log(chalk.green("\n✓ Static analysis only mode"));
  }
}

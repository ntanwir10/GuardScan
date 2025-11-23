import chalk from 'chalk';
import inquirer from 'inquirer';
import { configManager, AIProvider } from '../core/config';
import { ProviderFactory } from '../providers/factory';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

interface ConfigOptions {
  provider?: AIProvider;
  key?: string;
  show?: boolean;
}

const logger = createDebugLogger('config');
const perfTracker = createPerformanceTracker('guardscan config');

export async function configCommand(options: ConfigOptions): Promise<void> {
  logger.debug('Config command started', { options });
  perfTracker.start('config-total');
  
  try {
    // Show current config
    if (options.show) {
      perfTracker.start('show-config');
      showConfig();
      perfTracker.end('show-config');
      perfTracker.end('config-total');
      perfTracker.displaySummary();
      return;
    }

    // Direct config via flags
    if (options.provider || options.key) {
      perfTracker.start('direct-config');
      directConfig(options);
      perfTracker.end('direct-config');
      perfTracker.end('config-total');
      logger.debug('Config updated via flags');
      perfTracker.displaySummary();
      return;
    }

    // Check if running in non-interactive mode (no TTY)
    const isNonInteractive = !process.stdin.isTTY;
    if (isNonInteractive) {
      // In non-interactive mode, just show config
      logger.debug('Non-interactive mode detected, showing config');
      perfTracker.start('show-config');
      showConfig();
      perfTracker.end('show-config');
      perfTracker.end('config-total');
      perfTracker.displaySummary();
      return;
    }

    // Interactive config
    perfTracker.start('interactive-config');
    await interactiveConfig();
    perfTracker.end('interactive-config');
    perfTracker.end('config-total');
    logger.debug('Config updated interactively');
    perfTracker.displaySummary();
  } catch (error) {
    perfTracker.end('config-total');
    perfTracker.displaySummary();
    handleCommandError(error, 'Configuration');
  }
}

function showConfig(): void {
  logger.debug('Showing current configuration');
  const config = configManager.loadOrInit();
  logger.debug('Config loaded', { 
    provider: config.provider, 
    telemetryEnabled: config.telemetryEnabled 
  });

  console.log(chalk.cyan.bold('\n📋 Current Configuration\n'));

  // Show current mode prominently
  const mode = getModeFromProvider(config.provider);
  const modeDisplay = mode === 'cloud' ? '✨ AI-Enhanced Reviews' :
                      mode === 'local' ? '🏠 Local AI (Offline)' :
                      '🛡️  Static Analysis Only';
  console.log(chalk.white('Mode:             ') + chalk.cyan.bold(modeDisplay));
  console.log();

  console.log(chalk.white('Client ID:        ') + chalk.gray(config.clientId));
  console.log(chalk.white('Provider:         ') + chalk.green(config.provider));

  if (config.provider !== 'none') {
    console.log(chalk.white('API Key:          ') + chalk.gray(config.apiKey ? '****' + config.apiKey.slice(-4) : 'Environment variable'));
    if (config.apiEndpoint) {
      console.log(chalk.white('API Endpoint:     ') + chalk.gray(config.apiEndpoint));
    }
  }

  console.log(chalk.white('Telemetry:        ') + (config.telemetryEnabled ? chalk.green('Enabled') : chalk.yellow('Disabled')));
  console.log(chalk.white('Offline Mode:     ') + (config.offlineMode ? chalk.yellow('Yes') : chalk.green('No')));
  console.log(chalk.white('Created:          ') + chalk.gray(new Date(config.createdAt).toLocaleString()));
  console.log(chalk.white('Last Used:        ') + chalk.gray(new Date(config.lastUsed).toLocaleString()));
  console.log();
}

function getModeFromProvider(provider: string): 'cloud' | 'local' | 'static' {
  if (provider === 'none') return 'static';
  if (provider === 'ollama' || provider === 'lmstudio') return 'local';
  return 'cloud';
}

function directConfig(options: ConfigOptions): void {
  logger.debug('Direct config update', { options });
  perfTracker.start('load-config');
  const config = configManager.loadOrInit();
  perfTracker.end('load-config');

  if (options.provider) {
    config.provider = options.provider;
    logger.debug('Provider updated', { provider: options.provider });
    console.log(chalk.green(`✓ Provider set to: ${options.provider}`));
  }

  if (options.key) {
    config.apiKey = options.key;
    logger.debug('API key updated');
    console.log(chalk.green('✓ API key updated'));
  }

  perfTracker.start('save-config');
  configManager.save(config);
  perfTracker.end('save-config');
  logger.debug('Config saved');
  console.log();
}

async function interactiveConfig(): Promise<void> {
  const { displaySimpleBanner } = await import('../utils/ascii-art');
  displaySimpleBanner('config');

  const config = configManager.loadOrInit();
  const currentMode = getModeFromProvider(config.provider);

  // Show current mode
  console.log(chalk.gray('Current mode: ') + chalk.cyan(
    currentMode === 'cloud' ? '✨ AI-Enhanced Reviews' :
    currentMode === 'local' ? '🏠 Local AI' :
    '🛡️  Static Analysis'
  ) + '\n');

  // Ask if they want to change mode
  const { changeMode } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'changeMode',
      message: 'Do you want to change your mode?',
      default: false,
    },
  ]);

  if (changeMode) {
    const choices = [
      {
        name: chalk.cyan('✨ AI-Enhanced Reviews') + chalk.gray(' (Cloud AI providers)'),
        value: 'cloud',
      },
      {
        name: chalk.cyan('🏠 Local AI') + chalk.gray(' (Ollama, LM Studio)'),
        value: 'local',
      },
      {
        name: chalk.cyan('🛡️  Static Analysis Only') + chalk.gray(' (No AI)'),
        value: 'static',
      },
    ];

    const { newMode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'newMode',
        message: 'Select new mode:',
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
  console.log(chalk.green('\n✓ Configuration saved\n'));
}

async function configureModeSettings(config: any, mode: 'cloud' | 'local' | 'static'): Promise<void> {
  if (mode === 'cloud') {
    const cloudProviders = [
      { name: 'OpenAI (GPT-4)', value: 'openai' },
      { name: 'Claude (Anthropic)', value: 'claude' },
      { name: 'Gemini (Google)', value: 'gemini' },
      { name: 'OpenRouter (Multi-model)', value: 'openrouter' },
    ];

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Select cloud AI provider:',
        choices: cloudProviders,
        default: config.provider !== 'none' && !['ollama', 'lmstudio'].includes(config.provider) ? config.provider : 'openai',
      },
      {
        type: 'password',
        name: 'apiKey',
        message: 'Enter API key (or press Enter to use environment variable):',
        mask: '*',
        default: config.apiKey,
      },
      {
        type: 'confirm',
        name: 'telemetry',
        message: 'Enable telemetry?',
        default: config.telemetryEnabled,
      },
      {
        type: 'confirm',
        name: 'offlineMode',
        message: 'Enable offline mode? (skip telemetry and monitoring)',
        default: config.offlineMode,
      },
    ]);

    config.provider = answers.provider;
    config.apiKey = answers.apiKey || undefined;
    config.apiEndpoint = undefined;
    config.telemetryEnabled = answers.telemetry;
    config.offlineMode = answers.offlineMode;

    // Test connection
    if (answers.apiKey) {
      console.log(chalk.gray('\nTesting connection...'));
      try {
        const provider = ProviderFactory.create(config.provider, config.apiKey);
        const isAvailable = await provider.testConnection();
        if (isAvailable) {
          console.log(chalk.green(`✓ Connected to ${provider.getName()}`));
        } else {
          console.log(chalk.yellow(`⚠ Could not connect to ${provider.getName()}`));
        }
      } catch (error) {
        console.log(chalk.yellow('⚠ Connection test failed'));
      }
    }

  } else if (mode === 'local') {
    const localProviders = [
      { name: 'Ollama (http://localhost:11434)', value: 'ollama' },
      { name: 'LM Studio (http://localhost:1234)', value: 'lmstudio' },
    ];

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Select local AI:',
        choices: localProviders,
        default: ['ollama', 'lmstudio'].includes(config.provider) ? config.provider : 'ollama',
      },
      {
        type: 'input',
        name: 'apiEndpoint',
        message: 'Enter API endpoint:',
        default: (answers: any) => answers.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234',
      },
      {
        type: 'confirm',
        name: 'telemetry',
        message: 'Enable telemetry?',
        default: config.telemetryEnabled,
      },
    ]);

    config.provider = answers.provider;
    config.apiKey = undefined;
    config.apiEndpoint = answers.apiEndpoint;
    config.telemetryEnabled = answers.telemetry;
    config.offlineMode = true;

    console.log(chalk.green('\n✓ No internet required for reviews'));

  } else { // static
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'telemetry',
        message: 'Enable telemetry?',
        default: config.telemetryEnabled,
      },
    ]);

    config.provider = 'none';
    config.apiKey = undefined;
    config.apiEndpoint = undefined;
    config.telemetryEnabled = answers.telemetry;
    config.offlineMode = true;

    console.log(chalk.green('\n✓ Static analysis only mode'));
  }
}

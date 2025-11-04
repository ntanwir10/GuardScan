import chalk from 'chalk';
import inquirer from 'inquirer';
import { configManager, AIProvider } from '../core/config';
import { ProviderFactory } from '../providers/factory';

interface ConfigOptions {
  provider?: AIProvider;
  key?: string;
  show?: boolean;
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  try {
    // Show current config
    if (options.show) {
      showConfig();
      return;
    }

    // Direct config via flags
    if (options.provider || options.key) {
      directConfig(options);
      return;
    }

    // Interactive config
    await interactiveConfig();
  } catch (error) {
    console.error(chalk.red('\n✗ Configuration failed:'), error);
    process.exit(1);
  }
}

function showConfig(): void {
  const config = configManager.load();

  console.log(chalk.cyan.bold('\n📋 Current Configuration\n'));
  console.log(chalk.white('Client ID:        ') + chalk.gray(config.clientId));
  console.log(chalk.white('Provider:         ') + chalk.green(config.provider));
  console.log(chalk.white('API Key:          ') + chalk.gray(config.apiKey ? '****' + config.apiKey.slice(-4) : 'Not set'));
  console.log(chalk.white('Telemetry:        ') + (config.telemetryEnabled ? chalk.green('Enabled') : chalk.yellow('Disabled')));
  console.log(chalk.white('Offline Mode:     ') + (config.offlineMode ? chalk.yellow('Yes') : chalk.green('No')));
  console.log(chalk.white('Created:          ') + chalk.gray(new Date(config.createdAt).toLocaleString()));
  console.log(chalk.white('Last Used:        ') + chalk.gray(new Date(config.lastUsed).toLocaleString()));
  console.log();
}

function directConfig(options: ConfigOptions): void {
  const config = configManager.load();

  if (options.provider) {
    config.provider = options.provider;
    console.log(chalk.green(`✓ Provider set to: ${options.provider}`));
  }

  if (options.key) {
    config.apiKey = options.key;
    console.log(chalk.green('✓ API key updated'));
  }

  configManager.save(config);
  console.log();
}

async function interactiveConfig(): Promise<void> {
  console.log(chalk.cyan.bold('\n⚙️  Configure AI Code Review\n'));

  const config = configManager.load();
  const availableProviders = ProviderFactory.getAvailableProviders();

  const answers: any = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Select AI provider:',
      choices: availableProviders.map(p => ({
        name: p === 'ollama' || p === 'lmstudio' ? `${p} (local)` : p,
        value: p,
      })),
      default: config.provider,
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'Enter API key (leave empty to use environment variable):',
      when: (answers: any) => !['ollama', 'lmstudio'].includes(answers.provider),
      default: config.apiKey,
    },
    {
      type: 'input',
      name: 'apiEndpoint',
      message: 'Enter API endpoint:',
      when: (answers: any) => ['ollama', 'lmstudio'].includes(answers.provider),
      default: (answers: any) => answers.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234',
    },
    {
      type: 'confirm',
      name: 'telemetry',
      message: 'Enable telemetry? (anonymized usage data only)',
      default: config.telemetryEnabled,
    },
    {
      type: 'confirm',
      name: 'offlineMode',
      message: 'Enable offline mode? (skip cloud credit validation)',
      default: config.offlineMode,
    },
  ]);

  // Update config
  config.provider = answers.provider;
  if (answers.apiKey) {
    config.apiKey = answers.apiKey;
  }
  if (answers.apiEndpoint) {
    config.apiEndpoint = answers.apiEndpoint;
  }
  config.telemetryEnabled = answers.telemetry;
  config.offlineMode = answers.offlineMode;

  configManager.save(config);

  console.log(chalk.green('\n✓ Configuration saved\n'));

  // Test connection
  console.log(chalk.gray('Testing connection...'));
  try {
    const provider = ProviderFactory.create(config.provider, config.apiKey, config.apiEndpoint);
    const isAvailable = await provider.testConnection();

    if (isAvailable) {
      console.log(chalk.green(`✓ Successfully connected to ${provider.getName()}\n`));
    } else {
      console.log(chalk.yellow(`⚠ Could not connect to ${provider.getName()}`));
      console.log(chalk.gray('Please check your API key and internet connection\n'));
    }
  } catch (error) {
    console.log(chalk.yellow('⚠ Connection test failed'));
    console.log(chalk.gray('You can still proceed, but reviews may fail\n'));
  }
}

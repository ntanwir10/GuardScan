import chalk from 'chalk';
import inquirer from 'inquirer';
import { configManager, AIProvider } from '../core/config';
import { repositoryManager } from '../core/repository';
import { displayWelcomeBanner } from '../utils/ascii-art';
import { ProviderFactory } from '../providers/factory';

type SetupMode = 'cloud' | 'local' | 'static';

export async function initCommand(): Promise<void> {
  // Display welcome banner for first-time users
  if (!configManager.exists()) {
    displayWelcomeBanner();
  } else {
    console.log(chalk.cyan.bold('\n🚀 Initializing GuardScan\n'));
  }

  try {
    // Check if already initialized
    if (configManager.exists()) {
      const config = configManager.load();
      console.log(chalk.yellow('Already initialized!'));
      console.log(chalk.gray(`Client ID: ${config.clientId}`));
      console.log(chalk.gray(`Provider: ${config.provider}`));
      console.log(chalk.gray('\nRun "guardscan config" to modify settings\n'));
      return;
    }

    // Initialize config with defaults
    const config = configManager.init();

    console.log(chalk.green('✓ Configuration initialized'));
    console.log(chalk.gray(`  Config directory: ${configManager.getConfigDir()}`));
    console.log(chalk.gray(`  Client ID: ${config.clientId}`));

    // Detect repository
    try {
      const repoInfo = repositoryManager.getRepoInfo();
      console.log(chalk.green('\n✓ Repository detected'));
      console.log(chalk.gray(`  Name: ${repoInfo.name}`));
      console.log(chalk.gray(`  Type: ${repoInfo.isGit ? 'Git' : 'Standard'}`));
      if (repoInfo.branch) {
        console.log(chalk.gray(`  Branch: ${repoInfo.branch}`));
      }
      console.log(chalk.gray(`  Repo ID: ${repoInfo.repoId}`));
    } catch (error) {
      console.log(chalk.yellow('\n⚠ Could not detect repository'));
    }

    // Interactive setup
    console.log(chalk.cyan.bold('\n📝 Setup GuardScan\n'));

    const setupMode = await selectSetupMode();

    switch (setupMode) {
      case 'cloud':
        await setupCloudAI(config);
        break;
      case 'local':
        await setupLocalAI(config);
        break;
      case 'static':
        await setupStaticOnly(config);
        break;
    }

    // Save config
    configManager.save(config);

    // Show next steps
    console.log(chalk.cyan('\n📝 Next Steps:'));
    if (config.provider === 'none') {
      console.log(chalk.white('  1. Run security scan: ') + chalk.cyan('guardscan security'));
      console.log(chalk.white('  2. Check status: ') + chalk.cyan('guardscan status'));
      console.log(chalk.white('  3. Add AI later: ') + chalk.cyan('guardscan config'));
    } else {
      console.log(chalk.white('  1. Run AI code review: ') + chalk.cyan('guardscan run'));
      console.log(chalk.white('  2. Run security scan: ') + chalk.cyan('guardscan security'));
      console.log(chalk.white('  3. Check status: ') + chalk.cyan('guardscan status'));
    }

    console.log(chalk.gray('\nℹ Privacy Notice:'));
    console.log(chalk.gray('  - Your client_id is stored locally only'));
    console.log(chalk.gray('  - No source code is ever transmitted'));
    console.log(chalk.gray('  - Only anonymized metadata is collected'));
    console.log(chalk.gray('  - Telemetry can be disabled via config\n'));
  } catch (error) {
    console.error(chalk.red('\n✗ Initialization failed:'), error);
    process.exit(1);
  }
}

async function selectSetupMode(): Promise<SetupMode> {
  console.log(chalk.white('How would you like to use GuardScan?\n'));

  const choices = [
    {
      name: chalk.cyan('✨ AI-Enhanced Reviews') +
            chalk.gray('\n   • Best quality code reviews') +
            chalk.gray('\n   • Requires API key (OpenAI, Claude, Gemini)') +
            chalk.gray('\n   • Pay per use\n'),
      value: 'cloud' as SetupMode,
      short: 'AI-Enhanced',
    },
    {
      name: chalk.cyan('🏠 Local AI (Completely Offline)') +
            chalk.gray('\n   • Privacy-focused') +
            chalk.gray('\n   • Uses Ollama or LM Studio') +
            chalk.gray('\n   • Free, runs on your machine\n'),
      value: 'local' as SetupMode,
      short: 'Local AI',
    },
    {
      name: chalk.cyan('🛡️  Static Analysis Only (No AI)') +
            chalk.gray('\n   • Security scanning') +
            chalk.gray('\n   • Code quality checks') +
            chalk.gray('\n   • Always free\n'),
      value: 'static' as SetupMode,
      short: 'Static Only',
    },
  ];

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: 'Select your preferred mode:',
      choices,
      pageSize: 10,
    },
  ]);

  return answer.mode;
}

async function setupCloudAI(config: any): Promise<void> {
  console.log(chalk.cyan.bold('\n✨ Setting up AI-Enhanced Reviews\n'));

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
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter your API key (or press Enter to use environment variable):',
      mask: '*',
    },
    {
      type: 'confirm',
      name: 'telemetry',
      message: 'Enable telemetry? (helps improve GuardScan)',
      default: true,
    },
    {
      type: 'confirm',
      name: 'offlineMode',
      message: 'Enable offline mode? (skip telemetry and monitoring)',
      default: false,
    },
  ]);

  config.provider = answers.provider as AIProvider;
  config.apiKey = answers.apiKey || undefined;
  config.telemetryEnabled = answers.telemetry;
  config.offlineMode = answers.offlineMode;

  console.log(chalk.green('\n✓ Configuration saved'));

  // Test connection if API key provided
  if (answers.apiKey) {
    console.log(chalk.gray('\nTesting connection...'));
    try {
      const provider = ProviderFactory.create(config.provider, config.apiKey);
      const isAvailable = await provider.testConnection();

      if (isAvailable) {
        console.log(chalk.green(`✓ Successfully connected to ${provider.getName()}`));
      } else {
        console.log(chalk.yellow(`⚠ Could not connect to ${provider.getName()}`));
        console.log(chalk.gray('Please check your API key and internet connection'));
      }
    } catch (error) {
      console.log(chalk.yellow('⚠ Connection test failed'));
      console.log(chalk.gray('You can still proceed, but reviews may fail'));
    }
  } else {
    console.log(chalk.gray('\nℹ  Using environment variable for API key'));
    console.log(chalk.gray(`   Set ${getEnvVarName(config.provider)} in your environment`));
  }
}

async function setupLocalAI(config: any): Promise<void> {
  console.log(chalk.cyan.bold('\n🏠 Setting up Local AI\n'));

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
    },
    {
      type: 'input',
      name: 'apiEndpoint',
      message: 'Enter API endpoint:',
      default: (answers: any) =>
        answers.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234',
    },
    {
      type: 'confirm',
      name: 'telemetry',
      message: 'Enable telemetry? (helps improve GuardScan)',
      default: true,
    },
  ]);

  config.provider = answers.provider as AIProvider;
  config.apiEndpoint = answers.apiEndpoint;
  config.telemetryEnabled = answers.telemetry;
  config.offlineMode = true; // Always offline for local AI

  console.log(chalk.green('\n✓ Configuration saved'));
  console.log(chalk.green('✓ No internet required for reviews'));
  console.log(chalk.gray('\nℹ  Make sure your local AI server is running:'));
  console.log(chalk.gray(`   ${answers.apiEndpoint}`));
}

async function setupStaticOnly(config: any): Promise<void> {
  console.log(chalk.cyan.bold('\n🛡️  Setting up Static Analysis\n'));

  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'telemetry',
      message: 'Enable telemetry? (helps improve GuardScan)',
      default: true,
    },
  ]);

  config.provider = 'none' as AIProvider;
  config.telemetryEnabled = answers.telemetry;
  config.offlineMode = true; // Always offline for static only

  console.log(chalk.green('\n✓ Configuration saved'));
  console.log(chalk.green('✓ Static analysis enabled'));
  console.log(chalk.gray('\nℹ  You can add AI later with: guardscan config'));
}

function getEnvVarName(provider: AIProvider): string {
  const envVars: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    claude: 'ANTHROPIC_API_KEY',
    gemini: 'GOOGLE_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  return envVars[provider] || 'API_KEY';
}

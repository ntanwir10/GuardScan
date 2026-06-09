/**
 * models.ts - CLI Commands for Model Management
 * 
 * Commands to list, search, and get information about AI models.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { modelRegistry } from '../providers/model-registry';
import { ModelValidator } from '../providers/model-validator';
import { configManager } from '../core/config';

export function createModelsCommand(): Command {
  const command = new Command('models');
  command.description('Manage AI models');

  // List models
  command
    .command('list')
    .description('List all available models')
    .option('--provider <provider>', 'Filter by provider')
    .option('--tag <tag>', 'Filter by tag')
    .option('--active-only', 'Show only non-deprecated models')
    .action(async (options) => {
      let models = modelRegistry.getAllModels();

      // Apply filters
      if (options.provider) {
        models = models.filter((m) => m.provider === options.provider);
      }

      if (options.tag) {
        models = models.filter((m) => m.tags.includes(options.tag));
      }

      if (options.activeOnly) {
        models = models.filter((m) => !m.deprecated);
      }

      // Sort by provider, then by cost
      models.sort((a, b) => {
        if (a.provider !== b.provider) {
          return a.provider.localeCompare(b.provider);
        }
        const costA = a.inputPricing + a.outputPricing;
        const costB = b.inputPricing + b.outputPricing;
        return costA - costB;
      });

      console.log(chalk.bold('\n📋 Available Models\n'));
      console.log('─'.repeat(100));

      let currentProvider = '';
      for (const model of models) {
        if (model.provider !== currentProvider) {
          currentProvider = model.provider;
          console.log(chalk.cyan.bold(`\n${currentProvider.toUpperCase()}`));
        }

        const deprecated = model.deprecated ? chalk.yellow(' [DEPRECATED]') : '';
        const latest = model.tags.includes('latest') ? chalk.green(' [LATEST]') : '';
        
        console.log(
          `  ${chalk.bold(model.displayName.padEnd(25))} ` +
          `${model.name.padEnd(25)} ` +
          `$${(model.inputPricing + model.outputPricing).toFixed(4).padStart(8)}/1M ` +
          `${model.contextWindow.toLocaleString().padStart(8)} ctx ` +
          `${deprecated}${latest}`
        );
      }

      console.log('\n');
    });

  // Model info
  command
    .command('info <model>')
    .description('Get detailed information about a model')
    .action(async (modelName) => {
      const modelInfo = modelRegistry.getModelInfo(modelName);

      if (!modelInfo) {
        console.error(chalk.red(`❌ Model "${modelName}" not found`));
        
        const suggestions = ModelValidator.getSuggestions(modelName);
        if (suggestions.length > 0) {
          console.log(chalk.yellow('\nDid you mean:'));
          suggestions.forEach((s) => console.log(`  - ${s}`));
        }
        process.exit(1);
      }

      console.log(chalk.bold(`\n📦 ${modelInfo.displayName}\n`));
      console.log('─'.repeat(60));
      console.log(`${chalk.bold('Model ID:')}        ${modelInfo.name}`);
      console.log(`${chalk.bold('Provider:')}        ${modelInfo.provider}`);
      console.log(`${chalk.bold('Version:')}         ${modelInfo.version || 'N/A'}`);
      console.log(`${chalk.bold('Release Date:')}    ${modelInfo.releaseDate}`);
      
      console.log('\n' + chalk.bold('💰 Pricing:'));
      console.log(`  Input:  $${modelInfo.inputPricing.toFixed(6)}/1M tokens`);
      console.log(`  Output: $${modelInfo.outputPricing.toFixed(6)}/1M tokens`);
      
      if (modelInfo.embeddingPricing) {
        console.log(`  Embeddings: $${modelInfo.embeddingPricing.toFixed(6)}/1M tokens`);
      }

      console.log('\n' + chalk.bold('📊 Capabilities:'));
      console.log(`  Context Window: ${modelInfo.contextWindow.toLocaleString()} tokens`);
      console.log(`  Streaming: ${modelInfo.supportsStreaming ? '✅' : '❌'}`);
      console.log(`  Embeddings: ${modelInfo.supportsEmbeddings ? '✅' : '❌'}`);
      
      if (modelInfo.embeddingDimensions) {
        console.log(`  Embedding Dimensions: ${modelInfo.embeddingDimensions}`);
      }

      console.log('\n' + chalk.bold('🏷️  Tags:'));
      console.log(`  ${modelInfo.tags.join(', ')}`);

      if (modelInfo.deprecated) {
        console.log('\n' + chalk.yellow.bold('⚠️  DEPRECATED'));
        if (modelInfo.deprecationDate) {
          console.log(`  Deprecated on: ${modelInfo.deprecationDate}`);
        }
        if (modelInfo.replacedBy) {
          console.log(`  Replaced by: ${modelInfo.replacedBy}`);
        }
      }

      console.log('\n');
    });

  // Search models
  command
    .command('search')
    .description('Search models by name or tag')
    .option('--query <query>', 'Search query')
    .option('--tag <tag>', 'Filter by tag')
    .option('--provider <provider>', 'Filter by provider')
    .action(async (options) => {
      let models = modelRegistry.getAllModels();

      if (options.query) {
        models = modelRegistry.searchModels(options.query);
      }

      if (options.tag) {
        models = models.filter((m) => m.tags.includes(options.tag));
      }

      if (options.provider) {
        models = models.filter((m) => m.provider === options.provider);
      }

      if (models.length === 0) {
        console.log(chalk.yellow('No models found matching your criteria'));
        return;
      }

      console.log(chalk.bold(`\n🔍 Found ${models.length} models\n`));
      console.log('─'.repeat(80));

      for (const model of models) {
        console.log(
          `${chalk.bold(model.displayName)} ` +
          `(${model.name}) - ` +
          `$${(model.inputPricing + model.outputPricing).toFixed(4)}/1M tokens`
        );
      }

      console.log('\n');
    });

  // Compare models
  command
    .command('compare <model1> <model2>')
    .description('Compare two models')
    .action(async (model1, model2) => {
      const comparison = ModelValidator.compareModels(model1, model2);
      console.log(comparison);
    });

  // Recommend model
  command
    .command('recommend')
    .description('Get model recommendation for your provider')
    .option('--priority <priority>', 'Priority: cost, quality, speed, balanced', 'balanced')
    .action(async (options) => {
      const config = configManager.loadOrInit();
      
      if (config.provider === 'none') {
        console.error(chalk.red('❌ No provider configured. Run: guardscan config set provider <provider>'));
        process.exit(1);
      }

      const recommended = ModelValidator.recommendModel(
        config.provider,
        options.priority
      );

      if (!recommended) {
        console.error(chalk.red(`❌ No models found for provider ${config.provider}`));
        process.exit(1);
      }

      console.log(chalk.bold('\n💡 Recommended Model\n'));
      console.log('─'.repeat(60));
      console.log(`${chalk.bold('Model:')} ${recommended.displayName}`);
      console.log(`${chalk.bold('ID:')} ${recommended.name}`);
      console.log(`${chalk.bold('Priority:')} ${options.priority}`);
      console.log(`${chalk.bold('Cost:')} $${(recommended.inputPricing + recommended.outputPricing).toFixed(4)}/1M tokens`);
      console.log(`${chalk.bold('Context:')} ${recommended.contextWindow.toLocaleString()} tokens`);
      console.log(`${chalk.bold('Tags:')} ${recommended.tags.join(', ')}`);
      console.log('\n' + chalk.dim(`Set as default: guardscan config set model ${recommended.name}`));
      console.log('\n');
    });

  return command;
}

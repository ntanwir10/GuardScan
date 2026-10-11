/**
 * routing.ts - CLI Commands for Model Routing Management
 * 
 * Commands to configure task-specific model routing and overrides.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { ModelRouter, TaskType } from '../providers/model-router';
import { configManager } from '../core/config';
import { modelRegistry } from '../providers/model-registry';
import { ModelValidator } from '../providers/model-validator';

export function createRoutingCommand(): Command {
  const command = new Command('routing');
  command.description('Manage model routing for tasks');

  // List routing configuration
  command
    .command('list')
    .description('List routing configuration for all tasks')
    .action(async () => {
      const config = configManager.loadOrInit();

      if (!config.modelRouting?.enabled) {
        console.log(chalk.yellow('\n⚠️  Model routing is disabled'));
        console.log(chalk.dim('Enable it by setting modelRouting.enabled: true in ~/.guardscan/config.yml\n'));
      }

      const router = new ModelRouter(config);
      const routes = router.listAllRoutings();

      console.log(chalk.bold('\n📍 Model Routing Configuration\n'));
      console.log('─'.repeat(100));
      console.log(
        chalk.bold('Task'.padEnd(20)) +
        chalk.bold('Model Override'.padEnd(25)) +
        chalk.bold('Priority Override'.padEnd(20)) +
        chalk.bold('Selected Model'.padEnd(20)) +
        chalk.bold('Status')
      );
      console.log('─'.repeat(100));

      for (const [task, selection] of Object.entries(routes)) {
        if ('error' in selection) {
          console.log(
            `${task.padEnd(20)} ` +
            chalk.red(`Error: ${(selection as any).error}`)
          );
          continue;
        }

        const routing = router.getTaskRouting(task as TaskType);
        const override = routing.override;

        const modelOverride = override?.model || '-';
        const priorityOverride = override?.priority || '-';
        const selectedModel = selection.modelId;
        const status = selection.isOverride
          ? chalk.green('✓ Override')
          : chalk.dim('✓ Auto');

        console.log(
          `${task.padEnd(20)} ` +
          `${modelOverride.padEnd(25)} ` +
          `${priorityOverride.padEnd(20)} ` +
          `${selectedModel.padEnd(20)} ` +
          `${status}`
        );
      }

      console.log('\n');
    });

  // Set routing for a task
  command
    .command('set <task>')
    .description('Set routing for a specific task')
    .option('--model <model>', 'Override model for this task')
    .option('--priority <priority>', 'Override priority (cost, quality, speed, balanced)')
    .action(async (task, options) => {
      const config = configManager.loadOrInit();

      // Validate task type
      const validTasks = ModelRouter.getTaskTypes();
      if (!validTasks.includes(task as TaskType)) {
        console.error(
          chalk.red(`❌ Invalid task "${task}". Valid tasks: ${validTasks.join(', ')}`)
        );
        process.exit(1);
      }

      // Validate at least one option provided
      if (!options.model && !options.priority) {
        console.error(chalk.red('❌ Must specify --model or --priority'));
        process.exit(1);
      }

      // Initialize modelRouting if not exists
      if (!config.modelRouting) {
        config.modelRouting = {
          enabled: true,
          strategy: 'balanced',
          taskOverrides: {},
        };
      }

      if (!config.modelRouting.taskOverrides) {
        config.modelRouting.taskOverrides = {};
      }

      // Build override
      const override: any = config.modelRouting.taskOverrides[task as keyof typeof config.modelRouting.taskOverrides] || {};

      if (options.model) {
        // Validate model exists
        const modelInfo = modelRegistry.getModelInfo(options.model);
        if (!modelInfo) {
          console.error(chalk.red(`❌ Model "${options.model}" not found in registry`));
          
          const suggestions = ModelValidator.getSuggestions(options.model);
          if (suggestions.length > 0) {
            console.log(chalk.yellow('\nDid you mean:'));
            suggestions.forEach((s: string) => console.log(`  - ${s}`));
          }
          process.exit(1);
        }

        // Validate model belongs to current provider
        if (modelInfo.provider !== config.provider) {
          console.error(
            chalk.red(
              `❌ Model "${options.model}" belongs to provider "${modelInfo.provider}", ` +
              `but your current provider is "${config.provider}"`
            )
          );
          process.exit(1);
        }

        override.model = options.model;
      }

      if (options.priority) {
        const validPriorities = ['cost', 'quality', 'speed', 'balanced'];
        if (!validPriorities.includes(options.priority)) {
          console.error(
            chalk.red(`❌ Invalid priority "${options.priority}". Valid: ${validPriorities.join(', ')}`)
          );
          process.exit(1);
        }

        override.priority = options.priority;
      }

      // Update config
      (config.modelRouting.taskOverrides as any)[task] = override;
      configManager.save(config);

      console.log(chalk.green(`\n✅ Routing updated for task: ${task}`));
      if (options.model) {
        console.log(chalk.dim(`   Model: ${options.model}`));
      }
      if (options.priority) {
        console.log(chalk.dim(`   Priority: ${options.priority}`));
      }
      console.log('\n');
    });

  // Test routing
  command
    .command('test <task>')
    .description('Test routing for a specific task (dry run)')
    .action(async (task) => {
      const validTasks = ModelRouter.getTaskTypes();
      if (!validTasks.includes(task as TaskType)) {
        console.error(
          chalk.red(`❌ Invalid task "${task}". Valid tasks: ${validTasks.join(', ')}`)
        );
        process.exit(1);
      }

      const config = configManager.loadOrInit();
      const router = new ModelRouter(config);

      try {
        const selection = router.testRouting(task as TaskType);

        console.log(chalk.bold('\n🧪 Routing Test\n'));
        console.log('─'.repeat(60));
        console.log(`${chalk.bold('Task:')} ${task}`);
        console.log(`${chalk.bold('Selected Model:')} ${selection.modelId}`);
        console.log(`${chalk.bold('Provider:')} ${selection.provider}`);
        console.log(`${chalk.bold('Type:')} ${selection.isOverride ? 'User Override' : 'Automatic Selection'}`);
        console.log(`${chalk.bold('Estimated Cost:')} $${selection.estimatedCost.toFixed(6)}/1M input tokens`);
        console.log(`${chalk.bold('Rationale:')} ${selection.rationale}`);

        const modelInfo = modelRegistry.getModelInfo(selection.modelId);
        if (modelInfo) {
          console.log(`${chalk.bold('Context Window:')} ${modelInfo.contextWindow.toLocaleString()} tokens`);
          console.log(`${chalk.bold('Supports Streaming:')} ${modelInfo.supportsStreaming ? '✅' : '❌'}`);
        }

        console.log('\n');
      } catch (error: any) {
        console.error(chalk.red(`❌ Routing test failed: ${error.message}`));
        process.exit(1);
      }
    });

  // Clear routing override
  command
    .command('clear [task]')
    .description('Clear routing override for a task (or all with --all)')
    .option('--all', 'Clear all overrides')
    .action(async (task, options) => {
      const config = configManager.loadOrInit();

      if (!config.modelRouting?.taskOverrides) {
        console.log(chalk.yellow('⚠️  No routing overrides configured'));
        return;
      }

      if (options.all) {
        config.modelRouting.taskOverrides = {};
        configManager.save(config);
        console.log(chalk.green('✅ All routing overrides cleared\n'));
        return;
      }

      if (!task) {
        console.error(chalk.red('❌ Must specify task or use --all'));
        process.exit(1);
      }

      const validTasks = ModelRouter.getTaskTypes();
      if (!validTasks.includes(task as TaskType)) {
        console.error(
          chalk.red(`❌ Invalid task "${task}". Valid tasks: ${validTasks.join(', ')}`)
        );
        process.exit(1);
      }

      delete (config.modelRouting.taskOverrides as any)[task];
      configManager.save(config);

      console.log(chalk.green(`✅ Routing override cleared for: ${task}\n`));
    });

  return command;
}

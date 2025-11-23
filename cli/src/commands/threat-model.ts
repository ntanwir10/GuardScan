/**
 * threat-model.ts - CLI Command for Threat Modeling
 *
 * Generates comprehensive STRIDE-based threat models with:
 * - Asset identification
 * - Data flow mapping
 * - STRIDE threat analysis
 * - Threat diagrams
 * - Security recommendations
 *
 * Phase 5, Feature 2
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { ThreatModelingEngine, ThreatModelOptions, STRIDECategory } from '../features/threat-modeling';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';
import { repositoryManager } from '../core/repository';
import { ProviderFactory } from '../providers/factory';
import { ConfigManager } from '../core/config';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('threat-model');
const perfTracker = createPerformanceTracker('guardscan threat-model');

interface ThreatModelCommandOptions {
  file?: string;
  category?: STRIDECategory;
  flows?: boolean;
  diagram?: boolean;
  focus?: 'authentication' | 'data-protection' | 'api-security' | 'all';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  output?: string;
  report?: boolean;
}

/**
 * Main threat model command
 */
export async function threatModelCommand(options: ThreatModelCommandOptions): Promise<void> {
  logger.debug('Threat model command started', { options });
  perfTracker.start('threat-model-total');
  
  const spinner = ora('Initializing threat modeling...').start();

  try {
    // Load configuration
    perfTracker.start('load-config');
    const configManager = new ConfigManager();
    const config = configManager.loadOrInit();
    perfTracker.end('load-config');
    logger.debug('Config loaded', { provider: config.provider });

    // Check AI provider
    if (!config.provider || config.provider === 'none' || !config.apiKey) {
      spinner.fail('No AI provider configured');
      console.log(chalk.yellow('\nRun `guardscan config` to set up an AI provider.'));
      return;
    }

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    if (!repoInfo.isGit) {
      spinner.warn('Not a git repository (continuing anyway)');
    } else {
      spinner.succeed(`Repository: ${repoInfo.path}`);
    }

    // Initialize components
    const provider = ProviderFactory.create(config.provider, config.apiKey, config.apiEndpoint);
    const indexer = new CodebaseIndexer(repoInfo.path, repoInfo.repoId);
    const cache = new AICache(repoInfo.repoId);
    const engine = new ThreatModelingEngine(provider, indexer, cache, repoInfo.path);

    spinner.text = 'Generating threat model...';

    // Build threat model options
    const threatOptions: ThreatModelOptions = {
      targetPath: options.file,
      includeDataFlows: options.flows !== false,
      includeDiagrams: options.diagram || false,
      focusArea: options.focus || 'all',
      minimumSeverity: options.severity
    };

    // Generate threat model
    const report = await engine.generateThreatModel(threatOptions);
    spinner.succeed('Threat model generated');

    // Display results
    if (options.report) {
      await generateFullReport(report, options.output);
    } else if (options.category) {
      displayCategoryThreats(report, options.category);
    } else {
      displaySummary(report);
    }

  } catch (error: any) {
    spinner.fail('Threat modeling failed');
    handleCommandError(error, 'Threat modeling');
  }
}

/**
 * Generate full threat model report
 */
async function generateFullReport(
  report: any,
  outputPath?: string
): Promise<void> {
  let markdown = '# Threat Model Report\n\n';
  markdown += `**Generated:** ${report.generatedAt.toISOString()}\n\n`;

  // Summary
  markdown += '## Executive Summary\n\n';
  markdown += `- **Total Assets:** ${report.summary.totalAssets}\n`;
  markdown += `- **Total Threats:** ${report.summary.totalThreats}\n`;
  markdown += `- **Critical Threats:** ${report.summary.criticalThreats}\n`;
  markdown += `- **High Threats:** ${report.summary.highThreats}\n`;
  markdown += `- **Trust Boundaries:** ${report.summary.trustBoundaries}\n`;
  markdown += `- **Data Flows:** ${report.summary.dataFlows}\n\n`;

  // Assets
  markdown += '## Security Assets\n\n';
  markdown += '| Asset | Type | Sensitivity | Location |\n';
  markdown += '|-------|------|-------------|----------|\n';
  for (const asset of report.assets) {
    markdown += `| ${asset.name} | ${asset.type} | ${asset.sensitivity} | ${asset.location.file} |\n`;
  }
  markdown += '\n';

  // Threats by Severity
  markdown += '## Threats\n\n';

  const criticalThreats = report.threats.filter((t: any) => t.severity === 'critical');
  if (criticalThreats.length > 0) {
    markdown += '### Critical Threats\n\n';
    for (const threat of criticalThreats) {
      markdown += `#### ${threat.title}\n\n`;
      markdown += `**Category:** ${threat.category}\n\n`;
      markdown += `**Description:** ${threat.description}\n\n`;
      markdown += `**Attack Vector:** ${threat.attackVector}\n\n`;
      markdown += `**Impact:** ${threat.impact}\n\n`;
      markdown += `**Likelihood:** ${threat.likelihood}\n\n`;
      markdown += `**Risk Score:** ${threat.riskScore}\n\n`;

      if (threat.mitigations.length > 0) {
        markdown += '**Mitigations:**\n\n';
        for (const mitigation of threat.mitigations) {
          markdown += `- **${mitigation.strategy}**: ${mitigation.description} (Effort: ${mitigation.effort}, Effectiveness: ${mitigation.effectiveness})\n`;
        }
        markdown += '\n';
      }
    }
  }

  const highThreats = report.threats.filter((t: any) => t.severity === 'high');
  if (highThreats.length > 0) {
    markdown += '### High Threats\n\n';
    for (const threat of highThreats) {
      markdown += `#### ${threat.title}\n\n`;
      markdown += `- **Category:** ${threat.category}\n`;
      markdown += `- **Description:** ${threat.description}\n`;
      markdown += `- **Attack Vector:** ${threat.attackVector}\n`;
      markdown += `- **Impact:** ${threat.impact}\n`;
      markdown += `- **Likelihood:** ${threat.likelihood}\n\n`;
    }
  }

  // Data Flows
  if (report.dataFlows.length > 0) {
    markdown += '## Data Flows\n\n';
    markdown += '| Source | Destination | Data Types | Encrypted | Authenticated |\n';
    markdown += '|--------|-------------|------------|-----------|---------------|\n';
    for (const flow of report.dataFlows) {
      markdown += `| ${flow.source} | ${flow.destination} | ${flow.dataTypes.join(', ')} | ${flow.encryption ? '✅' : '❌'} | ${flow.authentication ? '✅' : '❌'} |\n`;
    }
    markdown += '\n';
  }

  // Trust Boundaries
  if (report.trustBoundaries.length > 0) {
    markdown += '## Trust Boundaries\n\n';
    for (const boundary of report.trustBoundaries) {
      markdown += `### ${boundary.name}\n\n`;
      markdown += `${boundary.description}\n\n`;
      markdown += `**Control Mechanisms:** ${boundary.controlMechanisms.join(', ')}\n\n`;
    }
  }

  // Diagram
  if (report.diagram) {
    markdown += '## Threat Model Diagram\n\n';
    markdown += report.diagram + '\n\n';
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    markdown += '## Recommendations\n\n';
    for (const rec of report.recommendations) {
      markdown += `- ${rec}\n`;
    }
    markdown += '\n';
  }

  // Save or display
  if (outputPath) {
    fs.writeFileSync(outputPath, markdown);
    console.log(chalk.green(`\n✓ Report saved to: ${outputPath}`));
  } else {
    console.log('\n' + markdown);
  }
}

/**
 * Display threats for specific STRIDE category
 */
function displayCategoryThreats(report: any, category: STRIDECategory): void {
  const categoryThreats = report.threats.filter((t: any) => t.category === category);

  console.log(chalk.blue(`\n${category.toUpperCase()} Threats\n`));
  console.log(`Found ${categoryThreats.length} threat(s)\n`);

  for (const threat of categoryThreats) {
    const severityColor = getSeverityColor(threat.severity);
    console.log(severityColor(`[${threat.severity.toUpperCase()}] ${threat.title}`));
    console.log(`  ${threat.description}`);
    console.log(`  Attack Vector: ${threat.attackVector}`);
    console.log(`  Impact: ${threat.impact}`);
    console.log(`  Risk Score: ${threat.riskScore}`);

    if (threat.mitigations.length > 0) {
      console.log(`  Mitigations:`);
      for (const mitigation of threat.mitigations) {
        console.log(`    - ${mitigation.strategy}: ${mitigation.description}`);
      }
    }
    console.log('');
  }
}

/**
 * Display summary of threat model
 */
function displaySummary(report: any): void {
  console.log(chalk.blue('\n=== Threat Model Summary ===\n'));

  // Summary stats
  console.log(chalk.green('Assets:'), report.summary.totalAssets);
  console.log(chalk.green('Data Flows:'), report.summary.dataFlows);
  console.log(chalk.green('Trust Boundaries:'), report.summary.trustBoundaries);
  console.log(chalk.green('Total Threats:'), report.summary.totalThreats);
  console.log(chalk.red('  Critical:'), report.summary.criticalThreats);
  console.log(chalk.yellow('  High:'), report.summary.highThreats);

  // Top threats
  console.log(chalk.blue('\n=== Top Threats ===\n'));

  const topThreats = report.threats
    .sort((a: any, b: any) => b.riskScore - a.riskScore)
    .slice(0, 5);

  for (const threat of topThreats) {
    const severityColor = getSeverityColor(threat.severity);
    console.log(severityColor(`[${threat.severity.toUpperCase()}] ${threat.title}`));
    console.log(`  Category: ${threat.category}`);
    console.log(`  Risk Score: ${threat.riskScore}`);
    console.log(`  Affected Assets: ${threat.affectedAssets.length > 0 ? threat.affectedAssets.join(', ') : 'Multiple'}`);
    console.log('');
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log(chalk.blue('=== Recommendations ===\n'));
    for (const rec of report.recommendations) {
      console.log(`  ${rec}`);
    }
    console.log('');
  }

  // Next steps
  console.log(chalk.gray('\nRun with --report to generate full report'));
  console.log(chalk.gray('Run with --diagram to include threat model diagram'));
}

/**
 * Get color for severity level
 */
function getSeverityColor(severity: string): (text: string) => string {
  switch (severity) {
    case 'critical':
      return chalk.red.bold;
    case 'high':
      return chalk.red;
    case 'medium':
      return chalk.yellow;
    case 'low':
      return chalk.gray;
    default:
      return chalk.white;
  }
}

import chalk from 'chalk';
import { configManager } from '../core/config';
import { repositoryManager } from '../core/repository';
import { ProviderFactory } from '../providers/factory';
import { DocsGenerator, DocumentationType, DocumentationOptions } from '../features/docs-generator';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';

interface DocsCommandOptions {
  type?: string;
  output?: string;
  diagrams?: boolean;
  examples?: boolean;
  audience?: string;
}

export async function docsCommand(options: DocsCommandOptions): Promise<void> {
  try {
    // Load config
    const config = configManager.loadOrInit();

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    const repoRoot = repoInfo.path;

    console.log(chalk.blue('📚 Generating documentation with AI...'));

    // Check if AI provider is configured
    if (!config.provider || !config.apiKey) {
      console.log(chalk.yellow('\n⚠ AI provider not configured. Run `guardscan config` to set up.'));
      return;
    }

    // Validate documentation type
    const docType = (options.type?.toLowerCase() || 'readme') as DocumentationType;
    const validTypes: DocumentationType[] = ['readme', 'api', 'architecture', 'contributing', 'changelog'];

    if (!validTypes.includes(docType)) {
      console.error(chalk.red(`\n✗ Invalid type. Must be one of: ${validTypes.join(', ')}`));
      process.exit(1);
    }

    // Validate target audience
    const validAudiences = ['developer', 'user', 'contributor'];
    const audience = options.audience?.toLowerCase() || 'user';
    if (!validAudiences.includes(audience)) {
      console.error(chalk.red(`\n✗ Invalid audience. Must be one of: ${validAudiences.join(', ')}`));
      process.exit(1);
    }

    // Create AI provider
    const provider = ProviderFactory.create(config.provider, config.apiKey, config.apiEndpoint);

    // Create AI cache
    const cache = new AICache(repoInfo.repoId, 100); // 100MB cache

    // Create indexer
    const indexer = new CodebaseIndexer(repoRoot, repoInfo.repoId);

    // Create documentation generator
    const docsGen = new DocsGenerator(provider, indexer, cache, repoRoot);

    // Prepare generation options
    const genOptions: DocumentationOptions = {
      type: docType,
      includeExamples: options.examples !== false,
      includeDiagrams: options.diagrams !== false,
      targetAudience: audience as 'developer' | 'user' | 'contributor',
      outputPath: options.output,
    };

    // Generate documentation based on type
    let result;

    try {
      console.log(chalk.blue(`\nGenerating ${docType} documentation...`));

      switch (docType) {
        case 'readme':
          result = await docsGen.generateReadme(genOptions);
          break;
        case 'api':
          result = await docsGen.generateAPIDocs(genOptions);
          break;
        case 'architecture':
          result = await docsGen.generateArchitectureDocs(genOptions);
          break;
        case 'contributing':
          result = await docsGen.generateContributingGuide(genOptions);
          break;
        case 'changelog':
          console.error(chalk.yellow('\n⚠ Changelog generation not yet implemented'));
          return;
        default:
          console.error(chalk.red(`\n✗ Unsupported documentation type: ${docType}`));
          process.exit(1);
      }
    } catch (error: any) {
      console.error(chalk.red(`\n✗ Failed to generate ${docType} documentation:`, error.message));
      process.exit(1);
    }

    if (!result) {
      console.error(chalk.red('\n✗ No documentation generated'));
      process.exit(1);
    }

    // Display results
    console.log(chalk.green('\n✓ Documentation generation complete!\n'));
    console.log(chalk.white.bold('📝 Generated Documentation Details:\n'));
    console.log(chalk.cyan('─'.repeat(60)));
    console.log(chalk.gray(`Type: ${result.type}`));
    console.log(chalk.gray(`Target Audience: ${result.metadata.targetAudience}`));
    console.log(chalk.gray(`Files Analyzed: ${result.metadata.filesAnalyzed}`));
    console.log(chalk.gray(`Sections: ${result.metadata.sectionsIncluded.join(', ')}`));

    if (result.diagrams && result.diagrams.length > 0) {
      console.log(chalk.gray(`Diagrams: ${result.diagrams.length} (${result.diagrams.map(d => d.type).join(', ')})`));
    }

    console.log(chalk.cyan('─'.repeat(60)));

    // Show preview
    console.log(chalk.white.bold('\n📄 Documentation Preview:\n'));
    const lines = result.content.split('\n').slice(0, 30);
    lines.forEach((line, i) => {
      // Syntax highlighting for headers
      if (line.startsWith('#')) {
        console.log(chalk.white.bold(line));
      } else if (line.startsWith('```')) {
        console.log(chalk.gray(line));
      } else {
        console.log(chalk.white(line));
      }
    });

    if (result.content.split('\n').length > 30) {
      console.log(chalk.gray(`\n... (${result.content.split('\n').length - 30} more lines)`));
    }

    // Save to file
    const outputPath = await docsGen.saveDocs(result, options.output);
    console.log(chalk.green(`\n✓ Documentation saved to: ${outputPath}`));

    if (result.diagrams && result.diagrams.length > 0) {
      console.log(chalk.green(`✓ Diagrams saved to: ${outputPath.replace(/[^/]+$/, 'diagrams/')}`));
    }

    // Show next steps
    console.log(chalk.white.bold('\n📋 Next Steps:\n'));
    console.log(chalk.gray('1. Review the generated documentation'));
    console.log(chalk.gray('2. Customize sections as needed'));
    console.log(chalk.gray('3. Add project-specific details'));

    if (docType === 'readme') {
      console.log(chalk.gray('4. Consider generating API docs: guardscan docs --type api'));
      console.log(chalk.gray('5. Add architecture docs: guardscan docs --type architecture'));
    }

    console.log();

  } catch (error) {
    console.error(chalk.red('\n✗ Failed to generate documentation:'), error);
    process.exit(1);
  }
}

import { Command } from 'commander';
import { collectRuntimeCapabilities } from '../utils/runtime-capabilities';

export function createCapabilitiesCommand(): Command {
  return new Command('capabilities')
    .description('Inspect optional runtime capabilities and safe fallback modes')
    .option('--json', 'Emit compact machine-readable JSON')
    .action(async (options: {json?: boolean}) => {
      const evidence = await collectRuntimeCapabilities();
      process.stdout.write(`${JSON.stringify(evidence, null, options.json ? undefined : 2)}\n`);
    });
}

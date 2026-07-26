import { Command } from "commander";
import chalk from "chalk";
import { configManager } from "../core/config";
import { createTelemetryManager } from "../core/telemetry";

export function createTelemetryCommand(): Command {
  const command = new Command("telemetry").description(
    "Inspect and explicitly synchronize opt-in telemetry"
  );

  command
    .command("status")
    .description("Show telemetry consent, suppression, endpoint, and outbox status")
    .action(() => {
      const stats = createTelemetryManager(configManager.loadOrInit()).getStats();
      console.log(chalk.bold("\nTelemetry status\n"));
      console.log(`  Consent: ${stats.enabled ? "enabled" : "disabled"}`);
      console.log(`  Delivery: ${stats.suppressed ? "suppressed" : "available"}`);
      console.log(`  Endpoint: ${stats.endpointConfigured ? "configured" : "not configured"}`);
      console.log(`  Pending events: ${stats.pending}`);
      if (stats.oldestEventAt) console.log(`  Oldest event: ${stats.oldestEventAt}`);
      if (stats.lastSyncAt) console.log(`  Last sync: ${stats.lastSyncAt}`);
      console.log();
    });

  command
    .command("sync")
    .description("Explicitly send the oldest pending telemetry batch")
    .action(async () => {
      try {
        const result = await createTelemetryManager(configManager.loadOrInit()).sync();
        console.log(
          chalk.green(`Sent ${result.sent} event(s); ${result.remaining} remain.`)
        );
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  command
    .command("clear")
    .description("Delete all locally queued telemetry events")
    .option("--force", "Confirm deletion")
    .action((options: { force?: boolean }) => {
      if (!options.force) {
        console.log(chalk.yellow("Use --force to confirm telemetry outbox deletion."));
        return;
      }
      const cleared = createTelemetryManager(configManager.loadOrInit()).clear();
      console.log(chalk.green(`Cleared ${cleared} queued event(s).`));
    });

  return command;
}

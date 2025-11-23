import chalk from "chalk";
import inquirer from "inquirer";
import { configManager } from "../core/config";
import { displaySimpleBanner } from "../utils/ascii-art";
import { createDebugLogger } from "../utils/debug-logger";
import { createPerformanceTracker } from "../utils/performance-tracker";
import { handleCommandError } from "../utils/error-handler";

const logger = createDebugLogger("reset");
const perfTracker = createPerformanceTracker("guardscan reset");

interface ResetOptions {
  all?: boolean;
  force?: boolean;
}

export async function resetCommand(options: ResetOptions): Promise<void> {
  logger.debug("Reset command started", { options });
  perfTracker.start("reset-total");

  displaySimpleBanner("reset");

  try {
    if (options.all) {
      logger.debug("Full reset requested", { force: options.force });
      // Confirm full reset unless --force is used
      if (!options.force) {
        const answer = await inquirer.prompt([
          {
            type: "confirm",
            name: "confirm",
            message: chalk.yellow(
              "This will delete ALL configuration including your client_id. Continue?"
            ),
            default: false,
          },
        ]);

        if (!answer.confirm) {
          console.log(chalk.gray("Reset cancelled\n"));
          return;
        }
      }

      configManager.reset(true);
      console.log(chalk.green("✓ Full reset completed"));
      console.log(chalk.gray("  All configuration and cache deleted"));
      console.log(chalk.gray('  Run "guardscan init" to start fresh\n'));
    } else {
      // Partial reset (cache only)
      configManager.reset(false);
      console.log(chalk.green("✓ Cache cleared"));
      console.log(chalk.gray("  Configuration preserved\n"));
    }
  } catch (error) {
    handleCommandError(error, "Reset");
  }
}

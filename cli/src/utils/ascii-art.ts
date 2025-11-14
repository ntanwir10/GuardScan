import chalk from 'chalk';

/**
 * GuardScan ASCII Art Logo
 */
export const GUARDSCAN_LOGO = `  ___    _____ _    _   ___  ___  ___    ___  ___   ___   _  _      ___  _    ___
 / __|  / __| | |  | | / _ \\| _ \\|   \\  / __|/ __| / _ \\ | \\| |    / __|| |  |_ _|
| (_ | | (_ | | |__| || |_| | _ /| |) | \\__ \\ (__| |_| || .  |   | (__ | |__ | |
 \\___/  \\___| |____|_| \\__/_|_| \\_|___/  |___/\\___|\\__/_|_|\\_|    \\___||____|___|`;

/**
 * GuardScan Shield ASCII Art (Alternative)
 */
export const GUARDSCAN_SHIELD = `  ___    GUARD SCAN - CLI
 / __|   Privacy-First Security
| (_ |
 \\___/`;

/**
 * Display GuardScan logo with optional tagline
 */
export function displayLogo(tagline?: string): void {
  console.log(chalk.cyan(GUARDSCAN_LOGO));
  if (tagline) {
    console.log(chalk.gray(`  ${tagline}\n`));
  }
}

/**
 * Display GuardScan shield banner
 */
export function displayShield(): void {
  console.log(chalk.cyan.bold(GUARDSCAN_SHIELD));
}

/**
 * Display compact version badge
 */
export function displayVersionBadge(version: string): void {
  console.log(chalk.cyan(`
  ╭────────────────────────────────╮
  │  GuardScan v${version.padEnd(20)} │
  ╰────────────────────────────────╯
`));
}

/**
 * Display welcome banner for first-time users
 */
export function displayWelcomeBanner(): void {
  console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ██████╗ ██╗   ██╗ █████╗ ██████╗ ██████╗ ███████╗ ██████╗ ║
║  ██╔════╝ ██║   ██║██╔══██╗██╔══██╗██╔══██╗██╔════╝██╔════╝ ║
║  ██║  ███╗██║   ██║███████║██████╔╝██║  ██║███████╗██║      ║
║  ██║   ██║██║   ██║██╔══██║██╔══██╗██║  ██║╚════██║██║      ║
║  ╚██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝███████║╚██████╗ ║
║   ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝ ╚═════╝ ║
║                                                    ███╗   ██╗ ║
║                                                    ████╗  ██║ ║
║                                                    ██╔██╗ ██║ ║
║                                                    ██║╚██╗██║ ║
║                                                    ██║ ╚████║ ║
║                                                    ╚═╝  ╚═══╝ ║
║                                                              ║
║              Privacy-First AI Code Review & Security         ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`));
  console.log(chalk.gray('           🛡️  Comprehensive Security Scanning\n'));
  console.log(chalk.gray('           🤖  AI-Enhanced Code Review (Optional)\n'));
  console.log(chalk.gray('           🔒  Your Code Stays Local & Private\n'));
}

/**
 * Display simple banner for commands
 */
export function displaySimpleBanner(command: string): void {
  const banners = {
    init: '🚀 Initializing GuardScan',
    run: '🔍 GuardScan Code Review',
    security: '🛡️  GuardScan Security Scan',
    status: '📊 GuardScan Status',
    config: '⚙️  Configure GuardScan',
    reset: '🔄 Reset GuardScan',
    test: '🧪 GuardScan Test Analysis',
    perf: '⚡ GuardScan Performance Test',
    mutation: '🧬 GuardScan Mutation Test',
    rules: '📋 GuardScan Custom Rules',
    sbom: '📦 GuardScan SBOM Generator',
  };

  const banner = banners[command as keyof typeof banners] || `GuardScan - ${command}`;
  console.log(chalk.cyan.bold(`\n${banner}\n`));
}

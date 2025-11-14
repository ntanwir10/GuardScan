import chalk from 'chalk';

/**
 * GuardScan ASCII Art Logo
 * GUARD SCAN - CLI text in ASCII block letters
 */
export const GUARDSCAN_LOGO = `
  ____ _   _   _    ____  ____    ____   ____    _    _   _            ____ _     ___ 
 / ___| | | | / \\  |  _ \\|  _ \\  / ___| / ___|  / \\  | \\ | |          / ___| |   |_ _|
| |  _| | | |/ _ \\ | |_) | | | | \\___ \\| |     / _ \\ |  \\| |  _____  | |   | |    | | 
| |_| | |_| / ___ \\|  _ <| |_| |  ___) | |___ / ___ \\| |\\  | |_____| | |___| |___ | | 
 \\____|\\___/_/   \\_\\_| \\_\\____/  |____/ \\____/_/   \\_\\_| \\_|          \\____|_____|___|
`;

/**
 * GuardScan Shield ASCII Art (Alternative)
 */
export const GUARDSCAN_SHIELD = `🛡️  GUARD SCAN - CLI
   Privacy-First Security`;

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
╔════════════════════════════════════════════════════════════            ══╗
║                                                                          ║
║   ██████╗ ██╗   ██╗ █████╗ ██████╗ ██████╗ ███████╗ ██████╗               ║
║  ██╔════╝ ██║   ██║██╔══██╗██╔══██╗██╔══██╗██╔════╝██╔════╝              ║
║  ██║  ███╗██║   ██║███████║██████╔╝██║  ██║███████╗██║                   ║
║  ██║   ██║██║   ██║██╔══██║██╔══██╗██║  ██║╚════██║██║                   ║
║  ╚██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝███████║╚██████╗              ║
║   ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝ ╚═════╝              ║
║                                                    ███╗   ██╗             ║
║                                                    ████╗  ██║             ║
║                                                    ██╔██╗ ██║             ║
║                                                    ██║╚██╗██║             ║
║                                                    ██║ ╚████║             ║
║                                                    ╚═╝  ╚═══╝             ║
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

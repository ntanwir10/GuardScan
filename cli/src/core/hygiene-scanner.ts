import * as fs from 'fs';
import * as path from 'path';
import { Finding } from '../utils/reporter';
import { collectPackageInventory, PackageInventory } from './package-inventory';
import { MAX_SECRET_FILE_BYTES, secretsDetector } from './secrets-detector';

/**
 * Hygiene checks for payment code, AI agent configuration and instruction files,
 * and malware or obfuscation markers. These are static review aids: they do not
 * protect against prompt injection or prove that code is safe. Only the three
 * high-confidence families (decoded-payload eval, reverse shell, download piped
 * to a shell in an agent config) use `high`; everything else stays at `medium`
 * or below so it cannot fail `--ci` (threshold `high`) by default.
 *
 * Every pattern is linear time: a literal anchor is found first, then a bounded
 * window around it is checked. No pattern has an unbounded quantifier that can
 * overlap with a neighbour, and hits are capped per rule per file.
 */

export type HygieneKind = 'code' | 'config' | 'agent-config' | 'instructions' | 'package-json';

export interface HygieneContext {
  /** A payment SDK is a declared dependency of this repository. */
  paymentSdk: boolean;
}

const MAX_HITS_PER_RULE = 25;
const PAYMENT_PACKAGE = /(?<![a-z0-9])(?:stripe|braintree|paypal|adyen)(?![a-z0-9])/i;

const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.py', '.rb', '.php', '.go', '.java', '.kt',
  '.cs', '.rs', '.sh', '.bash', '.zsh', '.ps1', '.pl', '.lua',
]);
const CONFIG_EXTENSIONS = new Set(['.json', '.yml', '.yaml', '.toml', '.conf', '.cfg', '.ini']);
const AGENT_CONFIG_NAMES = new Set([
  '.mcp.json', 'mcp.json', 'mcp_config.json', 'claude_desktop_config.json', 'mcp-config.json',
]);
const INSTRUCTION_NAMES = new Set([
  'claude.md', 'agents.md', 'gemini.md', '.cursorrules', '.windsurfrules', 'skill.md', 'copilot-instructions.md',
]);
const LOCKFILE_NAMES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'poetry.lock',
]);

/** Classify a repository-relative POSIX path, or undefined when no check applies. */
export function hygieneKindFor(relativePath: string): HygieneKind | undefined {
  const lower = relativePath.toLowerCase();
  const base = path.posix.basename(lower);
  if (LOCKFILE_NAMES.has(base)) {return undefined;}
  if (
    AGENT_CONFIG_NAMES.has(base) ||
    lower.endsWith('.cursor/mcp.json') || lower.endsWith('.vscode/mcp.json') ||
    /(?:^|\/)\.(?:claude|gemini)\/settings(?:\.local)?\.json$/.test(lower)
  ) {return 'agent-config';}
  if (
    INSTRUCTION_NAMES.has(base) || /(?:^|\/)\.cursor\/rules\/[^/]+\.mdc$/.test(lower) ||
    /(?:^|\/)\.claude\/(?:agents|commands|skills)\/.+\.md$/.test(lower)
  ) {return 'instructions';}
  if (base === 'package.json') {return 'package-json';}
  const ext = path.posix.extname(lower);
  if (CODE_EXTENSIONS.has(ext) || base === 'dockerfile' || base.startsWith('dockerfile.')) {return 'code';}
  if (CONFIG_EXTENSIONS.has(ext)) {return 'config';}
  return undefined;
}

function isTestPath(relativePath: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?|spec|fixtures?|__mocks__)\/|\.(?:test|spec)\.[a-z]+$/i.test(relativePath);
}

interface Meta {
  ruleId: string;
  severity: Finding['severity'];
  category: string;
  description: string;
  suggestion: string;
}

interface Matcher {
  /** Global anchor regex; its match marks a candidate. */
  anchor: RegExp;
  /** Characters of text kept before the anchor and after it for the follow checks. */
  before?: number;
  window?: number;
  /** Every regex must match the bounded slice (non-global). */
  all?: readonly RegExp[];
  /** Hit only when this regex does NOT match the slice. */
  absent?: RegExp;
}

interface TextRule extends Meta {
  matchers: readonly Matcher[];
}

/** Built from fragments so this source never contains the literal markers it looks for. */
const J = (...parts: string[]): string => parts.join('');

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {starts.push(i + 1);}
  return starts;
}

function lineAt(starts: readonly number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) {lo = mid;} else {hi = mid - 1;}
  }
  return lo + 1;
}

function emit(meta: Meta, file: string, line: number): Finding & {ruleId: string} {
  const {ruleId, severity, category, description, suggestion} = meta;
  return {ruleId, severity, category, file, line, description, suggestion};
}

function runMatcher(text: string, matcher: Matcher): number[] {
  const hits: number[] = [];
  const anchor = new RegExp(matcher.anchor.source, matcher.anchor.flags.includes('g') ? matcher.anchor.flags : `${matcher.anchor.flags}g`);
  const before = matcher.before ?? 0;
  const window = matcher.window ?? 0;
  let match: RegExpExecArray | null;
  while (hits.length < MAX_HITS_PER_RULE && (match = anchor.exec(text)) !== null) {
    if (match[0].length === 0) {anchor.lastIndex += 1; continue;}
    if (matcher.all || matcher.absent) {
      const slice = text.slice(Math.max(0, match.index - before), match.index + match[0].length + window);
      if (matcher.all && !matcher.all.every(pattern => pattern.test(slice))) {continue;}
      if (matcher.absent && matcher.absent.test(slice)) {continue;}
    }
    hits.push(match.index);
  }
  return hits;
}

function runTextRules(rules: readonly TextRule[], file: string, text: string, starts: readonly number[]): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    const lines = new Set<number>();
    for (const matcher of rule.matchers) {
      for (const index of runMatcher(text, matcher)) {lines.add(lineAt(starts, index));}
    }
    for (const line of [...lines].sort((a, b) => a - b).slice(0, MAX_HITS_PER_RULE)) {
      findings.push(emit(rule, file, line));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Malware and obfuscation markers (code and config files)
// ---------------------------------------------------------------------------

const SHELL_PIPE = /\|\s{0,4}(?:sudo\s{1,3})?(?:ba|z|da)?sh\b/;

const MALWARE_RULES: readonly TextRule[] = [
  {
    ruleId: 'guardscan.malware.decoded-payload-eval',
    severity: 'high',
    category: 'Malware Hygiene: Decoded Payload Executed',
    description: 'A decoded string (base64, hex, or character codes) is passed straight to eval, Function, or exec.',
    suggestion: 'Remove the decode-and-execute step; ship readable code and review where the payload came from.',
    matchers: [
      {anchor: /\b(?:eval|Function|exec|execSync)\s{0,3}\(\s{0,3}(?:(?:window\.|global\.|globalThis\.)?atob|String\.fromCharCode|base64\.b64decode|bytes\.fromhex|codecs\.decode)\b/},
      {
        anchor: /\b(?:eval|Function|exec|execSync)\s{0,3}\(\s{0,3}Buffer\.from\b/,
        window: 200,
        all: [/['"](?:base64|hex)['"]/],
      },
    ],
  },
  {
    ruleId: 'guardscan.malware.reverse-shell',
    severity: 'high',
    category: 'Malware Hygiene: Reverse Shell',
    description: 'Code or script that connects a shell to a remote host (a reverse shell pattern).',
    suggestion: 'Remove it. If this is a legitimate security tool, keep it out of application code and document it.',
    matchers: [
      {anchor: /\/dev\/tcp\//, before: 80, window: 120, all: [/[<>]&/]},
      {anchor: /\b(?:nc|ncat|netcat)\s{1,3}-/, window: 100, all: [/\s-[a-z]*[ec]\s{1,3}(?:\/\S{0,30}\/)?(?:(?:ba|z|da)?sh|cmd)\b/]},
      {anchor: /\bbash\s{1,3}-i\s{1,3}>&/},
      {anchor: /\bpty\.spawn\s{0,3}\(/, before: 400, window: 100, all: [/\.connect\s{0,3}\(/]},
    ],
  },
  {
    ruleId: 'guardscan.malware.cryptominer-marker',
    severity: 'medium',
    category: 'Malware Hygiene: Cryptominer Marker',
    description: 'Mining pool URL, miner binary name, or miner configuration key found.',
    suggestion: 'Confirm this is intended. Unexpected mining markers in a repository are a strong sign of compromise.',
    matchers: [
      {anchor: new RegExp(J('stratum', '2?\\+(?:tcp|ssl|tls)://'))},
      {anchor: new RegExp(J('\\b(?:', 'xmr', 'ig|cpu', 'miner|nb', 'miner|coin', 'hive|crypto', 'night)\\b'), 'i')},
      {anchor: new RegExp(J('["\']donate', '-level["\']'))},
    ],
  },
  {
    ruleId: 'guardscan.malware.download-execute',
    severity: 'medium',
    category: 'Malware Hygiene: Download and Execute',
    description: 'A download is piped into a shell, or a downloaded file is made executable and run.',
    suggestion: 'Download to a file, verify a pinned checksum or signature, then run it.',
    matchers: [
      {anchor: /\b(?:curl|wget)\b/, window: 160, all: [SHELL_PIPE]},
      {anchor: /\b(?:curl|wget)\b/, window: 200, all: [/;\s{0,3}chmod\s{1,3}\+x[^\n;]{0,80};\s{0,3}\.?\//]},
    ],
  },
  {
    ruleId: 'guardscan.malware.quarantine-flag-removal',
    severity: 'low',
    category: 'Malware Hygiene: Quarantine Flag Removal',
    description: 'Removes the macOS quarantine attribute, which skips the Gatekeeper check on downloaded files.',
    suggestion: 'Sign and notarize binaries instead of stripping the quarantine attribute.',
    matchers: [{anchor: /\bxattr\s{1,3}(?:-[a-z]{1,3}\s{1,3}){0,2}[^\n]{0,40}com\.apple\.quarantine/}],
  },
  {
    ruleId: 'guardscan.obfuscation.charcode-sequence',
    severity: 'low',
    category: 'Obfuscation Hygiene: Character Code Sequence',
    description: 'A long list of numeric character codes is turned into a string, which can hide a payload.',
    suggestion: 'Use a readable string, or document why the encoding is needed.',
    matchers: [{anchor: /String\.fromCharCode\s{0,3}\(/, window: 80, all: [/\(\s{0,3}(?:\d{1,3}\s{0,3},\s{0,3}){7}/]}],
  },
  {
    ruleId: 'guardscan.obfuscation.hex-escape-run',
    severity: 'low',
    category: 'Obfuscation Hygiene: Hex Escape Run',
    description: 'A long run of hex-escaped bytes in a string, which can hide a payload.',
    suggestion: 'Use a readable string, or document why the encoding is needed.',
    matchers: [{anchor: /(?:\\x[0-9a-fA-F]{2}){12}/}],
  },
  {
    ruleId: 'guardscan.malware.env-dump-to-network',
    severity: 'medium',
    category: 'Malware Hygiene: Environment Dump Sent Over Network',
    description: 'The whole process environment is serialized close to a network call.',
    suggestion: 'Send only the specific values that are needed, never the full environment.',
    matchers: [{
      anchor: /JSON\.stringify\s{0,3}\(\s{0,3}process\.env|json\.dumps\s{0,3}\(\s{0,3}(?:dict\(\s{0,3})?os\.environ/,
      before: 100,
      window: 200,
      all: [/\b(?:fetch|axios|requests|urlopen|request|post|send)\b/],
    }],
  },
];

const BIDI_RULE: TextRule = {
  ruleId: 'guardscan.malware.bidi-control-in-source',
  severity: 'medium',
  category: 'Malware Hygiene: Bidirectional Control Character',
  description: 'Bidirectional control characters in source can make code read differently from how it runs.',
  suggestion: 'Remove the characters; use escapes if the text really needs them.',
  matchers: [{anchor: /[\u202A-\u202E\u2066-\u2069]/}],
};

const CREDENTIAL_FILE = /\.ssh\/id_(?:rsa|ed25519|ecdsa)|\.aws\/credentials|\.kube\/config|\.docker\/config\.json/;
const NETWORK_CALL = /\b(?:fetch|axios|requests\.(?:post|put)|urlopen|https?\.request|curl)\b/;
const CREDENTIAL_RULE: Meta = {
  ruleId: 'guardscan.exfil.credential-file-with-network',
  severity: 'low',
  category: 'Malware Hygiene: Credential File Read Beside Network Call',
  description: 'A well-known credential file path and a network call appear in the same file.',
  suggestion: 'Confirm the file is never sent anywhere; read credentials through the SDK or environment instead.',
};

// ---------------------------------------------------------------------------
// Payment hygiene (only when a payment SDK is a dependency)
// ---------------------------------------------------------------------------

const PAYMENT_RULES: readonly TextRule[] = [
  {
    ruleId: 'guardscan.payments.missing-idempotency-key',
    severity: 'medium',
    category: 'Payment Hygiene: Missing Idempotency Key',
    description: 'A charge, payment intent, or transfer is created with no idempotency key nearby, so a retry can pay twice.',
    suggestion: 'Pass a stable idempotency key (for example derived from the order id) with every create call.',
    // shortcut: looks 600 characters ahead for the key; a key set further away is a false positive.
    matchers: [{
      anchor: /(?:\.(?:charges|paymentIntents|payment_intents|transfers|payouts)\.create|\b(?:Charge|PaymentIntent|Transfer|Payout)\.create)\s{0,3}\(/,
      window: 600,
      absent: /idempoten/i,
    }],
  },
  {
    ruleId: 'guardscan.payments.unvalidated-refund-amount',
    severity: 'medium',
    category: 'Payment Hygiene: Refund Amount From Request',
    description: 'A refund amount comes straight from the request without validation against the original payment.',
    suggestion: 'Look the payment up server-side and cap the refund at the refundable amount before creating it.',
    matchers: [{
      anchor: /(?:\.refunds\.create|\bRefund\.create)\s{0,3}\(/,
      window: 300,
      all: [/\bamount\s{0,3}[:=]\s{0,3}(?:(?:parse\w{0,8}|Number|int|float|Decimal)\s{0,3}\(\s{0,3})?(?:req|request|ctx\.request)\.(?:body|query|params|json|form|args|data)\b/],
    }],
  },
];

const WEBHOOK_BODY_PARSE = /\bJSON\.parse\s{0,3}\(\s{0,3}(?:req|request)\.(?:body|rawBody)|\b(?:req|request)\.body\.type\b|\bevent\s{0,3}=\s{0,3}(?:req|request)\.body\b|\brequest\.get_json\s{0,3}\(|\bjson\.loads\s{0,3}\(\s{0,3}request\.(?:data|body)|\bawait\s{1,3}(?:req|request)\.json\s{0,3}\(/g;
const WEBHOOK_VERIFY = /constructEvent|construct_event|verif\w{0,12}Signature|verify_header|stripe-signature|webhooks?\.verify|verify[_-]?webhook|createHmac|\bhmac\b/i;
const WEBHOOK_META: Meta = {
  ruleId: 'guardscan.payments.webhook-without-signature-check',
  severity: 'medium',
  category: 'Payment Hygiene: Webhook Without Signature Check',
  description: 'A webhook handler parses the event body and the file never verifies a signature.',
  suggestion: 'Verify the raw body against the signature header (for example stripe.webhooks.constructEvent) before using the event.',
};

const LOG_OR_STORE = /\b(?:console\.\w{1,8}|logger\.\w{1,8}|logging\.\w{1,8}|log\.\w{1,8}|print|fmt\.Print\w{0,3}|puts)\s{0,3}\(|\.(?:insert\w{0,6}|save|create|put|setItem|write\w{0,8}|appendFile\w{0,4}|set)\s{0,3}\(/;
const CARD_LITERAL = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;
const CVV_VALUE = /\b(?:cvv2?|cvc2?|cv2|cvn|securityCode)\b/i;
const CARD_META: Meta = {
  ruleId: 'guardscan.payments.card-number-in-log-or-storage',
  severity: 'medium',
  category: 'Payment Hygiene: Card Number in Log or Storage',
  description: 'A Luhn-valid card number literal appears on a line that writes to a log or storage.',
  suggestion: 'Never log or store a full card number; keep only the processor token and the last four digits.',
};
const CVV_META: Meta = {
  ruleId: 'guardscan.payments.cvv-in-log-or-storage',
  severity: 'medium',
  category: 'Payment Hygiene: CVV in Log or Storage',
  description: 'A CVV or CVC value is referenced on a line that writes to a log or storage.',
  suggestion: 'Card verification codes must never be logged or stored, even briefly.',
};

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {value *= 2; if (value > 9) {value -= 9;}}
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function paymentLineFindings(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  let card = 0;
  let cvv = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && (card < MAX_HITS_PER_RULE || cvv < MAX_HITS_PER_RULE); i++) {
    const line = lines[i];
    if (!LOG_OR_STORE.test(line)) {continue;}
    if (card < MAX_HITS_PER_RULE) {
      CARD_LITERAL.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CARD_LITERAL.exec(line)) !== null) {
        const digits = match[0].replace(/[ -]/g, '');
        if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
          findings.push(emit(CARD_META, file, i + 1));
          card += 1;
          break;
        }
      }
    }
    if (cvv < MAX_HITS_PER_RULE && CVV_VALUE.test(line)) {
      findings.push(emit(CVV_META, file, i + 1));
      cvv += 1;
    }
  }
  return findings;
}

function webhookFindings(file: string, text: string, starts: readonly number[]): Finding[] {
  if (!/webhook/i.test(text) || WEBHOOK_VERIFY.test(text)) {return [];}
  WEBHOOK_BODY_PARSE.lastIndex = 0;
  const match = WEBHOOK_BODY_PARSE.exec(text);
  return match ? [emit(WEBHOOK_META, file, lineAt(starts, match.index))] : [];
}

// ---------------------------------------------------------------------------
// Agent configuration (MCP servers and permission grants)
// ---------------------------------------------------------------------------

const SECRET_KEY = /key|token|secret|passw|credential|auth/i;
const PLACEHOLDER = /^\$|\$\{|^<.*>$|^%.*%$|^\{\{|your[_-]|changeme|example|placeholder|^x{3,}$|^\*+$/i;
const KNOWN_SECRET_PREFIX = /^(?:Bearer\s{1,3})?(?:sk-|ghp_|gho_|github_pat_|xox[bap]-|AKIA|AIza)/;
const URL_CREDENTIALS = /^[a-z][a-z0-9+.-]{1,10}:\/\/[^/\s:@]{1,64}:[^/\s@]{1,128}@/i;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh']);
const PERMISSION_KEYS = new Set(['alwaysallow', 'autoapprove', 'allow', 'allowedtools', 'enabledtools', 'trust']);

const AGENT_SECRET: Meta = {
  ruleId: 'guardscan.agent-config.inline-secret',
  severity: 'medium',
  category: 'Agent Config Hygiene: Inline Secret',
  description: 'A secret-looking value is written literally in an agent or MCP configuration file.',
  suggestion: 'Reference an environment variable or input prompt instead, and rotate the value if it was committed.',
};
const AGENT_HTTP: Meta = {
  ruleId: 'guardscan.agent-config.insecure-remote-http',
  severity: 'medium',
  category: 'Agent Config Hygiene: Plain HTTP Remote Server',
  description: 'A remote MCP server is reached over plain http:// on a non-local host.',
  suggestion: 'Use https:// so tool traffic and credentials are not readable or changeable on the network.',
};
const AGENT_SHELL: Meta = {
  ruleId: 'guardscan.agent-config.shell-command',
  severity: 'medium',
  category: 'Agent Config Hygiene: Shell Launcher',
  description: 'An MCP server is started through a shell interpreter instead of running the program directly.',
  suggestion: 'Set the program as the command and pass arguments separately, without a shell.',
};
const AGENT_PIPE: Meta = {
  ruleId: 'guardscan.agent-config.download-pipe-shell',
  severity: 'high',
  category: 'Agent Config Hygiene: Download Piped to Shell',
  description: 'An MCP server command downloads a script and pipes it into a shell.',
  suggestion: 'Install a pinned, verified package and start it directly.',
};
const AGENT_WILDCARD: Meta = {
  ruleId: 'guardscan.agent-config.wildcard-permission',
  severity: 'medium',
  category: 'Agent Config Hygiene: Wildcard Permission',
  description: 'A wildcard or blanket grant lets tools run without per-tool approval.',
  suggestion: 'List the specific tools or commands that are allowed.',
};

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host) || host === '0.0.0.0';
}

function isLiteralSecret(key: string, value: unknown): boolean {
  if (typeof value !== 'string' || value.length < 8 || PLACEHOLDER.test(value)) {return false;}
  return SECRET_KEY.test(key) || KNOWN_SECRET_PREFIX.test(value) || URL_CREDENTIALS.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function firstLine(text: string, needle: string): number {
  const index = text.indexOf(needle);
  return index < 0 ? 1 : text.slice(0, index).split('\n').length;
}

function agentConfigFindings(file: string, text: string): Finding[] {
  let doc: unknown;
  try {doc = JSON.parse(text);} catch {return [];}
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (meta: Meta, needle: string): void => {
    const line = firstLine(text, needle);
    const key = `${meta.ruleId}:${line}`;
    if (!seen.has(key)) {seen.add(key); findings.push(emit(meta, file, line));}
  };
  const checkServer = (name: string, server: Record<string, unknown>): void => {
    const marker = JSON.stringify(name);
    for (const bag of ['env', 'headers']) {
      for (const [key, value] of Object.entries(asRecord(server[bag]) ?? {})) {
        if (isLiteralSecret(key, value)) {add(AGENT_SECRET, JSON.stringify(key));}
      }
    }
    const args = Array.isArray(server.args) ? server.args.filter((arg): arg is string => typeof arg === 'string') : [];
    for (const arg of args) {
      const flag = /^--?([\w-]{1,40})=(.{1,200})$/.exec(arg);
      if (flag && isLiteralSecret(flag[1], flag[2])) {add(AGENT_SECRET, JSON.stringify(arg));}
    }
    for (const field of ['url', 'serverUrl']) {
      const raw = server[field];
      if (typeof raw !== 'string') {continue;}
      if (URL_CREDENTIALS.test(raw)) {add(AGENT_SECRET, JSON.stringify(raw));}
      try {
        const url = new URL(raw);
        if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {add(AGENT_HTTP, JSON.stringify(raw));}
      } catch {/* not a URL; nothing to report */}
    }
    if (typeof server.command === 'string') {
      const base = path.posix.basename(server.command.replace(/\\/g, '/')).toLowerCase();
      const joined = [server.command, ...args].join(' ');
      if (/\b(?:curl|wget)\b/.test(joined) && SHELL_PIPE.test(joined)) {add(AGENT_PIPE, marker);}
      else if (SHELLS.has(base) && args.some(arg => /^(?:-[a-z]*c|\/c|-command)$/i.test(arg))) {add(AGENT_SHELL, marker);}
    }
  };
  const visit = (node: unknown, depth: number): void => {
    if (depth > 8) {return;}
    if (Array.isArray(node)) {node.forEach(item => visit(item, depth + 1)); return;}
    const record = asRecord(node);
    if (!record) {return;}
    for (const [key, value] of Object.entries(record)) {
      const lower = key.toLowerCase();
      if (lower === 'mcpservers' || lower === 'servers') {
        for (const [name, server] of Object.entries(asRecord(value) ?? {})) {
          const config = asRecord(server);
          if (config) {checkServer(name, config);}
        }
      }
      if (PERMISSION_KEYS.has(lower)) {
        const grants = Array.isArray(value) ? value : [value];
        if (grants.some(grant => grant === true || (typeof grant === 'string' && /^(?:\*|[A-Za-z_]{1,40}\(\*\)|mcp__\*)$/.test(grant)))) {
          add(AGENT_WILDCARD, JSON.stringify(key));
        }
      }
      visit(value, depth + 1);
    }
  };
  visit(doc, 0);
  return findings;
}

// ---------------------------------------------------------------------------
// Instruction files (CLAUDE.md, AGENTS.md, SKILL.md, rules files)
// ---------------------------------------------------------------------------

const HIDDEN_CHARACTER = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069]|[\u{E0000}-\u{E007F}]|\uFEFF/u;
const DATA_WORDS = /\b(?:secrets?|credentials?|tokens?|api[ _-]?keys?|\.env|ssh keys?|source code|file contents?|conversation|chat history|private)\b/i;

const INSTRUCTION_RULES: readonly TextRule[] = [
  {
    ruleId: 'guardscan.agent-instructions.send-data-external',
    severity: 'medium',
    category: 'Agent Instructions Hygiene: Send Data to External URL',
    description: 'The instructions tell an agent to send or upload sensitive-looking data to an external URL.',
    suggestion: 'Remove the instruction, or limit it to a documented, trusted endpoint that the owner controls.',
    matchers: [{
      anchor: /\b(?:send|post|upload|exfiltrate|transmit|forward)\b/i,
      before: 80,
      window: 200,
      all: [/https?:\/\/[^\s)]{3,}/, DATA_WORDS],
    }],
  },
  {
    ruleId: 'guardscan.agent-instructions.download-execute',
    severity: 'medium',
    category: 'Agent Instructions Hygiene: Download and Execute',
    description: 'The instructions tell an agent to pipe a download into a shell.',
    suggestion: 'Point to a pinned, verified install step instead.',
    matchers: [{anchor: /\b(?:curl|wget)\b/, window: 160, all: [SHELL_PIPE]}],
  },
  {
    ruleId: 'guardscan.agent-instructions.bypass-approvals',
    severity: 'medium',
    category: 'Agent Instructions Hygiene: Bypass Approvals',
    description: 'The instructions tell an agent to skip confirmation, approval, or permission checks.',
    suggestion: 'Keep a human approval step for risky actions; scope any exception narrowly.',
    matchers: [{
      anchor: /(?:\b(?:without|no)\s{1,3}(?:asking|confirmation|approval|permission)\b|\b(?:skip|bypass|disable)\s{1,3}(?:all\s{1,3})?(?:the\s{1,3})?(?:confirm\w{0,8}|approval\w{0,2}|permission\w{0,2}|safety|sandbox)\b|--dangerously-skip-permissions|\bauto-?approve\b)/i,
    }],
  },
  {
    ruleId: 'guardscan.agent-instructions.override-phrase',
    severity: 'low',
    category: 'Agent Instructions Hygiene: Override or Concealment Phrase',
    description: 'Wording that tells an agent to ignore earlier instructions or hide actions from the user.',
    suggestion: 'Review the passage; instruction files should not ask an agent to disregard other rules or hide its work.',
    matchers: [{
      anchor: /(?:\b(?:ignore|disregard|forget)\s{1,3}(?:all\s{1,3})?(?:previous|prior|earlier)\s{1,3}(?:instructions|rules|prompts)\b|\b(?:do not|don't|never)\s{1,3}(?:tell|inform|mention|notify)\s{1,3}(?:the\s{1,3})?user\b)/i,
    }],
  },
  {
    ruleId: 'guardscan.agent-instructions.hidden-comment-directive',
    severity: 'medium',
    category: 'Agent Instructions Hygiene: Hidden Comment Directive',
    description: 'An HTML comment that reads like a directive to an agent; comments are invisible when rendered.',
    suggestion: 'Move the text into visible content or delete it.',
    matchers: [{anchor: /<!--\s{0,3}(?:ignore|override|system|admin|assistant|instruction)/i}],
  },
  {
    ruleId: 'guardscan.agent-instructions.untrusted-install',
    severity: 'medium',
    category: 'Agent Instructions Hygiene: Install From Link',
    description: 'The instructions tell an agent to install software from a URL or follow a link as a prerequisite.',
    suggestion: 'Name a pinned package from a registry you trust instead of a direct link.',
    matchers: [
      {anchor: /\b(?:pip3?|npm|npx|pnpm|yarn|gem|cargo)\s{1,3}(?:i|install|add)\b/, window: 100, all: [/https?:\/\/|git\+/]},
      {anchor: /\b(?:prerequisite|install first|required)\b/i, before: 80, window: 120, all: [/https?:\/\//, /\b(?:this link|click here|download from)\b/i]},
    ],
  },
];

const DESTRUCTIVE = /\brm\s{1,3}-[a-z]*r[a-z]*f|\bgit\s{1,3}push\s{1,3}(?:-f\b|--force)|\bgit\s{1,3}reset\s{1,3}--hard|\bdrop\s{1,3}(?:table|database)\b|--no-verify/i;
const UNATTENDED = /\b(?:automatically|always|unattended|never ask)\b|\bwithout\s{1,3}(?:asking|confirm\w{0,8}|approval)\b|\bno confirmation\b/i;
const DESTRUCTIVE_META: Meta = {
  ruleId: 'guardscan.agent-instructions.unattended-destructive',
  severity: 'medium',
  category: 'Agent Instructions Hygiene: Unattended Destructive Command',
  description: 'The instructions tell an agent to run a destructive command automatically or without asking.',
  suggestion: 'Require explicit approval before destructive commands.',
};
const HIDDEN_META: Meta = {
  ruleId: 'guardscan.agent-instructions.hidden-unicode',
  severity: 'medium',
  category: 'Agent Instructions Hygiene: Hidden Unicode',
  description: 'Zero-width, bidirectional, or tag characters that are invisible when the file is read.',
  suggestion: 'Remove the characters; a reviewer cannot see what they say.',
};

function instructionFindings(file: string, text: string, starts: readonly number[]): Finding[] {
  const findings = runTextRules(INSTRUCTION_RULES, file, text, starts);
  const lines = text.split('\n');
  let destructive = 0;
  let hidden = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (destructive < MAX_HITS_PER_RULE && DESTRUCTIVE.test(line) && UNATTENDED.test(line)) {
      findings.push(emit(DESTRUCTIVE_META, file, i + 1));
      destructive += 1;
    }
    // A byte-order mark at the very start of a file is normal.
    const candidate = i === 0 ? line.replace(/^\uFEFF/, '') : line;
    if (hidden < MAX_HITS_PER_RULE && HIDDEN_CHARACTER.test(candidate)) {
      findings.push(emit(HIDDEN_META, file, i + 1));
      hidden += 1;
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// package.json install scripts
// ---------------------------------------------------------------------------

const INSTALL_SCRIPT_META: Meta = {
  ruleId: 'guardscan.malware.install-script-download',
  severity: 'medium',
  category: 'Malware Hygiene: Install Script Downloads or Evaluates Code',
  description: 'An install lifecycle script downloads files or runs inline code.',
  suggestion: 'Keep install scripts free of downloads and inline code; ship needed files in the package.',
};

function packageJsonFindings(file: string, text: string): Finding[] {
  let doc: unknown;
  try {doc = JSON.parse(text);} catch {return [];}
  const scripts = asRecord(asRecord(doc)?.scripts) ?? {};
  const findings: Finding[] = [];
  for (const name of ['preinstall', 'install', 'postinstall']) {
    const value = scripts[name];
    if (typeof value === 'string' && /\b(?:curl|wget)\b|\bnode\s{1,3}-e\b|\bpython3?\s{1,3}-c\b|\b(?:ba)?sh\s{1,3}-c\b|base64\s{1,3}(?:-d|--decode)/.test(value)) {
      findings.push(emit(INSTALL_SCRIPT_META, file, firstLine(text, JSON.stringify(name))));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Public pure entry point and scanner
// ---------------------------------------------------------------------------

/**
 * Check one text file. `file` is the path reported in findings and `relativePath`
 * is the repository-relative POSIX path used to pick the checks. Pure: no I/O.
 */
export function scanHygieneText(file: string, relativePath: string, text: string, context: HygieneContext): Finding[] {
  const kind = hygieneKindFor(relativePath);
  if (!kind) {return [];}
  if (kind === 'agent-config') {return agentConfigFindings(file, text);}
  if (kind === 'package-json') {return packageJsonFindings(file, text);}
  const starts = lineStarts(text);
  if (kind === 'instructions') {return instructionFindings(file, text, starts);}
  const findings = runTextRules(MALWARE_RULES, file, text, starts);
  if (kind === 'code') {
    findings.push(...runTextRules([BIDI_RULE], file, text, starts));
    const credential = CREDENTIAL_FILE.exec(text);
    if (credential && NETWORK_CALL.test(text)) {findings.push(emit(CREDENTIAL_RULE, file, lineAt(starts, credential.index)));}
    if (context.paymentSdk && !isTestPath(relativePath)) {
      findings.push(
        ...runTextRules(PAYMENT_RULES, file, text, starts),
        ...webhookFindings(file, text, starts),
        ...paymentLineFindings(file, text)
      );
    }
  }
  return findings;
}

export function hasPaymentSdk(inventory: PackageInventory): boolean {
  return inventory.coordinates.some(coordinate => PAYMENT_PACKAGE.test(coordinate.name));
}

export class HygieneScanner {
  /**
   * Scan the repository. `files` limits the run to explicit absolute paths and skips discovery.
   * Discovery, exclusions, symlink handling, and the size cap come from the secrets detector.
   */
  async scan(
    repoPath: string = process.cwd(),
    onSkippedInput: () => void = () => {},
    options: {files?: readonly string[]; reportOutputPath?: string; inventory?: PackageInventory} = {}
  ): Promise<Finding[]> {
    let root: string;
    try {
      root = fs.realpathSync(repoPath);
    } catch {
      onSkippedInput();
      return [];
    }
    let paymentSdk = false;
    try {
      paymentSdk = hasPaymentSdk(options.inventory ?? collectPackageInventory(root));
    } catch {
      // No inventory means no payment evidence; the payment checks stay off.
    }
    const paths = options.files
      ? [...options.files]
      : await secretsDetector.discoverFiles(root, onSkippedInput, options.reportOutputPath);
    const findings: Finding[] = [];
    for (const file of paths) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (relative.startsWith('..') || !hygieneKindFor(relative)) {continue;}
      try {
        const stat = fs.statSync(file);
        // Oversized files are skipped, as the other scanners do for non-secret checks.
        if (!stat.isFile() || stat.size > MAX_SECRET_FILE_BYTES) {continue;}
        const raw = fs.readFileSync(file);
        if (raw.includes(0)) {continue;}
        findings.push(...scanHygieneText(file, relative, raw.toString('utf-8'), {paymentSdk}));
      } catch {
        onSkippedInput();
      }
    }
    return findings;
  }
}

export const hygieneScanner = new HygieneScanner();

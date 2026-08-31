import { spawnSync, SpawnSyncOptionsWithStringEncoding } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ProcessResult {
  command: string;
  args: string[];
  status: number;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBuffer?: number;
  networkIsolation?: boolean;
}

export interface ProcessInvocation {
  command: string;
  args: string[];
}

export class NetworkIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkIsolationError';
  }
}

export function isNetworkIsolationFailure(result: Pick<ProcessResult, 'status' | 'stdout' | 'stderr'>): boolean {
  if (result.status === 0) {return false;}
  const output = `${result.stderr}\n${result.stdout}`;
  if (/^unshare:.*failed to execute/im.test(output)) {return false;}
  return /^unshare:.*(?:unshare failed|write failed|operation not permitted|permission denied|cannot (?:open|write|create))/im.test(output) ||
    /^sandbox-exec:.*(?:sandbox_apply|operation not permitted|permission denied)/im.test(output);
}

export function isNetworkIsolationError(error: unknown): error is NetworkIsolationError {
  return error instanceof NetworkIsolationError;
}

const SENSITIVE_ENVIRONMENT = /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE[_-]?KEY|AUTH)/i;
const RUNTIME_INJECTION_ENVIRONMENT = new Set([
  'NODE_OPTIONS',
  'NODE_PATH',
  'BASH_ENV',
  'ENV',
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONSTARTUP',
  'RUBYOPT',
  'PERL5OPT',
  'JAVA_TOOL_OPTIONS',
  'MAVEN_OPTS',
  'GRADLE_OPTS',
  'NPM_CONFIG_USERCONFIG',
  'npm_config_userconfig',
  'PIP_CONFIG_FILE',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'NODE_EXTRA_CA_CERTS',
  'NODE_REPL_EXTERNAL_MODULE',
]);

function isBlockedEnvironmentName(name: string): boolean {
  return SENSITIVE_ENVIRONMENT.test(name) ||
    RUNTIME_INJECTION_ENVIRONMENT.has(name) ||
    /^(?:npm_config_|NPM_CONFIG_|COREPACK_|GIT_CONFIG_|GIT_SSH|GIT_ASKPASS|GIT_EXTERNAL_DIFF|LD_PRELOAD$|DYLD_(?:INSERT_LIBRARIES|LIBRARY_PATH)$)/.test(name);
}

export function sanitizeChildEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  isolatedHome: string
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(environment)) {
    if (isBlockedEnvironmentName(name)) {
      continue;
    }
    sanitized[name] = value;
  }

  sanitized.HOME = isolatedHome;
  sanitized.USERPROFILE = isolatedHome;
  sanitized.XDG_CONFIG_HOME = path.join(isolatedHome, '.config');
  sanitized.XDG_CACHE_HOME = path.join(isolatedHome, '.cache');
  sanitized.XDG_DATA_HOME = path.join(isolatedHome, '.local', 'share');
  return sanitized;
}

export function resolveExecutable(command: string, platform = process.platform): string {
  if (platform === 'win32' && (command === 'npm' || command === 'npx')) {
    return `${command}.cmd`;
  }
  return command;
}

export function resolveNetworkIsolatedInvocation(
  command: string,
  args: string[],
  platform = process.platform
): ProcessInvocation {
  const executable = resolveExecutable(command, platform);
  if (platform === 'linux') {
    return {
      command: 'unshare',
      args: ['--user', '--map-root-user', '--net', '--', executable, ...args],
    };
  }
  if (platform === 'darwin') {
    return {
      command: 'sandbox-exec',
      args: ['-p', '(version 1) (allow default) (deny network*)', executable, ...args],
    };
  }
  throw new NetworkIsolationError(`Network isolation is not supported on ${platform}`);
}

export function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions = {}
): ProcessResult {
  const invocation = options.networkIsolation
    ? resolveNetworkIsolatedInvocation(command, args)
    : {command: resolveExecutable(command), args: [...args]};
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-child-home-'));
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    cwd: options.cwd,
    env: sanitizeChildEnvironment(options.env, isolatedHome),
    encoding: 'utf8',
    shell: false,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    windowsHide: true,
  };
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(invocation.command, invocation.args, spawnOptions);
  } finally {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }

  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    if (options.networkIsolation) {
      throw new NetworkIsolationError(`Network isolation is unavailable: ${invocation.command} was not found`);
    }
    throw new Error(`Required executable not found: ${command}`);
  }
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') {
    throw new Error(`Failed to execute ${command}: ${result.error.message}`);
  }

  const processResult: ProcessResult = {
    command: invocation.command,
    args: [...invocation.args],
    status: result.status ?? (result.error ? 2 : 1),
    stdout: typeof result.stdout === 'string' ? result.stdout : result.stdout?.toString() || '',
    stderr: typeof result.stderr === 'string' ? result.stderr : result.stderr?.toString() || '',
    signal: result.signal,
    timedOut: (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
  };
  if (options.networkIsolation && isNetworkIsolationFailure(processResult)) {
    const detail = `${processResult.stderr}\n${processResult.stdout}`.trim().split(/\r?\n/)[0];
    throw new NetworkIsolationError(
      `Network isolation could not be established${detail ? `: ${detail.slice(0, 300)}` : ''}`
    );
  }
  return processResult;
}

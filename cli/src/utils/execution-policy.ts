export interface ExecutionPolicyInput {
  configOffline?: boolean;
  offline?: boolean;
  cloud?: boolean;
  runProjectCode?: boolean;
  allowProjectCodeOffline?: boolean;
  isolateProjectNetwork?: boolean;
  cve?: boolean;
  allowPartial?: boolean;
}

export interface EffectiveExecutionPolicy {
  offline: boolean;
  runProjectCode: boolean;
  isolateProjectNetwork: boolean;
  includeCve: boolean;
  allowPartial: boolean;
}

export function applyEarlyEnvironmentFlags(args: string[]): void {
  const separator = args.indexOf('--');
  const input = separator === -1 ? args : args.slice(0, separator);
  const commandIndex = input.findIndex(value => !value.startsWith('-'));
  const config = input[commandIndex] === 'config';
  const flags: string[] = [];
  const configValueOptions = new Set(['--provider', '-p', '--key', '-k', '--telemetry', '--offline']);
  for (let index = 0; index < input.length; index++) {
    if (config && index > commandIndex && configValueOptions.has(input[index])) {
      index++;
      continue;
    }
    flags.push(input[index]);
  }
  if (flags.includes('--no-telemetry')) {process.env.GUARDSCAN_NO_TELEMETRY = 'true';}
  if (flags.includes('--no-cache')) {process.env.GUARDSCAN_NO_CACHE = 'true';}
  if (flags.includes('--offline') || flags.includes('--no-cloud')) {
    process.env.GUARDSCAN_OFFLINE = 'true';
  }
  if (flags.includes('--debug')) {process.env.GUARDSCAN_DEBUG = 'true';}
}

export function environmentRequestsOffline(): boolean {
  return ['true', '1'].includes(
    process.env.GUARDSCAN_OFFLINE?.trim().toLowerCase() || ''
  );
}

export function resolveExecutionPolicy(input: ExecutionPolicyInput = {}): EffectiveExecutionPolicy {
  const environmentOffline = environmentRequestsOffline();
  const offline = input.configOffline === true ||
    input.offline === true ||
    input.cloud === false ||
    environmentOffline;
  const includeCve = input.cve === true;
  const runProjectCode = input.runProjectCode === true && (
    !offline || input.allowProjectCodeOffline === true
  );

  return {
    offline,
    runProjectCode,
    isolateProjectNetwork: runProjectCode && (
      input.isolateProjectNetwork === true ||
      (offline && input.allowProjectCodeOffline === true)
    ),
    includeCve,
    allowPartial: input.allowPartial === true,
  };
}

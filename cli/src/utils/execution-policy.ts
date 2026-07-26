export interface ExecutionPolicyInput {
  configOffline?: boolean;
  offline?: boolean;
  cloud?: boolean;
  runProjectCode?: boolean;
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

export function resolveExecutionPolicy(input: ExecutionPolicyInput = {}): EffectiveExecutionPolicy {
  const environmentOffline = ['true', '1'].includes(
    process.env.GUARDSCAN_OFFLINE?.trim().toLowerCase() || ''
  );
  const offline = input.configOffline === true ||
    input.offline === true ||
    input.cloud === false ||
    environmentOffline;
  const includeCve = input.cve === true;
  const runProjectCode = !offline && input.runProjectCode === true;

  return {
    offline,
    runProjectCode,
    isolateProjectNetwork: runProjectCode && input.isolateProjectNetwork === true,
    includeCve,
    allowPartial: includeCve && input.allowPartial === true,
  };
}

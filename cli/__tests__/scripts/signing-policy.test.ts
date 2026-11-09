import path from 'path';
import {spawnSync} from 'child_process';

const modulePath = path.resolve(__dirname, '../../scripts/release/signing-policy.js');
const {
  RELEASE_SIGNING_POLICY,
  SIGNING_POLICIES,
  requiredSignatures,
} = require(modulePath) as {
  RELEASE_SIGNING_POLICY: string;
  SIGNING_POLICIES: Record<string, any>;
  requiredSignatures: (policy: string, os: string) => string[];
};

const run = (...args: string[]) => spawnSync(process.execPath, [modulePath, ...args], {encoding: 'utf8'});

describe('release signing policy', () => {
  it('commits the community policy', () => {
    expect(RELEASE_SIGNING_POLICY).toBe('community');
  });

  it('returns copies that cannot mutate the policy table', () => {
    requiredSignatures('platform', 'windows').push('tampered');
    expect(requiredSignatures('platform', 'windows')).toEqual(['sigstore', 'authenticode']);
    expect(SIGNING_POLICIES.platform.signatures.windows).toEqual(['sigstore', 'authenticode']);
  });

  it('throws on an unknown policy or platform', () => {
    expect(() => requiredSignatures('bogus', 'linux')).toThrow(/unknown release signing policy/);
    expect(() => requiredSignatures('community', 'plan9')).toThrow(/unknown release signing platform/);
  });

  it('prints the workflow outputs and exact-match requirement strings', () => {
    const outputs = run();
    expect(outputs.status).toBe(0);
    expect(outputs.stdout.trim().split('\n')).toEqual([
      'policy=community',
      'providers=[]',
      'darwin=["sigstore"]',
      'linux=["sigstore"]',
      'windows=["sigstore"]',
    ]);
    expect(run('platform', 'windows').stdout).toBe('required=,sigstore,authenticode,\n');
  });
});

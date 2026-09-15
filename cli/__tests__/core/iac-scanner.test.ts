import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IaCScanner } from '../../src/core/iac-scanner';

describe('IaCScanner', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-iac-'));
  });

  afterEach(() => fs.rmSync(repository, {recursive: true, force: true}));

  it('accepts Compose mapping-form environments without degrading coverage', async () => {
    fs.writeFileSync(path.join(repository, 'docker-compose.yml'), [
      'services:',
      '  app:',
      '    image: example.test/app:latest',
      '    environment:',
      '      APP_MODE: production',
      '      API_TOKEN: hardcoded-secret',
      '      INHERITED_VALUE:',
    ].join('\n'));
    const onSkippedInput = jest.fn();

    const findings = await new IaCScanner().scan(repository, onSkippedInput);

    expect(onSkippedInput).not.toHaveBeenCalled();
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'Docker Compose Security',
        description: expect.stringMatching(/app.*hardcoded secrets/i),
      }),
    ]));
  });

  it('does not degrade coverage for malformed non-Kubernetes YAML', async () => {
    fs.writeFileSync(path.join(repository, 'application-config.yaml'), 'features: [unterminated\n');
    const onSkippedInput = jest.fn();

    const findings = await new IaCScanner().scan(repository, onSkippedInput);

    expect(findings).toEqual([]);
    expect(onSkippedInput).not.toHaveBeenCalled();
  });

  it('scans Kubernetes YAML with quoted keys and flow-map syntax', async () => {
    fs.writeFileSync(path.join(repository, 'quoted.yaml'), [
      '"apiVersion": v1',
      '"kind": Pod',
      '"spec":',
      '  "containers":',
      '    - "name": quoted',
      '      "image": example.test/quoted:1',
      '      "securityContext":',
      '        "privileged": true',
    ].join('\n'));
    fs.writeFileSync(path.join(repository, 'flow.yaml'),
      '{apiVersion: v1, kind: Pod, spec: {containers: [{name: flow, image: "example.test/flow:1", securityContext: {privileged: true}}]}}\n');
    const onSkippedInput = jest.fn();

    const findings = await new IaCScanner().scan(repository, onSkippedInput);

    expect(findings.filter(finding => /privileged mode/.test(finding.description))).toHaveLength(2);
    expect(onSkippedInput).not.toHaveBeenCalled();
  });

  it('degrades coverage for malformed Kubernetes YAML with quoted keys', async () => {
    fs.writeFileSync(path.join(repository, 'broken-kubernetes.yaml'), [
      '"apiVersion": v1',
      '"kind": Pod',
      'spec: [unterminated',
    ].join('\n'));
    const onSkippedInput = jest.fn();

    await new IaCScanner().scan(repository, onSkippedInput);

    expect(onSkippedInput).toHaveBeenCalledTimes(1);
  });
});

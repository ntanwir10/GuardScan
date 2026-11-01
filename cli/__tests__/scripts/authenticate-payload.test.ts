import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
const {authenticatePayload} = require('../../scripts/release/authenticate-payload');
const {createPointer, formatPointer} = require('../../scripts/release/canonical-payload');
const yaml = require('js-yaml');

describe('authenticated checkpoint transport', () => {
  let root: string;
  const sha = 'a'.repeat(40);
  const product = 'b'.repeat(40);
  let run: any;
  let manifest: any;
  let state: any;
  let rejectSignature: boolean;
  let tagCommit: string;
  const previousRepository = process.env.GITHUB_REPOSITORY;
  const writeManifest = () => {
    fs.writeFileSync(path.join(root, 'release-manifest.json'), JSON.stringify(manifest));
    const names = ['release-manifest.json', 'release-build-provenance.json'];
    fs.writeFileSync(path.join(root, 'SHA256SUMS'), names.map(name => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')}  ${name}\n`).join(''));
  };
  const execute = jest.fn((command: string, args: string[]) => {
    if (command === 'cosign') {
      expect(args).toContain('https://github.com/ntanwir10/GuardScan/.github/workflows/release-build.yml@refs/heads/main');
      expect(args[args.indexOf('--certificate-github-workflow-sha') + 1]).toBe(sha);
      if (rejectSignature) throw new Error('untrusted signer or SHA');
      return '';
    }
    if (args[1].includes('/actions/runs/')) return JSON.stringify(run);
    return JSON.stringify({sha: tagCommit});
  });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-payload-auth-'));
    process.env.GITHUB_REPOSITORY = 'ntanwir10/GuardScan';
    run = {id: 42, run_attempt: 2, path: '.github/workflows/release-train.yml', event: 'workflow_dispatch',
      head_branch: 'main', head_sha: sha, repository: {full_name: 'ntanwir10/GuardScan'},
      head_repository: {full_name: 'ntanwir10/GuardScan'}};
    manifest = {schemaVersion: 'guardscan.release-manifest.v1', version: '1.1.0', tag: 'v1.1.0', commit: product,
      producer: {provider: 'github-actions', repository: 'ntanwir10/GuardScan', workflow: '.github/workflows/release-build.yml', workflowSha: sha,
        runId: '42', runAttempt: 2, sourceRef: 'refs/tags/v1.1.0'}};
    rejectSignature = false;
    tagCommit = product;
    fs.writeFileSync(path.join(root, 'release-build-provenance.json'), JSON.stringify({schemaVersion: 'guardscan.release-build-provenance.v1', workflow: manifest.producer.workflow, ref: 'refs/heads/main', sha}));
    writeManifest();
    fs.writeFileSync(path.join(root, 'SHA256SUMS.sigstore.json'), '{}');
    state = {tag_name: 'v1.1.0', body: formatPointer(createPointer(root, 'v1.1.0'))};
    execute.mockClear();
  });
  afterEach(() => fs.rmSync(root, {recursive: true, force: true}));
  afterAll(() => {
    if (previousRepository === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = previousRepository;
  });
  it.each(['checkpoint', 'expanded', 'public'])('authenticates original producer on %s reuse and preserves retry bytes', () => {
    const before = fs.readFileSync(path.join(root, 'release-manifest.json'));
    expect(authenticatePayload(root, 'v1.1.0', state, execute)).toBe(sha);
    expect(authenticatePayload(root, 'v1.1.0', state, execute)).toBe(sha);
    expect(fs.readFileSync(path.join(root, 'release-manifest.json'))).toEqual(before);
    expect(execute.mock.calls.every(([command]) => ['gh', 'cosign'].includes(command))).toBe(true);
  });
  it.each([
    ['repository', {repository: {full_name: 'attacker/GuardScan'}}],
    ['head repository', {head_repository: {full_name: 'attacker/GuardScan'}}],
    ['run', {id: 43}], ['attempt', {run_attempt: 3}], ['event', {event: 'pull_request'}],
    ['branch', {head_branch: 'feature'}], ['SHA', {head_sha: 'invalid'}],
    ['workflow', {path: '.github/workflows/other.yml'}],
  ])('rejects incorrect producer %s before signing or publication', (_label, change) => {
    Object.assign(run, change);
    expect(() => authenticatePayload(root, 'v1.1.0', state, execute)).toThrow();
    expect(execute.mock.calls.some(([command]) => command === 'cosign')).toBe(false);
  });
  it('rejects an unsigned forged checkpoint even with consistent sidecar hashes', () => {
    rejectSignature = true;
    expect(() => authenticatePayload(root, 'v1.1.0', state, execute)).toThrow('untrusted signer');
  });
  it('rejects a well-formed conflicting caller SHA at signature verification', () => {
    run.head_sha = 'c'.repeat(40);
    expect(() => authenticatePayload(root, 'v1.1.0', state, execute)).toThrow();
  });
  it('rejects signed reusable workflow SHA drift from the original local caller', () => {
    manifest.producer.workflowSha = 'c'.repeat(40);
    writeManifest();
    expect(() => authenticatePayload(root, 'v1.1.0', state, execute)).toThrow('immutable release tag');
  });
  it('rejects signed provenance drift even with a consistent checksum sidecar', () => {
    const file = path.join(root, 'release-build-provenance.json');
    const provenance = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({...provenance, sha: 'c'.repeat(40)}));
    writeManifest();
    expect(() => authenticatePayload(root, 'v1.1.0', state, execute)).toThrow('provenance is inconsistent');
  });
  it('rejects a changed product tag', () => {
    tagCommit = 'c'.repeat(40);
    expect(() => authenticatePayload(root, 'v1.1.0', state, execute)).toThrow('immutable release tag');
  });
  it('rejects incomplete or modified inventories', () => {
    fs.writeFileSync(path.join(root, 'unexpected.zip'), 'payload');
    expect(() => authenticatePayload(root, 'v1.1.0', state, execute)).toThrow('complete release payload');
    fs.rmSync(path.join(root, 'unexpected.zip'));
    fs.appendFileSync(path.join(root, 'release-manifest.json'), ' ');
    expect(() => authenticatePayload(root, 'v1.1.0', state, execute)).toThrow('digest');
  });
  it('rejects a missing or changed canonical pointer', () => {
    expect(() => authenticatePayload(root, 'v1.1.0', {...state, body: ''}, execute)).toThrow('canonical pointer');
    const pointer = createPointer(root, 'v1.1.0');
    pointer.manifestSha256 = '0'.repeat(64);
    expect(() => authenticatePayload(root, 'v1.1.0', {...state, body: formatPointer(pointer)}, execute)).toThrow('original canonical');
  });
  it('places authentication before recovered artifact uploads and fresh checkpoint writes', () => {
    const train = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/release-train.yml'), 'utf8'));
    for (const [job, authentication] of [['resolve-checkpoint', 'Authenticate original producer before recovered payload reuse'],
      ['checkpoint', 'Authenticate original producer before checkpoint persistence']]) {
      const steps = train.jobs[job].steps;
      const index = steps.findIndex((step: any) => step.name === authentication);
      expect(index).toBeGreaterThan(0);
      expect(steps[index].run).toContain('authenticate-payload.js');
      expect(steps.slice(0, index).some((step: any) => /upload-artifact|gh release (?:create|edit|upload)/.test(JSON.stringify(step)))).toBe(false);
    }
  });
});

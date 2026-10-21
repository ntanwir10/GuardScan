import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import os from 'os';
import crypto from 'crypto';

describe('moderated receipts retain hardened publication preflights', () => {
  const workflow = yaml.load(fs.readFileSync(path.resolve(__dirname,
    '../../../.github/workflows/release-publish.yml'), 'utf8')) as any;
  it('verifies WinGet searches, recorded PRs and public blobs through the strict helper', () => {
    const run = workflow.jobs.winget.steps.find((step: any) =>
      step.name === 'Preflight and submit WinGet manifests with exact evidence').run;
    expect(run).toContain('winget-submission.js');
    expect(run).toContain('--public');
    expect(run).toContain('$recordedPull');
    expect(run).toContain('$LASTEXITCODE -eq 75');
    expect(run).not.toContain('raw_url');
    expect(run).not.toContain('per_page=20');
    expect(run).toContain('RELEASE_WINGETCREATE_SHA256');
    expect(run).toContain('files = $script:verifiedWinGet.files');
  });
  it('uses exact Chocolatey filename and canonical payload equality before submission', () => {
    const run = workflow.jobs.chocolatey.steps.find((step: any) =>
      step.name === 'Preflight and submit Chocolatey package with exact evidence').run;
    expect(run).toContain('chocolatey-preflight.py');
    expect(run).toContain('guardscan.$version.nupkg');
    expect(run).toContain('payloadDigest');
    expect(run.indexOf('chocolatey-preflight.py')).toBeLessThan(run.indexOf('choco push'));
    expect(run).not.toContain('Get-ChildItem local-feed');
    expect(run).not.toContain('Get-FileHash public-guardscan.nupkg');
  });

  it('authenticates public WinGet blob identities and recorded closed PRs without raw download URLs', () => {
    const {findPublicSubmission, findSubmission} = require('../../scripts/release/winget-submission');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winget-receipt-'));
    const prefix = 'manifests/n/NaumanTanwir/GuardScan/1.2.3/';
    const names = ['NaumanTanwir.GuardScan.yaml', 'NaumanTanwir.GuardScan.installer.yaml',
      'NaumanTanwir.GuardScan.locale.en-US.yaml'];
    const bytes = Buffer.from('PackageIdentifier: NaumanTanwir.GuardScan\nPackageVersion: 1.2.3\n');
    const sha = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    const commit = 'a'.repeat(40);
    let state = 'closed';
    let corrupt = false;
    const entries = names.map(name => ({path: prefix + name, type: 'file', sha}));
    const api = (endpoint: string): any => {
      if (endpoint.endsWith('/commits/master')) return {sha: commit};
      if (endpoint.includes('/contents/')) { expect(endpoint).toContain(`?ref=${commit}`); return entries; }
      if (endpoint.includes('/git/blobs/')) return {sha, size: bytes.length, encoding: 'base64',
        content: (corrupt ? Buffer.from('tampered') : bytes).toString('base64')};
      if (endpoint.endsWith('/files?per_page=100')) return entries.map(entry => ({...entry,
        filename: entry.path, status: 'added'}));
      if (endpoint.endsWith('/pulls/42')) return {number: 42, state, merged: false,
        changed_files: entries.length, base: {ref: 'master', repo: {full_name: 'microsoft/winget-pkgs'}},
        head: {sha: commit}};
      throw new Error(`Unexpected endpoint ${endpoint}`);
    };
    try {
      for (const name of names) fs.writeFileSync(path.join(root, name), bytes);
      // Equivalent YAML formatting remains acceptable, but receipt hashes must
      // describe authenticated remote bytes rather than these local bytes.
      for (const name of names) fs.appendFileSync(path.join(root, name), '# local formatting\n');
      const publicResult = findPublicSubmission(root, 'v1.2.3', {api});
      expect(publicResult.publicExact).toBe(true);
      expect(publicResult.submission).toBeUndefined();
      expect(publicResult.publication.files[names[0]])
        .toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
      const network = jest.fn();
      expect(() => findPublicSubmission(root, 'v1.2.3-rc.1', {api: network})).toThrow(/stable/);
      expect(network).not.toHaveBeenCalled();
      expect(findSubmission(root, 'v1.2.3', {api, pullRequest: 42}).submission.state).toBe('CLOSED');
      state = 'unexpected';
      expect(() => findSubmission(root, 'v1.2.3', {api, pullRequest: 42})).toThrow(/state/);
      state = 'closed';
      corrupt = true;
      expect(() => findPublicSubmission(root, 'v1.2.3', {api})).toThrow(/blob/);
      corrupt = false;
      entries.push({path: 'unrelated.yaml', type: 'file', sha});
      expect(() => findPublicSubmission(root, 'v1.2.3', {api})).toThrow(/file set/);
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });
});

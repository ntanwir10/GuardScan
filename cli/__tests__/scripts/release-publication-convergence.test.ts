import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';

const workflow = (name: string): any => yaml.load(fs.readFileSync(
  path.resolve(__dirname, '../../../.github/workflows', name), 'utf8'));

describe('publication convergence', () => {
  it('serializes publication across versions sharing a mutable npm tag without dropping queued runs', () => {
    const train = workflow('release-train.yml');
    expect(train.jobs.publish.concurrency).toEqual({
      group: 'release-publication-${{ needs.prepare.outputs.channel }}',
      queue: 'max', 'cancel-in-progress': false,
    });
  });

  it('rejects moving a shared npm tag backwards even if an older version is absent', () => {
    const {classifyNpmRemote} = require('../../scripts/release/npm-artifact');
    const artifact = {version: '1.2.3-rc.1', integrity: 'sha512-test'};
    expect(() => classifyNpmRemote(artifact, undefined, {
      expectedDistTag: 'next', taggedVersion: '1.2.3-rc.2',
    })).toThrow(/backwards/);
    expect(() => classifyNpmRemote(artifact, artifact.integrity, {
      expectedDistTag: 'next', taggedVersion: 'invalid',
    })).toThrow(/version/);
    expect(classifyNpmRemote(artifact, undefined, {
      expectedDistTag: 'next', taggedVersion: '1.2.3-rc.0',
    }).publishRequired).toBe(true);
  });

  it('requires the signed checksum inventory to cover exactly the bounded payload names', () => {
    const {verifyChecksumInventory} = require('../../scripts/release/checksum-inventory');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'signed-inventory-'));
    const line = 'a'.repeat(64) + '  release-manifest.json\n';
    try {
      fs.writeFileSync(path.join(root, 'release-manifest.json'), '{}');
      fs.writeFileSync(path.join(root, 'SHA256SUMS.sigstore.json'), '{}');
      fs.writeFileSync(path.join(root, 'SHA256SUMS'), line);
      expect(() => verifyChecksumInventory(root)).not.toThrow();
      for (const unsafe of [line + line, line.replace('release-manifest.json', '../escape'), line.replace('  ', ' *')]) {
        fs.writeFileSync(path.join(root, 'SHA256SUMS'), unsafe);
        expect(() => verifyChecksumInventory(root)).toThrow();
      }
      fs.writeFileSync(path.join(root, 'SHA256SUMS'), line);
      fs.writeFileSync(path.join(root, 'unsigned-extra'), 'unexpected');
      expect(() => verifyChecksumInventory(root)).toThrow();
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });

  it('adopts authenticated tag-scoped bytes before publication and replaces both downstream artifact sets', () => {
    const job = workflow('release-publish.yml').jobs.github;
    const select = job.steps.findIndex((s: any) => s.name === 'Reuse existing immutable tag payload');
    const authenticate = job.steps.findIndex((s: any) => s.id === 'release-build-identity');
    const publish = job.steps.findIndex((s: any) => s.name === 'Publish verified draft');
    expect(select).toBeGreaterThanOrEqual(0);
    expect(select).toBeLessThan(authenticate);
    const uploads = job.steps.filter((s: any) => s.uses?.startsWith('actions/upload-artifact@'));
    expect(uploads.map((s: any) => s.with.name).sort()).toEqual([
      'release-npm-${{ inputs.tag }}', 'release-payload-${{ inputs.tag }}',
    ]);
    for (const upload of uploads) {
      expect(upload.with.overwrite).toBe(true);
      expect(job.steps.indexOf(upload)).toBeGreaterThan(publish);
    }
    for (const build of Object.values(workflow('release-build.yml').jobs) as any[]) {
      for (const upload of (build.steps || []).filter((s: any) => s.uses?.startsWith('actions/upload-artifact@'))) {
        expect(upload.with.overwrite).toBe(upload.with.name.startsWith('release-canonical-') ? false : true);
      }
    }
    const canonical = Object.values(workflow('release-build.yml').jobs).flatMap((build: any) => build.steps || [])
      .find((s: any) => s.with?.name?.startsWith('release-canonical-')) as any;
    expect(canonical).toBeTruthy();
    expect(canonical.with.name).toContain('${{ github.run_id }}-${{ github.run_attempt }}');
    expect(job.steps[select].run).toContain('gh release view');
    expect(job.steps[select].run).toContain('gh run download');
    expect(job.steps[select].run.indexOf('.head_branch == "main"'))
      .toBeLessThan(job.steps[select].run.indexOf('gh run download'));
    expect(job.steps.some((s: any) => s.run?.includes('restore-npm-payload.js'))).toBe(true);
  });

  it('recovers the original payload from a durable draft pointer and rejects substituted attempts or manifests', () => {
    const {createPointer, parsePointer, formatPointer, verifyCanonical} = require('../../scripts/release/canonical-payload');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-pointer-'));
    const manifest = {tag: 'v1.2.3', producer: {runId: '123', runAttempt: 1, sourceRef: 'refs/tags/v1.2.3'}};
    try {
      fs.writeFileSync(path.join(root, 'release-manifest.json'), JSON.stringify(manifest));
      const pointer = createPointer(root, 'v1.2.3');
      expect(pointer.artifact).toBe('release-canonical-v1.2.3-123-1');
      expect(parsePointer('Generated notes\n' + formatPointer(pointer), 'v1.2.3')).toEqual(pointer);
      expect(() => verifyCanonical(root, pointer)).not.toThrow();
      expect(() => parsePointer(formatPointer(pointer) + '\n' + formatPointer(pointer), 'v1.2.3')).toThrow();
      expect(() => parsePointer(formatPointer({...pointer, artifact: 'other-artifact'}), 'v1.2.3')).toThrow();
      expect(() => parsePointer(formatPointer(pointer), 'v1.2.4')).toThrow();
      fs.writeFileSync(path.join(root, 'release-manifest.json'), JSON.stringify({...manifest, producer: {...manifest.producer, runAttempt: 2}}));
      expect(() => verifyCanonical(root, pointer)).toThrow();
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });

  it('requires WinGet exact-state preflight and postflight instead of trusting the submit exit code', () => {
    const job = workflow('release-publish.yml').jobs.winget;
    const submit = job.steps.find((s: any) => s.name === 'Submit WinGet manifests');
    expect(submit.run).toContain('winget-submission.js');
    expect(submit.run.indexOf('Get-SubmissionState')).toBeLessThan(submit.run.indexOf('& $creator submit'));
    expect(submit.run).toContain('submitRequired');
    expect(submit.run).toContain('WinGet submission did not converge');
    expect(job.steps.some((s: any) => s.with?.name === 'release-winget-${{ inputs.tag }}')).toBe(true);
  });

  it('restores npm metadata from the original signed manifest and detects altered bytes', () => {
    const {restoreNpmPayload} = require('../../scripts/release/restore-npm-payload');
    const crypto = require('crypto');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-reuse-'));
    const source = {packageName: 'guardscan', version: '1.2.3', tag: 'v1.2.3', commit: 'a'.repeat(40)};
    const bytes = Buffer.from('original immutable tarball');
    const manifest = {...source, createdAt: '2026-10-19T00:00:00.000Z', artifacts: [{
      kind: 'npm-tarball', filename: 'guardscan-1.2.3.tgz', size: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      integrity: 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64'), source,
    }]};
    try {
      const payload = path.join(root, 'payload'); fs.mkdirSync(payload);
      fs.writeFileSync(path.join(payload, manifest.artifacts[0].filename), bytes);
      const output = path.join(root, 'npm');
      restoreNpmPayload(source, manifest, payload, output);
      const metadata = JSON.parse(fs.readFileSync(path.join(output, 'npm-artifact.json'), 'utf8'));
      expect(metadata.commit).toBe(source.commit);
      expect(fs.readFileSync(path.join(output, manifest.artifacts[0].filename))).toEqual(bytes);
      expect(() => restoreNpmPayload({...source, commit: 'b'.repeat(40)}, manifest, payload, path.join(root, 'wrong'))).toThrow();
      fs.writeFileSync(path.join(payload, manifest.artifacts[0].filename), 'different');
      expect(() => restoreNpmPayload(source, manifest, payload, path.join(root, 'tampered'))).toThrow();
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });

  it('accepts only a complete matching WinGet PR pinned to an unchanged head, including merged retries', () => {
    const {findSubmission} = require('../../scripts/release/winget-submission');
    const crypto = require('crypto');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winget-evidence-'));
    const prefix = 'manifests/n/NaumanTanwir/GuardScan/1.2.3/';
    const documents: Record<string, string> = {
      'NaumanTanwir.GuardScan.yaml': 'ManifestType: version\n',
      'NaumanTanwir.GuardScan.installer.yaml': 'ManifestType: installer\nInstallerSha256: abc\n',
      'NaumanTanwir.GuardScan.locale.en-US.yaml': 'ManifestType: defaultLocale\nPackageLocale: en-US\n',
    };
    for (const name of Object.keys(documents)) {
      documents[name] = 'PackageIdentifier: NaumanTanwir.GuardScan\nPackageVersion: 1.2.3\n' + documents[name];
      fs.writeFileSync(path.join(root, name), documents[name]);
    }
    const check = (options: any = {}) => {
      let reads = 0;
      const blobs: Record<string, any> = {};
      const files: any[] = Object.entries(documents).map(([name, original]) => {
        const data = Buffer.from(options.conflict && name.endsWith('.installer.yaml') ? original.replace('abc', 'bad') : original);
        const sha = crypto.createHash('sha1').update('blob ' + data.length + '\0').update(data).digest('hex');
        blobs[sha] = {sha, size: data.length, encoding: 'base64', content: data.toString('base64')};
        return {filename: prefix + name, status: 'added', sha};
      });
      if (options.extra) files.push({filename: 'unrelated.yaml', status: 'added', sha: 'c'.repeat(40)});
      const api = (endpoint: string) => {
        if (endpoint.startsWith('search/issues?')) return {total_count: options.absent ? 0 : 1,
          incomplete_results: false, items: options.absent ? [] : [{number: 123}]};
        if (endpoint.includes('/files?')) return files;
        if (endpoint.includes('/git/blobs/')) return blobs[endpoint.split('/').pop()!];
        reads++;
        return {number: 123, state: options.merged || options.closed ? 'closed' : 'open', merged: !!options.merged,
          changed_files: files.length,
          base: {ref: 'master', repo: {full_name: 'microsoft/winget-pkgs'}},
          head: {sha: options.race && reads > 1 ? 'b'.repeat(40) : 'a'.repeat(40)}};
      };
      return findSubmission(root, 'v1.2.3', {api});
    };
    try {
      expect(check().submitRequired).toBe(false);
      expect(check({merged: true}).submission.state).toBe('MERGED');
      expect(check({closed: true}).submitRequired).toBe(true);
      expect(check({absent: true}).submitRequired).toBe(true);
      for (const options of [{conflict: true}, {extra: true}, {race: true}]) expect(() => check(options)).toThrow();
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });
});

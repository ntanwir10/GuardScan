import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

const repository = path.resolve(__dirname, '../../..');
const workflow: any = yaml.load(fs.readFileSync(
  path.join(repository, '.github/workflows/release-canary.yml'), 'utf8'
));

describe('portable signed release checksum verification', () => {
  it('runs with only the verifier file present and no installed repository dependencies', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-checksums-'));
    try {
      const script = path.join(root, 'checksum-inventory.js');
      fs.copyFileSync(path.join(repository, 'cli/scripts/release/checksum-inventory.js'), script);
      const payload = path.join(root, 'payload'); fs.mkdirSync(payload);
      const bytes = Buffer.from('{}\n');
      fs.writeFileSync(path.join(payload, 'release-manifest.json'), bytes);
      fs.writeFileSync(path.join(payload, 'SHA256SUMS'),
        crypto.createHash('sha256').update(bytes).digest('hex') + '  release-manifest.json\n');
      const result = spawnSync(process.execPath, [script, payload, 'release-manifest.json'], {encoding: 'utf8', cwd: root});
      if (result.status !== 0) throw new Error(result.stderr || String(result.error));
      expect(result.status).toBe(0);
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });

  it('streams selected signed payload files and rejects missing, duplicate, unsafe, and incorrect entries', () => {
    const {verifyChecksumInventory} = require('../../scripts/release/checksum-inventory');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-checksums-'));
    const archive = 'guardscan-1.2.3-darwin-arm64.tar.gz';
    const manifest = 'release-manifest.json';
    const archiveBytes = Buffer.alloc(320 * 1024, 0xa5);
    const manifestBytes = Buffer.from('{"version":"1.2.3"}\n');
    const digest = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
    const inventory = (archiveHash = digest(archiveBytes), manifestHash = digest(manifestBytes)) => (
      `${archiveHash}  ${archive}\n${manifestHash}  ${manifest}\n`
    );
    try {
      fs.writeFileSync(path.join(root, archive), archiveBytes);
      fs.writeFileSync(path.join(root, manifest), manifestBytes);
      fs.writeFileSync(path.join(root, 'SHA256SUMS'), inventory());
      fs.writeFileSync(path.join(root, 'SHA256SUMS.sigstore.json'), '{}');

      expect(() => verifyChecksumInventory(root, [archive, manifest])).not.toThrow();
      expect(() => verifyChecksumInventory(root, [archive, 'missing.dmg'])).toThrow(/missing|cover/i);
      expect(() => verifyChecksumInventory(root, [archive, archive])).toThrow(/duplicate|unique/i);

      fs.writeFileSync(path.join(root, 'SHA256SUMS'), inventory('0'.repeat(64)));
      expect(() => verifyChecksumInventory(root, [archive, manifest])).toThrow(/digest|checksum/i);

      fs.writeFileSync(path.join(root, 'SHA256SUMS'), `${inventory()}${digest(archiveBytes)}  ${archive}\n`);
      expect(() => verifyChecksumInventory(root, [archive, manifest])).toThrow(/duplicate/i);

      fs.writeFileSync(path.join(root, 'SHA256SUMS'), `${inventory()}${'c'.repeat(64)}  ../escape\n`);
      expect(() => verifyChecksumInventory(root, [archive, manifest])).toThrow(/unsafe|format/i);

      fs.writeFileSync(path.join(root, 'SHA256SUMS'), inventory());
      fs.symlinkSync(process.platform === 'win32' ? root : path.join(root, manifest), path.join(root, 'linked-payload'),
        process.platform === 'win32' ? 'junction' : 'file');
      expect(() => verifyChecksumInventory(root, [archive, manifest])).toThrow(/non-regular|symlink/i);
      fs.unlinkSync(path.join(root, 'linked-payload'));
      fs.mkdirSync(path.join(root, 'payload-directory'));
      expect(() => verifyChecksumInventory(root, [archive, manifest])).toThrow(/non-regular/i);
      fs.rmdirSync(path.join(root, 'payload-directory'));
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('uses the portable verifier for archive, manifest, and downloaded DMG after producer authentication', () => {
    const job = workflow.jobs['native-and-pypi'];
    const steps = job.steps;
    const checkout = steps.findIndex((item: any) => item.uses?.startsWith('actions/checkout@'));
    const initialize = steps.findIndex((item: any) => item.name === 'Initialize fail-closed reports');
    expect(checkout).toBe(0);
    expect(checkout).toBeLessThan(initialize);
    expect(steps[checkout].with['persist-credentials']).toBe(false);
    const identityIndex = steps.findIndex((item: any) => item.name === 'Authenticate the release-build producer and verify signed checksums');
    const manifestIndex = steps.findIndex((item: any) => item.name === 'Verify signed checksums and bind the manifest to the immutable tag');
    const dmgIndex = steps.findIndex((item: any) => item.name === 'Verify macOS signing and Gatekeeper');
    const manifestRun = steps[manifestIndex].run as string;
    const dmgRun = steps[dmgIndex].run as string;

    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(identityIndex).toBeLessThan(manifestIndex);
    expect(manifestRun).toContain('node cli/scripts/release/checksum-inventory.js release "$ARCHIVE_NAME" release-manifest.json');
    expect(manifestRun).toContain('ARCHIVE_SHA=');
    expect(manifestRun).toContain('.sha256 == $archive_sha');
    expect(manifestRun).not.toContain('sha256sum');
    expect(dmgRun.indexOf('gh release download')).toBeLessThan(dmgRun.indexOf('checksum-inventory.js'));
    expect(dmgRun).toContain('node cli/scripts/release/checksum-inventory.js release "$ARCHIVE_NAME" release-manifest.json "$DMG_NAME"');
    expect(steps[dmgIndex].env.ARCHIVE).toBe('${{ matrix.target.archive }}');
    expect(dmgRun).not.toContain('sha256sum');
  });
});

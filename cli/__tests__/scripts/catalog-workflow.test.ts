import {spawnSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
const catalogWorkflow = path.join(
  repositoryRoot,
  'catalog/homebrew-tap/.github/workflows/verify.yml'
);
const source = fs.readFileSync(catalogWorkflow, 'utf8');

function lockValidationScript(): string {
  const marker = '      - name: Validate the untrusted lock before using it';
  const section = source.slice(source.indexOf(marker));
  const match = section.match(/node <<'NODE'\n([\s\S]*?)^          NODE$/m);
  if (!match) throw new Error('catalog lock validation script was not found');
  return match[1].replace(/^          /gm, '');
}

function write(root: string, relative: string, contents = 'fixture\n'): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, contents);
}

function validateCatalog(files: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-catalog-workflow-'));
  const output = path.join(root, 'github-output.txt');
  try {
    for (const file of files) write(root, file);
    const result = spawnSync(process.execPath, ['-e', lockValidationScript()], {
      cwd: root,
      encoding: 'utf8',
      env: {...process.env, GITHUB_OUTPUT: output},
    });
    return {
      ...result,
      output: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '',
    };
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

function publishedLock(version: string): string {
  const commit = 'a'.repeat(40);
  const digest = 'b'.repeat(64);
  const tag = `v${version}`;
  return JSON.stringify({
    schemaVersion: 'guardscan.channel-catalog.v1',
    source: {
      repository: 'ntanwir10/GuardScan',
      version,
      tag,
      commit,
      manifestUrl: `https://github.com/ntanwir10/GuardScan/releases/download/${tag}/release-manifest.json`,
      manifestSha256: digest,
    },
    generator: {repository: 'ntanwir10/GuardScan', commit},
    files: {
      'Formula/guardscan.rb': {sha256: digest},
      'bucket/guardscan.json': {sha256: digest},
    },
  });
}

function validatePublishedCatalog(version: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-catalog-published-'));
  const output = path.join(root, 'github-output.txt');
  try {
    write(root, 'README.md');
    write(root, '.github/workflows/verify.yml');
    write(root, 'Formula/guardscan.rb');
    write(root, 'bucket/guardscan.json');
    write(root, 'channel-lock.json', publishedLock(version));
    const result = spawnSync(process.execPath, ['-e', lockValidationScript()], {
      cwd: root,
      encoding: 'utf8',
      env: {...process.env, GITHUB_OUTPUT: output},
    });
    return {
      ...result,
      output: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '',
    };
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

describe('shared catalog verification workflow', () => {
  it('accepts only the exact unpublished bootstrap tree', () => {
    const expected = validateCatalog([
      'README.md',
      '.github/workflows/verify.yml',
    ]);
    expect(expected.status).toBe(0);
    expect(expected.output).toBe('published=false\n');

    const unexpected = validateCatalog([
      'README.md',
      '.github/workflows/verify.yml',
      'notes.txt',
    ]);
    expect(unexpected.status).not.toBe(0);
    expect(unexpected.stderr).toContain('catalog contains unexpected paths: notes.txt');
  });

  it('does not trust dependency caches while reproducing release metadata', () => {
    expect(source).not.toMatch(/^\s+cache:/m);
    expect(source).not.toContain('cache-dependency-path:');
  });

  it('rejects unsafe versions and emits published values through bounded heredocs', () => {
    const injected = validatePublishedCatalog('1.1.0\nsource_commit=attacker');
    expect(injected.status).not.toBe(0);
    expect(injected.stderr).toContain('invalid source version');

    const valid = validatePublishedCatalog('1.1.0-rc.1');
    expect(valid.status).toBe(0);
    expect(valid.output).toMatch(/^published<<guardscan_[0-9a-f-]+\ntrue\n/m);
    expect(valid.output).toMatch(/^source_commit<<guardscan_[0-9a-f-]+\na{40}\n/m);
    expect(valid.output).not.toContain('\nsource_commit=');
  });
});

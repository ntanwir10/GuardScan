import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { APIScanner } from '../../src/core/api-scanner';
import { OwaspScanner } from '../../src/core/owasp-scanner';
import { ComplianceChecker } from '../../src/core/compliance-checker';
import { DockerfileScanner } from '../../src/core/dockerfile-scanner';
import { IaCScanner } from '../../src/core/iac-scanner';

type ScannerFixture = {
  name: string;
  source: string;
  content: string;
  scan: (root: string, skipped: () => void) => Promise<Array<{file: string}>>;
};

const scanners: ScannerFixture[] = [
  {
    name: 'api', source: 'security.py', content: 'query = "SELECT * FROM users"\n',
    scan: (root, skipped) => new APIScanner().scan(root, skipped),
  },
  {
    name: 'owasp', source: 'security.py', content: 'digest = hashlib.md5(payload)\n',
    scan: (root, skipped) => new OwaspScanner().scan(root, skipped),
  },
  {
    name: 'compliance', source: 'security.py', content: 'password = "unsafe"\n',
    scan: async (root, skipped) => (await new ComplianceChecker().check(root, skipped))
      .flatMap(report => report.violations),
  },
  {
    name: 'dockerfile', source: 'Dockerfile', content: 'FROM node:latest\nUSER root\n',
    scan: (root, skipped) => new DockerfileScanner().scan(root, skipped),
  },
  {
    name: 'iac', source: 'main.tf', content: 'storage_encrypted = false\n',
    scan: (root, skipped) => new IaCScanner().scan(root, skipped),
  },
];

describe.each(scanners)('$name scanner virtual-environment discovery', scanner => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-scanner-venv-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(repository, {recursive: true, force: true});
  });

  function writeSource(directory: string): string {
    fs.mkdirSync(directory, {recursive: true});
    const source = path.join(directory, scanner.source);
    fs.writeFileSync(source, scanner.content);
    return source;
  }

  it.each(['venv', '.venv'])('finds vulnerabilities in first-party src/%s without an environment marker', async name => {
    const source = writeSource(path.join(repository, 'src', name));
    const skipped = jest.fn();

    const findings = await scanner.scan(repository, skipped);

    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({file: source})]));
    expect(skipped).not.toHaveBeenCalled();
  });

  it.each(['.venv', 'venv', 'python-runtime'])('excludes a real %s environment identified by a regular pyvenv.cfg', async name => {
    const firstParty = writeSource(path.join(repository, 'src'));
    const environment = path.join(repository, name);
    writeSource(path.join(environment, 'lib', 'site-packages'));
    fs.writeFileSync(path.join(environment, 'pyvenv.cfg'), 'home = /python\n');
    const skipped = jest.fn();

    const findings = await scanner.scan(repository, skipped);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every(finding => finding.file === firstParty)).toBe(true);
    expect(skipped).not.toHaveBeenCalled();
  });

  it('continues excluding generated and vendor directories', async () => {
    const firstParty = writeSource(path.join(repository, 'src'));
    for (const name of ['node_modules', '.git', 'vendor', 'dist', 'build', 'target', 'coverage', '__pycache__']) {
      writeSource(path.join(repository, 'packages', name));
    }
    const skipped = jest.fn();

    const findings = await scanner.scan(repository, skipped);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every(finding => finding.file === firstParty)).toBe(true);
    expect(skipped).not.toHaveBeenCalled();
  });

  it('scans source when pyvenv.cfg is a directory rather than a regular file', async () => {
    const directory = path.join(repository, 'src', 'venv');
    const source = writeSource(directory);
    fs.mkdirSync(path.join(directory, 'pyvenv.cfg'));
    const skipped = jest.fn();

    const findings = await scanner.scan(repository, skipped);

    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({file: source})]));
    expect(skipped).not.toHaveBeenCalled();
  });

  it('scans source when the environment marker cannot be inspected', async () => {
    const directory = path.join(repository, 'src', 'venv');
    const source = writeSource(directory);
    const marker = path.join(directory, 'pyvenv.cfg');
    const nativeFs = require('fs') as typeof fs;
    const originalLstat = nativeFs.lstatSync;
    jest.spyOn(nativeFs, 'lstatSync').mockImplementation(((file: fs.PathLike, options?: unknown) => {
      if (String(file) === marker) {
        throw Object.assign(new Error('Permission denied'), {code: 'EACCES'});
      }
      return Reflect.apply(originalLstat, nativeFs, [file, options]);
    }) as typeof nativeFs.lstatSync);
    const skipped = jest.fn();

    const findings = await scanner.scan(repository, skipped);

    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({file: source})]));
    expect(skipped).not.toHaveBeenCalled();
  });

  it('does not treat a symlinked pyvenv.cfg as an environment marker', async () => {
    const directory = path.join(repository, 'src', '.venv');
    const source = writeSource(directory);
    const markerTarget = path.join(repository, 'environment-marker');
    fs.writeFileSync(markerTarget, 'home = /python\n');
    const marker = path.join(directory, 'pyvenv.cfg');
    if (process.platform === 'win32') {
      // Model file-symlink metadata without requiring Windows symlink privileges.
      fs.writeFileSync(marker, 'home = /python\n');
      const nativeFs = require('fs') as typeof fs;
      const originalLstat = nativeFs.lstatSync;
      const linkedMarkerStat = originalLstat(marker);
      linkedMarkerStat.isSymbolicLink = () => true;
      linkedMarkerStat.isFile = () => false;
      jest.spyOn(nativeFs, 'lstatSync').mockImplementation(((file: fs.PathLike, options?: unknown) => {
        if (String(file) === marker) {return linkedMarkerStat;}
        return Reflect.apply(originalLstat, nativeFs, [file, options]);
      }) as typeof nativeFs.lstatSync);
    } else {
      fs.symlinkSync(markerTarget, marker);
    }
    const skipped = jest.fn();

    const findings = await scanner.scan(repository, skipped);

    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({file: source})]));
    expect(skipped).not.toHaveBeenCalled();
  });

  it('keeps directory symlinks skipped and reported even when their targets are environments', async () => {
    const target = path.join(repository, 'environment-target');
    writeSource(target);
    fs.writeFileSync(path.join(target, 'pyvenv.cfg'), 'home = /python\n');
    for (const name of ['venv', '.venv', 'python-runtime']) {
      fs.symlinkSync(target, path.join(repository, name), process.platform === 'win32' ? 'junction' : 'dir');
    }
    const skipped = jest.fn();

    const findings = await scanner.scan(repository, skipped);

    expect(findings).toEqual([]);
    expect(skipped).toHaveBeenCalledTimes(scanner.name === 'iac' ? 9 : 3);
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

const repository = path.resolve(__dirname, '../../..');
const workflow: any = yaml.load(fs.readFileSync(
  path.join(repository, '.github/workflows/release-canary.yml'), 'utf8'
));
const step = (job: any, name: string): any => {
  const found = job.steps.find((item: any) => item.name === name);
  if (!found) throw new Error('Missing step: ' + name);
  return found;
};

describe('moderated Chocolatey and pipx release canaries', () => {
  it('treats only explicit Chocolatey no-result responses as pending at documented exit codes', () => {
    const run = step(workflow.jobs.moderated,
      'Poll, install, invoke, and uninstall public moderated channels').run as string;
    // PowerShell requires this binary operator to continue the preceding line.
    expect(run).not.toMatch(/^\s+-or\s/m);
    const choco = run.slice(run.indexOf('$availability = choco info'), run.indexOf("if ($notPublic) {", run.indexOf('$availability = choco info')));

    expect(choco).toContain("$noResult = $availabilityText -match '(?im)^\\s*(Unable to find package .guardscan.|0 packages found\\.)\\s*$'");
    const banneredZeroResults = 'Chocolatey v2.5.0\n0 packages found.\n';
    const regexSource = choco.match(/\$noResult = \$availabilityText -match '([^']+)'/)?.[1];
    expect(regexSource).toBeTruthy();
    expect(banneredZeroResults).toMatch(new RegExp(regexSource!.replace(/^\(\?im\)/, ''), 'im'));
    expect(choco).toContain("$availabilityStatus -eq 0");
    expect(choco).toContain("$availabilityStatus -eq 2 -and $noResult");
    expect(choco).toContain('Unable to find package .guardscan.|0 packages found\\.');
    expect(choco).toContain('$exactVersion');
    expect(choco).toContain('Unexpected moderated registry error:');
  });

  it('invokes the isolated pipx-installed app and checks the exact public version before passing', () => {
    const run = step(workflow.jobs['native-and-pypi'], 'Test public wheel through pip and pipx').run as string;
    const pypi = workflow.jobs['native-and-pypi'].steps.find((item: any) => item.name === 'Test public wheel through pip and pipx');
    expect(pypi.shell).toBe('bash');
    expect(pypi.env.VERSION).toBe('${{ matrix.train.version }}');
    expect(run).toContain('export PIPX_BIN_DIR=');
    expect(run).toContain('PIPX_APP="$PIPX_APP.exe"');
    expect(run).toContain('"$PIPX_APP" --version');
    expect(run).toContain('test "$PIPX_REPORTED_VERSION" = "$VERSION"');
    expect(run.indexOf('"$PIPX_APP" --version')).toBeLessThan(run.indexOf('report["status"] = "passed"'));
    expect(run).not.toMatch(/python -m pipx run\s/);
    expect(run).toContain('python -m pipx runpip guardscan-cli show guardscan-cli');
    expect(run.indexOf('"$PIPX_APP" --help')).toBeLessThan(run.indexOf('report["status"] = "passed"'));
    expect(run).toContain('PIP_REPORTED_VERSION');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-pipx-canary-'));
    try {
      const runnerTemp = path.join(directory, 'runner-temp').replace(/\\/g, '/');
      const pipxBinDir = path.join(runnerTemp, 'pipx-bin');
      fs.mkdirSync(pipxBinDir, {recursive: true});
      fs.writeFileSync(path.join(directory, 'pypi.json'), JSON.stringify({status: 'failed'}));
      fs.writeFileSync(path.join(pipxBinDir, 'guardscan'), `#!/bin/sh
if [ "$1" = --help ]; then printf '%s\\n' scan; exit 0; fi
printf '%s\\n' "$CANARY_APP_VERSION"
`);
      fs.chmodSync(path.join(pipxBinDir, 'guardscan'), 0o755);
      const shellFunctions = `python() {
  if [ "$1" = "-" ]; then
    cat >/dev/null
    "$FIXTURE_NODE" -e 'const fs = require("fs"); const file = "pypi.json"; const report = JSON.parse(fs.readFileSync(file)); report.status = "passed"; fs.writeFileSync(file, JSON.stringify(report));'
    return $?
  fi
  return 0
}
guardscan() { if [ "$1" = --help ]; then printf '%s\\n' scan; else printf '%s\\n' "$PIP_VERSION"; fi; }
`;
      const executed = shellFunctions + run.replace(/\$\{\{\s*matrix\.train\.version\s*\}\}/g, '1.2.3');
      const fixtureNode = process.execPath.replace(/\\/g, '/');
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', executed], {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          FIXTURE_NODE: fixtureNode,
          RUNNER_TEMP: runnerTemp,
          RUNNER_OS: 'Linux',
          VERSION: '1.2.3',
          PYPI_VERSION: '1.2.3',
          PIP_VERSION: '1.2.3',
          CANARY_APP_VERSION: '1.2.3',
        },
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(fs.readFileSync(path.join(directory, 'pypi.json'), 'utf8')).status).toBe('passed');

      fs.writeFileSync(path.join(directory, 'pypi.json'), JSON.stringify({status: 'failed'}));
      const mismatch = spawnSync('bash', ['-euo', 'pipefail', '-c', executed], {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          FIXTURE_NODE: fixtureNode,
          RUNNER_TEMP: runnerTemp,
          RUNNER_OS: 'Linux',
          VERSION: '1.2.3',
          PYPI_VERSION: '1.2.3',
          PIP_VERSION: '1.2.3',
          CANARY_APP_VERSION: '9.9.9',
        },
      });
      expect(mismatch.status).not.toBe(0);
    } finally {
      fs.rmSync(directory, {recursive: true, force: true});
    }
  });
});

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const repositoryRoot = path.resolve(__dirname, '../../..');
const cliPath = path.join(repositoryRoot, 'cli', 'dist', 'index.js');

function runHelp(command?: string): string {
  const args = command ? [cliPath, command, '--help'] : [cliPath, '--help'];
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    env: {
      ...process.env,
      GUARDSCAN_HOME: path.join(os.tmpdir(), 'guardscan-documentation-contract'),
      GUARDSCAN_NO_TELEMETRY: 'true',
      GUARDSCAN_OFFLINE: 'true',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
    windowsHide: true,
  });

  if (result.error) throw result.error;
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout;
}

function documentedQuickstartCommands(quickstart: string): string[] {
  const inventory = quickstart.match(
    /## 📋 Available Commands([\s\S]*?)\n---/
  )?.[1];
  if (!inventory) throw new Error('QUICKSTART.md has no bounded Available Commands section');
  return Array.from(inventory.matchAll(/^guardscan\s+([a-z][a-z-]*)/gm), match => match[1]);
}

function actualTopLevelCommands(help: string): string[] {
  const inventory = help.match(/^Commands:\s*$([\s\S]*)/m)?.[1];
  if (!inventory) throw new Error('guardscan --help has no Commands section');
  return Array.from(
    inventory.matchAll(/^  ([a-z][a-z-]*)(?:\|[a-z-]+)?(?:\s|\[|<)/gm),
    match => match[1]
  ).filter(command => command !== 'help');
}

function documentedAcceptanceCommands(acceptance: string): string[] {
  const inventory = acceptance.match(
    /## Command acceptance matrix([\s\S]*?)(?=\n## )/
  )?.[1];
  if (!inventory) {
    throw new Error('docs/FUNCTIONAL_ACCEPTANCE.md has no bounded command acceptance matrix');
  }
  return Array.from(
    inventory.matchAll(/^\| `guardscan ([a-z][a-z-]*)` \|/gm),
    match => match[1]
  );
}

describe('public command documentation contracts', () => {
  const readme = fs.readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8');
  const cliReadme = fs.readFileSync(path.join(repositoryRoot, 'cli', 'README.md'), 'utf8');
  const quickstart = fs.readFileSync(path.join(repositoryRoot, 'QUICKSTART.md'), 'utf8');
  const changelog = fs.readFileSync(path.join(repositoryRoot, 'cli', 'CHANGELOG.md'), 'utf8');

  it('keeps all prepared 1.1.0 changes in one release section', () => {
    const headings = changelog.match(/^## \[1\.1\.0\](?:\s|$)/gm) || [];
    const release = changelog.match(
      /^## \[1\.1\.0\][\s\S]*?(?=^## \[1\.0\.5\])/m
    )?.[0];

    expect(headings).toHaveLength(1);
    expect(release).toContain('Static-safe `guardscan scan` execution');
    expect(release).toContain('Native OSV-backed dependency vulnerability scanning');
    expect(release).toContain('The GuardScan-hosted Cloudflare telemetry service');
  });

  it('keeps the documented 29-command inventory identical to installed CLI help', () => {
    const documented = documentedQuickstartCommands(quickstart);
    const actual = actualTopLevelCommands(runHelp());

    expect(new Set(documented).size).toBe(29);
    expect(documented).toHaveLength(29);
    expect(new Set(actual).size).toBe(29);
    expect(actual).toHaveLength(29);
    expect([...documented].sort()).toEqual([...actual].sort());
  });

  it('classifies every installed command exactly once in the functional acceptance matrix', () => {
    const acceptance = fs.readFileSync(
      path.join(repositoryRoot, 'docs', 'FUNCTIONAL_ACCEPTANCE.md'),
      'utf8'
    );
    const documented = documentedAcceptanceCommands(acceptance);
    const actual = actualTopLevelCommands(runHelp());

    expect(documented).toHaveLength(29);
    expect(new Set(documented).size).toBe(29);
    expect([...documented].sort()).toEqual([...actual].sort());
  });

  it.each([
    ['review', 'guardscan review --file <path>', '--file <path>', 'guardscan review <file>'],
    ['docs', 'guardscan docs --type <type>', '--type <type>', 'guardscan docs <file>'],
    ['test-gen', 'guardscan test-gen --file <path>', '--file <path>', 'guardscan test-gen <file>'],
    ['refactor', 'guardscan refactor --file <path>', '--file <path>', 'guardscan refactor <file>'],
  ])('documents supported %s option syntax', (command, documented, helpOption, obsolete) => {
    for (const document of [readme, cliReadme]) {
      expect(document).toContain(`\`${documented}\``);
      expect(document).not.toContain(`\`${obsolete}\``);
    }
    expect(runHelp(command)).toContain(helpOption);
  });
});

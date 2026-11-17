import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const repositoryRoot = path.resolve(__dirname, '../../..');

describe('release pull request automation', () => {
  it('uses manifest mode for the CLI and never creates tags or GitHub releases', () => {
    const config = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, 'release-please-config.json'),
      'utf8'
    ));
    const manifest = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, '.release-please-manifest.json'),
      'utf8'
    ));
    const packageJson = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, 'cli/package.json'),
      'utf8'
    ));

    expect(config).toMatchObject({
      'separate-pull-requests': false,
      'skip-github-release': true,
      packages: {
        cli: {
          'release-type': 'node',
          'package-name': 'guardscan',
          'changelog-path': 'CHANGELOG.md',
          'include-component-in-tag': false,
        },
      },
    });
    expect(Object.keys(config.packages)).toEqual(['cli']);
    // RC candidate commits bump package.json to X.Y.Z-rc.N while the Release Please manifest stays at X.Y.Z.
    expect(manifest).toEqual({cli: packageJson.version.replace(/-rc\.(0|[1-9][0-9]*)$/, '')});
  });

  it('uses a short-lived GitHub App token and pinned action commits', () => {
    const source = fs.readFileSync(
      path.join(repositoryRoot, '.github/workflows/release-please.yml'),
      'utf8'
    );
    const workflow = yaml.load(source) as Record<string, unknown>;

    expect(workflow).toBeTruthy();
    expect(source).toContain('actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510');
    expect(source).toContain('googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7');
    expect(source).toContain('secrets.RELEASE_APP_PRIVATE_KEY');
    expect(source).toContain('skip-github-release: true');
    expect(source).toContain("vars.RELEASE_PLEASE_ENABLED == 'true'");
    expect(source).not.toContain("vars.RELEASE_AUTOMATION_ENABLED == 'true'");
    expect(source).not.toContain('secrets.GITHUB_TOKEN');
    expect(source).not.toContain('github.token');
  });
});

import fs from 'fs';
import path from 'path';

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');

describe('release control-plane governance', () => {
  it('routes every release-authority change through an explicit code owner', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, '.github/CODEOWNERS'), 'utf8');
    for (const pattern of [
      '/.github/workflows/release-*.yml',
      '/.github/release-ledger/',
      '/cli/scripts/release/',
      '/cli/schemas/release-*.schema.json',
      '/catalog/homebrew-tap/',
      '/docs/RELEASE_*.md',
    ]) {
      expect(source).toContain(`${pattern} @ntanwir10`);
    }
  });

  it('documents protected workflow review as a publication authority boundary', () => {
    const onboarding = fs.readFileSync(
      path.join(repositoryRoot, 'docs/RELEASE_ONBOARDING.md'),
      'utf8'
    );
    expect(onboarding).toContain('Require code-owner review for release control-plane changes');
    expect(onboarding).toContain('must name an independent maintainer or team');
    expect(onboarding).toContain('approval of the latest push by someone other than its author');
    expect(onboarding).toMatch(/does\s+not require a per-release promotion click/);
  });
});

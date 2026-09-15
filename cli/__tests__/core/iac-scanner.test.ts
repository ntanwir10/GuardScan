import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IaCScanner } from '../../src/core/iac-scanner';

describe('IaCScanner', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-iac-'));
  });

  afterEach(() => fs.rmSync(repository, {recursive: true, force: true}));

  it('accepts Compose mapping-form environments without degrading coverage', async () => {
    fs.writeFileSync(path.join(repository, 'docker-compose.yml'), [
      'services:',
      '  app:',
      '    image: example.test/app:latest',
      '    environment:',
      '      APP_MODE: production',
      '      API_TOKEN: hardcoded-secret',
      '      INHERITED_VALUE:',
    ].join('\n'));
    const onSkippedInput = jest.fn();

    const findings = await new IaCScanner().scan(repository, onSkippedInput);

    expect(onSkippedInput).not.toHaveBeenCalled();
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'Docker Compose Security',
        description: expect.stringMatching(/app.*hardcoded secrets/i),
      }),
    ]));
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ComplianceChecker } from '../../src/core/compliance-checker';

describe('ComplianceChecker GDPR identification numbers', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'compliance-test-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function identificationLines(file: string, content: string): Promise<number[]> {
    fs.writeFileSync(path.join(root, file), content);
    const reports = await new ComplianceChecker().check(root);
    return reports
      .flatMap(report => report.violations)
      .filter(violation => violation.description.includes('Identification Number'))
      .map(violation => violation.line);
  }

  it('does not treat software license metadata as personal data', async () => {
    // package.json and every package-lock.json entry carry an SPDX "license" field.
    const manifest = ['{', '  "name": "acme-api",', '  "license": "MIT",', '  "licenses": ["Apache-2.0"]', '}'].join('\n');
    await expect(identificationLines('package.json', manifest)).resolves.toEqual([]);
  });

  it('still flags identification-number fields', async () => {
    const code = [
      'const user = {',
      '  passport_number: input.passport,',
      '  driverLicense: input.dl,',
      '  drivers_license: input.dl,',
      '  license_number: input.licenseNumber,',
      '  id_number: input.nationalId,',
      '  license: "MIT",',
      '};',
    ].join('\n');
    await expect(identificationLines('user.js', code)).resolves.toEqual([2, 3, 4, 5, 6]);
  });
});

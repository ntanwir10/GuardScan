import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScanEngine, ScanEngineOptions, ScanEngineResult, writeScanResult } from '../../src/core/scan-engine';
import { isGuardScanReport } from '../../src/core/scan-ignored-directories';
import { reporter, ReviewResult } from '../../src/utils/reporter';

describe('GuardScan report outputs in the scanned repository', () => {
  let repository: string;

  beforeEach(() => {
    // Deliberately not realpath'd: on macOS the walkers see /private/var, not /var.
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-report-outputs-'));
    fs.writeFileSync(
      path.join(repository, 'app.js'),
      'const customerData = db.storage.read();\nconst password = "hunter2";\n'
    );
    fs.writeFileSync(path.join(repository, 'config.json'), '{"database": "customers"}\n');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(repository, {recursive: true, force: true});
  });

  const scan = (extra: ScanEngineOptions = {}): Promise<ScanEngineResult> => new ScanEngine().runSecurityScan({
    repoPath: repository,
    offline: true,
    includeVulnerabilities: false,
    includeGitHistory: false,
    ...extra,
  });

  function markdownReview(result: ScanEngineResult): ReviewResult {
    return {
      summary: `Security scan found ${result.findings.length} issue(s).`,
      findings: result.findings,
      recommendations: [],
      metadata: {
        timestamp: new Date().toISOString(),
        repoInfo: {name: 'fixture'},
        locStats: {totalLines: 2, codeLines: 2, commentLines: 0, blankLines: 0, fileCount: 2},
        provider: 'security-scanner',
        model: 'multi-scanner',
        durationMs: 1,
      },
    } as unknown as ReviewResult;
  }

  it('produces the same findings when earlier default reports sit in the repository', async () => {
    const baseline = await scan();
    expect(baseline.findings.some(finding => finding.category.includes('Compliance'))).toBe(true);

    writeScanResult(baseline, 'json', path.join(repository, 'guardscan-security.json'), repository);
    writeScanResult(baseline, 'sarif', path.join(repository, 'guardscan-security.sarif'), repository);
    fs.mkdirSync(path.join(repository, 'nested'));
    writeScanResult(baseline, 'json', path.join(repository, 'nested', 'guardscan-scan.json'), repository);
    fs.mkdirSync(path.join(repository, '.guardscan'));
    writeScanResult(baseline, 'json', path.join(repository, '.guardscan', 'rules-results.json'), repository);
    jest.spyOn(process, 'cwd').mockReturnValue(repository);
    const markdown = await reporter.saveReport(markdownReview(baseline), 'markdown', undefined, 'security');
    jest.restoreAllMocks();
    expect(path.basename(markdown)).toMatch(/^guardscan-security-.+\.md$/);

    const rescan = await scan();

    expect(rescan.findings).toEqual(baseline.findings);
  });

  it("excludes this run's explicit --output path but still scans it on other runs", async () => {
    const baseline = await scan();
    const customOutput = path.join(repository, 'out', 'custom.json');
    fs.mkdirSync(path.dirname(customOutput));
    writeScanResult(baseline, 'json', customOutput, repository);

    // Without the exclusion the report changes the findings, so the next assertion can fail.
    expect((await scan()).findings).not.toEqual(baseline.findings);
    expect((await scan({reportOutputPath: customOutput})).findings).toEqual(baseline.findings);
  });

  it('keeps an earlier --output with a source extension out of pattern and secret inputs', async () => {
    const baseline = await scan();
    const jsOutput = path.join(repository, 'out', 'report.js');
    fs.mkdirSync(path.dirname(jsOutput));
    // A real report rarely trips these rules; this content does, so the negative control can fail.
    fs.writeFileSync(jsOutput, 'const awsKey = "AKIA1234567890123456";\n');
    // loadFiles (and LOC/--files) return code files, so this path bypasses the walkers' exclusion.
    const fileInputFindings = (result: ScanEngineResult) => result.scannerResults
      .filter(scanner => scanner.scanner === 'patterns' || scanner.scanner === 'secrets')
      .map(scanner => scanner.findings);

    expect(fileInputFindings(await scan())).not.toEqual(fileInputFindings(baseline));
    expect(fileInputFindings(await scan({reportOutputPath: jsOutput}))).toEqual(fileInputFindings(baseline));
    expect(fileInputFindings(await scan({files: [{path: jsOutput}], reportOutputPath: jsOutput})))
      .toEqual([[], []]);
  });

  it.each([
    ['guardscan-security.json', true],
    ['guardscan-scan.sarif', true],
    ['guardscan-comprehensive-2026-11-15T12-01-02-123Z.md', true],
    ['guardscan-code-review-2026-11-15T12-01-02-123Z.html', true],
    ['guardscan-setup.md', false],
    ['guardscan-config.json', false],
    ['my-guardscan-security.json', false],
  ])('treats %s as a report: %s', (name, expected) => {
    expect(isGuardScanReport(path.join(repository, 'docs', name))).toBe(expected);
  });
});

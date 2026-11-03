import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';

const timestamp = '2026-10-01T00:00:00.000Z';
const evidenceUrl = 'https://github.com/ntanwir10/GuardScan/actions/runs/123';

describe('complete release canary coverage', () => {
  it('requires every declared manager, native, adapter, and moderated report exactly once', () => {
    const {EXPECTED_CANARY_TARGETS, validateCanaryReports} = require('../../scripts/release/canary-reports');
    const reports = EXPECTED_CANARY_TARGETS.map(([channel, target]: string[]) => ({
      channel, target, version: '1.2.3-rc.1', status: ['winget', 'chocolatey'].includes(channel) ? 'pending' : 'passed',
      checkedAt: timestamp, evidenceUrl,
    }));
    expect(reports).toHaveLength(20);
    expect(() => validateCanaryReports(reports, '1.2.3-rc.1', evidenceUrl)).not.toThrow();
    for (let index = 0; index < reports.length; index += 1) {
      expect(() => validateCanaryReports(reports.filter((_item: any, i: number) => i !== index), '1.2.3-rc.1', evidenceUrl))
        .toThrow(/coverage/);
    }
    for (const replacement of [
      reports[1], {...reports[0], target: 'unknown'}, {...reports[0], version: '1.2.4-rc.1'},
      {...reports[0], status: 'pending'}, {...reports[0], status: 'unknown'},
      {...reports[0], checkedAt: 'invalid'}, {...reports[0], evidenceUrl: evidenceUrl + '4'},
    ]) {
      expect(() => validateCanaryReports([replacement, ...reports.slice(1)], '1.2.3-rc.1', evidenceUrl)).toThrow();
    }
    const workflow: any = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/release-canary.yml'), 'utf8'));
    const expected = [
      ...workflow.jobs['package-managers'].strategy.matrix.manager.map((manager: string) => [manager.split('-')[0], manager]),
      ...workflow.jobs['native-and-pypi'].strategy.matrix.target.flatMap((target: any) => ['github', 'pypi'].map(channel => [channel, target.id])),
      ...workflow.jobs.adapters.strategy.matrix.adapter.map((adapter: string) => [adapter.startsWith('homebrew-') ? 'homebrew' : 'scoop', adapter]),
      ...['winget', 'chocolatey'].map(channel => [channel, 'windows-x64']),
    ];
    expect([...EXPECTED_CANARY_TARGETS].map((item: string[]) => item.join(':')).sort())
      .toEqual(expected.map(item => item.join(':')).sort());
    const record = workflow.jobs.record.steps.find((step: any) => step.name === 'Append hash-chained canary and verification events');
    expect(record.run.indexOf('validateCanaryReports(')).toBeLessThan(record.run.indexOf('appendEvent(ledger'));
  });

  it('reads and appends realistic ledgers beyond 1 MiB without enlarging generic release files', () => {
    const {createEvent, readEvents, appendEvent, MAX_LEDGER_BYTES} = require('../../scripts/release/events');
    const {readBounded} = require('../../scripts/release/lib');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-large-ledger-'));
    try {
      const file = path.join(root, 'release.jsonl');
      const events: any[] = [];
      for (let index = 0; index < 280; index += 1) events.push(createEvent({
        version: '1.2.3', tag: 'v1.2.3', commit: 'a'.repeat(40), timestamp,
        type: index === 0 ? 'train_started' : 'canary_recorded',
        idempotencyKey: 'sample:' + index, ...(index > 0 ? {channel: 'github'} : {}),
        payload: index === 0
          ? {channels: ['github']}
          : {status: 'passed', checkedAt: timestamp, target: 'linux-x64-glibc',
            evidenceUrl, note: 'a'.repeat(4096)},
      }, events.at(-1)));
      fs.writeFileSync(file, events.map(event => JSON.stringify(event) + '\n').join(''));
      expect(fs.statSync(file).size).toBeGreaterThan(1024 * 1024);
      expect(() => readBounded(file)).toThrow(/exceeds/);
      expect(readEvents(file)).toHaveLength(280);
      expect(appendEvent(file, {...events.at(-1), idempotencyKey: 'next'}).changed).toBe(true);
      expect(readEvents(file)).toHaveLength(281);
      fs.truncateSync(file, MAX_LEDGER_BYTES + 1);
      expect(() => readEvents(file)).toThrow(/exceeds/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});

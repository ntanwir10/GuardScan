import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

it('queues every protected release-ledger writer without dropping pending trains', () => {
  const root = path.resolve(__dirname, '../../../.github/workflows');
  let writers = 0;
  for (const file of fs.readdirSync(root).filter(name => name.endsWith('.yml'))) {
    const workflow: any = yaml.load(fs.readFileSync(path.join(root, file), 'utf8'));
    for (const owner of [workflow, ...Object.values(workflow.jobs || {})] as any[]) {
      if (owner.concurrency?.group !== 'release-ledger') continue;
      writers += 1;
      expect({file, queue: owner.concurrency.queue}).toEqual({file, queue: 'max'});
      expect(owner.concurrency['cancel-in-progress']).toBe(false);
    }
  }
  expect(writers).toBeGreaterThanOrEqual(6);
});

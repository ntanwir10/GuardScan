import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';

describe('machine-readable CLI version', () => {
  it.each(['--version', '-V'])('prints only the version for %s', flag => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-version-output-'));
    try {
      const root = path.resolve(__dirname, '../..');
      const expected = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
      const result = spawnSync(process.execPath, [path.join(root, 'dist/index.js'), flag], {
        encoding: 'utf8', timeout: 15000,
        env: {...process.env, GUARDSCAN_HOME: home, GUARDSCAN_NO_TELEMETRY: 'true'},
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`${expected}\n`);
    } finally { fs.rmSync(home, {recursive: true, force: true}); }
  });
});

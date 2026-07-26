import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const original = {
  guardscanHome: process.env.GUARDSCAN_HOME,
  home: process.env.HOME,
  userProfile: process.env.USERPROFILE,
};
const isolatedHome = fs.mkdtempSync(
  path.join(os.tmpdir(), `guardscan-jest-${process.pid}-`)
);

process.env.GUARDSCAN_HOME = isolatedHome;
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;

afterEach(() => {
  // Command tests intentionally exercise failure paths; do not let their
  // process-level exit code leak into Jest's own result.
  process.exitCode = 0;
});

afterAll(() => {
  fs.rmSync(isolatedHome, { recursive: true, force: true });
  restore('GUARDSCAN_HOME', original.guardscanHome);
  restore('HOME', original.home);
  restore('USERPROFILE', original.userProfile);
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

import axios from "axios";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ConfigManager } from "../../src/core/config";
import { checkForUpdates } from "../../src/utils/version";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("version update checks", () => {
  const originalNoTelemetry = process.env.GUARDSCAN_NO_TELEMETRY;
  const originalOffline = process.env.GUARDSCAN_OFFLINE;
  const originalGuardScanHome = process.env.GUARDSCAN_HOME;
  let guardScanHome: string;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GUARDSCAN_NO_TELEMETRY;
    delete process.env.GUARDSCAN_OFFLINE;
    guardScanHome = fs.mkdtempSync(path.join(os.tmpdir(), "guardscan-version-"));
    process.env.GUARDSCAN_HOME = guardScanHome;
    new ConfigManager().save({
      provider: "none",
      telemetryEnabled: true,
      offlineMode: false,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    });
  });

  afterEach(() => {
    fs.rmSync(guardScanHome, { recursive: true, force: true });
  });

  afterAll(() => {
    if (originalNoTelemetry === undefined) {
      delete process.env.GUARDSCAN_NO_TELEMETRY;
    } else {
      process.env.GUARDSCAN_NO_TELEMETRY = originalNoTelemetry;
    }
    if (originalOffline === undefined) {
      delete process.env.GUARDSCAN_OFFLINE;
    } else {
      process.env.GUARDSCAN_OFFLINE = originalOffline;
    }
    if (originalGuardScanHome === undefined) {
      delete process.env.GUARDSCAN_HOME;
    } else {
      process.env.GUARDSCAN_HOME = originalGuardScanHome;
    }
  });

  it("skips the remote version check when telemetry is disabled for the command", async () => {
    process.env.GUARDSCAN_NO_TELEMETRY = "true";

    await checkForUpdates();

    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("skips the remote version check for numeric offline mode", async () => {
    process.env.GUARDSCAN_OFFLINE = " 1 ";

    await checkForUpdates();

    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

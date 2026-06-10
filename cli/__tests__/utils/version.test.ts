import axios from "axios";
import { checkForUpdates } from "../../src/utils/version";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("version update checks", () => {
  const originalNoTelemetry = process.env.GUARDSCAN_NO_TELEMETRY;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GUARDSCAN_NO_TELEMETRY;
  });

  afterAll(() => {
    if (originalNoTelemetry === undefined) {
      delete process.env.GUARDSCAN_NO_TELEMETRY;
    } else {
      process.env.GUARDSCAN_NO_TELEMETRY = originalNoTelemetry;
    }
  });

  it("skips the remote version check when telemetry is disabled for the command", async () => {
    process.env.GUARDSCAN_NO_TELEMETRY = "true";

    await checkForUpdates();

    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

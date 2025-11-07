import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface PerformanceMetrics {
  p50: number;  // 50th percentile (median)
  p95: number;  // 95th percentile
  p99: number;  // 99th percentile
  avg: number;  // Average response time
  min: number;  // Minimum response time
  max: number;  // Maximum response time
  rps: number;  // Requests per second
  errorRate: number;  // Error rate (0-1)
}

export interface PerformanceResult {
  framework: 'k6' | 'lighthouse';
  testType: 'load' | 'stress' | 'spike' | 'soak' | 'web';
  duration: number;  // Test duration in milliseconds
  metrics: PerformanceMetrics;
  passed: boolean;
  failures: string[];
  timestamp: string;
}

export interface K6Result {
  metrics: {
    http_req_duration: {
      values: {
        'p(50)': number;
        'p(95)': number;
        'p(99)': number;
        avg: number;
        min: number;
        max: number;
      };
    };
    http_reqs: {
      values: {
        rate: number;
        count: number;
      };
    };
    http_req_failed: {
      values: {
        rate: number;
      };
    };
  };
}

export interface LighthouseResult {
  categories: {
    performance: {
      score: number;  // 0-1
    };
    accessibility: {
      score: number;
    };
    'best-practices': {
      score: number;
    };
    seo: {
      score: number;
    };
  };
  audits: {
    'first-contentful-paint': {
      numericValue: number;
    };
    'largest-contentful-paint': {
      numericValue: number;
    };
    'total-blocking-time': {
      numericValue: number;
    };
    'cumulative-layout-shift': {
      numericValue: number;
    };
    'speed-index': {
      numericValue: number;
    };
  };
}

export interface Regression {
  metric: string;
  baseline: number;
  current: number;
  change: number;  // Percentage change
  threshold: number;  // Regression threshold
  isRegression: boolean;
}

export interface PerformanceConfig {
  endpoints?: Array<{
    url: string;
    method?: string;
    body?: string;
    expectedLatency?: number;
  }>;
  thresholds?: {
    p95?: number;
    errorRate?: number;
    throughput?: number;
  };
  duration?: string;  // e.g., '30s', '1m'
  vus?: number;  // Virtual users
  regressionThreshold?: number;  // e.g., 0.2 for 20%
  baselineFile?: string;
}

export class PerformanceTester {
  private readonly DEFAULT_CONFIG: PerformanceConfig = {
    duration: '30s',
    vus: 10,
    thresholds: {
      p95: 500,  // 500ms
      errorRate: 0.01,  // 1%
      throughput: 10,  // 10 req/s
    },
    regressionThreshold: 0.2,  // 20%
    baselineFile: '.guardscan/performance-baseline.json',
  };

  /**
   * Run load test
   */
  async runLoadTest(config?: PerformanceConfig): Promise<PerformanceResult> {
    const mergedConfig = { ...this.DEFAULT_CONFIG, ...config };

    // Check if k6 is available
    if (!this.isK6Available()) {
      throw new Error('k6 is not installed. Please install k6: https://k6.io/docs/getting-started/installation/');
    }

    // Generate k6 script
    const scriptPath = await this.generateK6Script(mergedConfig, 'load');

    try {
      // Run k6
      const output = execSync(`k6 run --out json=k6-results.json ${scriptPath}`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        timeout: 300000,  // 5 minutes
      });

      // Parse results
      const result = this.parseK6Output(output, 'load');

      // Check thresholds
      result.passed = this.checkThresholds(result.metrics, mergedConfig.thresholds);
      if (!result.passed) {
        result.failures = this.getThresholdFailures(result.metrics, mergedConfig.thresholds);
      }

      // Clean up
      fs.unlinkSync(scriptPath);
      if (fs.existsSync('k6-results.json')) {
        fs.unlinkSync('k6-results.json');
      }

      return result;
    } catch (error) {
      throw new Error(`k6 load test failed: ${error}`);
    }
  }

  /**
   * Run stress test (increasing load)
   */
  async runStressTest(config?: PerformanceConfig): Promise<PerformanceResult> {
    const mergedConfig = { ...this.DEFAULT_CONFIG, ...config };

    if (!this.isK6Available()) {
      throw new Error('k6 is not installed');
    }

    const scriptPath = await this.generateK6Script(mergedConfig, 'stress');

    try {
      const output = execSync(`k6 run ${scriptPath}`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        timeout: 600000,  // 10 minutes
      });

      const result = this.parseK6Output(output, 'stress');
      result.passed = this.checkThresholds(result.metrics, mergedConfig.thresholds);

      fs.unlinkSync(scriptPath);
      return result;
    } catch (error) {
      throw new Error(`k6 stress test failed: ${error}`);
    }
  }

  /**
   * Run Lighthouse audit for web performance
   */
  async runLighthouse(url: string): Promise<PerformanceResult> {
    if (!this.isLighthouseAvailable()) {
      throw new Error('Lighthouse is not installed. Please install: npm install -g lighthouse');
    }

    try {
      const output = execSync(`lighthouse ${url} --output=json --output-path=/tmp/lh-report.json --chrome-flags="--headless"`, {
        encoding: 'utf-8',
        timeout: 120000,  // 2 minutes
      });

      const reportPath = '/tmp/lh-report.json';
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as LighthouseResult;

      const result: PerformanceResult = {
        framework: 'lighthouse',
        testType: 'web',
        duration: 0,
        metrics: {
          p50: report.audits['first-contentful-paint'].numericValue,
          p95: report.audits['largest-contentful-paint'].numericValue,
          p99: report.audits['speed-index'].numericValue,
          avg: report.audits['total-blocking-time'].numericValue,
          min: 0,
          max: 0,
          rps: 0,
          errorRate: 0,
        },
        passed: report.categories.performance.score >= 0.9,  // 90% threshold
        failures: [],
        timestamp: new Date().toISOString(),
      };

      if (!result.passed) {
        result.failures.push(`Performance score: ${(report.categories.performance.score * 100).toFixed(0)}% (expected >= 90%)`);
      }

      // Clean up
      if (fs.existsSync(reportPath)) {
        fs.unlinkSync(reportPath);
      }

      return result;
    } catch (error) {
      throw new Error(`Lighthouse audit failed: ${error}`);
    }
  }

  /**
   * Detect regressions by comparing with baseline
   */
  detectRegressions(current: PerformanceResult, baselinePath?: string): Regression[] {
    const regressions: Regression[] = [];
    const path = baselinePath || this.DEFAULT_CONFIG.baselineFile!;

    if (!fs.existsSync(path)) {
      return regressions;  // No baseline to compare
    }

    try {
      const baseline: PerformanceResult = JSON.parse(fs.readFileSync(path, 'utf-8'));

      const metrics: Array<keyof PerformanceMetrics> = ['p50', 'p95', 'p99', 'avg'];

      for (const metric of metrics) {
        const baselineValue = baseline.metrics[metric];
        const currentValue = current.metrics[metric];

        const change = ((currentValue - baselineValue) / baselineValue);
        const threshold = this.DEFAULT_CONFIG.regressionThreshold!;

        const isRegression = change > threshold;  // Slower is regression

        regressions.push({
          metric,
          baseline: baselineValue,
          current: currentValue,
          change: change * 100,  // Convert to percentage
          threshold: threshold * 100,
          isRegression,
        });
      }
    } catch (error) {
      // Baseline file corrupted or invalid
    }

    return regressions;
  }

  /**
   * Save baseline for future comparisons
   */
  saveBaseline(result: PerformanceResult, filePath?: string): void {
    const outputPath = filePath || this.DEFAULT_CONFIG.baselineFile!;
    const dir = path.dirname(outputPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  }

  /**
   * Generate k6 test script
   */
  private async generateK6Script(config: PerformanceConfig, testType: 'load' | 'stress' | 'spike'): Promise<string> {
    const endpoint = config.endpoints?.[0] || { url: 'http://localhost:3000', method: 'GET' };

    let stages = '';
    if (testType === 'load') {
      stages = `
    stages: [
      { duration: '${config.duration}', target: ${config.vus} },
    ],`;
    } else if (testType === 'stress') {
      stages = `
    stages: [
      { duration: '1m', target: 10 },
      { duration: '2m', target: 50 },
      { duration: '2m', target: 100 },
      { duration: '1m', target: 0 },
    ],`;
    } else if (testType === 'spike') {
      stages = `
    stages: [
      { duration: '30s', target: 10 },
      { duration: '10s', target: 100 },  // Spike
      { duration: '30s', target: 10 },
      { duration: '30s', target: 0 },
    ],`;
    }

    const script = `
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {${stages}
  thresholds: {
    http_req_duration: ['p(95)<${config.thresholds?.p95 || 500}'],
    http_req_failed: ['rate<${config.thresholds?.errorRate || 0.01}'],
  },
};

export default function () {
  const res = http.${endpoint.method?.toLowerCase() || 'get'}('${endpoint.url}'${endpoint.body ? `, '${endpoint.body}'` : ''});

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < ${endpoint.expectedLatency || 200}ms': (r) => r.timings.duration < ${endpoint.expectedLatency || 200},
  });

  sleep(1);
}
`;

    const scriptPath = '/tmp/k6-test.js';
    fs.writeFileSync(scriptPath, script);

    return scriptPath;
  }

  /**
   * Parse k6 output
   */
  private parseK6Output(output: string, testType: string): PerformanceResult {
    // k6 outputs summary in text format at the end
    const lines = output.split('\n');

    let p50 = 0, p95 = 0, p99 = 0, avg = 0, min = 0, max = 0;
    let rps = 0, errorRate = 0;

    for (const line of lines) {
      // Parse http_req_duration metrics
      if (line.includes('http_req_duration')) {
        const match = line.match(/avg=([0-9.]+)ms.*min=([0-9.]+)ms.*med=([0-9.]+)ms.*max=([0-9.]+)ms.*p\(95\)=([0-9.]+)ms.*p\(99\)=([0-9.]+)ms/);
        if (match) {
          avg = parseFloat(match[1]);
          min = parseFloat(match[2]);
          p50 = parseFloat(match[3]);
          max = parseFloat(match[4]);
          p95 = parseFloat(match[5]);
          p99 = parseFloat(match[6]);
        }
      }

      // Parse request rate
      if (line.includes('http_reqs')) {
        const match = line.match(/([0-9.]+)\/s/);
        if (match) {
          rps = parseFloat(match[1]);
        }
      }

      // Parse error rate
      if (line.includes('http_req_failed')) {
        const match = line.match(/([0-9.]+)%/);
        if (match) {
          errorRate = parseFloat(match[1]) / 100;
        }
      }
    }

    return {
      framework: 'k6',
      testType: testType as any,
      duration: 0,
      metrics: { p50, p95, p99, avg, min, max, rps, errorRate },
      passed: true,  // Will be checked later
      failures: [],
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check if thresholds are met
   */
  private checkThresholds(metrics: PerformanceMetrics, thresholds?: PerformanceConfig['thresholds']): boolean {
    if (!thresholds) return true;

    if (thresholds.p95 && metrics.p95 > thresholds.p95) return false;
    if (thresholds.errorRate && metrics.errorRate > thresholds.errorRate) return false;
    if (thresholds.throughput && metrics.rps < thresholds.throughput) return false;

    return true;
  }

  /**
   * Get threshold failures
   */
  private getThresholdFailures(metrics: PerformanceMetrics, thresholds?: PerformanceConfig['thresholds']): string[] {
    const failures: string[] = [];

    if (!thresholds) return failures;

    if (thresholds.p95 && metrics.p95 > thresholds.p95) {
      failures.push(`P95 latency ${metrics.p95.toFixed(2)}ms exceeds threshold ${thresholds.p95}ms`);
    }

    if (thresholds.errorRate && metrics.errorRate > thresholds.errorRate) {
      failures.push(`Error rate ${(metrics.errorRate * 100).toFixed(2)}% exceeds threshold ${(thresholds.errorRate * 100).toFixed(2)}%`);
    }

    if (thresholds.throughput && metrics.rps < thresholds.throughput) {
      failures.push(`Throughput ${metrics.rps.toFixed(2)} req/s below threshold ${thresholds.throughput} req/s`);
    }

    return failures;
  }

  /**
   * Check if k6 is installed
   */
  private isK6Available(): boolean {
    try {
      execSync('k6 version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Lighthouse is installed
   */
  private isLighthouseAvailable(): boolean {
    try {
      execSync('lighthouse --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

export const performanceTester = new PerformanceTester();

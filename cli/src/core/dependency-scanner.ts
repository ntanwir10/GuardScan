import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface DependencyVulnerability {
  package: string;
  version: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  cve?: string;
  recommendation: string;
  ecosystem: 'npm' | 'pip' | 'go' | 'ruby' | 'cargo' | 'maven';
}

export interface DependencyScanResult {
  vulnerabilities: DependencyVulnerability[];
  totalVulnerabilities: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  ecosystem: string;
}

export class DependencyScanner {
  /**
   * Scan dependencies for vulnerabilities
   */
  async scan(repoPath: string = process.cwd()): Promise<DependencyScanResult[]> {
    const results: DependencyScanResult[] = [];

    // Scan npm dependencies
    if (fs.existsSync(path.join(repoPath, 'package.json'))) {
      const npmResult = await this.scanNpm(repoPath);
      if (npmResult) results.push(npmResult);
    }

    // Scan Python dependencies
    if (fs.existsSync(path.join(repoPath, 'requirements.txt')) ||
        fs.existsSync(path.join(repoPath, 'Pipfile'))) {
      const pipResult = await this.scanPip(repoPath);
      if (pipResult) results.push(pipResult);
    }

    // Scan Go dependencies
    if (fs.existsSync(path.join(repoPath, 'go.mod'))) {
      const goResult = await this.scanGo(repoPath);
      if (goResult) results.push(goResult);
    }

    // Scan Ruby dependencies
    if (fs.existsSync(path.join(repoPath, 'Gemfile'))) {
      const rubyResult = await this.scanRuby(repoPath);
      if (rubyResult) results.push(rubyResult);
    }

    // Scan Rust dependencies
    if (fs.existsSync(path.join(repoPath, 'Cargo.toml'))) {
      const cargoResult = await this.scanCargo(repoPath);
      if (cargoResult) results.push(cargoResult);
    }

    return results;
  }

  /**
   * Scan npm dependencies using npm audit
   */
  private async scanNpm(repoPath: string): Promise<DependencyScanResult | null> {
    try {
      const result = execSync('npm audit --json', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });

      const auditData = JSON.parse(result);
      const vulnerabilities: DependencyVulnerability[] = [];

      if (auditData.vulnerabilities) {
        for (const [pkgName, vuln] of Object.entries(auditData.vulnerabilities as any)) {
          const v = vuln as any;
          vulnerabilities.push({
            package: pkgName,
            version: v.range || 'unknown',
            severity: this.mapSeverity(v.severity),
            title: v.via?.[0]?.title || 'Vulnerability detected',
            cve: v.via?.[0]?.cve || undefined,
            recommendation: v.fixAvailable ? `Update to ${v.fixAvailable.version}` : 'Review and update',
            ecosystem: 'npm',
          });
        }
      }

      return {
        vulnerabilities,
        totalVulnerabilities: vulnerabilities.length,
        critical: vulnerabilities.filter(v => v.severity === 'critical').length,
        high: vulnerabilities.filter(v => v.severity === 'high').length,
        medium: vulnerabilities.filter(v => v.severity === 'medium').length,
        low: vulnerabilities.filter(v => v.severity === 'low').length,
        ecosystem: 'npm',
      };
    } catch (error) {
      // npm audit returns exit code 1 if vulnerabilities found, parse anyway
      try {
        const errorOutput = (error as any).stdout || '';
        if (errorOutput) {
          const auditData = JSON.parse(errorOutput);
          const vulnerabilities: DependencyVulnerability[] = [];

          if (auditData.vulnerabilities) {
            for (const [pkgName, vuln] of Object.entries(auditData.vulnerabilities as any)) {
              const v = vuln as any;
              vulnerabilities.push({
                package: pkgName,
                version: v.range || 'unknown',
                severity: this.mapSeverity(v.severity),
                title: v.via?.[0]?.title || 'Vulnerability detected',
                cve: v.via?.[0]?.cve || undefined,
                recommendation: v.fixAvailable ? `Update to ${v.fixAvailable.version}` : 'Review and update',
                ecosystem: 'npm',
              });
            }
          }

          return {
            vulnerabilities,
            totalVulnerabilities: vulnerabilities.length,
            critical: vulnerabilities.filter(v => v.severity === 'critical').length,
            high: vulnerabilities.filter(v => v.severity === 'high').length,
            medium: vulnerabilities.filter(v => v.severity === 'medium').length,
            low: vulnerabilities.filter(v => v.severity === 'low').length,
            ecosystem: 'npm',
          };
        }
      } catch {
        // If parsing fails, return null
      }
      return null;
    }
  }

  /**
   * Scan Python dependencies using pip-audit (if available) or safety
   */
  private async scanPip(repoPath: string): Promise<DependencyScanResult | null> {
    try {
      // Try pip-audit first
      const result = execSync('pip-audit --format json 2>/dev/null || echo "[]"', {
        cwd: repoPath,
        encoding: 'utf-8',
        shell: '/bin/bash',
      });

      const auditData = JSON.parse(result);
      const vulnerabilities: DependencyVulnerability[] = [];

      if (Array.isArray(auditData.vulnerabilities)) {
        for (const vuln of auditData.vulnerabilities) {
          vulnerabilities.push({
            package: vuln.name,
            version: vuln.version,
            severity: this.mapSeverity(vuln.severity || 'medium'),
            title: vuln.description || 'Vulnerability detected',
            cve: vuln.id,
            recommendation: `Update to ${vuln.fix_versions?.[0] || 'latest version'}`,
            ecosystem: 'pip',
          });
        }
      }

      return {
        vulnerabilities,
        totalVulnerabilities: vulnerabilities.length,
        critical: vulnerabilities.filter(v => v.severity === 'critical').length,
        high: vulnerabilities.filter(v => v.severity === 'high').length,
        medium: vulnerabilities.filter(v => v.severity === 'medium').length,
        low: vulnerabilities.filter(v => v.severity === 'low').length,
        ecosystem: 'pip',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Scan Go dependencies using govulncheck
   */
  private async scanGo(repoPath: string): Promise<DependencyScanResult | null> {
    try {
      const result = execSync('govulncheck -json . 2>/dev/null || echo "[]"', {
        cwd: repoPath,
        encoding: 'utf-8',
        shell: '/bin/bash',
      });

      const vulnerabilities: DependencyVulnerability[] = [];
      // Parse govulncheck output (it's line-delimited JSON)
      const lines = result.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const vuln = JSON.parse(line);
          if (vuln.osv) {
            vulnerabilities.push({
              package: vuln.osv.affected?.[0]?.package?.name || 'unknown',
              version: 'unknown',
              severity: 'medium',
              title: vuln.osv.summary || 'Vulnerability detected',
              cve: vuln.osv.id,
              recommendation: 'Update dependency',
              ecosystem: 'go',
            });
          }
        } catch {
          // Skip invalid JSON lines
        }
      }

      return {
        vulnerabilities,
        totalVulnerabilities: vulnerabilities.length,
        critical: vulnerabilities.filter(v => v.severity === 'critical').length,
        high: vulnerabilities.filter(v => v.severity === 'high').length,
        medium: vulnerabilities.filter(v => v.severity === 'medium').length,
        low: vulnerabilities.filter(v => v.severity === 'low').length,
        ecosystem: 'go',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Scan Ruby dependencies using bundler-audit
   */
  private async scanRuby(repoPath: string): Promise<DependencyScanResult | null> {
    try {
      const result = execSync('bundle audit check --format json 2>/dev/null || echo "{}"', {
        cwd: repoPath,
        encoding: 'utf-8',
        shell: '/bin/bash',
      });

      const auditData = JSON.parse(result);
      const vulnerabilities: DependencyVulnerability[] = [];

      if (auditData.results) {
        for (const vuln of auditData.results) {
          vulnerabilities.push({
            package: vuln.gem,
            version: vuln.version,
            severity: this.mapSeverity(vuln.criticality || 'medium'),
            title: vuln.title || 'Vulnerability detected',
            cve: vuln.cve,
            recommendation: `Update to ${vuln.patched_versions?.[0] || 'latest version'}`,
            ecosystem: 'ruby',
          });
        }
      }

      return {
        vulnerabilities,
        totalVulnerabilities: vulnerabilities.length,
        critical: vulnerabilities.filter(v => v.severity === 'critical').length,
        high: vulnerabilities.filter(v => v.severity === 'high').length,
        medium: vulnerabilities.filter(v => v.severity === 'medium').length,
        low: vulnerabilities.filter(v => v.severity === 'low').length,
        ecosystem: 'ruby',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Scan Rust dependencies using cargo-audit
   */
  private async scanCargo(repoPath: string): Promise<DependencyScanResult | null> {
    try {
      const result = execSync('cargo audit --json 2>/dev/null || echo "{}"', {
        cwd: repoPath,
        encoding: 'utf-8',
        shell: '/bin/bash',
      });

      const auditData = JSON.parse(result);
      const vulnerabilities: DependencyVulnerability[] = [];

      if (auditData.vulnerabilities?.list) {
        for (const vuln of auditData.vulnerabilities.list) {
          vulnerabilities.push({
            package: vuln.package,
            version: vuln.version,
            severity: this.mapSeverity(vuln.severity || 'medium'),
            title: vuln.title || 'Vulnerability detected',
            cve: vuln.cve,
            recommendation: `Update to ${vuln.patched_versions?.[0] || 'latest version'}`,
            ecosystem: 'cargo',
          });
        }
      }

      return {
        vulnerabilities,
        totalVulnerabilities: vulnerabilities.length,
        critical: vulnerabilities.filter(v => v.severity === 'critical').length,
        high: vulnerabilities.filter(v => v.severity === 'high').length,
        medium: vulnerabilities.filter(v => v.severity === 'medium').length,
        low: vulnerabilities.filter(v => v.severity === 'low').length,
        ecosystem: 'cargo',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Map various severity strings to our standard levels
   */
  private mapSeverity(severity: string): 'critical' | 'high' | 'medium' | 'low' {
    const s = severity.toLowerCase();
    if (s.includes('critical')) return 'critical';
    if (s.includes('high')) return 'high';
    if (s.includes('medium') || s.includes('moderate')) return 'medium';
    return 'low';
  }
}

export const dependencyScanner = new DependencyScanner();

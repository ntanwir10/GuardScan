import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface LicenseFinding {
  package: string;
  version: string;
  license: string; // SPDX identifier
  category: 'permissive' | 'weak-copyleft' | 'strong-copyleft' | 'proprietary' | 'unknown';
  risk: 'critical' | 'high' | 'medium' | 'low' | 'info';
  description: string;
  source: 'npm' | 'pip' | 'go' | 'cargo' | 'maven' | 'rubygems';
}

export interface CompatibilityIssue {
  package1: string;
  license1: string;
  package2: string;
  license2: string;
  conflict: string;
  severity: 'critical' | 'high' | 'medium';
  recommendation: string;
}

export interface LicenseReport {
  totalDependencies: number;
  findings: LicenseFinding[];
  compatibilityIssues: CompatibilityIssue[];
  riskSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  categorySummary: {
    permissive: number;
    'weak-copyleft': number;
    'strong-copyleft': number;
    proprietary: number;
    unknown: number;
  };
  sbom?: SBOMDocument;
}

export interface SBOMDocument {
  format: 'spdx' | 'cyclonedx';
  version: string;
  name: string;
  packages: SBOMPackage[];
  timestamp: string;
}

export interface SBOMPackage {
  name: string;
  version: string;
  license: string;
  purl?: string; // Package URL
  cpe?: string;  // Common Platform Enumeration
}

export class LicenseScanner {
  // License compatibility matrix
  private readonly COMPATIBILITY_MATRIX: Record<string, { compatible: string[]; incompatible?: string[] }> = {
    'MIT': { compatible: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'GPL-*', 'LGPL-*', 'AGPL-*'] },
    'Apache-2.0': { compatible: ['MIT', 'Apache-2.0', 'BSD-*', 'ISC', 'GPL-3.0', 'GPL-3.0+', 'LGPL-*', 'AGPL-3.0'], incompatible: ['GPL-2.0'] },
    'BSD-2-Clause': { compatible: ['MIT', 'Apache-2.0', 'BSD-*', 'ISC', 'GPL-*', 'LGPL-*'] },
    'BSD-3-Clause': { compatible: ['MIT', 'Apache-2.0', 'BSD-*', 'ISC', 'GPL-*', 'LGPL-*'] },
    'ISC': { compatible: ['MIT', 'Apache-2.0', 'BSD-*', 'ISC', 'GPL-*', 'LGPL-*'] },
    'GPL-2.0': { compatible: ['GPL-2.0', 'LGPL-2.0', 'LGPL-2.1'], incompatible: ['Apache-2.0', 'GPL-3.0', 'proprietary'] },
    'GPL-2.0-only': { compatible: ['GPL-2.0', 'LGPL-2.0', 'LGPL-2.1'], incompatible: ['Apache-2.0', 'GPL-3.0', 'proprietary'] },
    'GPL-2.0-or-later': { compatible: ['GPL-2.0', 'GPL-3.0', 'LGPL-*'], incompatible: ['proprietary'] },
    'GPL-3.0': { compatible: ['GPL-3.0', 'LGPL-3.0', 'Apache-2.0', 'MIT', 'BSD-*'], incompatible: ['GPL-2.0', 'proprietary'] },
    'GPL-3.0-only': { compatible: ['GPL-3.0', 'LGPL-3.0', 'Apache-2.0'], incompatible: ['GPL-2.0', 'proprietary'] },
    'GPL-3.0-or-later': { compatible: ['GPL-3.0', 'AGPL-3.0', 'LGPL-3.0', 'Apache-2.0'], incompatible: ['GPL-2.0', 'proprietary'] },
    'LGPL-2.0': { compatible: ['LGPL-2.0', 'LGPL-2.1', 'GPL-2.0', 'GPL-3.0', 'MIT', 'Apache-2.0', 'BSD-*'] },
    'LGPL-2.1': { compatible: ['LGPL-2.1', 'GPL-2.0', 'GPL-3.0', 'MIT', 'Apache-2.0', 'BSD-*'] },
    'LGPL-3.0': { compatible: ['LGPL-3.0', 'GPL-3.0', 'MIT', 'Apache-2.0', 'BSD-*'], incompatible: ['GPL-2.0'] },
    'AGPL-3.0': { compatible: ['AGPL-3.0', 'GPL-3.0'], incompatible: ['proprietary', 'MIT', 'Apache-2.0', 'BSD-*'] },
    'AGPL-3.0-only': { compatible: ['AGPL-3.0', 'GPL-3.0'], incompatible: ['proprietary'] },
    'MPL-2.0': { compatible: ['MIT', 'Apache-2.0', 'BSD-*', 'GPL-*', 'LGPL-*'] },
    'UNLICENSED': { compatible: [], incompatible: ['*'] },
    'proprietary': { compatible: ['MIT', 'Apache-2.0', 'BSD-*', 'ISC'], incompatible: ['GPL-*', 'AGPL-*', 'LGPL-*'] },
  };

  /**
   * Scan repository for license compliance
   */
  async scan(repoPath: string = process.cwd(), projectType: 'proprietary' | 'open-source' = 'proprietary'): Promise<LicenseReport> {
    const findings: LicenseFinding[] = [];

    // Scan different ecosystems
    findings.push(...await this.scanNpm(repoPath));
    findings.push(...await this.scanPip(repoPath));
    findings.push(...await this.scanGo(repoPath));
    findings.push(...await this.scanCargo(repoPath));
    findings.push(...await this.scanMaven(repoPath));
    findings.push(...await this.scanRubygems(repoPath));

    // Calculate risk for each finding
    findings.forEach(finding => {
      finding.risk = this.calculateRisk(finding.license, finding.category, projectType);
    });

    // Check compatibility
    const compatibilityIssues = this.checkCompatibility(findings, projectType);

    // Generate summary
    const riskSummary = {
      critical: findings.filter(f => f.risk === 'critical').length,
      high: findings.filter(f => f.risk === 'high').length,
      medium: findings.filter(f => f.risk === 'medium').length,
      low: findings.filter(f => f.risk === 'low').length,
      info: findings.filter(f => f.risk === 'info').length,
    };

    const categorySummary = {
      permissive: findings.filter(f => f.category === 'permissive').length,
      'weak-copyleft': findings.filter(f => f.category === 'weak-copyleft').length,
      'strong-copyleft': findings.filter(f => f.category === 'strong-copyleft').length,
      proprietary: findings.filter(f => f.category === 'proprietary').length,
      unknown: findings.filter(f => f.category === 'unknown').length,
    };

    return {
      totalDependencies: findings.length,
      findings,
      compatibilityIssues,
      riskSummary,
      categorySummary,
    };
  }

  /**
   * Scan npm packages
   */
  private async scanNpm(repoPath: string): Promise<LicenseFinding[]> {
    const findings: LicenseFinding[] = [];
    const packageJsonPath = path.join(repoPath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      return findings;
    }

    try {
      // Try using license-checker if available
      const output = execSync('npx license-checker --json', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 30000,
      });

      const licenses = JSON.parse(output);

      for (const [pkg, data] of Object.entries(licenses as any)) {
        const [name, version] = pkg.split('@').filter(Boolean);
        const license = (data as any).licenses || 'Unknown';

        findings.push({
          package: name || pkg,
          version: version || 'unknown',
          license: this.normalizeLicense(license),
          category: this.categorizeLicense(license),
          risk: 'info', // Will be calculated later
          description: `npm package: ${name}@${version}`,
          source: 'npm',
        });
      }
    } catch (error) {
      // Fallback: parse package.json manually
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        for (const [name, version] of Object.entries(allDeps)) {
          findings.push({
            package: name,
            version: (version as string).replace(/[\^~>=<]/, ''),
            license: 'Unknown',
            category: 'unknown',
            risk: 'info',
            description: `npm package: ${name} (license detection failed)`,
            source: 'npm',
          });
        }
      } catch {
        // Skip
      }
    }

    return findings;
  }

  /**
   * Scan pip packages
   */
  private async scanPip(repoPath: string): Promise<LicenseFinding[]> {
    const findings: LicenseFinding[] = [];
    const requirementsPath = path.join(repoPath, 'requirements.txt');

    if (!fs.existsSync(requirementsPath)) {
      return findings;
    }

    try {
      // Try using pip-licenses if available
      const output = execSync('pip-licenses --format=json', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 30000,
      });

      const licenses = JSON.parse(output);

      for (const pkg of licenses) {
        findings.push({
          package: pkg.Name,
          version: pkg.Version,
          license: this.normalizeLicense(pkg.License),
          category: this.categorizeLicense(pkg.License),
          risk: 'info',
          description: `pip package: ${pkg.Name}@${pkg.Version}`,
          source: 'pip',
        });
      }
    } catch (error) {
      // Fallback: parse requirements.txt
      try {
        const requirements = fs.readFileSync(requirementsPath, 'utf-8');
        const lines = requirements.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;

          const match = trimmed.match(/^([a-zA-Z0-9\-_]+)([>=<~!].+)?$/);
          if (match) {
            findings.push({
              package: match[1],
              version: match[2] ? match[2].replace(/[>=<~!]/, '') : 'unknown',
              license: 'Unknown',
              category: 'unknown',
              risk: 'info',
              description: `pip package: ${match[1]} (license detection failed)`,
              source: 'pip',
            });
          }
        }
      } catch {
        // Skip
      }
    }

    return findings;
  }

  /**
   * Scan Go modules
   */
  private async scanGo(repoPath: string): Promise<LicenseFinding[]> {
    const findings: LicenseFinding[] = [];
    const goModPath = path.join(repoPath, 'go.mod');

    if (!fs.existsSync(goModPath)) {
      return findings;
    }

    try {
      const output = execSync('go list -m -json all', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 30000,
      });

      // Parse NDJSON
      const lines = output.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const mod = JSON.parse(line);
          if (mod.Path && mod.Version) {
            findings.push({
              package: mod.Path,
              version: mod.Version,
              license: 'Unknown', // Go doesn't provide license info in go list
              category: 'unknown',
              risk: 'info',
              description: `Go module: ${mod.Path}@${mod.Version}`,
              source: 'go',
            });
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Skip
    }

    return findings;
  }

  /**
   * Scan Cargo packages
   */
  private async scanCargo(repoPath: string): Promise<LicenseFinding[]> {
    const findings: LicenseFinding[] = [];
    const cargoTomlPath = path.join(repoPath, 'Cargo.toml');

    if (!fs.existsSync(cargoTomlPath)) {
      return findings;
    }

    try {
      const output = execSync('cargo metadata --format-version 1', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 30000,
      });

      const metadata = JSON.parse(output);

      for (const pkg of metadata.packages || []) {
        findings.push({
          package: pkg.name,
          version: pkg.version,
          license: this.normalizeLicense(pkg.license || 'Unknown'),
          category: this.categorizeLicense(pkg.license || 'Unknown'),
          risk: 'info',
          description: `Cargo crate: ${pkg.name}@${pkg.version}`,
          source: 'cargo',
        });
      }
    } catch {
      // Skip
    }

    return findings;
  }

  /**
   * Scan Maven dependencies
   */
  private async scanMaven(repoPath: string): Promise<LicenseFinding[]> {
    const findings: LicenseFinding[] = [];
    const pomPath = path.join(repoPath, 'pom.xml');

    if (!fs.existsSync(pomPath)) {
      return findings;
    }

    // Maven license scanning is complex, would require parsing pom.xml
    // For now, return empty (can be enhanced later)

    return findings;
  }

  /**
   * Scan Ruby gems
   */
  private async scanRubygems(repoPath: string): Promise<LicenseFinding[]> {
    const findings: LicenseFinding[] = [];
    const gemfilePath = path.join(repoPath, 'Gemfile');

    if (!fs.existsSync(gemfilePath)) {
      return findings;
    }

    try {
      const output = execSync('bundle exec gem list --local', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 30000,
      });

      // Parse gem list output
      const lines = output.split('\n');
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9\-_]+)\s+\(([^)]+)\)/);
        if (match) {
          findings.push({
            package: match[1],
            version: match[2],
            license: 'Unknown',
            category: 'unknown',
            risk: 'info',
            description: `Ruby gem: ${match[1]}@${match[2]}`,
            source: 'rubygems',
          });
        }
      }
    } catch {
      // Skip
    }

    return findings;
  }

  /**
   * Normalize license identifier to SPDX format
   */
  private normalizeLicense(license: string): string {
    if (!license || license === 'UNKNOWN') return 'Unknown';

    // Common variations
    const normalizations: Record<string, string> = {
      'MIT': 'MIT',
      'Apache-2.0': 'Apache-2.0',
      'Apache 2.0': 'Apache-2.0',
      'BSD': 'BSD-3-Clause',
      'BSD-3': 'BSD-3-Clause',
      'BSD-2': 'BSD-2-Clause',
      'ISC': 'ISC',
      'GPL-2.0': 'GPL-2.0-only',
      'GPL-3.0': 'GPL-3.0-only',
      'GPLv2': 'GPL-2.0-only',
      'GPLv3': 'GPL-3.0-only',
      'LGPL-2.1': 'LGPL-2.1-only',
      'LGPL-3.0': 'LGPL-3.0-only',
      'AGPL-3.0': 'AGPL-3.0-only',
      'MPL-2.0': 'MPL-2.0',
      'UNLICENSED': 'UNLICENSED',
      'proprietary': 'proprietary',
    };

    return normalizations[license] || license;
  }

  /**
   * Categorize license
   */
  private categorizeLicense(license: string): 'permissive' | 'weak-copyleft' | 'strong-copyleft' | 'proprietary' | 'unknown' {
    const normalized = this.normalizeLicense(license);

    const permissive = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'CC0-1.0'];
    const weakCopyleft = ['LGPL-2.0', 'LGPL-2.1', 'LGPL-3.0', 'MPL-2.0', 'EPL-1.0', 'EPL-2.0'];
    const strongCopyleft = ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'OSL-3.0'];

    if (permissive.some(p => normalized.includes(p))) return 'permissive';
    if (weakCopyleft.some(w => normalized.includes(w))) return 'weak-copyleft';
    if (strongCopyleft.some(s => normalized.includes(s))) return 'strong-copyleft';
    if (normalized === 'UNLICENSED' || normalized === 'proprietary') return 'proprietary';

    return 'unknown';
  }

  /**
   * Calculate risk level for a license
   */
  private calculateRisk(
    license: string,
    category: string,
    projectType: 'proprietary' | 'open-source'
  ): 'critical' | 'high' | 'medium' | 'low' | 'info' {
    const normalized = this.normalizeLicense(license);

    // Critical risks
    if (projectType === 'proprietary') {
      // GPL/AGPL in proprietary project is critical
      if (normalized.includes('GPL') || normalized.includes('AGPL')) {
        return 'critical';
      }
    }

    // High risks
    if (normalized === 'UNLICENSED' || normalized === 'Unknown') {
      return 'high'; // Unknown license is risky
    }

    // Medium risks
    if (category === 'weak-copyleft' && projectType === 'proprietary') {
      return 'medium'; // LGPL requires compliance
    }

    // Low risks
    if (category === 'permissive') {
      return 'low'; // MIT, Apache are low risk
    }

    return 'info';
  }

  /**
   * Check license compatibility
   */
  private checkCompatibility(findings: LicenseFinding[], projectType: string): CompatibilityIssue[] {
    const issues: CompatibilityIssue[] = [];

    // Check each pair of licenses
    for (let i = 0; i < findings.length; i++) {
      for (let j = i + 1; j < findings.length; j++) {
        const f1 = findings[i];
        const f2 = findings[j];

        const conflict = this.checkLicenseConflict(f1.license, f2.license);
        if (conflict) {
          issues.push({
            package1: f1.package,
            license1: f1.license,
            package2: f2.package,
            license2: f2.license,
            conflict: conflict.reason,
            severity: conflict.severity,
            recommendation: conflict.recommendation,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check if two licenses conflict
   */
  private checkLicenseConflict(
    license1: string,
    license2: string
  ): { reason: string; severity: 'critical' | 'high' | 'medium'; recommendation: string } | null {
    const l1 = this.normalizeLicense(license1);
    const l2 = this.normalizeLicense(license2);

    const compat1 = this.COMPATIBILITY_MATRIX[l1];
    const compat2 = this.COMPATIBILITY_MATRIX[l2];

    if (!compat1 || !compat2) return null;

    // Check if explicitly incompatible
    if (compat1.incompatible) {
      for (const incompatible of compat1.incompatible) {
        if (incompatible === '*' || l2.includes(incompatible.replace('*', ''))) {
          return {
            reason: `${l1} is incompatible with ${l2}`,
            severity: l1.includes('GPL') || l2.includes('GPL') ? 'critical' : 'high',
            recommendation: `Choose compatible licenses or separate into different modules`,
          };
        }
      }
    }

    // GPL-2.0 and Apache-2.0 conflict
    if ((l1.includes('GPL-2.0') && l2.includes('Apache-2.0')) ||
        (l2.includes('GPL-2.0') && l1.includes('Apache-2.0'))) {
      return {
        reason: 'GPL-2.0 and Apache-2.0 are incompatible',
        severity: 'critical',
        recommendation: 'Upgrade to GPL-3.0 or remove Apache-2.0 dependency',
      };
    }

    return null;
  }

  /**
   * Generate SBOM (Software Bill of Materials)
   */
  generateSBOM(findings: LicenseFinding[], format: 'spdx' | 'cyclonedx' = 'spdx', projectName: string = 'unknown'): SBOMDocument {
    const packages: SBOMPackage[] = findings.map(f => ({
      name: f.package,
      version: f.version,
      license: f.license,
      purl: this.generatePURL(f),
    }));

    return {
      format,
      version: format === 'spdx' ? '2.3' : '1.4',
      name: projectName,
      packages,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generate Package URL (PURL)
   */
  private generatePURL(finding: LicenseFinding): string {
    const type = finding.source;
    const name = finding.package;
    const version = finding.version;

    return `pkg:${type}/${name}@${version}`;
  }
}

export const licenseScanner = new LicenseScanner();

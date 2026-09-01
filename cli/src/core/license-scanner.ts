import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import packageManifest from '../../package.json';
import {
  collectPackageInventory,
  DependencyCoordinate,
  PackageInventory,
  PackageInventoryError,
} from './package-inventory';
import { runProcess } from '../utils/process-runner';

export interface LicenseFinding {
  package: string;
  version: string;
  scope?: DependencyCoordinate['scope'];
  direct?: boolean;
  dependencyPaths?: string[];
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
  inventoryErrors: PackageInventoryError[];
  sbom?: SBOMDocument;
}

export interface LicenseScanOptions {
  offline?: boolean;
  /** Explicit capability for installed ecosystem tools that may execute repository code. */
  runProjectCode?: boolean;
  networkIsolation?: boolean;
  /** Reuse a caller-owned inventory when vulnerability and SBOM work share a run. */
  inventory?: PackageInventory;
}

export type SBOMDocument = Spdx23Document | CycloneDx17Document;

export interface Spdx23Document {
  spdxVersion: 'SPDX-2.3';
  dataLicense: 'CC0-1.0';
  SPDXID: 'SPDXRef-DOCUMENT';
  name: string;
  documentNamespace: string;
  creationInfo: { created: string; creators: string[] };
  packages: Spdx23Package[];
  relationships: Array<{
    spdxElementId: 'SPDXRef-DOCUMENT';
    relationshipType: 'DESCRIBES';
    relatedSpdxElement: string;
  }>;
}

export interface Spdx23Package {
  name: string;
  SPDXID: string;
  versionInfo: string;
  downloadLocation: 'NOASSERTION';
  filesAnalyzed: false;
  licenseConcluded: string;
  licenseDeclared: string;
  copyrightText: 'NOASSERTION';
  externalRefs: Array<{
    referenceCategory: 'PACKAGE-MANAGER';
    referenceType: 'purl';
    referenceLocator: string;
  }>;
}

export interface CycloneDx17Document {
  $schema: 'https://cyclonedx.org/schema/bom-1.7.schema.json';
  bomFormat: 'CycloneDX';
  specVersion: '1.7';
  serialNumber: string;
  version: 1;
  metadata: {
    timestamp: string;
    tools: { components: Array<{ type: 'application'; name: 'GuardScan'; version: string }> };
    component: { type: 'application'; name: string; 'bom-ref': string };
  };
  components: CycloneDx17Component[];
  dependencies: Array<{ ref: string; dependsOn: string[] }>;
}

export interface CycloneDx17Component {
  type: 'library';
  'bom-ref': string;
  name: string;
  version: string;
  purl: string;
  scope?: 'required' | 'optional' | 'excluded';
  licenses: Array<{ license: { id?: string; name?: string } }>;
}

const PACKAGE_VERSION = packageManifest.version;

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
  async scan(
    repoPath: string = process.cwd(),
    projectType: 'proprietary' | 'open-source' = 'proprietary',
    options: LicenseScanOptions = {}
  ): Promise<LicenseReport> {
    const inventory = options.inventory || collectPackageInventory(repoPath);
    const localFindings = inventory.coordinates.map(coordinate =>
      this.findingFromCoordinate(repoPath, coordinate)
    );
    let findings = this.mergeFindings(localFindings);

    if (!options.offline && options.runProjectCode === true) {
      // Scan different ecosystems
      findings = this.mergeFindings([
        ...findings,
        ...await this.scanNpm(repoPath, options.networkIsolation),
        ...await this.scanPip(repoPath, options.networkIsolation),
        ...await this.scanGo(repoPath, options.networkIsolation),
        ...await this.scanCargo(repoPath, options.networkIsolation),
        ...await this.scanMaven(repoPath),
        ...await this.scanRubygems(repoPath, options.networkIsolation),
      ]);
    }

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
      inventoryErrors: inventory.errors.map(error => ({ ...error })),
    };
  }

  /**
   * Build an SBOM-safe entry from repository data only. Network access is never
   * required; npm license metadata is read from an installed package when it is
   * available and otherwise remains explicitly unknown.
   */
  private findingFromCoordinate(repoPath: string, coordinate: DependencyCoordinate): LicenseFinding {
    const source = coordinate.ecosystem === 'ruby' ? 'rubygems' : coordinate.ecosystem;
    const discoveredLicense = coordinate.ecosystem === 'npm'
      ? this.readInstalledNpmLicense(repoPath, coordinate)
      : 'Unknown';
    const license = this.normalizeLicense(discoveredLicense);

    return {
      package: coordinate.name,
      version: coordinate.exactVersion,
      scope: coordinate.scope,
      direct: coordinate.direct,
      dependencyPaths: [...coordinate.dependencyPaths],
      license,
      category: this.categorizeLicense(license),
      risk: 'info',
      description: `${source} package from ${coordinate.lockfilePath}`,
      source,
    };
  }

  private readInstalledNpmLicense(repoPath: string, coordinate: DependencyCoordinate): string {
    const candidates = coordinate.dependencyPaths
      .filter(value => /(?:^|\/)node_modules\//.test(value.replace(/\\/g, '/')))
      .map(value => path.resolve(repoPath, value, 'package.json'));

    // Lockfile v1 dependency paths do not necessarily name a filesystem path.
    candidates.push(path.resolve(repoPath, 'node_modules', coordinate.name, 'package.json'));

    for (const candidate of candidates) {
      const relative = path.relative(repoPath, candidate);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        continue;
      }
      try {
        const manifest = JSON.parse(fs.readFileSync(candidate, 'utf8')) as {
          license?: string | { type?: string };
          licenses?: Array<string | { type?: string }>;
        };
        if (typeof manifest.license === 'string') {return manifest.license;}
        if (manifest.license && typeof manifest.license.type === 'string') {return manifest.license.type;}
        if (Array.isArray(manifest.licenses)) {
          const values = manifest.licenses
            .map(value => typeof value === 'string' ? value : value?.type)
            .filter((value): value is string => Boolean(value));
          if (values.length > 0) {return values.join(' OR ');}
        }
      } catch {
        // Missing and malformed installed metadata falls back to Unknown.
      }
    }
    return 'Unknown';
  }

  private mergeFindings(values: LicenseFinding[]): LicenseFinding[] {
    const findings = new Map<string, LicenseFinding>();
    const scopeRank: Record<DependencyCoordinate['scope'], number> = {
      unknown: 0,
      development: 1,
      optional: 2,
      runtime: 3,
    };
    for (const value of values) {
      const key = `${value.source}\u0000${value.package}\u0000${value.version}`;
      const existing = findings.get(key);
      if (!existing) {
        findings.set(key, {
          ...value,
          dependencyPaths: [...new Set(value.dependencyPaths || [])].sort(),
        });
        continue;
      }
      const preferred = existing.license === 'Unknown' && value.license !== 'Unknown'
        ? value
        : existing;
      const scopes = [existing.scope, value.scope].filter(
        (scope): scope is DependencyCoordinate['scope'] => scope !== undefined
      );
      const scope = scopes.sort((left, right) => scopeRank[right] - scopeRank[left])[0];
      const direct = existing.direct === true || value.direct === true
        ? true
        : existing.direct === false || value.direct === false
          ? false
          : undefined;
      findings.set(key, {
        ...preferred,
        scope,
        direct,
        dependencyPaths: [...new Set([
          ...(existing.dependencyPaths || []),
          ...(value.dependencyPaths || []),
        ])].sort(),
      });
    }
    return [...findings.values()].sort((left, right) =>
      left.source.localeCompare(right.source) ||
      left.package.localeCompare(right.package) ||
      left.version.localeCompare(right.version)
    );
  }

  /**
   * Scan npm packages
   */
  private async scanNpm(
    repoPath: string,
    networkIsolation?: boolean
  ): Promise<LicenseFinding[]> {
    const findings: LicenseFinding[] = [];
    const packageJsonPath = path.join(repoPath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      return findings;
    }

    try {
      // Try using license-checker if available
      const output = runLicenseTool(
        'npx',
        ['--no-install', 'license-checker', '--json'],
        repoPath,
        networkIsolation
      );

      const licenses = JSON.parse(output);

      for (const [pkg, data] of Object.entries(licenses)) {
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
  private async scanPip(
    repoPath: string,
    networkIsolation?: boolean
  ): Promise<LicenseFinding[]> {
    const findings: LicenseFinding[] = [];
    const requirementsPath = path.join(repoPath, 'requirements.txt');

    if (!fs.existsSync(requirementsPath)) {
      return findings;
    }

    try {
      // Try using pip-licenses if available
      const output = runLicenseTool(
        'pip-licenses',
        ['--format=json'],
        repoPath,
        networkIsolation
      );

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
          if (!trimmed || trimmed.startsWith('#')) {continue;}

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
  private async scanGo(
    repoPath: string,
    networkIsolation?: boolean
  ): Promise<LicenseFinding[]> {
    const findings: LicenseFinding[] = [];
    const goModPath = path.join(repoPath, 'go.mod');

    if (!fs.existsSync(goModPath)) {
      return findings;
    }

    try {
      const output = runLicenseTool(
        'go',
        ['list', '-m', '-json', 'all'],
        repoPath,
        networkIsolation
      );

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
  private async scanCargo(
    repoPath: string,
    networkIsolation?: boolean
  ): Promise<LicenseFinding[]> {
    const findings: LicenseFinding[] = [];
    const cargoTomlPath = path.join(repoPath, 'Cargo.toml');

    if (!fs.existsSync(cargoTomlPath)) {
      return findings;
    }

    try {
      const output = runLicenseTool(
        'cargo',
        ['metadata', '--format-version', '1'],
        repoPath,
        networkIsolation
      );

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
  private async scanRubygems(
    repoPath: string,
    networkIsolation?: boolean
  ): Promise<LicenseFinding[]> {
    const findings: LicenseFinding[] = [];
    const gemfilePath = path.join(repoPath, 'Gemfile');

    if (!fs.existsSync(gemfilePath)) {
      return findings;
    }

    try {
      const output = runLicenseTool(
        'bundle',
        ['exec', 'gem', 'list', '--local'],
        repoPath,
        networkIsolation
      );

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
    if (!license || license === 'UNKNOWN') {return 'Unknown';}

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

    if (permissive.some(p => normalized.includes(p))) {return 'permissive';}
    if (weakCopyleft.some(w => normalized.includes(w))) {return 'weak-copyleft';}
    if (strongCopyleft.some(s => normalized.includes(s))) {return 'strong-copyleft';}
    if (normalized === 'UNLICENSED' || normalized === 'proprietary') {return 'proprietary';}

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

    if (!compat1 || !compat2) {return null;}

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
  generateSBOM(findings: LicenseFinding[], format: 'spdx', projectName?: string): Spdx23Document;
  generateSBOM(findings: LicenseFinding[], format: 'cyclonedx', projectName?: string): CycloneDx17Document;
  generateSBOM(findings: LicenseFinding[], format?: 'spdx' | 'cyclonedx', projectName?: string): SBOMDocument;
  generateSBOM(
    findings: LicenseFinding[],
    format: 'spdx' | 'cyclonedx' = 'spdx',
    projectName: string = 'unknown'
  ): SBOMDocument {
    const ordered = [...findings].sort((left, right) =>
      `${left.source}\0${left.package}\0${left.version}`.localeCompare(
        `${right.source}\0${right.package}\0${right.version}`
      )
    );
    const created = new Date().toISOString();
    const rootReference = `urn:guardscan:project:${stableIdentifier(projectName)}`;

    if (format === 'cyclonedx') {
      const components: CycloneDx17Component[] = ordered.map(finding => {
        const purl = this.generatePURL(finding);
        return {
          type: 'library',
          'bom-ref': purl,
          name: finding.package,
          version: finding.version,
          purl,
          scope: cycloneDxScope(finding.scope),
          licenses: [{
            license: isSimpleSpdxIdentifier(finding.license)
              ? { id: finding.license }
              : { name: finding.license || 'Unknown' },
          }],
        };
      });
      return {
        $schema: 'https://cyclonedx.org/schema/bom-1.7.schema.json',
        bomFormat: 'CycloneDX',
        specVersion: '1.7',
        serialNumber: `urn:uuid:${stableUuid(`${projectName}\0${components.map(value => value['bom-ref']).join('\0')}`)}`,
        version: 1,
        metadata: {
          timestamp: created,
          tools: { components: [{ type: 'application', name: 'GuardScan', version: PACKAGE_VERSION }] },
          component: { type: 'application', name: projectName, 'bom-ref': rootReference },
        },
        components,
        dependencies: cycloneDxDependencies(ordered, components, rootReference),
      };
    }

    const packages: Spdx23Package[] = ordered.map(finding => {
      const purl = this.generatePURL(finding);
      const license = isSpdxExpression(finding.license) ? finding.license : 'NOASSERTION';
      return {
        name: finding.package,
        SPDXID: `SPDXRef-Package-${stableIdentifier(purl)}`,
        versionInfo: finding.version,
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: license,
        licenseDeclared: license,
        copyrightText: 'NOASSERTION',
        externalRefs: [{
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: purl,
        }],
      };
    });
    const digest = stableIdentifier(`${projectName}\0${packages.map(value => value.SPDXID).join('\0')}`);
    return {
      spdxVersion: 'SPDX-2.3',
      dataLicense: 'CC0-1.0',
      SPDXID: 'SPDXRef-DOCUMENT',
      name: projectName,
      documentNamespace: `https://guardscancli.com/spdx/${encodeURIComponent(projectName)}/${digest}`,
      creationInfo: { created, creators: [`Tool: GuardScan-${PACKAGE_VERSION}`] },
      packages,
      relationships: packages.map(value => ({
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
        relatedSpdxElement: value.SPDXID,
      })),
    };
  }

  /**
   * Generate Package URL (PURL)
   */
  private generatePURL(finding: LicenseFinding): string {
    const type = finding.source === 'rubygems' ? 'gem' : finding.source;
    const version = encodeURIComponent(finding.version);

    if (type === 'maven') {
      const separator = finding.package.indexOf(':');
      if (separator > 0 && separator < finding.package.length - 1) {
        const namespace = encodeURIComponent(finding.package.slice(0, separator));
        const artifact = encodeURIComponent(finding.package.slice(separator + 1));
        return `pkg:maven/${namespace}/${artifact}@${version}`;
      }
    }

    const name = finding.package.split('/').map(segment => encodeURIComponent(segment)).join('/');

    return `pkg:${type}/${name}@${version}`;
  }
}

function runLicenseTool(
  command: string,
  args: string[],
  repoPath: string,
  networkIsolation?: boolean
): string {
  const result = runProcess(command, args, {
    cwd: repoPath,
    timeoutMs: 30_000,
    maxBuffer: 10 * 1024 * 1024,
    networkIsolation: networkIsolation === true,
  });
  if (result.timedOut) {throw new Error(`${command} timed out`);}
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status} without usable license metadata`);
  }
  return result.stdout;
}

function cycloneDxScope(
  scope: DependencyCoordinate['scope'] | undefined
): CycloneDx17Component['scope'] {
  if (scope === 'development') {return 'excluded';}
  if (scope === 'optional') {return 'optional';}
  if (scope === 'unknown') {return undefined;}
  return 'required';
}

function isDirectInstallDependency(finding: LicenseFinding): boolean {
  return finding.direct === true && finding.scope !== 'development';
}

function npmDependencyNames(dependencyPath: string): string[] {
  if (dependencyPath.includes(' > ')) {
    return dependencyPath.split(' > ').map(value => value.trim()).filter(Boolean);
  }
  const segments = dependencyPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const names: string[] = [];
  for (let index = 0; index < segments.length; index++) {
    if (segments[index] !== 'node_modules' || !segments[index + 1]) {continue;}
    const first = segments[index + 1];
    if (first.startsWith('@') && segments[index + 2]) {
      names.push(`${first}/${segments[index + 2]}`);
      index += 2;
    } else {
      names.push(first);
      index += 1;
    }
  }
  return names;
}

function cycloneDxDependencies(
  findings: LicenseFinding[],
  components: CycloneDx17Component[],
  rootReference: string
): Array<{ ref: string; dependsOn: string[] }> {
  const referencesByPackage = new Map<string, string[]>();
  for (let index = 0; index < findings.length; index++) {
    const finding = findings[index];
    const key = `${finding.source}\u0000${finding.package}`;
    const references = referencesByPackage.get(key) || [];
    references.push(components[index]['bom-ref']);
    referencesByPackage.set(key, references);
  }

  const outgoing = new Map<string, Set<string>>();
  for (let index = 0; index < findings.length; index++) {
    const finding = findings[index];
    if (finding.source !== 'npm') {continue;}
    for (const dependencyPath of finding.dependencyPaths || []) {
      const names = npmDependencyNames(dependencyPath);
      if (names.length < 2 || names[names.length - 1] !== finding.package) {continue;}
      const parentReferences = referencesByPackage.get(`npm\u0000${names[names.length - 2]}`) || [];
      if (parentReferences.length !== 1) {continue;}
      const children = outgoing.get(parentReferences[0]) || new Set<string>();
      children.add(components[index]['bom-ref']);
      outgoing.set(parentReferences[0], children);
    }
  }

  const dependencies: Array<{ ref: string; dependsOn: string[] }> = [{
    ref: rootReference,
    dependsOn: components.flatMap((component, index) =>
      isDirectInstallDependency(findings[index]) ? [component['bom-ref']] : []
    ),
  }];
  for (const component of components) {
    const dependsOn = outgoing.get(component['bom-ref']);
    if (dependsOn && dependsOn.size > 0) {
      dependencies.push({ ref: component['bom-ref'], dependsOn: [...dependsOn].sort() });
    }
  }
  return dependencies;
}

function stableIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function stableUuid(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  digest[12] = '5';
  digest[16] = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8).join('')}-${digest.slice(8, 12).join('')}-${digest.slice(12, 16).join('')}-${digest.slice(16, 20).join('')}-${digest.slice(20).join('')}`;
}

function isSimpleSpdxIdentifier(value: string): boolean {
  return value !== 'Unknown' && /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(value);
}

function isSpdxExpression(value: string): boolean {
  if (value === 'Unknown' || value.length > 4096) {return false;}
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const whitespace = value.slice(cursor).match(/^\s+/)?.[0];
    if (whitespace) {
      cursor += whitespace.length;
      continue;
    }
    const character = value[cursor];
    if (character === '(' || character === ')') {
      tokens.push(character);
      cursor += 1;
      continue;
    }
    const identifier = value.slice(cursor).match(/^[A-Za-z0-9][A-Za-z0-9.+:-]*/)?.[0];
    if (!identifier) {return false;}
    tokens.push(identifier);
    if (tokens.length > 256) {return false;}
    cursor += identifier.length;
  }
  if (tokens.length === 0) {return false;}

  let index = 0;
  const isIdentifier = (token: string | undefined): boolean =>
    token !== undefined && !['(', ')', 'AND', 'OR', 'WITH'].includes(token);
  const parseLicense = (): boolean => {
    if (!isIdentifier(tokens[index])) {return false;}
    index += 1;
    if (tokens[index] === 'WITH') {
      index += 1;
      if (!isIdentifier(tokens[index])) {return false;}
      index += 1;
    }
    return true;
  };
  const parsePrimary = (depth: number): boolean => {
    if (tokens[index] !== '(') {return parseLicense();}
    if (depth >= 64) {return false;}
    index += 1;
    if (!parseOr(depth + 1) || tokens[index] !== ')') {return false;}
    index += 1;
    return true;
  };
  const parseAnd = (depth: number): boolean => {
    if (!parsePrimary(depth)) {return false;}
    while (tokens[index] === 'AND') {
      index += 1;
      if (!parsePrimary(depth)) {return false;}
    }
    return true;
  };
  const parseOr = (depth: number): boolean => {
    if (!parseAnd(depth)) {return false;}
    while (tokens[index] === 'OR') {
      index += 1;
      if (!parseAnd(depth)) {return false;}
    }
    return true;
  };

  return parseOr(0) && index === tokens.length;
}

export const licenseScanner = new LicenseScanner();

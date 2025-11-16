/**
 * threat-modeling.ts - AI-Powered Threat Modeling Engine
 *
 * Implements STRIDE threat modeling methodology with automated:
 * - Asset identification (databases, APIs, auth systems, sensitive data)
 * - Data flow mapping and analysis
 * - STRIDE threat generation (Spoofing, Tampering, Repudiation, Information Disclosure, DoS, Elevation of Privilege)
 * - Threat diagrams and comprehensive reports
 *
 * Phase 5, Feature 2
 */

import * as fs from 'fs';
import * as path from 'path';
import { AIProvider } from '../providers/base';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';

/**
 * Security Asset Types
 */
export type AssetType =
  | 'database'
  | 'api-endpoint'
  | 'authentication'
  | 'authorization'
  | 'user-data'
  | 'config'
  | 'secret'
  | 'file-storage'
  | 'external-service'
  | 'cache'
  | 'session';

/**
 * STRIDE Threat Categories
 */
export type STRIDECategory =
  | 'spoofing'
  | 'tampering'
  | 'repudiation'
  | 'information-disclosure'
  | 'denial-of-service'
  | 'elevation-of-privilege';

/**
 * Security Asset
 */
export interface SecurityAsset {
  id: string;
  type: AssetType;
  name: string;
  description: string;
  location: {
    file: string;
    startLine: number;
    endLine: number;
  };
  sensitivity: 'critical' | 'high' | 'medium' | 'low';
  dataTypes: string[];
  accessControl?: {
    authentication: boolean;
    authorization: boolean;
    roles?: string[];
  };
  encryption?: {
    atRest: boolean;
    inTransit: boolean;
  };
}

/**
 * Data Flow
 */
export interface DataFlow {
  id: string;
  source: string;
  destination: string;
  dataTypes: string[];
  protocol?: string;
  encryption: boolean;
  authentication: boolean;
  trustBoundary: boolean;
  description: string;
}

/**
 * STRIDE Threat
 */
export interface STRIDEThreat {
  id: string;
  category: STRIDECategory;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedAssets: string[];
  attackVector: string;
  impact: string;
  likelihood: 'very-high' | 'high' | 'medium' | 'low' | 'very-low';
  riskScore: number;
  mitigations: Mitigation[];
  references?: string[];
}

/**
 * Mitigation Strategy
 */
export interface Mitigation {
  strategy: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
  effectiveness: 'low' | 'medium' | 'high';
  implemented: boolean;
}

/**
 * Trust Boundary
 */
export interface TrustBoundary {
  id: string;
  name: string;
  description: string;
  internalAssets: string[];
  externalAssets: string[];
  controlMechanisms: string[];
}

/**
 * Threat Model Report
 */
export interface ThreatModelReport {
  summary: {
    totalAssets: number;
    totalThreats: number;
    criticalThreats: number;
    highThreats: number;
    trustBoundaries: number;
    dataFlows: number;
  };
  assets: SecurityAsset[];
  dataFlows: DataFlow[];
  trustBoundaries: TrustBoundary[];
  threats: STRIDEThreat[];
  recommendations: string[];
  diagram?: string;
  generatedAt: Date;
}

/**
 * Threat Modeling Options
 */
export interface ThreatModelOptions {
  targetPath?: string;
  includeDataFlows?: boolean;
  includeDiagrams?: boolean;
  focusArea?: 'authentication' | 'data-protection' | 'api-security' | 'all';
  minimumSeverity?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Threat Modeling Engine
 */
export class ThreatModelingEngine {
  constructor(
    private aiProvider: AIProvider,
    private indexer: CodebaseIndexer,
    private cache: AICache,
    private repoPath: string
  ) {}

  /**
   * Generate comprehensive threat model
   */
  async generateThreatModel(options: ThreatModelOptions = {}): Promise<ThreatModelReport> {
    console.log('🔍 Identifying security assets...');
    const assets = await this.identifyAssets(options.targetPath);

    console.log('🔗 Mapping data flows...');
    const dataFlows = options.includeDataFlows !== false
      ? await this.mapDataFlows(assets)
      : [];

    console.log('🛡️ Identifying trust boundaries...');
    const trustBoundaries = await this.identifyTrustBoundaries(assets, dataFlows);

    console.log('⚠️ Generating STRIDE threats...');
    const threats = await this.generateSTRIDEThreats(assets, dataFlows, options);

    console.log('📊 Generating recommendations...');
    const recommendations = this.generateRecommendations(threats, assets);

    let diagram: string | undefined;
    if (options.includeDiagrams) {
      console.log('🎨 Generating threat model diagram...');
      diagram = await this.generateDiagram(assets, dataFlows, trustBoundaries);
    }

    return {
      summary: {
        totalAssets: assets.length,
        totalThreats: threats.length,
        criticalThreats: threats.filter(t => t.severity === 'critical').length,
        highThreats: threats.filter(t => t.severity === 'high').length,
        trustBoundaries: trustBoundaries.length,
        dataFlows: dataFlows.length
      },
      assets,
      dataFlows,
      trustBoundaries,
      threats,
      recommendations,
      diagram,
      generatedAt: new Date()
    };
  }

  /**
   * Identify security assets in codebase
   */
  async identifyAssets(targetPath?: string): Promise<SecurityAsset[]> {
    const assets: SecurityAsset[] = [];

    // Get files to analyze
    let files: string[];
    if (targetPath) {
      files = [targetPath];
    } else {
      const index = await this.indexer.buildIndex();
      files = Array.from(index.files.keys());
    }

    // Analyze each file for security assets
    for (const file of files) {
      const fileAssets = await this.analyzeFileForAssets(file);
      assets.push(...fileAssets);
    }

    return assets;
  }

  /**
   * Analyze a file for security assets
   */
  private async analyzeFileForAssets(filePath: string): Promise<SecurityAsset[]> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const assets: SecurityAsset[] = [];

    // Check for database connections
    if (this.containsPattern(content, [
      'mongoose.connect',
      'createConnection',
      'Pool(',
      'Sequelize',
      'TypeORM',
      'prisma',
      'knex'
    ])) {
      assets.push({
        id: `db-${this.generateId()}`,
        type: 'database',
        name: 'Database Connection',
        description: 'Database connection detected',
        location: {
          file: filePath,
          startLine: 1,
          endLine: 1
        },
        sensitivity: 'critical',
        dataTypes: ['user-data', 'application-data'],
        encryption: {
          atRest: false,
          inTransit: content.includes('ssl') || content.includes('tls')
        }
      });
    }

    // Check for API endpoints
    const apiPatterns = [
      /app\.(get|post|put|delete|patch)\s*\(['"](.*?)['"]/g,
      /router\.(get|post|put|delete|patch)\s*\(['"](.*?)['"]/g,
      /@(Get|Post|Put|Delete|Patch)\s*\(['"](.*?)['"]/g
    ];

    for (const pattern of apiPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        const endpoint = match[2];
        assets.push({
          id: `api-${this.generateId()}`,
          type: 'api-endpoint',
          name: `${method} ${endpoint}`,
          description: `API endpoint: ${method} ${endpoint}`,
          location: {
            file: filePath,
            startLine: this.getLineNumber(content, match.index),
            endLine: this.getLineNumber(content, match.index)
          },
          sensitivity: endpoint.includes('admin') || endpoint.includes('user') ? 'high' : 'medium',
          dataTypes: this.inferDataTypes(endpoint),
          accessControl: {
            authentication: content.includes('auth') || content.includes('jwt'),
            authorization: content.includes('role') || content.includes('permission')
          }
        });
      }
    }

    // Check for authentication mechanisms
    if (this.containsPattern(content, [
      'passport',
      'jwt.sign',
      'bcrypt',
      'hash(',
      'authenticate',
      'login',
      'auth'
    ])) {
      assets.push({
        id: `auth-${this.generateId()}`,
        type: 'authentication',
        name: 'Authentication System',
        description: 'Authentication mechanism detected',
        location: {
          file: filePath,
          startLine: 1,
          endLine: 1
        },
        sensitivity: 'critical',
        dataTypes: ['credentials', 'tokens'],
        accessControl: {
          authentication: true,
          authorization: false
        }
      });
    }

    // Check for secrets and config
    const secretPatterns = [
      /API_KEY/g,
      /SECRET/g,
      /PASSWORD/g,
      /TOKEN/g,
      /PRIVATE_KEY/g
    ];

    for (const pattern of secretPatterns) {
      if (pattern.test(content)) {
        assets.push({
          id: `secret-${this.generateId()}`,
          type: 'secret',
          name: 'Secrets/Config',
          description: 'Secret or configuration data detected',
          location: {
            file: filePath,
            startLine: 1,
            endLine: 1
          },
          sensitivity: 'critical',
          dataTypes: ['credentials', 'api-keys'],
          encryption: {
            atRest: content.includes('encrypt') || content.includes('KMS'),
            inTransit: true
          }
        });
        break;
      }
    }

    // Check for file storage
    if (this.containsPattern(content, [
      'multer',
      'fs.writeFile',
      'createWriteStream',
      'upload',
      'S3',
      'blob'
    ])) {
      assets.push({
        id: `storage-${this.generateId()}`,
        type: 'file-storage',
        name: 'File Storage',
        description: 'File storage mechanism detected',
        location: {
          file: filePath,
          startLine: 1,
          endLine: 1
        },
        sensitivity: 'high',
        dataTypes: ['files', 'documents'],
        encryption: {
          atRest: content.includes('encrypt'),
          inTransit: content.includes('https')
        }
      });
    }

    return assets;
  }

  /**
   * Map data flows between assets
   */
  async mapDataFlows(assets: SecurityAsset[]): Promise<DataFlow[]> {
    const flows: DataFlow[] = [];

    // Use AI to identify data flows
    const cacheKey = `dataflows-${assets.length}`;
    const cached = await this.cache.get(cacheKey, this.aiProvider.getName());
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache
      }
    }

    const prompt = this.buildDataFlowPrompt(assets);
    const response = await this.aiProvider.chat([
      {
        role: 'system',
        content: 'You are a security architect analyzing application data flows.'
      },
      {
        role: 'user',
        content: prompt
      }
    ], {
      temperature: 0.3,
      maxTokens: 2000
    });

    const parsedFlows = this.parseDataFlowResponse(response.content, assets);
    await this.cache.set(cacheKey, this.aiProvider.getName(), JSON.stringify(parsedFlows));

    return parsedFlows;
  }

  /**
   * Identify trust boundaries
   */
  async identifyTrustBoundaries(
    assets: SecurityAsset[],
    dataFlows: DataFlow[]
  ): Promise<TrustBoundary[]> {
    const boundaries: TrustBoundary[] = [];

    // External boundary (internet-facing)
    const externalAssets = assets.filter(a => a.type === 'api-endpoint');
    if (externalAssets.length > 0) {
      boundaries.push({
        id: 'boundary-external',
        name: 'External Boundary',
        description: 'Internet-facing components',
        internalAssets: assets.filter(a => a.type !== 'api-endpoint').map(a => a.id),
        externalAssets: externalAssets.map(a => a.id),
        controlMechanisms: ['authentication', 'rate-limiting', 'firewall']
      });
    }

    // Database boundary
    const dbAssets = assets.filter(a => a.type === 'database');
    if (dbAssets.length > 0) {
      boundaries.push({
        id: 'boundary-database',
        name: 'Database Boundary',
        description: 'Database access control',
        internalAssets: dbAssets.map(a => a.id),
        externalAssets: assets.filter(a => a.type !== 'database').map(a => a.id),
        controlMechanisms: ['connection-pooling', 'query-parameterization', 'access-control']
      });
    }

    // Authentication boundary
    const authAssets = assets.filter(a => a.type === 'authentication');
    if (authAssets.length > 0) {
      boundaries.push({
        id: 'boundary-auth',
        name: 'Authentication Boundary',
        description: 'Authentication and session management',
        internalAssets: authAssets.map(a => a.id),
        externalAssets: assets.filter(a => a.type !== 'authentication').map(a => a.id),
        controlMechanisms: ['jwt', 'session-management', 'mfa']
      });
    }

    return boundaries;
  }

  /**
   * Generate STRIDE threats
   */
  async generateSTRIDEThreats(
    assets: SecurityAsset[],
    dataFlows: DataFlow[],
    options: ThreatModelOptions
  ): Promise<STRIDEThreat[]> {
    const threats: STRIDEThreat[] = [];

    // Generate threats for each STRIDE category
    for (const category of this.getSTRIDECategories()) {
      const categoryThreats = await this.generateThreatsForCategory(
        category,
        assets,
        dataFlows
      );
      threats.push(...categoryThreats);
    }

    // Filter by severity if specified
    if (options.minimumSeverity) {
      const severityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
      const minLevel = severityOrder[options.minimumSeverity];
      return threats.filter(t => severityOrder[t.severity] >= minLevel);
    }

    return threats;
  }

  /**
   * Generate threats for specific STRIDE category
   */
  private async generateThreatsForCategory(
    category: STRIDECategory,
    assets: SecurityAsset[],
    dataFlows: DataFlow[]
  ): Promise<STRIDEThreat[]> {
    const threats: STRIDEThreat[] = [];

    // Use AI to generate context-aware threats
    const cacheKey = `threats-${category}-${assets.length}`;
    const cached = await this.cache.get(cacheKey, this.aiProvider.getName());
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache
      }
    }

    const prompt = this.buildThreatPrompt(category, assets, dataFlows);
    const response = await this.aiProvider.chat([
      {
        role: 'system',
        content: `You are a security expert specializing in ${category} threats in the STRIDE model.`
      },
      {
        role: 'user',
        content: prompt
      }
    ], {
      temperature: 0.4,
      maxTokens: 2000
    });

    const parsedThreats = this.parseThreatResponse(response.content, category, assets);
    await this.cache.set(cacheKey, this.aiProvider.getName(), JSON.stringify(parsedThreats));

    return parsedThreats;
  }

  /**
   * Generate threat model diagram (Mermaid format)
   */
  async generateDiagram(
    assets: SecurityAsset[],
    dataFlows: DataFlow[],
    trustBoundaries: TrustBoundary[]
  ): Promise<string> {
    let diagram = '```mermaid\ngraph TD\n';

    // Add assets
    for (const asset of assets) {
      const icon = this.getAssetIcon(asset.type);
      const style = this.getAssetStyle(asset.sensitivity);
      diagram += `  ${asset.id}[${icon} ${asset.name}]:::${style}\n`;
    }

    // Add data flows
    for (const flow of dataFlows) {
      const flowStyle = flow.encryption ? 'encrypted' : 'unencrypted';
      diagram += `  ${flow.source} -->|${flow.dataTypes.join(', ')}| ${flow.destination}\n`;
    }

    // Add trust boundaries
    for (const boundary of trustBoundaries) {
      diagram += `  subgraph ${boundary.id} [${boundary.name}]\n`;
      for (const assetId of boundary.internalAssets) {
        diagram += `    ${assetId}\n`;
      }
      diagram += `  end\n`;
    }

    // Add styles
    diagram += `\n  classDef critical fill:#ff6b6b,stroke:#c92a2a,stroke-width:3px\n`;
    diagram += `  classDef high fill:#ffa94d,stroke:#f76707,stroke-width:2px\n`;
    diagram += `  classDef medium fill:#ffd43b,stroke:#fab005,stroke-width:1px\n`;
    diagram += `  classDef low fill:#c0eb75,stroke:#82c91e,stroke-width:1px\n`;
    diagram += '```\n';

    return diagram;
  }

  /**
   * Generate security recommendations
   */
  private generateRecommendations(
    threats: STRIDEThreat[],
    assets: SecurityAsset[]
  ): string[] {
    const recommendations: string[] = [];

    // Critical threats
    const criticalThreats = threats.filter(t => t.severity === 'critical');
    if (criticalThreats.length > 0) {
      recommendations.push(
        `🚨 Address ${criticalThreats.length} critical threat(s) immediately`
      );
    }

    // Unencrypted data flows
    const unencryptedAssets = assets.filter(a => a.encryption && !a.encryption.inTransit);
    if (unencryptedAssets.length > 0) {
      recommendations.push(
        `🔒 Enable encryption in transit for ${unencryptedAssets.length} asset(s)`
      );
    }

    // Missing authentication
    const unauthAssets = assets.filter(
      a => a.type === 'api-endpoint' && !a.accessControl?.authentication
    );
    if (unauthAssets.length > 0) {
      recommendations.push(
        `🔐 Add authentication to ${unauthAssets.length} API endpoint(s)`
      );
    }

    // High-value assets without authorization
    const highValueAssets = assets.filter(
      a => a.sensitivity === 'critical' && !a.accessControl?.authorization
    );
    if (highValueAssets.length > 0) {
      recommendations.push(
        `👤 Implement authorization controls for ${highValueAssets.length} critical asset(s)`
      );
    }

    return recommendations;
  }

  // ==================== Helper Methods ====================

  private containsPattern(content: string, patterns: string[]): boolean {
    return patterns.some(p => content.includes(p));
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  private getLineNumber(content: string, index: number): number {
    return content.substring(0, index).split('\n').length;
  }

  private inferDataTypes(endpoint: string): string[] {
    const types: string[] = [];
    if (endpoint.includes('user')) types.push('user-data');
    if (endpoint.includes('auth') || endpoint.includes('login')) types.push('credentials');
    if (endpoint.includes('payment')) types.push('financial-data');
    if (endpoint.includes('admin')) types.push('administrative-data');
    return types.length > 0 ? types : ['general-data'];
  }

  private getSTRIDECategories(): STRIDECategory[] {
    return [
      'spoofing',
      'tampering',
      'repudiation',
      'information-disclosure',
      'denial-of-service',
      'elevation-of-privilege'
    ];
  }

  private getAssetIcon(type: AssetType): string {
    const icons: Record<AssetType, string> = {
      'database': '🗄️',
      'api-endpoint': '🌐',
      'authentication': '🔐',
      'authorization': '👤',
      'user-data': '📊',
      'config': '⚙️',
      'secret': '🔑',
      'file-storage': '📁',
      'external-service': '☁️',
      'cache': '💾',
      'session': '🎫'
    };
    return icons[type] || '📦';
  }

  private getAssetStyle(sensitivity: string): string {
    return sensitivity;
  }

  private buildDataFlowPrompt(assets: SecurityAsset[]): string {
    return `Analyze these security assets and identify data flows between them:

${assets.map(a => `- ${a.name} (${a.type}) in ${a.location.file}`).join('\n')}

For each data flow, identify:
1. Source asset
2. Destination asset
3. Data types transferred
4. Whether encryption is used
5. Whether authentication is required

Return data flows in JSON format.`;
  }

  private buildThreatPrompt(
    category: STRIDECategory,
    assets: SecurityAsset[],
    dataFlows: DataFlow[]
  ): string {
    return `Generate ${category} threats for this application based on STRIDE methodology.

Assets:
${assets.map(a => `- ${a.name} (${a.type}, sensitivity: ${a.sensitivity})`).join('\n')}

Data Flows:
${dataFlows.map(f => `- ${f.source} → ${f.destination} (encrypted: ${f.encryption})`).join('\n')}

For each threat, provide:
1. Threat title and description
2. Affected assets
3. Attack vector
4. Impact
5. Likelihood (very-high, high, medium, low, very-low)
6. Severity (critical, high, medium, low)
7. Mitigation strategies

Return threats in JSON format.`;
  }

  private parseDataFlowResponse(content: string, assets: SecurityAsset[]): DataFlow[] {
    // Parse AI response for data flows (simplified implementation)
    const flows: DataFlow[] = [];

    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.map((f: any, i: number) => ({
          id: `flow-${i}`,
          source: f.source || 'unknown',
          destination: f.destination || 'unknown',
          dataTypes: f.dataTypes || [],
          encryption: f.encryption || false,
          authentication: f.authentication || false,
          trustBoundary: f.trustBoundary || false,
          description: f.description || ''
        }));
      }
    } catch {
      // Fallback: infer flows from assets
    }

    return flows;
  }

  private parseThreatResponse(
    content: string,
    category: STRIDECategory,
    assets: SecurityAsset[]
  ): STRIDEThreat[] {
    const threats: STRIDEThreat[] = [];

    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.map((t: any, i: number) => ({
          id: `threat-${category}-${i}`,
          category,
          severity: t.severity || 'medium',
          title: t.title || `${category} threat`,
          description: t.description || '',
          affectedAssets: t.affectedAssets || [],
          attackVector: t.attackVector || '',
          impact: t.impact || '',
          likelihood: t.likelihood || 'medium',
          riskScore: this.calculateRiskScore(t.severity, t.likelihood),
          mitigations: t.mitigations || [],
          references: t.references
        }));
      }
    } catch {
      // Fallback: return empty array
    }

    return threats;
  }

  private calculateRiskScore(
    severity: string,
    likelihood: string
  ): number {
    const severityScore = { critical: 10, high: 7, medium: 4, low: 2 };
    const likelihoodScore = { 'very-high': 5, high: 4, medium: 3, low: 2, 'very-low': 1 };
    return (severityScore[severity as keyof typeof severityScore] || 4) *
           (likelihoodScore[likelihood as keyof typeof likelihoodScore] || 3);
  }
}

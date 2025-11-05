import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { Finding } from '../utils/reporter';

export class IaCScanner {
  /**
   * Scan Infrastructure as Code files
   */
  async scan(repoPath: string = process.cwd()): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Scan Terraform files
    findings.push(...await this.scanTerraform(repoPath));

    // Scan Kubernetes YAML files
    findings.push(...await this.scanKubernetes(repoPath));

    // Scan Docker Compose files
    findings.push(...await this.scanDockerCompose(repoPath));

    return findings;
  }

  /**
   * Scan Terraform files for security issues
   */
  private async scanTerraform(repoPath: string): Promise<Finding[]> {
    const findings: Finding[] = [];
    const tfFiles = this.findFiles(repoPath, /\.tf$/);

    for (const file of tfFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNum = i + 1;

          // Check for hardcoded credentials
          if (/password\s*=|secret\s*=|token\s*=|key\s*=/i.test(line) &&
              !/var\.|data\.|module\./i.test(line)) {
            findings.push({
              severity: 'critical',
              category: 'Terraform Security',
              file,
              line: lineNum,
              description: 'Hardcoded credentials detected',
              suggestion: 'Use variables or secrets management',
            });
          }

          // Check for unencrypted storage
          if (/storage_encrypted\s*=\s*false/i.test(line)) {
            findings.push({
              severity: 'high',
              category: 'Terraform Security',
              file,
              line: lineNum,
              description: 'Storage encryption disabled',
              suggestion: 'Enable storage encryption for data at rest',
            });
          }

          // Check for public access
          if (/public_access\s*=\s*true|publicly_accessible\s*=\s*true/i.test(line)) {
            findings.push({
              severity: 'high',
              category: 'Terraform Security',
              file,
              line: lineNum,
              description: 'Resource configured for public access',
              suggestion: 'Restrict public access unless absolutely necessary',
            });
          }

          // Check for overly permissive security groups
          if (/cidr_blocks\s*=\s*\["0\.0\.0\.0\/0"\]/i.test(line)) {
            findings.push({
              severity: 'high',
              category: 'Terraform Security',
              file,
              line: lineNum,
              description: 'Security group allows access from anywhere (0.0.0.0/0)',
              suggestion: 'Restrict CIDR blocks to specific IP ranges',
            });
          }

          // Check for IAM wildcards
          if (/"Action":\s*"\*"|"Resource":\s*"\*"/i.test(line)) {
            findings.push({
              severity: 'high',
              category: 'Terraform Security',
              file,
              line: lineNum,
              description: 'IAM policy uses wildcards (*)',
              suggestion: 'Use least privilege principle with specific actions/resources',
            });
          }

          // Check for logging disabled
          if (/logging\s*=\s*\{\s*enabled\s*=\s*false/i.test(line)) {
            findings.push({
              severity: 'medium',
              category: 'Terraform Security',
              file,
              line: lineNum,
              description: 'Logging is disabled',
              suggestion: 'Enable logging for audit and compliance',
            });
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return findings;
  }

  /**
   * Scan Kubernetes YAML files
   */
  private async scanKubernetes(repoPath: string): Promise<Finding[]> {
    const findings: Finding[] = [];
    const k8sFiles = this.findFiles(repoPath, /\.ya?ml$/);

    for (const file of k8sFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const docs = yaml.loadAll(content) as any[];

        for (const doc of docs) {
          if (!doc || typeof doc !== 'object') continue;

          // Check if it's a Kubernetes resource
          if (doc.apiVersion && doc.kind) {
            findings.push(...this.checkK8sResource(doc, file));
          }
        }
      } catch {
        // Skip files that can't be parsed
      }
    }

    return findings;
  }

  /**
   * Check Kubernetes resource for security issues
   */
  private checkK8sResource(resource: any, file: string): Finding[] {
    const findings: Finding[] = [];

    // Check Pod Security
    if (resource.kind === 'Pod' || resource.kind === 'Deployment' || resource.kind === 'StatefulSet') {
      const containers = resource.spec?.template?.spec?.containers || resource.spec?.containers || [];

      for (const container of containers) {
        // Check for privileged containers
        if (container.securityContext?.privileged === true) {
          findings.push({
            severity: 'critical',
            category: 'Kubernetes Security',
            file,
            description: `Container ${container.name} runs in privileged mode`,
            suggestion: 'Remove privileged mode or use specific capabilities',
          });
        }

        // Check for running as root
        if (!container.securityContext?.runAsNonRoot) {
          findings.push({
            severity: 'high',
            category: 'Kubernetes Security',
            file,
            description: `Container ${container.name} may run as root`,
            suggestion: 'Set runAsNonRoot: true in securityContext',
          });
        }

        // Check for missing resource limits
        if (!container.resources?.limits) {
          findings.push({
            severity: 'medium',
            category: 'Kubernetes Best Practice',
            file,
            description: `Container ${container.name} has no resource limits`,
            suggestion: 'Define CPU and memory limits to prevent resource exhaustion',
          });
        }

        // Check for latest tag
        if (container.image && (container.image.endsWith(':latest') || !container.image.includes(':'))) {
          findings.push({
            severity: 'medium',
            category: 'Kubernetes Best Practice',
            file,
            description: `Container ${container.name} uses :latest tag`,
            suggestion: 'Pin to specific image versions',
          });
        }

        // Check for hostNetwork
        if (resource.spec?.hostNetwork === true) {
          findings.push({
            severity: 'high',
            category: 'Kubernetes Security',
            file,
            description: 'Pod uses host network',
            suggestion: 'Avoid hostNetwork unless absolutely necessary',
          });
        }

        // Check for hostPath volumes
        const volumes = resource.spec?.volumes || [];
        for (const volume of volumes) {
          if (volume.hostPath) {
            findings.push({
              severity: 'high',
              category: 'Kubernetes Security',
              file,
              description: 'Pod uses hostPath volume',
              suggestion: 'Avoid hostPath volumes, use PersistentVolumes instead',
            });
          }
        }
      }
    }

    // Check Service security
    if (resource.kind === 'Service') {
      if (resource.spec?.type === 'LoadBalancer') {
        findings.push({
          severity: 'medium',
          category: 'Kubernetes Security',
          file,
          description: 'Service exposed via LoadBalancer',
          suggestion: 'Review if public exposure is necessary',
        });
      }
    }

    // Check RBAC
    if (resource.kind === 'ClusterRole' || resource.kind === 'Role') {
      const rules = resource.rules || [];
      for (const rule of rules) {
        if (rule.verbs?.includes('*') || rule.resources?.includes('*')) {
          findings.push({
            severity: 'high',
            category: 'Kubernetes Security',
            file,
            description: 'RBAC role uses wildcards',
            suggestion: 'Use least privilege with specific verbs and resources',
          });
        }
      }
    }

    return findings;
  }

  /**
   * Scan Docker Compose files
   */
  private async scanDockerCompose(repoPath: string): Promise<Finding[]> {
    const findings: Finding[] = [];
    const composeFiles = this.findFiles(repoPath, /docker-compose.*\.ya?ml$/);

    for (const file of composeFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const compose = yaml.load(content) as any;

        if (compose.services) {
          for (const [serviceName, serviceConfig] of Object.entries(compose.services as any)) {
            const service = serviceConfig as any;

            // Check for privileged containers
            if (service.privileged === true) {
              findings.push({
                severity: 'critical',
                category: 'Docker Compose Security',
                file,
                description: `Service ${serviceName} runs in privileged mode`,
                suggestion: 'Remove privileged mode',
              });
            }

            // Check for host network
            if (service.network_mode === 'host') {
              findings.push({
                severity: 'high',
                category: 'Docker Compose Security',
                file,
                description: `Service ${serviceName} uses host network`,
                suggestion: 'Use bridge network instead',
              });
            }

            // Check for exposed ports
            if (service.ports) {
              for (const port of service.ports) {
                if (typeof port === 'string' && port.startsWith('0.0.0.0:')) {
                  findings.push({
                    severity: 'medium',
                    category: 'Docker Compose Security',
                    file,
                    description: `Service ${serviceName} binds to 0.0.0.0`,
                    suggestion: 'Bind to localhost (127.0.0.1) if not needed externally',
                  });
                }
              }
            }

            // Check for environment variables with secrets
            if (service.environment) {
              for (const env of service.environment) {
                const envStr = typeof env === 'string' ? env : JSON.stringify(env);
                if (/password|secret|token|key/i.test(envStr) && /=/.test(envStr)) {
                  findings.push({
                    severity: 'high',
                    category: 'Docker Compose Security',
                    file,
                    description: `Service ${serviceName} has hardcoded secrets`,
                    suggestion: 'Use Docker secrets or .env files',
                  });
                }
              }
            }
          }
        }
      } catch {
        // Skip files that can't be parsed
      }
    }

    return findings;
  }

  /**
   * Find files matching pattern recursively
   */
  private findFiles(dir: string, pattern: RegExp, maxDepth: number = 5): string[] {
    const files: string[] = [];

    const search = (currentDir: string, depth: number) => {
      if (depth > maxDepth) return;

      try {
        const items = fs.readdirSync(currentDir);

        for (const item of items) {
          // Skip node_modules, .git, etc.
          if (item === 'node_modules' || item === '.git' || item === 'vendor') continue;

          const fullPath = path.join(currentDir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            search(fullPath, depth + 1);
          } else if (pattern.test(item)) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip directories that can't be read
      }
    };

    search(dir, 0);
    return files;
  }
}

export const iacScanner = new IaCScanner();

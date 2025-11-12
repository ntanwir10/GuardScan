import * as fs from 'fs';
import * as path from 'path';
import { Finding } from '../utils/reporter';

export class DockerfileScanner {
  /**
   * Scan all Dockerfiles in repository
   */
  async scan(repoPath: string = process.cwd()): Promise<Finding[]> {
    const findings: Finding[] = [];
    const dockerfiles = this.findDockerfiles(repoPath);

    for (const dockerfile of dockerfiles) {
      findings.push(...this.scanDockerfile(dockerfile));
    }

    return findings;
  }

  /**
   * Find all Dockerfiles in repository
   */
  private findDockerfiles(dir: string): string[] {
    const dockerfiles: string[] = [];

    const search = (currentDir: string, depth: number) => {
      if (depth > 5) return;

      try {
        const items = fs.readdirSync(currentDir);
        for (const item of items) {
          if (item === 'node_modules' || item === '.git' || item === 'vendor') continue;

          const fullPath = path.join(currentDir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            search(fullPath, depth + 1);
          } else if (item === 'Dockerfile' || item.startsWith('Dockerfile.')) {
            dockerfiles.push(fullPath);
          }
        }
      } catch {
        // Skip
      }
    };

    search(dir, 0);
    return dockerfiles;
  }

  /**
   * Scan Dockerfile for security issues
   */
  scanDockerfile(dockerfilePath: string): Finding[] {
    const findings: Finding[] = [];

    try {
      const content = fs.readFileSync(dockerfilePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lineNum = i + 1;

        findings.push(...this.checkBaseImage(line, dockerfilePath, lineNum));
        findings.push(...this.checkRunAsRoot(line, dockerfilePath, lineNum));
        findings.push(...this.checkExposedPorts(line, dockerfilePath, lineNum));
        findings.push(...this.checkCopyPermissions(line, dockerfilePath, lineNum));
        findings.push(...this.checkSecrets(line, dockerfilePath, lineNum));
        findings.push(...this.checkAptGet(line, dockerfilePath, lineNum));
        findings.push(...this.checkLayerOptimization(line, dockerfilePath, lineNum));
      }

      findings.push(...this.checkHealthcheck(lines, dockerfilePath));
      findings.push(...this.checkUserDirective(lines, dockerfilePath));
    } catch (error) {
      // File doesn't exist or can't be read
    }

    return findings;
  }

  private checkBaseImage(line: string, file: string, lineNum: number): Finding[] {
    const findings: Finding[] = [];

    if (line.startsWith('FROM ')) {
      const image = line.substring(5).trim();

      if (image.endsWith(':latest') || !image.includes(':')) {
        findings.push({
          severity: 'medium',
          category: 'Docker Security',
          file,
          line: lineNum,
          description: 'Using :latest tag or no tag is not recommended',
          suggestion: 'Pin to specific version tags for reproducible builds',
        });
      }

      if (image.startsWith('ubuntu') || image.startsWith('debian')) {
        if (!image.includes('slim') && !image.includes('minimal')) {
          findings.push({
            severity: 'low',
            category: 'Docker Best Practice',
            file,
            line: lineNum,
            description: 'Using full OS image increases attack surface',
            suggestion: 'Consider using slim or distroless images',
          });
        }
      }
    }

    return findings;
  }

  private checkRunAsRoot(line: string, file: string, lineNum: number): Finding[] {
    const findings: Finding[] = [];

    if (line.startsWith('RUN ') && line.includes('chmod 777')) {
      findings.push({
        severity: 'high',
        category: 'Docker Security',
        file,
        line: lineNum,
        description: 'Using chmod 777 grants excessive permissions',
        suggestion: 'Use least privilege principle, avoid 777 permissions',
      });
    }

    return findings;
  }

  private checkExposedPorts(line: string, file: string, lineNum: number): Finding[] {
    const findings: Finding[] = [];

    if (line.startsWith('EXPOSE ')) {
      const port = line.substring(7).trim();
      const dangerousPorts = ['22', '23', '3389', '5900'];

      if (dangerousPorts.includes(port)) {
        findings.push({
          severity: 'high',
          category: 'Docker Security',
          file,
          line: lineNum,
          description: `Exposing potentially dangerous port ${port}`,
          suggestion: 'Avoid exposing SSH, Telnet, RDP, or VNC ports',
        });
      }
    }

    return findings;
  }

  private checkCopyPermissions(line: string, file: string, lineNum: number): Finding[] {
    const findings: Finding[] = [];

    if (line.startsWith('COPY ') || line.startsWith('ADD ')) {
      if (!line.includes('--chown=')) {
        findings.push({
          severity: 'medium',
          category: 'Docker Best Practice',
          file,
          line: lineNum,
          description: 'COPY/ADD without --chown creates files owned by root',
          suggestion: 'Use --chown flag to set appropriate ownership',
        });
      }

      if (line.startsWith('ADD ') && (line.includes('http://') || line.includes('https://'))) {
        findings.push({
          severity: 'medium',
          category: 'Docker Security',
          file,
          line: lineNum,
          description: 'ADD with remote URL can be dangerous',
          suggestion: 'Use RUN curl/wget for remote files',
        });
      }
    }

    return findings;
  }

  private checkSecrets(line: string, file: string, lineNum: number): Finding[] {
    const findings: Finding[] = [];

    if (line.startsWith('ENV ')) {
      const secretKeywords = ['PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'API_KEY'];
      if (secretKeywords.some(keyword => line.toUpperCase().includes(keyword))) {
        findings.push({
          severity: 'critical',
          category: 'Docker Security',
          file,
          line: lineNum,
          description: 'Potential hardcoded secret in ENV variable',
          suggestion: 'Use Docker secrets or runtime environment variables',
        });
      }
    }

    return findings;
  }

  private checkAptGet(line: string, file: string, lineNum: number): Finding[] {
    const findings: Finding[] = [];

    if (line.includes('apt-get update') && !line.includes('apt-get clean')) {
      findings.push({
        severity: 'low',
        category: 'Docker Best Practice',
        file,
        line: lineNum,
        description: 'apt-get update without cleanup increases image size',
        suggestion: 'Chain apt-get commands and add clean in one RUN',
      });
    }

    return findings;
  }

  private checkLayerOptimization(line: string, file: string, lineNum: number): Finding[] {
    const findings: Finding[] = [];

    if (line.startsWith('RUN ') && !line.includes('&&')) {
      findings.push({
        severity: 'low',
        category: 'Docker Best Practice',
        file,
        line: lineNum,
        description: 'Multiple RUN commands create unnecessary layers',
        suggestion: 'Combine related commands with && to reduce layers',
      });
    }

    return findings;
  }

  private checkHealthcheck(lines: string[], file: string): Finding[] {
    const findings: Finding[] = [];
    const hasHealthcheck = lines.some(line => line.trim().startsWith('HEALTHCHECK '));

    if (!hasHealthcheck) {
      findings.push({
        severity: 'low',
        category: 'Docker Best Practice',
        file,
        description: 'No HEALTHCHECK instruction found',
        suggestion: 'Add HEALTHCHECK to enable container health monitoring',
      });
    }

    return findings;
  }

  private checkUserDirective(lines: string[], file: string): Finding[] {
    const findings: Finding[] = [];
    const hasUser = lines.some(line => line.trim().startsWith('USER '));

    if (!hasUser) {
      findings.push({
        severity: 'high',
        category: 'Docker Security',
        file,
        description: 'No USER directive - container runs as root',
        suggestion: 'Add USER directive to run as non-root user',
      });
    }

    return findings;
  }
}

export const dockerfileScanner = new DockerfileScanner();

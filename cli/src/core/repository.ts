import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

export interface RepositoryInfo {
  repoId: string;
  name: string;
  path: string;
  isGit: boolean;
  remoteUrl?: string;
  branch?: string;
}

export class RepositoryManager {
  /**
   * Get repository information from current directory
   */
  getRepoInfo(repoPath: string = process.cwd()): RepositoryInfo {
    const isGit = this.isGitRepo(repoPath);

    if (isGit) {
      return this.getGitRepoInfo(repoPath);
    } else {
      return this.getFallbackRepoInfo(repoPath);
    }
  }

  /**
   * Check if directory is a git repository
   */
  private isGitRepo(repoPath: string): boolean {
    try {
      const gitDir = path.join(repoPath, '.git');
      return fs.existsSync(gitDir);
    } catch {
      return false;
    }
  }

  /**
   * Get git repository information
   */
  private getGitRepoInfo(repoPath: string): RepositoryInfo {
    try {
      // Get remote URL
      let remoteUrl: string | undefined;
      try {
        remoteUrl = execSync('git config --get remote.origin.url', {
          cwd: repoPath,
          encoding: 'utf-8',
        }).trim();
      } catch {
        // No remote configured
      }

      // Get current branch
      let branch: string | undefined;
      try {
        branch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: repoPath,
          encoding: 'utf-8',
        }).trim();
      } catch {
        // Unable to get branch
      }

      // Generate repo ID based on priority:
      // 1. Git remote URL hash
      // 2. Git metadata hash
      // 3. UUID fallback
      const repoId = this.generateRepoId(repoPath, remoteUrl);

      const name = path.basename(repoPath);

      return {
        repoId,
        name,
        path: repoPath,
        isGit: true,
        remoteUrl,
        branch,
      };
    } catch (error) {
      // Fallback if git commands fail
      return this.getFallbackRepoInfo(repoPath);
    }
  }

  /**
   * Get fallback repository info for non-git directories
   */
  private getFallbackRepoInfo(repoPath: string): RepositoryInfo {
    const name = path.basename(repoPath);
    const repoId = this.hashString(repoPath + name);

    return {
      repoId,
      name,
      path: repoPath,
      isGit: false,
    };
  }

  /**
   * Generate repo ID using priority system
   */
  private generateRepoId(repoPath: string, remoteUrl?: string): string {
    // Priority 1: Git remote URL hash
    if (remoteUrl) {
      return this.hashString(remoteUrl);
    }

    // Priority 2: Git metadata hash
    try {
      const gitDir = path.join(repoPath, '.git');
      const configPath = path.join(gitDir, 'config');
      const headPath = path.join(gitDir, 'HEAD');

      if (fs.existsSync(configPath) && fs.existsSync(headPath)) {
        const config = fs.readFileSync(configPath, 'utf-8');
        const head = fs.readFileSync(headPath, 'utf-8');
        return this.hashString(config + head);
      }
    } catch {
      // Continue to fallback
    }

    // Priority 3: UUID fallback
    return this.hashString(uuidv4());
  }

  /**
   * Hash string to create consistent identifier
   */
  private hashString(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
  }

  /**
   * Validate if current directory is a valid repository
   */
  isValidRepo(repoPath: string = process.cwd()): boolean {
    try {
      const stat = fs.statSync(repoPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}

export const repositoryManager = new RepositoryManager();

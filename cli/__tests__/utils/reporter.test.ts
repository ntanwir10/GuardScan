import { Reporter, ReviewResult, Finding } from "../../src/utils/reporter";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { describe, it, beforeEach, afterEach, expect } from "@jest/globals";

describe("Reporter", () => {
  let reporter: Reporter;
  let testDir: string;
  let mockResult: ReviewResult;

  beforeEach(() => {
    reporter = new Reporter();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporter-test-"));

    mockResult = {
      summary: "Test summary",
      findings: [
        {
          severity: "critical",
          category: "Security",
          file: "test.js",
          line: 10,
          description: "Critical security issue",
          suggestion: "Fix it immediately",
        },
        {
          severity: "high",
          category: "Performance",
          file: "app.js",
          line: 25,
          description: "Performance bottleneck",
          suggestion: "Optimize this code",
        },
        {
          severity: "medium",
          category: "Code Quality",
          file: "utils.js",
          description: "Code smell detected",
        },
      ],
      recommendations: [
        "Fix critical issues first",
        "Review all security findings",
        "Add more tests",
      ],
      metadata: {
        timestamp: new Date().toISOString(),
        repoInfo: {
          repoId: "test-repo-id",
          name: "test-repo",
          path: "/test/path",
          isGit: true,
          branch: "main",
        },
        locStats: {
          totalLines: 1000,
          codeLines: 800,
          commentLines: 100,
          blankLines: 100,
          fileCount: 10,
          fileBreakdown: [],
        },
        provider: "openai",
        model: "gpt-4",
        durationMs: 5000,
      },
    };
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("generateMarkdown", () => {
    it("should generate valid markdown", () => {
      const markdown = reporter.generateMarkdown(mockResult);

      expect(markdown).toContain("# GuardScan Report");
      expect(markdown).toContain("## Overview");
      expect(markdown).toContain("## Code Statistics");
      expect(markdown).toContain("## Summary");
      expect(markdown).toContain("## Findings");
      expect(markdown).toContain("## Recommendations");
    });

    it("should include repository information", () => {
      const markdown = reporter.generateMarkdown(mockResult);

      expect(markdown).toContain("test-repo");
      expect(markdown).toContain("main");
    });

    it("should include LOC statistics", () => {
      const markdown = reporter.generateMarkdown(mockResult);

      expect(markdown).toContain("Total Lines");
      expect(markdown).toContain("800");
      expect(markdown).toContain("Files Analyzed");
      expect(markdown).toContain("10");
    });

    it("should group findings by severity", () => {
      const markdown = reporter.generateMarkdown(mockResult);

      expect(markdown).toContain("CRITICAL");
      expect(markdown).toContain("HIGH");
      expect(markdown).toContain("MEDIUM");
      expect(markdown).toContain("🔴");
      expect(markdown).toContain("🟠");
      expect(markdown).toContain("🟡");
    });

    it("should include finding details", () => {
      const markdown = reporter.generateMarkdown(mockResult);

      expect(markdown).toContain("Critical security issue");
      expect(markdown).toContain("test.js");
      expect(markdown).toContain("Line 10");
      expect(markdown).toContain("Fix it immediately");
    });

    it("should include recommendations", () => {
      const markdown = reporter.generateMarkdown(mockResult);

      expect(markdown).toContain("Fix critical issues first");
      expect(markdown).toContain("Review all security findings");
      expect(markdown).toContain("Add more tests");
    });

    it("should handle empty findings gracefully", () => {
      const emptyResult = { ...mockResult, findings: [] };
      const markdown = reporter.generateMarkdown(emptyResult);

      expect(markdown).toContain("No issues found");
    });

    it("should include provider and model information", () => {
      const markdown = reporter.generateMarkdown(mockResult);

      expect(markdown).toContain("openai");
      expect(markdown).toContain("gpt-4");
    });

    it("should include duration", () => {
      const markdown = reporter.generateMarkdown(mockResult);

      expect(markdown).toContain("5.00s");
    });
  });

  describe("saveReport", () => {
    it("should save markdown report to file", () => {
      const outputPath = path.join(testDir, "report.md");
      const savedPath = reporter.saveReport(mockResult, "markdown", outputPath);

      expect(savedPath).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("# GuardScan Report");
    });

    it("should generate default filename if not specified", () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      const savedPath = reporter.saveReport(mockResult, "markdown");

      expect(savedPath).toMatch(/code-review-.*\.md/);
      expect(fs.existsSync(savedPath)).toBe(true);

      process.chdir(originalCwd);
    });

    it("should handle markdown format", () => {
      const outputPath = path.join(testDir, "report.md");
      reporter.saveReport(mockResult, "markdown", outputPath);

      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("# GuardScan Report");
    });
  });

  describe("groupFindingsBySeverity", () => {
    it("should group findings correctly", () => {
      const grouped = (reporter as any).groupFindingsBySeverity(
        mockResult.findings
      );

      expect(grouped.critical).toHaveLength(1);
      expect(grouped.high).toHaveLength(1);
      expect(grouped.medium).toHaveLength(1);
      expect(grouped.low).toHaveLength(0);
    });

    it("should handle empty findings", () => {
      const grouped = (reporter as any).groupFindingsBySeverity([]);

      expect(grouped.critical).toEqual([]);
      expect(grouped.high).toEqual([]);
      expect(grouped.medium).toEqual([]);
      expect(grouped.low).toEqual([]);
    });
  });

  describe("getSeverityIcon", () => {
    it("should return correct icons", () => {
      expect((reporter as any).getSeverityIcon("critical")).toBe("🔴");
      expect((reporter as any).getSeverityIcon("high")).toBe("🟠");
      expect((reporter as any).getSeverityIcon("medium")).toBe("🟡");
      expect((reporter as any).getSeverityIcon("low")).toBe("🔵");
      expect((reporter as any).getSeverityIcon("info")).toBe("⚪");
    });
  });

  describe("calculateSeveritySummary", () => {
    it("should calculate severity counts correctly", () => {
      const summary = (reporter as any).calculateSeveritySummary(
        mockResult.findings
      );

      expect(summary.critical).toBe(1);
      expect(summary.high).toBe(1);
      expect(summary.medium).toBe(1);
      expect(summary.low).toBe(0);
      expect(summary.info).toBe(0);
    });
  });

  describe("calculateCategoryDistribution", () => {
    it("should calculate category distribution", () => {
      const distribution = (reporter as any).calculateCategoryDistribution(
        mockResult.findings
      );

      expect(distribution["Security"]).toBe(1);
      expect(distribution["Performance"]).toBe(1);
      expect(distribution["Code Quality"]).toBe(1);
    });

    it("should handle multiple findings in same category", () => {
      const findings: Finding[] = [
        {
          severity: "high",
          category: "Security",
          file: "test1.js",
          description: "Issue 1",
        },
        {
          severity: "high",
          category: "Security",
          file: "test2.js",
          description: "Issue 2",
        },
        {
          severity: "medium",
          category: "Security",
          file: "test3.js",
          description: "Issue 3",
        },
      ];

      const distribution = (reporter as any).calculateCategoryDistribution(
        findings
      );

      expect(distribution["Security"]).toBe(3);
    });
  });
});

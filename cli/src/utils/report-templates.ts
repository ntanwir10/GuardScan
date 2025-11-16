/**
 * Custom Report Templates
 *
 * Allows users to customize report output format
 * Supports multiple output formats: Markdown, HTML, JSON, XML, PDF
 *
 * P1: Important Feature
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../core/config';

/**
 * Report Format Types
 */
export enum ReportFormat {
  MARKDOWN = 'markdown',
  HTML = 'html',
  JSON = 'json',
  XML = 'xml',
  PDF = 'pdf',
  TEXT = 'text'
}

/**
 * Report Section
 */
export interface ReportSection {
  title: string;
  content: string;
  subsections?: ReportSection[];
  data?: any;
}

/**
 * Report Data
 */
export interface ReportData {
  title: string;
  subtitle?: string;
  timestamp: Date;
  sections: ReportSection[];
  metadata?: Record<string, any>;
  summary?: {
    totalIssues: number;
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    lowIssues: number;
  };
}

/**
 * Template Configuration
 */
export interface TemplateConfig {
  format: ReportFormat;
  includeTimestamp: boolean;
  includeTOC: boolean; // Table of Contents
  includeSummary: boolean;
  includeCharts: boolean;
  customCSS?: string;
  customHeader?: string;
  customFooter?: string;
  logoPath?: string;
}

/**
 * Default Template Configuration
 */
const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  format: ReportFormat.MARKDOWN,
  includeTimestamp: true,
  includeTOC: true,
  includeSummary: true,
  includeCharts: false
};

/**
 * Report Template Engine
 */
export class ReportTemplateEngine {
  private config: TemplateConfig;
  private configManager: ConfigManager;

  constructor(config?: Partial<TemplateConfig>) {
    this.configManager = new ConfigManager();
    this.config = { ...DEFAULT_TEMPLATE_CONFIG, ...config };
  }

  /**
   * Generate report
   */
  generate(data: ReportData): string {
    switch (this.config.format) {
      case ReportFormat.MARKDOWN:
        return this.generateMarkdown(data);
      case ReportFormat.HTML:
        return this.generateHTML(data);
      case ReportFormat.JSON:
        return this.generateJSON(data);
      case ReportFormat.XML:
        return this.generateXML(data);
      case ReportFormat.TEXT:
        return this.generateText(data);
      default:
        throw new Error(`Unsupported format: ${this.config.format}`);
    }
  }

  /**
   * Generate Markdown report
   */
  private generateMarkdown(data: ReportData): string {
    let report = '';

    // Title
    report += `# ${data.title}\n\n`;

    if (data.subtitle) {
      report += `*${data.subtitle}*\n\n`;
    }

    // Timestamp
    if (this.config.includeTimestamp) {
      report += `**Generated:** ${data.timestamp.toISOString()}\n\n`;
    }

    // Summary
    if (this.config.includeSummary && data.summary) {
      report += this.generateMarkdownSummary(data.summary);
    }

    // Table of Contents
    if (this.config.includeTOC) {
      report += this.generateMarkdownTOC(data.sections);
    }

    // Sections
    for (const section of data.sections) {
      report += this.generateMarkdownSection(section, 2);
    }

    return report;
  }

  /**
   * Generate Markdown summary
   */
  private generateMarkdownSummary(summary: any): string {
    let md = '## Summary\n\n';
    md += '| Severity | Count |\n';
    md += '|----------|-------|\n';
    md += `| 🔴 Critical | ${summary.criticalIssues || 0} |\n`;
    md += `| 🟠 High | ${summary.highIssues || 0} |\n`;
    md += `| 🟡 Medium | ${summary.mediumIssues || 0} |\n`;
    md += `| 🟢 Low | ${summary.lowIssues || 0} |\n`;
    md += `| **Total** | **${summary.totalIssues || 0}** |\n\n`;
    return md;
  }

  /**
   * Generate Markdown Table of Contents
   */
  private generateMarkdownTOC(sections: ReportSection[]): string {
    let toc = '## Table of Contents\n\n';

    for (const section of sections) {
      const anchor = section.title.toLowerCase().replace(/\s+/g, '-');
      toc += `- [${section.title}](#${anchor})\n`;

      if (section.subsections) {
        for (const subsection of section.subsections) {
          const subAnchor = subsection.title.toLowerCase().replace(/\s+/g, '-');
          toc += `  - [${subsection.title}](#${subAnchor})\n`;
        }
      }
    }

    toc += '\n';
    return toc;
  }

  /**
   * Generate Markdown section
   */
  private generateMarkdownSection(section: ReportSection, level: number): string {
    let md = '';

    // Section title
    md += `${'#'.repeat(level)} ${section.title}\n\n`;

    // Section content
    if (section.content) {
      md += `${section.content}\n\n`;
    }

    // Section data (render as code block)
    if (section.data) {
      md += '```json\n';
      md += JSON.stringify(section.data, null, 2);
      md += '\n```\n\n';
    }

    // Subsections
    if (section.subsections) {
      for (const subsection of section.subsections) {
        md += this.generateMarkdownSection(subsection, level + 1);
      }
    }

    return md;
  }

  /**
   * Generate HTML report
   */
  private generateHTML(data: ReportData): string {
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHTML(data.title)}</title>
  ${this.getHTMLStyles()}
</head>
<body>
  <div class="container">
`;

    // Custom header
    if (this.config.customHeader) {
      html += this.config.customHeader;
    }

    // Title
    html += `    <h1>${this.escapeHTML(data.title)}</h1>\n`;

    if (data.subtitle) {
      html += `    <p class="subtitle">${this.escapeHTML(data.subtitle)}</p>\n`;
    }

    // Timestamp
    if (this.config.includeTimestamp) {
      html += `    <p class="timestamp">Generated: ${data.timestamp.toISOString()}</p>\n`;
    }

    // Summary
    if (this.config.includeSummary && data.summary) {
      html += this.generateHTMLSummary(data.summary);
    }

    // Table of Contents
    if (this.config.includeTOC) {
      html += this.generateHTMLTOC(data.sections);
    }

    // Sections
    for (const section of data.sections) {
      html += this.generateHTMLSection(section);
    }

    // Custom footer
    if (this.config.customFooter) {
      html += this.config.customFooter;
    }

    html += `  </div>
</body>
</html>`;

    return html;
  }

  /**
   * Generate HTML summary
   */
  private generateHTMLSummary(summary: any): string {
    return `
    <div class="summary">
      <h2>Summary</h2>
      <table>
        <tr>
          <th>Severity</th>
          <th>Count</th>
        </tr>
        <tr class="critical">
          <td>🔴 Critical</td>
          <td>${summary.criticalIssues || 0}</td>
        </tr>
        <tr class="high">
          <td>🟠 High</td>
          <td>${summary.highIssues || 0}</td>
        </tr>
        <tr class="medium">
          <td>🟡 Medium</td>
          <td>${summary.mediumIssues || 0}</td>
        </tr>
        <tr class="low">
          <td>🟢 Low</td>
          <td>${summary.lowIssues || 0}</td>
        </tr>
        <tr class="total">
          <td><strong>Total</strong></td>
          <td><strong>${summary.totalIssues || 0}</strong></td>
        </tr>
      </table>
    </div>
`;
  }

  /**
   * Generate HTML Table of Contents
   */
  private generateHTMLTOC(sections: ReportSection[]): string {
    let toc = '    <div class="toc">\n      <h2>Table of Contents</h2>\n      <ul>\n';

    for (const section of sections) {
      const anchor = section.title.toLowerCase().replace(/\s+/g, '-');
      toc += `        <li><a href="#${anchor}">${this.escapeHTML(section.title)}</a></li>\n`;

      if (section.subsections) {
        toc += '        <ul>\n';
        for (const subsection of section.subsections) {
          const subAnchor = subsection.title.toLowerCase().replace(/\s+/g, '-');
          toc += `          <li><a href="#${subAnchor}">${this.escapeHTML(subsection.title)}</a></li>\n`;
        }
        toc += '        </ul>\n';
      }
    }

    toc += '      </ul>\n    </div>\n';
    return toc;
  }

  /**
   * Generate HTML section
   */
  private generateHTMLSection(section: ReportSection): string {
    const anchor = section.title.toLowerCase().replace(/\s+/g, '-');
    let html = `    <div class="section" id="${anchor}">\n`;
    html += `      <h2>${this.escapeHTML(section.title)}</h2>\n`;

    if (section.content) {
      html += `      <div class="content">${this.markdownToHTML(section.content)}</div>\n`;
    }

    if (section.data) {
      html += `      <pre><code>${this.escapeHTML(JSON.stringify(section.data, null, 2))}</code></pre>\n`;
    }

    if (section.subsections) {
      for (const subsection of section.subsections) {
        html += this.generateHTMLSection(subsection);
      }
    }

    html += '    </div>\n';
    return html;
  }

  /**
   * Get HTML styles
   */
  private getHTMLStyles(): string {
    const customCSS = this.config.customCSS || '';

    return `  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #2c3e50;
      border-bottom: 3px solid #3498db;
      padding-bottom: 10px;
    }
    .subtitle {
      font-size: 1.2em;
      color: #7f8c8d;
      margin-top: -10px;
    }
    .timestamp {
      color: #95a5a6;
      font-size: 0.9em;
    }
    .summary {
      background: #ecf0f1;
      padding: 20px;
      border-radius: 5px;
      margin: 20px 0;
    }
    .summary table {
      width: 100%;
      border-collapse: collapse;
    }
    .summary th, .summary td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #bdc3c7;
    }
    .summary .critical { color: #e74c3c; }
    .summary .high { color: #e67e22; }
    .summary .medium { color: #f39c12; }
    .summary .low { color: #27ae60; }
    .summary .total { font-weight: bold; }
    .toc {
      background: #ecf0f1;
      padding: 20px;
      border-radius: 5px;
      margin: 20px 0;
    }
    .toc ul {
      list-style-type: none;
      padding-left: 0;
    }
    .toc li {
      margin: 5px 0;
    }
    .toc a {
      color: #3498db;
      text-decoration: none;
    }
    .toc a:hover {
      text-decoration: underline;
    }
    .section {
      margin: 30px 0;
    }
    .section h2 {
      color: #34495e;
      border-bottom: 2px solid #ecf0f1;
      padding-bottom: 5px;
    }
    pre {
      background: #2c3e50;
      color: #ecf0f1;
      padding: 15px;
      border-radius: 5px;
      overflow-x: auto;
    }
    code {
      font-family: 'Courier New', monospace;
    }
    ${customCSS}
  </style>`;
  }

  /**
   * Generate JSON report
   */
  private generateJSON(data: ReportData): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Generate XML report
   */
  private generateXML(data: ReportData): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<report>\n';
    xml += `  <title>${this.escapeXML(data.title)}</title>\n`;

    if (data.subtitle) {
      xml += `  <subtitle>${this.escapeXML(data.subtitle)}</subtitle>\n`;
    }

    if (this.config.includeTimestamp) {
      xml += `  <timestamp>${data.timestamp.toISOString()}</timestamp>\n`;
    }

    if (this.config.includeSummary && data.summary) {
      xml += '  <summary>\n';
      xml += `    <totalIssues>${data.summary.totalIssues}</totalIssues>\n`;
      xml += `    <criticalIssues>${data.summary.criticalIssues}</criticalIssues>\n`;
      xml += `    <highIssues>${data.summary.highIssues}</highIssues>\n`;
      xml += `    <mediumIssues>${data.summary.mediumIssues}</mediumIssues>\n`;
      xml += `    <lowIssues>${data.summary.lowIssues}</lowIssues>\n`;
      xml += '  </summary>\n';
    }

    xml += '  <sections>\n';
    for (const section of data.sections) {
      xml += this.generateXMLSection(section, 4);
    }
    xml += '  </sections>\n';

    xml += '</report>';
    return xml;
  }

  /**
   * Generate XML section
   */
  private generateXMLSection(section: ReportSection, indent: number): string {
    const spaces = ' '.repeat(indent);
    let xml = `${spaces}<section>\n`;
    xml += `${spaces}  <title>${this.escapeXML(section.title)}</title>\n`;

    if (section.content) {
      xml += `${spaces}  <content><![CDATA[${section.content}]]></content>\n`;
    }

    if (section.data) {
      xml += `${spaces}  <data><![CDATA[${JSON.stringify(section.data)}]]></data>\n`;
    }

    if (section.subsections) {
      xml += `${spaces}  <subsections>\n`;
      for (const subsection of section.subsections) {
        xml += this.generateXMLSection(subsection, indent + 4);
      }
      xml += `${spaces}  </subsections>\n`;
    }

    xml += `${spaces}</section>\n`;
    return xml;
  }

  /**
   * Generate plain text report
   */
  private generateText(data: ReportData): string {
    let text = '';

    text += `${data.title}\n`;
    text += '='.repeat(data.title.length) + '\n\n';

    if (data.subtitle) {
      text += `${data.subtitle}\n\n`;
    }

    if (this.config.includeTimestamp) {
      text += `Generated: ${data.timestamp.toISOString()}\n\n`;
    }

    if (this.config.includeSummary && data.summary) {
      text += 'SUMMARY\n';
      text += '-------\n';
      text += `Critical: ${data.summary.criticalIssues || 0}\n`;
      text += `High:     ${data.summary.highIssues || 0}\n`;
      text += `Medium:   ${data.summary.mediumIssues || 0}\n`;
      text += `Low:      ${data.summary.lowIssues || 0}\n`;
      text += `Total:    ${data.summary.totalIssues || 0}\n\n`;
    }

    for (const section of data.sections) {
      text += this.generateTextSection(section, 0);
    }

    return text;
  }

  /**
   * Generate text section
   */
  private generateTextSection(section: ReportSection, level: number): string {
    let text = '';
    const indent = '  '.repeat(level);

    text += `${indent}${section.title}\n`;
    text += `${indent}${'-'.repeat(section.title.length)}\n`;

    if (section.content) {
      text += `${indent}${section.content}\n\n`;
    }

    if (section.data) {
      text += `${indent}${JSON.stringify(section.data, null, 2)}\n\n`;
    }

    if (section.subsections) {
      for (const subsection of section.subsections) {
        text += this.generateTextSection(subsection, level + 1);
      }
    }

    return text;
  }

  /**
   * Escape HTML
   */
  private escapeHTML(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Escape XML
   */
  private escapeXML(text: string): string {
    return this.escapeHTML(text);
  }

  /**
   * Convert simple Markdown to HTML
   */
  private markdownToHTML(markdown: string): string {
    return markdown
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  /**
   * Save report to file
   */
  saveToFile(data: ReportData, outputPath: string): void {
    const report = this.generate(data);
    fs.writeFileSync(outputPath, report, 'utf-8');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TemplateConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';

export interface SeveritySummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface ComplexityData {
  file: string;
  complexity: number;
}

export interface CoverageData {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

export class ChartGenerator {
  private chartJSNodeCanvas: ChartJSNodeCanvas;

  constructor() {
    this.chartJSNodeCanvas = new ChartJSNodeCanvas({
      width: 800,
      height: 600,
      backgroundColour: 'white',
    });
  }

  /**
   * Generate severity distribution pie chart
   */
  async generateSeverityChart(summary: SeveritySummary): Promise<Buffer> {
    const config: ChartConfiguration = {
      type: 'doughnut',
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low', 'Info'],
        datasets: [{
          data: [
            summary.critical,
            summary.high,
            summary.medium,
            summary.low,
            summary.info,
          ],
          backgroundColor: [
            '#dc3545', // red
            '#fd7e14', // orange
            '#ffc107', // yellow
            '#17a2b8', // blue
            '#6c757d', // gray
          ],
          borderWidth: 2,
          borderColor: '#ffffff',
        }],
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: 'Security Findings by Severity',
            font: {
              size: 18,
              weight: 'bold',
            },
            padding: 20,
          },
          legend: {
            position: 'bottom',
            labels: {
              padding: 15,
              font: {
                size: 12,
              },
            },
          },
        },
      },
    };

    return this.chartJSNodeCanvas.renderToBuffer(config);
  }

  /**
   * Generate complexity bar chart (top 10 most complex files)
   */
  async generateComplexityChart(data: ComplexityData[]): Promise<Buffer> {
    const sortedData = data
      .sort((a, b) => b.complexity - a.complexity)
      .slice(0, 10);

    const config: ChartConfiguration = {
      type: 'bar',
      data: {
        labels: sortedData.map(d => d.file.split('/').pop() || d.file),
        datasets: [{
          label: 'Cyclomatic Complexity',
          data: sortedData.map(d => d.complexity),
          backgroundColor: sortedData.map(d =>
            d.complexity > 15 ? '#dc3545' :
            d.complexity > 10 ? '#ffc107' : '#28a745'
          ),
          borderWidth: 1,
          borderColor: '#333',
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: 'Top 10 Most Complex Files',
            font: {
              size: 18,
              weight: 'bold',
            },
            padding: 20,
          },
          legend: {
            display: false,
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Complexity Score',
              font: {
                size: 14,
              },
            },
            grid: {
              color: '#e0e0e0',
            },
          },
          y: {
            grid: {
              display: false,
            },
            ticks: {
              font: {
                size: 11,
              },
            },
          },
        },
      },
    };

    return this.chartJSNodeCanvas.renderToBuffer(config);
  }

  /**
   * Generate test coverage bar chart
   */
  async generateCoverageChart(coverage: CoverageData): Promise<Buffer> {
    const config: ChartConfiguration = {
      type: 'bar',
      data: {
        labels: ['Lines', 'Branches', 'Functions', 'Statements'],
        datasets: [{
          label: 'Coverage %',
          data: [
            coverage.lines,
            coverage.branches,
            coverage.functions,
            coverage.statements,
          ],
          backgroundColor: [
            coverage.lines >= 80 ? '#28a745' : coverage.lines >= 60 ? '#ffc107' : '#dc3545',
            coverage.branches >= 80 ? '#28a745' : coverage.branches >= 60 ? '#ffc107' : '#dc3545',
            coverage.functions >= 80 ? '#28a745' : coverage.functions >= 60 ? '#ffc107' : '#dc3545',
            coverage.statements >= 80 ? '#28a745' : coverage.statements >= 60 ? '#ffc107' : '#dc3545',
          ],
          borderWidth: 1,
          borderColor: '#333',
        }],
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: 'Test Coverage Metrics',
            font: {
              size: 18,
              weight: 'bold',
            },
            padding: 20,
          },
          legend: {
            display: false,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            title: {
              display: true,
              text: 'Coverage %',
              font: {
                size: 14,
              },
            },
            grid: {
              color: '#e0e0e0',
            },
          },
          x: {
            grid: {
              display: false,
            },
          },
        },
      },
    };

    return this.chartJSNodeCanvas.renderToBuffer(config);
  }

  /**
   * Generate category distribution chart
   */
  async generateCategoryChart(categories: { [key: string]: number }): Promise<Buffer> {
    const sortedCategories = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const config: ChartConfiguration = {
      type: 'bar',
      data: {
        labels: sortedCategories.map(([category]) => category),
        datasets: [{
          label: 'Findings',
          data: sortedCategories.map(([, count]) => count),
          backgroundColor: '#007bff',
          borderWidth: 1,
          borderColor: '#0056b3',
        }],
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: 'Issues by Category',
            font: {
              size: 18,
              weight: 'bold',
            },
            padding: 20,
          },
          legend: {
            display: false,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Number of Issues',
              font: {
                size: 14,
              },
            },
            grid: {
              color: '#e0e0e0',
            },
          },
          x: {
            grid: {
              display: false,
            },
            ticks: {
              maxRotation: 45,
              minRotation: 45,
              font: {
                size: 11,
              },
            },
          },
        },
      },
    };

    return this.chartJSNodeCanvas.renderToBuffer(config);
  }
}

export const chartGenerator = new ChartGenerator();

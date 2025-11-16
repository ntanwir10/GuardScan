/**
 * Python AST Parser
 *
 * Parses Python code to extract functions, classes, and other structures
 * Uses python-parser or calls Python ast module via child_process
 *
 * Phase 6: Multi-Language Support
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Python Function
 */
export interface PythonFunction {
  name: string;
  file: string;
  line: number;
  endLine: number;
  parameters: PythonParameter[];
  returnType?: string;
  body: string;
  complexity: number;
  isAsync: boolean;
  isMethod: boolean;
  decorators: string[];
  documentation?: string;
  dependencies: string[];
}

/**
 * Python Class
 */
export interface PythonClass {
  name: string;
  file: string;
  line: number;
  endLine: number;
  bases: string[];  // Parent classes
  methods: PythonFunction[];
  properties: PythonProperty[];
  decorators: string[];
  documentation?: string;
}

/**
 * Python Parameter
 */
export interface PythonParameter {
  name: string;
  type?: string;
  defaultValue?: string;
  isOptional: boolean;
}

/**
 * Python Property
 */
export interface PythonProperty {
  name: string;
  type?: string;
  value?: string;
  isClassVar: boolean;
}

/**
 * Python Import
 */
export interface PythonImport {
  module: string;
  names: string[];
  alias?: string;
  isFrom: boolean;
}

/**
 * Parsed Python File
 */
export interface ParsedPythonFile {
  file: string;
  functions: PythonFunction[];
  classes: PythonClass[];
  imports: PythonImport[];
  exports: string[];
  globalVariables: string[];
  language: 'python';
  version?: string; // Python 2 or 3
}

/**
 * Python AST Parser
 */
export class PythonParser {
  /**
   * Parse Python file
   */
  async parseFile(filePath: string): Promise<ParsedPythonFile> {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this.parseCode(content, filePath);
  }

  /**
   * Parse Python code string
   */
  async parseCode(code: string, filePath: string = 'unknown.py'): Promise<ParsedPythonFile> {
    // Try to use Python's ast module for accurate parsing
    try {
      return await this.parseWithPythonAST(code, filePath);
    } catch (error) {
      // Fallback to regex-based parsing
      console.warn('Python ast module unavailable, using fallback parser');
      return this.parseWithRegex(code, filePath);
    }
  }

  /**
   * Parse using Python's ast module (most accurate)
   */
  private async parseWithPythonAST(code: string, filePath: string): Promise<ParsedPythonFile> {
    // Write code to temp file
    const tempFile = path.join(process.cwd(), '.tmp-parse.py');
    fs.writeFileSync(tempFile, code);

    try {
      // Python script to parse AST
      const parserScript = `
import ast
import json
import sys

def parse_file(filepath):
    with open(filepath, 'r') as f:
        source = f.read()

    tree = ast.parse(source)

    functions = []
    classes = []
    imports = []
    globals = []

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
            functions.append({
                'name': node.name,
                'line': node.lineno,
                'endLine': node.end_lineno,
                'parameters': [arg.arg for arg in node.args.args],
                'isAsync': isinstance(node, ast.AsyncFunctionDef),
                'decorators': [d.id if isinstance(d, ast.Name) else str(d) for d in node.decorator_list],
                'docstring': ast.get_docstring(node)
            })

        elif isinstance(node, ast.ClassDef):
            methods = [n for n in node.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
            classes.append({
                'name': node.name,
                'line': node.lineno,
                'endLine': node.end_lineno,
                'bases': [b.id if isinstance(b, ast.Name) else str(b) for b in node.bases],
                'methods': [m.name for m in methods],
                'decorators': [d.id if isinstance(d, ast.Name) else str(d) for d in node.decorator_list],
                'docstring': ast.get_docstring(node)
            })

        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({
                    'module': alias.name,
                    'alias': alias.asname,
                    'isFrom': False
                })

        elif isinstance(node, ast.ImportFrom):
            imports.append({
                'module': node.module or '',
                'names': [alias.name for alias in node.names],
                'isFrom': True
            })

        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    globals.append(target.id)

    return {
        'functions': functions,
        'classes': classes,
        'imports': imports,
        'globals': globals
    }

try:
    result = parse_file(sys.argv[1])
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({'error': str(e)}), file=sys.stderr)
    sys.exit(1)
`;

      // Write parser script
      const scriptFile = path.join(process.cwd(), '.tmp-parser.py');
      fs.writeFileSync(scriptFile, parserScript);

      // Execute Python parser
      const { stdout } = await execAsync(`python3 ${scriptFile} ${tempFile}`);
      const result = JSON.parse(stdout);

      // Clean up temp files
      fs.unlinkSync(tempFile);
      fs.unlinkSync(scriptFile);

      return this.formatPythonASTResult(result, filePath, code);
    } catch (error) {
      // Clean up on error
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      throw error;
    }
  }

  /**
   * Format Python AST result into our structure
   */
  private formatPythonASTResult(
    result: any,
    filePath: string,
    code: string
  ): ParsedPythonFile {
    const lines = code.split('\n');

    const functions: PythonFunction[] = result.functions.map((f: any) => ({
      name: f.name,
      file: filePath,
      line: f.line,
      endLine: f.endLine || f.line,
      parameters: f.parameters.map((p: string) => ({
        name: p,
        isOptional: false
      })),
      body: this.extractBody(lines, f.line, f.endLine),
      complexity: this.calculateComplexity(this.extractBody(lines, f.line, f.endLine)),
      isAsync: f.isAsync || false,
      isMethod: false,
      decorators: f.decorators || [],
      documentation: f.docstring,
      dependencies: []
    }));

    const classes: PythonClass[] = result.classes.map((c: any) => ({
      name: c.name,
      file: filePath,
      line: c.line,
      endLine: c.endLine || c.line,
      bases: c.bases || [],
      methods: [], // Will be populated separately
      properties: [],
      decorators: c.decorators || [],
      documentation: c.docstring
    }));

    const imports: PythonImport[] = result.imports.map((i: any) => ({
      module: i.module,
      names: i.names || [i.module],
      alias: i.alias,
      isFrom: i.isFrom
    }));

    return {
      file: filePath,
      functions,
      classes,
      imports,
      exports: this.extractExports(code),
      globalVariables: result.globals || [],
      language: 'python'
    };
  }

  /**
   * Fallback regex-based parser (less accurate but doesn't require Python)
   */
  private parseWithRegex(code: string, filePath: string): ParsedPythonFile {
    const lines = code.split('\n');

    // Parse functions
    const functions = this.extractFunctions(lines, filePath);

    // Parse classes
    const classes = this.extractClasses(lines, filePath);

    // Parse imports
    const imports = this.extractImports(lines);

    // Extract exports (functions/classes defined at module level)
    const exports = [
      ...functions.filter(f => !f.isMethod).map(f => f.name),
      ...classes.map(c => c.name)
    ];

    return {
      file: filePath,
      functions,
      classes,
      imports,
      exports,
      globalVariables: this.extractGlobalVariables(lines),
      language: 'python'
    };
  }

  /**
   * Extract functions using regex
   */
  private extractFunctions(lines: string[], filePath: string): PythonFunction[] {
    const functions: PythonFunction[] = [];
    const funcRegex = /^(\s*)(async\s+)?def\s+(\w+)\s*\((.*?)\)(\s*->\s*(.+?))?:/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(funcRegex);
      if (match) {
        const indent = match[1].length;
        const isAsync = !!match[2];
        const name = match[3];
        const params = match[4];
        const returnType = match[6];

        // Find function end
        let endLine = i;
        for (let j = i + 1; j < lines.length; j++) {
          const lineIndent = lines[j].match(/^(\s*)/)?.[1].length || 0;
          if (lineIndent <= indent && lines[j].trim().length > 0) {
            endLine = j - 1;
            break;
          }
          if (j === lines.length - 1) {
            endLine = j;
          }
        }

        const body = this.extractBody(lines, i + 1, endLine + 1);

        functions.push({
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          parameters: this.parseParameters(params),
          returnType,
          body,
          complexity: this.calculateComplexity(body),
          isAsync,
          isMethod: indent > 0,
          decorators: this.extractDecorators(lines, i),
          documentation: this.extractDocstring(lines, i + 1),
          dependencies: this.extractDependencies(body)
        });
      }
    }

    return functions;
  }

  /**
   * Extract classes using regex
   */
  private extractClasses(lines: string[], filePath: string): PythonClass[] {
    const classes: PythonClass[] = [];
    const classRegex = /^(\s*)class\s+(\w+)(\((.*?)\))?:/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(classRegex);
      if (match) {
        const indent = match[1].length;
        const name = match[2];
        const bases = match[4] ? match[4].split(',').map(b => b.trim()) : [];

        // Find class end
        let endLine = i;
        for (let j = i + 1; j < lines.length; j++) {
          const lineIndent = lines[j].match(/^(\s*)/)?.[1].length || 0;
          if (lineIndent <= indent && lines[j].trim().length > 0) {
            endLine = j - 1;
            break;
          }
          if (j === lines.length - 1) {
            endLine = j;
          }
        }

        // Extract methods (functions within class)
        const classBody = lines.slice(i + 1, endLine + 1).join('\n');
        const methods = this.extractFunctions(
          lines.slice(i + 1, endLine + 1),
          filePath
        ).filter(f => f.isMethod);

        classes.push({
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          bases,
          methods,
          properties: this.extractProperties(classBody),
          decorators: this.extractDecorators(lines, i),
          documentation: this.extractDocstring(lines, i + 1)
        });
      }
    }

    return classes;
  }

  /**
   * Extract imports
   */
  private extractImports(lines: string[]): PythonImport[] {
    const imports: PythonImport[] = [];

    for (const line of lines) {
      // import x, y, z
      const importMatch = line.match(/^import\s+(.+)/);
      if (importMatch) {
        const modules = importMatch[1].split(',').map(m => m.trim());
        for (const module of modules) {
          const [name, alias] = module.split(' as ').map(s => s.trim());
          imports.push({
            module: name,
            names: [name],
            alias,
            isFrom: false
          });
        }
      }

      // from x import y, z
      const fromMatch = line.match(/^from\s+(.+?)\s+import\s+(.+)/);
      if (fromMatch) {
        const module = fromMatch[1].trim();
        const names = fromMatch[2].split(',').map(n => n.trim().split(' as ')[0]);
        imports.push({
          module,
          names,
          isFrom: true
        });
      }
    }

    return imports;
  }

  /**
   * Parse function parameters
   */
  private parseParameters(paramsStr: string): PythonParameter[] {
    if (!paramsStr.trim()) return [];

    const params = paramsStr.split(',').map(p => p.trim());
    return params.map(param => {
      const [nameType, defaultValue] = param.split('=').map(s => s.trim());
      const [name, type] = nameType.split(':').map(s => s.trim());

      return {
        name,
        type,
        defaultValue,
        isOptional: !!defaultValue
      };
    });
  }

  /**
   * Extract decorators
   */
  private extractDecorators(lines: string[], funcLine: number): string[] {
    const decorators: string[] = [];
    for (let i = funcLine - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('@')) {
        decorators.unshift(line.substring(1));
      } else if (line.length > 0) {
        break;
      }
    }
    return decorators;
  }

  /**
   * Extract docstring
   */
  private extractDocstring(lines: string[], startLine: number): string | undefined {
    const line = lines[startLine]?.trim();
    if (line?.startsWith('"""') || line?.startsWith("'''")) {
      const quote = line.startsWith('"""') ? '"""' : "'''";
      let docstring = line.substring(3);

      if (docstring.endsWith(quote)) {
        return docstring.substring(0, docstring.length - 3);
      }

      for (let i = startLine + 1; i < lines.length; i++) {
        docstring += '\n' + lines[i];
        if (lines[i].includes(quote)) {
          return docstring.substring(0, docstring.lastIndexOf(quote));
        }
      }
    }
    return undefined;
  }

  /**
   * Extract class properties
   */
  private extractProperties(classBody: string): PythonProperty[] {
    const properties: PythonProperty[] = [];
    const propRegex = /(\w+)\s*:\s*(.+?)\s*=\s*(.+)/g;

    let match;
    while ((match = propRegex.exec(classBody)) !== null) {
      properties.push({
        name: match[1],
        type: match[2],
        value: match[3],
        isClassVar: true
      });
    }

    return properties;
  }

  /**
   * Extract global variables
   */
  private extractGlobalVariables(lines: string[]): string[] {
    const variables: string[] = [];
    const varRegex = /^(\w+)\s*=\s*.+/;

    for (const line of lines) {
      const match = line.match(varRegex);
      if (match) {
        variables.push(match[1]);
      }
    }

    return variables;
  }

  /**
   * Extract exports (__all__)
   */
  private extractExports(code: string): string[] {
    const match = code.match(/__all__\s*=\s*\[(.*?)\]/s);
    if (match) {
      return match[1]
        .split(',')
        .map(s => s.trim().replace(/['"]/g, ''))
        .filter(s => s.length > 0);
    }
    return [];
  }

  /**
   * Extract dependencies from code
   */
  private extractDependencies(code: string): string[] {
    const deps = new Set<string>();
    const callRegex = /\b(\w+)\s*\(/g;

    let match;
    while ((match = callRegex.exec(code)) !== null) {
      deps.add(match[1]);
    }

    return Array.from(deps);
  }

  /**
   * Extract code body
   */
  private extractBody(lines: string[], startLine: number, endLine: number): string {
    return lines.slice(startLine - 1, endLine).join('\n');
  }

  /**
   * Calculate cyclomatic complexity
   */
  private calculateComplexity(code: string): number {
    let complexity = 1;

    // Count decision points
    const patterns = [
      /\bif\b/g,
      /\belif\b/g,
      /\bwhile\b/g,
      /\bfor\b/g,
      /\band\b/g,
      /\bor\b/g,
      /\btry\b/g,
      /\bexcept\b/g
    ];

    for (const pattern of patterns) {
      const matches = code.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  /**
   * Check if Python is available
   */
  async isPythonAvailable(): Promise<boolean> {
    try {
      await execAsync('python3 --version');
      return true;
    } catch {
      return false;
    }
  }
}

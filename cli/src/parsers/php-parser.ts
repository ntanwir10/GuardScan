/**
 * PHP AST Parser
 *
 * Parses PHP code to extract classes, functions, traits, and other structures
 * Uses regex-based parsing (can be enhanced with php-parser library)
 *
 * Phase 6: Multi-Language Support
 */

import * as fs from 'fs';

/**
 * PHP Function
 */
export interface PHPFunction {
  name: string;
  file: string;
  line: number;
  endLine: number;
  parameters: PHPParameter[];
  returnType?: string;
  body: string;
  complexity: number;
  visibility?: 'public' | 'private' | 'protected';
  isStatic: boolean;
  isFinal: boolean;
  isAbstract: boolean;
  documentation?: string;
}

/**
 * PHP Class
 */
export interface PHPClass {
  name: string;
  file: string;
  line: number;
  endLine: number;
  namespace?: string;
  extends?: string;
  implements: string[];
  uses: string[]; // Traits
  methods: PHPFunction[];
  properties: PHPProperty[];
  constants: PHPConstant[];
  visibility: 'public' | 'private' | 'protected' | 'none';
  isAbstract: boolean;
  isFinal: boolean;
  isInterface: boolean;
  isTrait: boolean;
  documentation?: string;
}

/**
 * PHP Parameter
 */
export interface PHPParameter {
  name: string;
  type?: string;
  defaultValue?: string;
  isReference: boolean;
  isVariadic: boolean;
  isNullable: boolean;
}

/**
 * PHP Property
 */
export interface PHPProperty {
  name: string;
  type?: string;
  visibility: 'public' | 'private' | 'protected';
  isStatic: boolean;
  defaultValue?: string;
  documentation?: string;
}

/**
 * PHP Constant
 */
export interface PHPConstant {
  name: string;
  value?: string;
  visibility?: 'public' | 'private' | 'protected';
}

/**
 * PHP Use Statement
 */
export interface PHPUse {
  namespace: string;
  alias?: string;
  isFunction: boolean;
  isConst: boolean;
}

/**
 * Parsed PHP File
 */
export interface ParsedPHPFile {
  file: string;
  namespace?: string;
  uses: PHPUse[];
  classes: PHPClass[];
  interfaces: PHPClass[];
  traits: PHPClass[];
  functions: PHPFunction[];
  language: 'php';
}

/**
 * PHP AST Parser
 */
export class PHPParser {
  /**
   * Parse PHP file
   */
  async parseFile(filePath: string): Promise<ParsedPHPFile> {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this.parseCode(content, filePath);
  }

  /**
   * Parse PHP code string
   */
  async parseCode(code: string, filePath: string = 'Unknown.php'): Promise<ParsedPHPFile> {
    const lines = code.split('\n');

    // Extract namespace
    const namespace = this.extractNamespace(code);

    // Extract use statements
    const uses = this.extractUses(lines);

    // Extract classes, interfaces, traits
    const classes: PHPClass[] = [];
    const interfaces: PHPClass[] = [];
    const traits: PHPClass[] = [];

    const types = this.extractTypes(lines, filePath, namespace);

    for (const type of types) {
      if (type.isInterface) {
        interfaces.push(type);
      } else if (type.isTrait) {
        traits.push(type);
      } else {
        classes.push(type);
      }
    }

    // Extract top-level functions
    const functions = this.extractTopLevelFunctions(lines, filePath);

    return {
      file: filePath,
      namespace,
      uses,
      classes,
      interfaces,
      traits,
      functions,
      language: 'php'
    };
  }

  /**
   * Extract namespace declaration
   */
  private extractNamespace(code: string): string | undefined {
    const match = code.match(/^\s*namespace\s+([\w\\]+)\s*;/m);
    return match ? match[1] : undefined;
  }

  /**
   * Extract use statements
   */
  private extractUses(lines: string[]): PHPUse[] {
    const uses: PHPUse[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // use function Name
      const funcMatch = trimmed.match(/^use\s+function\s+([\w\\]+)(?:\s+as\s+(\w+))?;/);
      if (funcMatch) {
        uses.push({
          namespace: funcMatch[1],
          alias: funcMatch[2],
          isFunction: true,
          isConst: false
        });
        continue;
      }

      // use const NAME
      const constMatch = trimmed.match(/^use\s+const\s+([\w\\]+)(?:\s+as\s+(\w+))?;/);
      if (constMatch) {
        uses.push({
          namespace: constMatch[1],
          alias: constMatch[2],
          isFunction: false,
          isConst: true
        });
        continue;
      }

      // use Namespace\Class
      const classMatch = trimmed.match(/^use\s+([\w\\]+)(?:\s+as\s+(\w+))?;/);
      if (classMatch) {
        uses.push({
          namespace: classMatch[1],
          alias: classMatch[2],
          isFunction: false,
          isConst: false
        });
      }
    }

    return uses;
  }

  /**
   * Extract classes, interfaces, traits
   */
  private extractTypes(lines: string[], filePath: string, namespace?: string): PHPClass[] {
    const types: PHPClass[] = [];
    const typeRegex = /^(abstract\s+|final\s+)?(class|interface|trait)\s+(\w+)/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(typeRegex);

      if (match) {
        const modifier = match[1] || '';
        const typeKeyword = match[2];
        const name = match[3];

        // Find type end
        const endLine = this.findBlockEnd(lines, i);

        // Extract extends/implements
        const declaration = this.getFullDeclaration(lines, i);
        const extendsMatch = declaration.match(/extends\s+([\w\\]+)/);
        const implementsMatch = declaration.match(/implements\s+([\w\\,\s]+)/);

        const type: PHPClass = {
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          namespace,
          extends: extendsMatch ? extendsMatch[1] : undefined,
          implements: implementsMatch
            ? implementsMatch[1].split(',').map(s => s.trim())
            : [],
          uses: [],
          methods: [],
          properties: [],
          constants: [],
          visibility: 'none',
          isAbstract: modifier.includes('abstract'),
          isFinal: modifier.includes('final'),
          isInterface: typeKeyword === 'interface',
          isTrait: typeKeyword === 'trait',
          documentation: this.extractDocumentation(lines, i)
        };

        // Extract class body
        const typeBody = lines.slice(i + 1, endLine);
        type.uses = this.extractTraitUses(typeBody);
        type.methods = this.extractMethods(typeBody, filePath, i + 1);
        type.properties = this.extractProperties(typeBody);
        type.constants = this.extractConstants(typeBody);

        types.push(type);
      }
    }

    return types;
  }

  /**
   * Extract trait uses within a class
   */
  private extractTraitUses(lines: string[]): string[] {
    const uses: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^use\s+([\w\\, ]+);/);

      if (match) {
        const traits = match[1].split(',').map(s => s.trim());
        uses.push(...traits);
      }
    }

    return uses;
  }

  /**
   * Extract methods
   */
  private extractMethods(lines: string[], filePath: string, startLine: number): PHPFunction[] {
    const methods: PHPFunction[] = [];
    const methodRegex = /^(public\s+|private\s+|protected\s+)?(static\s+|final\s+|abstract\s+)*function\s+(\w+)\s*\((.*?)\)(?:\s*:\s*([\w\\|?]+))?/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(methodRegex);

      if (match) {
        const visibility = this.parseVisibility(match[1]);
        const modifiers = match[2] || '';
        const name = match[3];
        const params = match[4];
        const returnType = match[5];

        // Find method end
        const methodEndLine = this.findBlockEnd(lines, i);

        const body = lines.slice(i, methodEndLine + 1).join('\n');

        methods.push({
          name,
          file: filePath,
          line: startLine + i,
          endLine: startLine + methodEndLine,
          parameters: this.parseParameters(params),
          returnType,
          body,
          complexity: this.calculateComplexity(body),
          visibility,
          isStatic: modifiers.includes('static'),
          isFinal: modifiers.includes('final'),
          isAbstract: modifiers.includes('abstract'),
          documentation: this.extractDocumentation(lines, i)
        });
      }
    }

    return methods;
  }

  /**
   * Extract top-level functions
   */
  private extractTopLevelFunctions(lines: string[], filePath: string): PHPFunction[] {
    const functions: PHPFunction[] = [];
    const funcRegex = /^function\s+(\w+)\s*\((.*?)\)(?:\s*:\s*([\w\\|?]+))?/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(funcRegex);

      if (match) {
        const name = match[1];
        const params = match[2];
        const returnType = match[3];

        // Find function end
        const funcEndLine = this.findBlockEnd(lines, i);

        const body = lines.slice(i, funcEndLine + 1).join('\n');

        functions.push({
          name,
          file: filePath,
          line: i + 1,
          endLine: funcEndLine + 1,
          parameters: this.parseParameters(params),
          returnType,
          body,
          complexity: this.calculateComplexity(body),
          isStatic: false,
          isFinal: false,
          isAbstract: false,
          documentation: this.extractDocumentation(lines, i)
        });
      }
    }

    return functions;
  }

  /**
   * Extract properties
   */
  private extractProperties(lines: string[]): PHPProperty[] {
    const properties: PHPProperty[] = [];
    const propRegex = /^(public\s+|private\s+|protected\s+)(static\s+)?([\w\\|?]+\s+)?(\$\w+)(\s*=\s*(.+?))?;/;

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(propRegex);

      if (match) {
        const visibility = this.parseVisibility(match[1]);
        const isStatic = !!match[2];
        const type = match[3]?.trim();
        const name = match[4].substring(1); // Remove $
        const defaultValue = match[6];

        properties.push({
          name,
          type,
          visibility,
          isStatic,
          defaultValue,
          documentation: undefined
        });
      }
    }

    return properties;
  }

  /**
   * Extract constants
   */
  private extractConstants(lines: string[]): PHPConstant[] {
    const constants: PHPConstant[] = [];
    const constRegex = /^(public\s+|private\s+|protected\s+)?const\s+(\w+)\s*=\s*(.+?);/;

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(constRegex);

      if (match) {
        const visibility = match[1] ? this.parseVisibility(match[1]) : undefined;
        const name = match[2];
        const value = match[3];

        constants.push({
          name,
          value,
          visibility
        });
      }
    }

    return constants;
  }

  /**
   * Parse method parameters
   */
  private parseParameters(paramsStr: string): PHPParameter[] {
    if (!paramsStr.trim()) return [];

    const params = this.splitParameters(paramsStr);
    return params.map(param => {
      const trimmed = param.trim();

      // Variadic parameter ...$args
      const isVariadic = trimmed.includes('...');

      // Reference parameter &$var
      const isReference = trimmed.includes('&');

      // Extract type, nullable, name, default
      const parts = trimmed.split(/\s+/);

      let type: string | undefined;
      let name: string;
      let defaultValue: string | undefined;
      let isNullable = false;

      // Type can be: ?int, int, ClassName, int|string
      if (parts.length > 1) {
        type = parts[0];
        if (type.startsWith('?')) {
          isNullable = true;
          type = type.substring(1);
        }
        name = parts[1];
      } else {
        name = parts[0];
      }

      // Remove &, ..., $ from name
      name = name.replace(/[&.]/g, '').replace(/^\$/, '');

      // Extract default value
      if (trimmed.includes('=')) {
        const equalIndex = trimmed.indexOf('=');
        defaultValue = trimmed.substring(equalIndex + 1).trim();
      }

      return {
        name,
        type,
        defaultValue,
        isReference,
        isVariadic,
        isNullable
      };
    });
  }

  /**
   * Split parameters correctly (handle nested arrays, etc.)
   */
  private splitParameters(params: string): string[] {
    const result: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of params) {
      if (char === '(' || char === '[') depth++;
      if (char === ')' || char === ']') depth--;

      if (char === ',' && depth === 0) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      result.push(current.trim());
    }

    return result;
  }

  /**
   * Extract documentation (PHPDoc comments)
   */
  private extractDocumentation(lines: string[], targetLine: number): string | undefined {
    let documentation = '';
    let inDocBlock = false;

    for (let i = targetLine - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();

      if (trimmed === '*/') {
        inDocBlock = true;
        continue;
      }

      if (inDocBlock) {
        if (trimmed.startsWith('/**')) {
          documentation = trimmed + '\n' + documentation;
          return documentation.trim();
        }
        documentation = trimmed + '\n' + documentation;
      } else if (trimmed.length > 0 && !trimmed.startsWith('//')) {
        break;
      }
    }

    return undefined;
  }

  /**
   * Parse visibility modifier
   */
  private parseVisibility(modifier?: string): 'public' | 'private' | 'protected' {
    if (!modifier) return 'public';
    if (modifier.includes('public')) return 'public';
    if (modifier.includes('private')) return 'private';
    if (modifier.includes('protected')) return 'protected';
    return 'public';
  }

  /**
   * Get full declaration (may span multiple lines)
   */
  private getFullDeclaration(lines: string[], startLine: number): string {
    let declaration = '';

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      declaration += ' ' + line.trim();

      if (line.includes('{')) break;
    }

    return declaration;
  }

  /**
   * Find end of block (matching braces)
   */
  private findBlockEnd(lines: string[], startLine: number): number {
    let depth = 0;
    let started = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === '{') {
          depth++;
          started = true;
        }
        if (char === '}') {
          depth--;
          if (started && depth === 0) {
            return i;
          }
        }
      }
    }

    return lines.length - 1;
  }

  /**
   * Calculate cyclomatic complexity
   */
  private calculateComplexity(code: string): number {
    let complexity = 1;

    const patterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\belseif\s*\(/g,
      /\bwhile\s*\(/g,
      /\bfor\s*\(/g,
      /\bforeach\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /\&\&/g,
      /\|\|/g,
      /\band\s+/g,
      /\bor\s+/g,
      /\?/g  // Ternary operator
    ];

    for (const pattern of patterns) {
      const matches = code.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }
}

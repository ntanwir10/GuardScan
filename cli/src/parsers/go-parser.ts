/**
 * Go AST Parser
 *
 * Parses Go code to extract functions, structs, interfaces, and other structures
 * Uses regex-based parsing
 *
 * Phase 6: Multi-Language Support
 */

import * as fs from 'fs';

/**
 * Go Function
 */
export interface GoFunction {
  name: string;
  file: string;
  line: number;
  endLine: number;
  parameters: GoParameter[];
  returnTypes: string[];
  body: string;
  complexity: number;
  isMethod: boolean;
  receiver?: GoReceiver;
  documentation?: string;
}

/**
 * Go Struct
 */
export interface GoStruct {
  name: string;
  file: string;
  line: number;
  endLine: number;
  fields: GoField[];
  methods: GoFunction[];
  documentation?: string;
}

/**
 * Go Interface
 */
export interface GoInterface {
  name: string;
  file: string;
  line: number;
  endLine: number;
  methods: GoMethodSignature[];
  embeds: string[];
  documentation?: string;
}

/**
 * Go Parameter
 */
export interface GoParameter {
  name: string;
  type: string;
  isVariadic: boolean;
}

/**
 * Go Receiver (for methods)
 */
export interface GoReceiver {
  name: string;
  type: string;
  isPointer: boolean;
}

/**
 * Go Field
 */
export interface GoField {
  name: string;
  type: string;
  tag?: string;
  isExported: boolean;
}

/**
 * Go Method Signature
 */
export interface GoMethodSignature {
  name: string;
  parameters: GoParameter[];
  returnTypes: string[];
}

/**
 * Go Import
 */
export interface GoImport {
  path: string;
  alias?: string;
}

/**
 * Parsed Go File
 */
export interface ParsedGoFile {
  file: string;
  package: string;
  imports: GoImport[];
  functions: GoFunction[];
  structs: GoStruct[];
  interfaces: GoInterface[];
  constants: GoConstant[];
  variables: GoVariable[];
  language: 'go';
}

export interface GoConstant {
  name: string;
  type?: string;
  value: string;
}

export interface GoVariable {
  name: string;
  type?: string;
  value?: string;
}

/**
 * Go AST Parser
 */
export class GoParser {
  /**
   * Parse Go file
   */
  async parseFile(filePath: string): Promise<ParsedGoFile> {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this.parseCode(content, filePath);
  }

  /**
   * Parse Go code string
   */
  async parseCode(code: string, filePath: string = 'main.go'): Promise<ParsedGoFile> {
    const lines = code.split('\n');

    return {
      file: filePath,
      package: this.extractPackage(code),
      imports: this.extractImports(lines),
      functions: this.extractFunctions(lines, filePath),
      structs: this.extractStructs(lines, filePath),
      interfaces: this.extractInterfaces(lines, filePath),
      constants: this.extractConstants(lines),
      variables: this.extractVariables(lines),
      language: 'go'
    };
  }

  /**
   * Extract package name
   */
  private extractPackage(code: string): string {
    const match = code.match(/^package\s+(\w+)/m);
    return match ? match[1] : 'main';
  }

  /**
   * Extract imports
   */
  private extractImports(lines: string[]): GoImport[] {
    const imports: GoImport[] = [];
    let inImportBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // import "path"
      const singleImport = trimmed.match(/^import\s+"(.+)"/);
      if (singleImport) {
        imports.push({ path: singleImport[1] });
        continue;
      }

      // import alias "path"
      const aliasImport = trimmed.match(/^import\s+(\w+)\s+"(.+)"/);
      if (aliasImport) {
        imports.push({
          path: aliasImport[2],
          alias: aliasImport[1]
        });
        continue;
      }

      // import (
      if (trimmed === 'import (') {
        inImportBlock = true;
        continue;
      }

      if (inImportBlock) {
        if (trimmed === ')') {
          inImportBlock = false;
          continue;
        }

        // "path"
        const blockImport = trimmed.match(/^"(.+)"/);
        if (blockImport) {
          imports.push({ path: blockImport[1] });
          continue;
        }

        // alias "path"
        const blockAliasImport = trimmed.match(/^(\w+)\s+"(.+)"/);
        if (blockAliasImport) {
          imports.push({
            path: blockAliasImport[2],
            alias: blockAliasImport[1]
          });
        }
      }
    }

    return imports;
  }

  /**
   * Extract functions and methods
   */
  private extractFunctions(lines: string[], filePath: string): GoFunction[] {
    const functions: GoFunction[] = [];

    // func (receiver) name(params) returns { ... }
    // func name(params) returns { ... }
    const funcRegex = /^func\s+(?:\((\w+)\s+(\*?)(\w+)\)\s+)?(\w+)\s*\((.*?)\)(?:\s+(.+?))?\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(funcRegex);

      if (match) {
        const receiverName = match[1];
        const isPointerReceiver = match[2] === '*';
        const receiverType = match[3];
        const name = match[4];
        const params = match[5];
        const returns = match[6];

        const endLine = this.findBlockEnd(lines, i);
        const body = lines.slice(i, endLine + 1).join('\n');

        const func: GoFunction = {
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          parameters: this.parseParameters(params),
          returnTypes: returns ? this.parseReturnTypes(returns) : [],
          body,
          complexity: this.calculateComplexity(body),
          isMethod: !!receiverName,
          receiver: receiverName
            ? {
                name: receiverName,
                type: receiverType,
                isPointer: isPointerReceiver
              }
            : undefined,
          documentation: this.extractDocumentation(lines, i)
        };

        functions.push(func);
      }
    }

    return functions;
  }

  /**
   * Extract structs
   */
  private extractStructs(lines: string[], filePath: string): GoStruct[] {
    const structs: GoStruct[] = [];
    const structRegex = /^type\s+(\w+)\s+struct\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(structRegex);

      if (match) {
        const name = match[1];
        const endLine = this.findBlockEnd(lines, i);

        const fields = this.extractStructFields(lines.slice(i + 1, endLine));

        structs.push({
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          fields,
          methods: [],  // Will be populated by matching receivers
          documentation: this.extractDocumentation(lines, i)
        });
      }
    }

    // Match methods to structs
    const functions = this.extractFunctions(lines, filePath);
    for (const func of functions) {
      if (func.receiver) {
        const struct = structs.find(s => s.name === func.receiver!.type);
        if (struct) {
          struct.methods.push(func);
        }
      }
    }

    return structs;
  }

  /**
   * Extract struct fields
   */
  private extractStructFields(lines: string[]): GoField[] {
    const fields: GoField[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '}') continue;

      // name type `tag`
      const fieldMatch = trimmed.match(/^(\w+)\s+([\w\[\].*]+)(?:\s+`(.+?)`)?/);
      if (fieldMatch) {
        fields.push({
          name: fieldMatch[1],
          type: fieldMatch[2],
          tag: fieldMatch[3],
          isExported: this.isExported(fieldMatch[1])
        });
      }
    }

    return fields;
  }

  /**
   * Extract interfaces
   */
  private extractInterfaces(lines: string[], filePath: string): GoInterface[] {
    const interfaces: GoInterface[] = [];
    const interfaceRegex = /^type\s+(\w+)\s+interface\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(interfaceRegex);

      if (match) {
        const name = match[1];
        const endLine = this.findBlockEnd(lines, i);

        const { methods, embeds } = this.extractInterfaceMethods(
          lines.slice(i + 1, endLine)
        );

        interfaces.push({
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          methods,
          embeds,
          documentation: this.extractDocumentation(lines, i)
        });
      }
    }

    return interfaces;
  }

  /**
   * Extract interface methods
   */
  private extractInterfaceMethods(lines: string[]): {
    methods: GoMethodSignature[];
    embeds: string[];
  } {
    const methods: GoMethodSignature[] = [];
    const embeds: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '}') continue;

      // Embedded interface
      if (/^[A-Z]\w+$/.test(trimmed)) {
        embeds.push(trimmed);
        continue;
      }

      // Method signature: Name(params) returns
      const methodMatch = trimmed.match(/^(\w+)\s*\((.*?)\)(?:\s+(.+?))?$/);
      if (methodMatch) {
        methods.push({
          name: methodMatch[1],
          parameters: this.parseParameters(methodMatch[2]),
          returnTypes: methodMatch[3] ? this.parseReturnTypes(methodMatch[3]) : []
        });
      }
    }

    return { methods, embeds };
  }

  /**
   * Extract constants
   */
  private extractConstants(lines: string[]): GoConstant[] {
    const constants: GoConstant[] = [];
    const constRegex = /^const\s+(\w+)(?:\s+([\w\[\]]+))?\s*=\s*(.+)/;

    for (const line of lines) {
      const match = line.trim().match(constRegex);
      if (match) {
        constants.push({
          name: match[1],
          type: match[2],
          value: match[3]
        });
      }
    }

    return constants;
  }

  /**
   * Extract variables
   */
  private extractVariables(lines: string[]): GoVariable[] {
    const variables: GoVariable[] = [];
    const varRegex = /^var\s+(\w+)(?:\s+([\w\[\]]+))?(?:\s*=\s*(.+))?/;

    for (const line of lines) {
      const match = line.trim().match(varRegex);
      if (match) {
        variables.push({
          name: match[1],
          type: match[2],
          value: match[3]
        });
      }
    }

    return variables;
  }

  /**
   * Parse function parameters
   */
  private parseParameters(params: string): GoParameter[] {
    if (!params.trim()) return [];

    const result: GoParameter[] = [];
    const parts = params.split(',').map(p => p.trim());

    for (const part of parts) {
      // Handle variadic parameters: args ...string
      const variadicMatch = part.match(/(\w+)\s+\.\.\.(\w+)/);
      if (variadicMatch) {
        result.push({
          name: variadicMatch[1],
          type: variadicMatch[2],
          isVariadic: true
        });
        continue;
      }

      // Regular parameter: name type
      const match = part.match(/(\w+)\s+([\w\[\].*]+)/);
      if (match) {
        result.push({
          name: match[1],
          type: match[2],
          isVariadic: false
        });
      }
    }

    return result;
  }

  /**
   * Parse return types
   */
  private parseReturnTypes(returns: string): string[] {
    const trimmed = returns.trim();

    // Multiple returns: (Type1, Type2)
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map(t => t.trim());
    }

    // Single return: Type
    return [trimmed];
  }

  /**
   * Extract documentation comments
   */
  private extractDocumentation(lines: string[], lineIndex: number): string | undefined {
    const docs: string[] = [];

    for (let i = lineIndex - 1; i >= 0; i--) {
      const line = lines[i].trim();

      if (line.startsWith('//')) {
        docs.unshift(line.substring(2).trim());
      } else if (line.length === 0) {
        continue;
      } else {
        break;
      }
    }

    return docs.length > 0 ? docs.join('\n') : undefined;
  }

  /**
   * Check if identifier is exported (starts with capital letter)
   */
  private isExported(name: string): boolean {
    return /^[A-Z]/.test(name);
  }

  /**
   * Find end of block (matching braces)
   */
  private findBlockEnd(lines: string[], startLine: number): number {
    let depth = 0;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === '{') depth++;
        if (char === '}') {
          depth--;
          if (depth === 0) return i;
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
      /\bif\s+/g,
      /\belse\s+if\s+/g,
      /\bfor\s+/g,
      /\bcase\s+/g,
      /\b&&\b/g,
      /\b\|\|\b/g
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

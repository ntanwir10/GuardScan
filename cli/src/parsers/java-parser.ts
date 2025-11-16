/**
 * Java AST Parser
 *
 * Parses Java code to extract classes, methods, and other structures
 * Uses regex-based parsing (can be enhanced with java-parser library)
 *
 * Phase 6: Multi-Language Support
 */

import * as fs from 'fs';

/**
 * Java Method
 */
export interface JavaMethod {
  name: string;
  file: string;
  line: number;
  endLine: number;
  parameters: JavaParameter[];
  returnType: string;
  body: string;
  complexity: number;
  visibility: 'public' | 'private' | 'protected' | 'package';
  isStatic: boolean;
  isFinal: boolean;
  isAbstract: boolean;
  isSynchronized: boolean;
  annotations: string[];
  documentation?: string;
  exceptions: string[];
}

/**
 * Java Class
 */
export interface JavaClass {
  name: string;
  file: string;
  line: number;
  endLine: number;
  package?: string;
  extends?: string;
  implements: string[];
  methods: JavaMethod[];
  fields: JavaField[];
  innerClasses: JavaClass[];
  visibility: 'public' | 'private' | 'protected' | 'package';
  isAbstract: boolean;
  isFinal: boolean;
  isStatic: boolean;
  isInterface: boolean;
  isEnum: boolean;
  annotations: string[];
  documentation?: string;
}

/**
 * Java Parameter
 */
export interface JavaParameter {
  name: string;
  type: string;
  annotations: string[];
  isFinal: boolean;
  isVarArgs: boolean;
}

/**
 * Java Field
 */
export interface JavaField {
  name: string;
  type: string;
  visibility: 'public' | 'private' | 'protected' | 'package';
  isStatic: boolean;
  isFinal: boolean;
  isVolatile: boolean;
  isTransient: boolean;
  value?: string;
  annotations: string[];
}

/**
 * Java Import
 */
export interface JavaImport {
  package: string;
  className?: string;
  isStatic: boolean;
  isWildcard: boolean;
}

/**
 * Parsed Java File
 */
export interface ParsedJavaFile {
  file: string;
  package?: string;
  imports: JavaImport[];
  classes: JavaClass[];
  interfaces: JavaClass[];
  enums: JavaClass[];
  language: 'java';
  javaVersion?: string;
}

/**
 * Java AST Parser
 */
export class JavaParser {
  /**
   * Parse Java file
   */
  async parseFile(filePath: string): Promise<ParsedJavaFile> {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this.parseCode(content, filePath);
  }

  /**
   * Parse Java code string
   */
  async parseCode(code: string, filePath: string = 'Unknown.java'): Promise<ParsedJavaFile> {
    const lines = code.split('\n');

    // Extract package
    const packageName = this.extractPackage(code);

    // Extract imports
    const imports = this.extractImports(lines);

    // Extract classes, interfaces, enums
    const classes: JavaClass[] = [];
    const interfaces: JavaClass[] = [];
    const enums: JavaClass[] = [];

    const topLevelTypes = this.extractTopLevelTypes(lines, filePath);

    for (const type of topLevelTypes) {
      if (type.isInterface) {
        interfaces.push(type);
      } else if (type.isEnum) {
        enums.push(type);
      } else {
        classes.push(type);
      }
    }

    return {
      file: filePath,
      package: packageName,
      imports,
      classes,
      interfaces,
      enums,
      language: 'java'
    };
  }

  /**
   * Extract package declaration
   */
  private extractPackage(code: string): string | undefined {
    const match = code.match(/^package\s+([\w.]+)\s*;/m);
    return match ? match[1] : undefined;
  }

  /**
   * Extract imports
   */
  private extractImports(lines: string[]): JavaImport[] {
    const imports: JavaImport[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // static import
      const staticMatch = trimmed.match(/^import\s+static\s+([\w.]+)(\.\*)?;/);
      if (staticMatch) {
        imports.push({
          package: staticMatch[1],
          isStatic: true,
          isWildcard: !!staticMatch[2]
        });
        continue;
      }

      // regular import
      const importMatch = trimmed.match(/^import\s+([\w.]+)(\.\*)?;/);
      if (importMatch) {
        const fullPath = importMatch[1];
        const isWildcard = !!importMatch[2];

        const lastDot = fullPath.lastIndexOf('.');
        const packageName = lastDot > 0 ? fullPath.substring(0, lastDot) : fullPath;
        const className = lastDot > 0 && !isWildcard ? fullPath.substring(lastDot + 1) : undefined;

        imports.push({
          package: packageName,
          className,
          isStatic: false,
          isWildcard
        });
      }
    }

    return imports;
  }

  /**
   * Extract top-level types (classes, interfaces, enums)
   */
  private extractTopLevelTypes(lines: string[], filePath: string): JavaClass[] {
    const types: JavaClass[] = [];
    const typeRegex = /^(public\s+|private\s+|protected\s+)?(abstract\s+|final\s+|static\s+)*(class|interface|enum)\s+(\w+)/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(typeRegex);

      if (match) {
        const visibility = this.parseVisibility(match[1]);
        const modifiers = match[2] || '';
        const typeKeyword = match[3];
        const name = match[4];

        // Find type end (matching braces)
        const endLine = this.findBlockEnd(lines, i);

        // Extract extends/implements
        const declaration = this.getFullDeclaration(lines, i);
        const extendsMatch = declaration.match(/extends\s+([\w.]+)/);
        const implementsMatch = declaration.match(/implements\s+([\w.,\s]+)/);

        const type: JavaClass = {
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          extends: extendsMatch ? extendsMatch[1] : undefined,
          implements: implementsMatch
            ? implementsMatch[1].split(',').map(s => s.trim())
            : [],
          methods: [],
          fields: [],
          innerClasses: [],
          visibility,
          isAbstract: modifiers.includes('abstract'),
          isFinal: modifiers.includes('final'),
          isStatic: modifiers.includes('static'),
          isInterface: typeKeyword === 'interface',
          isEnum: typeKeyword === 'enum',
          annotations: this.extractAnnotations(lines, i),
          documentation: this.extractJavadoc(lines, i)
        };

        // Extract methods, fields, and inner classes
        const typeBody = lines.slice(i + 1, endLine);
        type.methods = this.extractMethods(typeBody, filePath, i + 1);
        type.fields = this.extractFields(typeBody);
        type.innerClasses = this.extractInnerClasses(typeBody, filePath, i + 1);

        types.push(type);
      }
    }

    return types;
  }

  /**
   * Extract methods
   */
  private extractMethods(lines: string[], filePath: string, startLine: number): JavaMethod[] {
    const methods: JavaMethod[] = [];
    const methodRegex = /^(public\s+|private\s+|protected\s+)?(static\s+|final\s+|abstract\s+|synchronized\s+)*([\w<>[\]]+)\s+(\w+)\s*\((.*?)\)(\s+throws\s+([\w,\s]+))?/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(methodRegex);

      if (match && !trimmed.startsWith('//') && !trimmed.includes('=')) {
        const visibility = this.parseVisibility(match[1]);
        const modifiers = match[2] || '';
        const returnType = match[3];
        const name = match[4];
        const params = match[5];
        const exceptions = match[7] ? match[7].split(',').map(e => e.trim()) : [];

        // Skip constructors (same name as class) for now
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
          isSynchronized: modifiers.includes('synchronized'),
          annotations: this.extractAnnotations(lines, i),
          documentation: this.extractJavadoc(lines, i),
          exceptions
        });
      }
    }

    return methods;
  }

  /**
   * Extract fields
   */
  private extractFields(lines: string[]): JavaField[] {
    const fields: JavaField[] = [];
    const fieldRegex = /^(public\s+|private\s+|protected\s+)?(static\s+|final\s+|volatile\s+|transient\s+)*([\w<>[\]]+)\s+(\w+)(\s*=\s*(.+?))?;/;

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(fieldRegex);

      if (match) {
        const visibility = this.parseVisibility(match[1]);
        const modifiers = match[2] || '';
        const type = match[3];
        const name = match[4];
        const value = match[6];

        fields.push({
          name,
          type,
          visibility,
          isStatic: modifiers.includes('static'),
          isFinal: modifiers.includes('final'),
          isVolatile: modifiers.includes('volatile'),
          isTransient: modifiers.includes('transient'),
          value,
          annotations: []
        });
      }
    }

    return fields;
  }

  /**
   * Extract inner classes
   */
  private extractInnerClasses(lines: string[], filePath: string, startLine: number): JavaClass[] {
    // Similar to extractTopLevelTypes but within a class body
    return this.extractTopLevelTypes(lines, filePath);
  }

  /**
   * Parse method parameters
   */
  private parseParameters(paramsStr: string): JavaParameter[] {
    if (!paramsStr.trim()) return [];

    const params = this.splitParameters(paramsStr);
    return params.map(param => {
      const trimmed = param.trim();
      const parts = trimmed.split(/\s+/);

      // Handle annotations like @NotNull
      const annotations: string[] = [];
      let typeStart = 0;

      for (let i = 0; i < parts.length; i++) {
        if (parts[i].startsWith('@')) {
          annotations.push(parts[i]);
          typeStart = i + 1;
        } else {
          break;
        }
      }

      const isFinal = parts[typeStart] === 'final';
      if (isFinal) typeStart++;

      const type = parts[typeStart];
      const name = parts[typeStart + 1] || '';
      const isVarArgs = type?.endsWith('...');

      return {
        name: name.replace(/\.\.\.$/, ''),
        type: isVarArgs ? type.replace(/\.\.\.$/, '[]') : type,
        annotations,
        isFinal,
        isVarArgs
      };
    });
  }

  /**
   * Split parameters correctly (handle generics)
   */
  private splitParameters(params: string): string[] {
    const result: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of params) {
      if (char === '<') depth++;
      if (char === '>') depth--;

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
   * Extract annotations
   */
  private extractAnnotations(lines: string[], methodLine: number): string[] {
    const annotations: string[] = [];

    for (let i = methodLine - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('@')) {
        annotations.unshift(trimmed);
      } else if (trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
        break;
      }
    }

    return annotations;
  }

  /**
   * Extract Javadoc
   */
  private extractJavadoc(lines: string[], methodLine: number): string | undefined {
    let javadoc = '';
    let inJavadoc = false;

    for (let i = methodLine - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();

      if (trimmed.endsWith('*/')) {
        inJavadoc = true;
        javadoc = trimmed + '\n' + javadoc;
      } else if (inJavadoc) {
        javadoc = trimmed + '\n' + javadoc;
        if (trimmed.startsWith('/**')) {
          return javadoc.trim();
        }
      } else if (trimmed.length > 0) {
        break;
      }
    }

    return undefined;
  }

  /**
   * Parse visibility modifier
   */
  private parseVisibility(modifier?: string): 'public' | 'private' | 'protected' | 'package' {
    if (!modifier) return 'package';
    if (modifier.includes('public')) return 'public';
    if (modifier.includes('private')) return 'private';
    if (modifier.includes('protected')) return 'protected';
    return 'package';
  }

  /**
   * Get full class/method declaration (may span multiple lines)
   */
  private getFullDeclaration(lines: string[], startLine: number): string {
    let declaration = '';
    let depth = 0;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      declaration += ' ' + line.trim();

      for (const char of line) {
        if (char === '{') depth++;
        if (char === '}') depth--;
      }

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
      /\bwhile\s*\(/g,
      /\bfor\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /\&\&/g,
      /\|\|/g,
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

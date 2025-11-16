/**
 * Ruby AST Parser
 *
 * Parses Ruby code to extract classes, methods, modules, and other structures
 * Uses regex-based parsing (can be enhanced with ripper or parser gem)
 *
 * Phase 6: Multi-Language Support
 */

import * as fs from 'fs';

/**
 * Ruby Method
 */
export interface RubyMethod {
  name: string;
  file: string;
  line: number;
  endLine: number;
  parameters: RubyParameter[];
  body: string;
  complexity: number;
  visibility: 'public' | 'private' | 'protected';
  isClassMethod: boolean;
  isAlias: boolean;
  documentation?: string;
  yieldsCalled: boolean;
}

/**
 * Ruby Class
 */
export interface RubyClass {
  name: string;
  file: string;
  line: number;
  endLine: number;
  superclass?: string;
  includes: string[];
  extends: string[];
  methods: RubyMethod[];
  attributes: RubyAttribute[];
  constants: RubyConstant[];
  nestedClasses: RubyClass[];
  documentation?: string;
}

/**
 * Ruby Module
 */
export interface RubyModule {
  name: string;
  file: string;
  line: number;
  endLine: number;
  includes: string[];
  extends: string[];
  methods: RubyMethod[];
  constants: RubyConstant[];
  documentation?: string;
}

/**
 * Ruby Parameter
 */
export interface RubyParameter {
  name: string;
  defaultValue?: string;
  isKeyword: boolean;
  isSplat: boolean;
  isDoubleSplat: boolean;
  isBlock: boolean;
}

/**
 * Ruby Attribute
 */
export interface RubyAttribute {
  name: string;
  type: 'reader' | 'writer' | 'accessor';
  visibility: 'public' | 'private' | 'protected';
}

/**
 * Ruby Constant
 */
export interface RubyConstant {
  name: string;
  value?: string;
  line: number;
}

/**
 * Ruby Require
 */
export interface RubyRequire {
  path: string;
  isRelative: boolean;
  isRequireRelative: boolean;
}

/**
 * Parsed Ruby File
 */
export interface ParsedRubyFile {
  file: string;
  requires: RubyRequire[];
  classes: RubyClass[];
  modules: RubyModule[];
  methods: RubyMethod[]; // Top-level methods
  constants: RubyConstant[];
  language: 'ruby';
}

/**
 * Ruby AST Parser
 */
export class RubyParser {
  /**
   * Parse Ruby file
   */
  async parseFile(filePath: string): Promise<ParsedRubyFile> {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this.parseCode(content, filePath);
  }

  /**
   * Parse Ruby code string
   */
  async parseCode(code: string, filePath: string = 'Unknown.rb'): Promise<ParsedRubyFile> {
    const lines = code.split('\n');

    return {
      file: filePath,
      requires: this.extractRequires(lines),
      classes: this.extractClasses(lines, filePath),
      modules: this.extractModules(lines, filePath),
      methods: this.extractTopLevelMethods(lines, filePath),
      constants: this.extractTopLevelConstants(lines),
      language: 'ruby'
    };
  }

  /**
   * Extract require statements
   */
  private extractRequires(lines: string[]): RubyRequire[] {
    const requires: RubyRequire[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // require 'path'
      const requireMatch = trimmed.match(/^require\s+['"](.+?)['"]/);
      if (requireMatch) {
        requires.push({
          path: requireMatch[1],
          isRelative: requireMatch[1].startsWith('.'),
          isRequireRelative: false
        });
        continue;
      }

      // require_relative 'path'
      const requireRelativeMatch = trimmed.match(/^require_relative\s+['"](.+?)['"]/);
      if (requireRelativeMatch) {
        requires.push({
          path: requireRelativeMatch[1],
          isRelative: true,
          isRequireRelative: true
        });
      }
    }

    return requires;
  }

  /**
   * Extract classes
   */
  private extractClasses(lines: string[], filePath: string): RubyClass[] {
    const classes: RubyClass[] = [];
    const classRegex = /^class\s+(\w+)(?:\s+<\s+(\S+))?/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(classRegex);

      if (match) {
        const name = match[1];
        const superclass = match[2];

        // Find class end
        const endLine = this.findBlockEnd(lines, i, 'class', 'end');

        const classBody = lines.slice(i + 1, endLine);

        const rubyClass: RubyClass = {
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          superclass,
          includes: this.extractIncludes(classBody),
          extends: this.extractExtends(classBody),
          methods: this.extractMethods(classBody, filePath, i + 1),
          attributes: this.extractAttributes(classBody),
          constants: this.extractConstants(classBody),
          nestedClasses: this.extractClasses(classBody, filePath),
          documentation: this.extractDocumentation(lines, i)
        };

        classes.push(rubyClass);
      }
    }

    return classes;
  }

  /**
   * Extract modules
   */
  private extractModules(lines: string[], filePath: string): RubyModule[] {
    const modules: RubyModule[] = [];
    const moduleRegex = /^module\s+(\w+)/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(moduleRegex);

      if (match) {
        const name = match[1];

        // Find module end
        const endLine = this.findBlockEnd(lines, i, 'module', 'end');

        const moduleBody = lines.slice(i + 1, endLine);

        const rubyModule: RubyModule = {
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          includes: this.extractIncludes(moduleBody),
          extends: this.extractExtends(moduleBody),
          methods: this.extractMethods(moduleBody, filePath, i + 1),
          constants: this.extractConstants(moduleBody),
          documentation: this.extractDocumentation(lines, i)
        };

        modules.push(rubyModule);
      }
    }

    return modules;
  }

  /**
   * Extract methods
   */
  private extractMethods(lines: string[], filePath: string, startLine: number): RubyMethod[] {
    const methods: RubyMethod[] = [];
    const methodRegex = /^def\s+(self\.)?(\w+[?!]?)(?:\((.*?)\))?/;
    let currentVisibility: 'public' | 'private' | 'protected' = 'public';

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // Check visibility modifiers
      if (trimmed === 'private') {
        currentVisibility = 'private';
        continue;
      }
      if (trimmed === 'protected') {
        currentVisibility = 'protected';
        continue;
      }
      if (trimmed === 'public') {
        currentVisibility = 'public';
        continue;
      }

      const match = trimmed.match(methodRegex);

      if (match && !trimmed.startsWith('#')) {
        const isClassMethod = !!match[1];
        const name = match[2];
        const params = match[3] || '';

        // Find method end
        const methodEndLine = this.findBlockEnd(lines, i, 'def', 'end');

        const body = lines.slice(i, methodEndLine + 1).join('\n');

        methods.push({
          name,
          file: filePath,
          line: startLine + i,
          endLine: startLine + methodEndLine,
          parameters: this.parseParameters(params),
          body,
          complexity: this.calculateComplexity(body),
          visibility: currentVisibility,
          isClassMethod,
          isAlias: false,
          documentation: this.extractDocumentation(lines, i),
          yieldsCalled: body.includes('yield')
        });
      }
    }

    return methods;
  }

  /**
   * Extract top-level methods
   */
  private extractTopLevelMethods(lines: string[], filePath: string): RubyMethod[] {
    return this.extractMethods(lines, filePath, 0);
  }

  /**
   * Extract includes (modules)
   */
  private extractIncludes(lines: string[]): string[] {
    const includes: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^include\s+(\w+)/);
      if (match) {
        includes.push(match[1]);
      }
    }

    return includes;
  }

  /**
   * Extract extends
   */
  private extractExtends(lines: string[]): string[] {
    const extends_: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^extend\s+(\w+)/);
      if (match) {
        extends_.push(match[1]);
      }
    }

    return extends_;
  }

  /**
   * Extract attributes (attr_reader, attr_writer, attr_accessor)
   */
  private extractAttributes(lines: string[]): RubyAttribute[] {
    const attributes: RubyAttribute[] = [];
    let currentVisibility: 'public' | 'private' | 'protected' = 'public';

    for (const line of lines) {
      const trimmed = line.trim();

      // Check visibility
      if (trimmed === 'private') currentVisibility = 'private';
      if (trimmed === 'protected') currentVisibility = 'protected';
      if (trimmed === 'public') currentVisibility = 'public';

      // attr_reader :name, :age
      const readerMatch = trimmed.match(/^attr_reader\s+(.+)/);
      if (readerMatch) {
        const attrs = this.parseAttributeList(readerMatch[1]);
        attrs.forEach(name => {
          attributes.push({ name, type: 'reader', visibility: currentVisibility });
        });
      }

      // attr_writer :name, :age
      const writerMatch = trimmed.match(/^attr_writer\s+(.+)/);
      if (writerMatch) {
        const attrs = this.parseAttributeList(writerMatch[1]);
        attrs.forEach(name => {
          attributes.push({ name, type: 'writer', visibility: currentVisibility });
        });
      }

      // attr_accessor :name, :age
      const accessorMatch = trimmed.match(/^attr_accessor\s+(.+)/);
      if (accessorMatch) {
        const attrs = this.parseAttributeList(accessorMatch[1]);
        attrs.forEach(name => {
          attributes.push({ name, type: 'accessor', visibility: currentVisibility });
        });
      }
    }

    return attributes;
  }

  /**
   * Parse attribute list (:name, :age, :email)
   */
  private parseAttributeList(attrString: string): string[] {
    return attrString
      .split(',')
      .map(s => s.trim())
      .map(s => s.replace(/^:/, ''))
      .filter(s => s.length > 0);
  }

  /**
   * Extract constants
   */
  private extractConstants(lines: string[]): RubyConstant[] {
    const constants: RubyConstant[] = [];
    const constantRegex = /^([A-Z][A-Z0-9_]*)\s*=\s*(.+)/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(constantRegex);

      if (match) {
        constants.push({
          name: match[1],
          value: match[2],
          line: i + 1
        });
      }
    }

    return constants;
  }

  /**
   * Extract top-level constants
   */
  private extractTopLevelConstants(lines: string[]): RubyConstant[] {
    return this.extractConstants(lines);
  }

  /**
   * Parse method parameters
   */
  private parseParameters(paramsStr: string): RubyParameter[] {
    if (!paramsStr.trim()) return [];

    const params = paramsStr.split(',').map(p => p.trim());
    return params.map(param => {
      // Block parameter &block
      if (param.startsWith('&')) {
        return {
          name: param.substring(1),
          isKeyword: false,
          isSplat: false,
          isDoubleSplat: false,
          isBlock: true
        };
      }

      // Double splat **kwargs
      if (param.startsWith('**')) {
        return {
          name: param.substring(2).split('=')[0].trim(),
          isKeyword: false,
          isSplat: false,
          isDoubleSplat: true,
          isBlock: false
        };
      }

      // Splat parameter *args
      if (param.startsWith('*')) {
        return {
          name: param.substring(1),
          isKeyword: false,
          isSplat: true,
          isDoubleSplat: false,
          isBlock: false
        };
      }

      // Keyword parameter (name: default) or (name:)
      if (param.includes(':')) {
        const [name, defaultValue] = param.split(':').map(s => s.trim());
        return {
          name,
          defaultValue: defaultValue || undefined,
          isKeyword: true,
          isSplat: false,
          isDoubleSplat: false,
          isBlock: false
        };
      }

      // Regular parameter with default (name = value)
      if (param.includes('=')) {
        const [name, defaultValue] = param.split('=').map(s => s.trim());
        return {
          name,
          defaultValue,
          isKeyword: false,
          isSplat: false,
          isDoubleSplat: false,
          isBlock: false
        };
      }

      // Regular parameter
      return {
        name: param,
        isKeyword: false,
        isSplat: false,
        isDoubleSplat: false,
        isBlock: false
      };
    });
  }

  /**
   * Extract documentation (comments before method/class)
   */
  private extractDocumentation(lines: string[], targetLine: number): string | undefined {
    let documentation = '';

    for (let i = targetLine - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith('#')) {
        documentation = trimmed.substring(1).trim() + '\n' + documentation;
      } else if (trimmed.length > 0) {
        break;
      }
    }

    return documentation.trim() || undefined;
  }

  /**
   * Find end of block (matching keyword and end)
   */
  private findBlockEnd(
    lines: string[],
    startLine: number,
    startKeyword: string,
    endKeyword: string
  ): number {
    let depth = 1;
    const blockStarters = ['class', 'module', 'def', 'if', 'unless', 'while', 'until', 'for', 'begin', 'case', 'do'];

    for (let i = startLine + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // Check for block starters
      for (const starter of blockStarters) {
        if (trimmed.startsWith(starter + ' ') || trimmed === starter) {
          depth++;
          break;
        }
      }

      // Check for block enders
      if (trimmed === endKeyword || trimmed.startsWith(endKeyword + ' ')) {
        depth--;
        if (depth === 0) {
          return i;
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
      /\bunless\s+/g,
      /\belsif\s+/g,
      /\bwhile\s+/g,
      /\buntil\s+/g,
      /\bfor\s+/g,
      /\bwhen\s+/g,
      /\brescue\s+/g,
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

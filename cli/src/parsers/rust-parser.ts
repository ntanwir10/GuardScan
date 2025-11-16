/**
 * Rust AST Parser
 *
 * Parses Rust code to extract functions, structs, traits, and other structures
 * Uses regex-based parsing
 *
 * Phase 6: Multi-Language Support
 */

import * as fs from 'fs';

/**
 * Rust Function
 */
export interface RustFunction {
  name: string;
  file: string;
  line: number;
  endLine: number;
  parameters: RustParameter[];
  returnType?: string;
  body: string;
  complexity: number;
  visibility: 'public' | 'private' | 'pub(crate)' | 'pub(super)';
  isAsync: boolean;
  isConst: boolean;
  isUnsafe: boolean;
  generics: string[];
  attributes: string[];
  documentation?: string;
}

/**
 * Rust Struct
 */
export interface RustStruct {
  name: string;
  file: string;
  line: number;
  endLine: number;
  fields: RustField[];
  methods: RustFunction[];
  visibility: 'public' | 'private';
  generics: string[];
  attributes: string[];
  documentation?: string;
  isUnit: boolean;
  isTuple: boolean;
}

/**
 * Rust Enum
 */
export interface RustEnum {
  name: string;
  file: string;
  line: number;
  endLine: number;
  variants: RustEnumVariant[];
  visibility: 'public' | 'private';
  generics: string[];
  attributes: string[];
  documentation?: string;
}

/**
 * Rust Trait
 */
export interface RustTrait {
  name: string;
  file: string;
  line: number;
  endLine: number;
  methods: RustMethodSignature[];
  visibility: 'public' | 'private';
  generics: string[];
  documentation?: string;
}

/**
 * Rust Parameter
 */
export interface RustParameter {
  name: string;
  type: string;
  isMutable: boolean;
  isReference: boolean;
}

/**
 * Rust Field
 */
export interface RustField {
  name: string;
  type: string;
  visibility: 'public' | 'private';
}

/**
 * Rust Enum Variant
 */
export interface RustEnumVariant {
  name: string;
  fields?: RustField[];
  discriminant?: string;
}

/**
 * Rust Method Signature
 */
export interface RustMethodSignature {
  name: string;
  parameters: RustParameter[];
  returnType?: string;
}

/**
 * Rust Use Statement
 */
export interface RustUse {
  path: string;
  items?: string[];
  alias?: string;
}

/**
 * Parsed Rust File
 */
export interface ParsedRustFile {
  file: string;
  module?: string;
  uses: RustUse[];
  functions: RustFunction[];
  structs: RustStruct[];
  enums: RustEnum[];
  traits: RustTrait[];
  impls: RustImpl[];
  constants: RustConstant[];
  language: 'rust';
}

export interface RustImpl {
  type: string;
  trait?: string;
  methods: RustFunction[];
}

export interface RustConstant {
  name: string;
  type: string;
  value: string;
  visibility: 'public' | 'private';
}

/**
 * Rust AST Parser
 */
export class RustParser {
  /**
   * Parse Rust file
   */
  async parseFile(filePath: string): Promise<ParsedRustFile> {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this.parseCode(content, filePath);
  }

  /**
   * Parse Rust code string
   */
  async parseCode(code: string, filePath: string = 'main.rs'): Promise<ParsedRustFile> {
    const lines = code.split('\n');

    return {
      file: filePath,
      module: this.extractModule(code),
      uses: this.extractUses(lines),
      functions: this.extractFunctions(lines, filePath),
      structs: this.extractStructs(lines, filePath),
      enums: this.extractEnums(lines, filePath),
      traits: this.extractTraits(lines, filePath),
      impls: this.extractImpls(lines, filePath),
      constants: this.extractConstants(lines),
      language: 'rust'
    };
  }

  /**
   * Extract module name
   */
  private extractModule(code: string): string | undefined {
    const match = code.match(/^mod\s+(\w+)\s*;/m);
    return match ? match[1] : undefined;
  }

  /**
   * Extract use statements
   */
  private extractUses(lines: string[]): RustUse[] {
    const uses: RustUse[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // use path;
      const simpleUse = trimmed.match(/^use\s+([\w:]+)\s*;/);
      if (simpleUse) {
        uses.push({ path: simpleUse[1] });
        continue;
      }

      // use path as alias;
      const aliasUse = trimmed.match(/^use\s+([\w:]+)\s+as\s+(\w+)\s*;/);
      if (aliasUse) {
        uses.push({
          path: aliasUse[1],
          alias: aliasUse[2]
        });
        continue;
      }

      // use path::{item1, item2};
      const multiUse = trimmed.match(/^use\s+([\w:]+)::\{(.+?)\}\s*;/);
      if (multiUse) {
        const items = multiUse[2].split(',').map(i => i.trim());
        uses.push({
          path: multiUse[1],
          items
        });
      }
    }

    return uses;
  }

  /**
   * Extract functions
   */
  private extractFunctions(lines: string[], filePath: string): RustFunction[] {
    const functions: RustFunction[] = [];

    // pub/pub(crate)/pub(super) async/const/unsafe fn name<T>(params) -> return { ... }
    const funcRegex = /^(pub(?:\([^)]+\))?\s+)?(async\s+|const\s+|unsafe\s+)*fn\s+(\w+)(?:<(.+?)>)?\s*\((.*?)\)(?:\s*->\s*(.+?))?\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(funcRegex);

      if (match) {
        const visibility = this.parseVisibility(match[1]);
        const modifiers = match[2] || '';
        const name = match[3];
        const generics = match[4] ? match[4].split(',').map(g => g.trim()) : [];
        const params = match[5];
        const returnType = match[6];

        const endLine = this.findBlockEnd(lines, i);
        const body = lines.slice(i, endLine + 1).join('\n');

        functions.push({
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          parameters: this.parseParameters(params),
          returnType,
          body,
          complexity: this.calculateComplexity(body),
          visibility,
          isAsync: modifiers.includes('async'),
          isConst: modifiers.includes('const'),
          isUnsafe: modifiers.includes('unsafe'),
          generics,
          attributes: this.extractAttributes(lines, i),
          documentation: this.extractDocumentation(lines, i)
        });
      }
    }

    return functions;
  }

  /**
   * Extract structs
   */
  private extractStructs(lines: string[], filePath: string): RustStruct[] {
    const structs: RustStruct[] = [];

    // pub struct Name<T> { ... }
    const structRegex = /^(pub\s+)?struct\s+(\w+)(?:<(.+?)>)?\s*(\{|\(|;)/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(structRegex);

      if (match) {
        const visibility = match[1] ? 'public' : 'private';
        const name = match[2];
        const generics = match[3] ? match[3].split(',').map(g => g.trim()) : [];
        const structType = match[4];

        const isUnit = structType === ';';
        const isTuple = structType === '(';

        const endLine = isUnit ? i : this.findBlockEnd(lines, i);
        const fields = isUnit ? [] : this.extractStructFields(lines.slice(i + 1, endLine), isTuple);

        structs.push({
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          fields,
          methods: [],
          visibility: visibility as 'public' | 'private',
          generics,
          attributes: this.extractAttributes(lines, i),
          documentation: this.extractDocumentation(lines, i),
          isUnit,
          isTuple
        });
      }
    }

    return structs;
  }

  /**
   * Extract struct fields
   */
  private extractStructFields(lines: string[], isTuple: boolean): RustField[] {
    const fields: RustField[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '}' || trimmed === ')') continue;

      if (isTuple) {
        // Tuple struct: pub Type,
        const tupleMatch = trimmed.match(/^(pub\s+)?([\w<>]+)/);
        if (tupleMatch) {
          fields.push({
            name: `field_${fields.length}`,
            type: tupleMatch[2],
            visibility: tupleMatch[1] ? 'public' : 'private'
          });
        }
      } else {
        // Named struct: pub name: Type,
        const fieldMatch = trimmed.match(/^(pub\s+)?(\w+)\s*:\s*([\w<>]+)/);
        if (fieldMatch) {
          fields.push({
            name: fieldMatch[2],
            type: fieldMatch[3],
            visibility: fieldMatch[1] ? 'public' : 'private'
          });
        }
      }
    }

    return fields;
  }

  /**
   * Extract enums
   */
  private extractEnums(lines: string[], filePath: string): RustEnum[] {
    const enums: RustEnum[] = [];
    const enumRegex = /^(pub\s+)?enum\s+(\w+)(?:<(.+?)>)?\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(enumRegex);

      if (match) {
        const visibility = match[1] ? 'public' : 'private';
        const name = match[2];
        const generics = match[3] ? match[3].split(',').map(g => g.trim()) : [];

        const endLine = this.findBlockEnd(lines, i);
        const variants = this.extractEnumVariants(lines.slice(i + 1, endLine));

        enums.push({
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          variants,
          visibility: visibility as 'public' | 'private',
          generics,
          attributes: this.extractAttributes(lines, i),
          documentation: this.extractDocumentation(lines, i)
        });
      }
    }

    return enums;
  }

  /**
   * Extract enum variants
   */
  private extractEnumVariants(lines: string[]): RustEnumVariant[] {
    const variants: RustEnumVariant[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '}') continue;

      // Variant,
      // Variant(Type),
      // Variant { field: Type },
      // Variant = 1,

      const simpleMatch = trimmed.match(/^(\w+)\s*,?$/);
      if (simpleMatch) {
        variants.push({ name: simpleMatch[1] });
        continue;
      }

      const discriminantMatch = trimmed.match(/^(\w+)\s*=\s*(.+?),?$/);
      if (discriminantMatch) {
        variants.push({
          name: discriminantMatch[1],
          discriminant: discriminantMatch[2]
        });
        continue;
      }

      const tupleMatch = trimmed.match(/^(\w+)\s*\((.+?)\)/);
      if (tupleMatch) {
        variants.push({ name: tupleMatch[1] });
        continue;
      }

      const structMatch = trimmed.match(/^(\w+)\s*\{/);
      if (structMatch) {
        variants.push({ name: structMatch[1] });
      }
    }

    return variants;
  }

  /**
   * Extract traits
   */
  private extractTraits(lines: string[], filePath: string): RustTrait[] {
    const traits: RustTrait[] = [];
    const traitRegex = /^(pub\s+)?trait\s+(\w+)(?:<(.+?)>)?\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(traitRegex);

      if (match) {
        const visibility = match[1] ? 'public' : 'private';
        const name = match[2];
        const generics = match[3] ? match[3].split(',').map(g => g.trim()) : [];

        const endLine = this.findBlockEnd(lines, i);
        const methods = this.extractTraitMethods(lines.slice(i + 1, endLine));

        traits.push({
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          methods,
          visibility: visibility as 'public' | 'private',
          generics,
          documentation: this.extractDocumentation(lines, i)
        });
      }
    }

    return traits;
  }

  /**
   * Extract trait method signatures
   */
  private extractTraitMethods(lines: string[]): RustMethodSignature[] {
    const methods: RustMethodSignature[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // fn name(params) -> return;
      const methodMatch = trimmed.match(/fn\s+(\w+)\s*\((.*?)\)(?:\s*->\s*(.+?))?;/);
      if (methodMatch) {
        methods.push({
          name: methodMatch[1],
          parameters: this.parseParameters(methodMatch[2]),
          returnType: methodMatch[3]
        });
      }
    }

    return methods;
  }

  /**
   * Extract impl blocks
   */
  private extractImpls(lines: string[], filePath: string): RustImpl[] {
    const impls: RustImpl[] = [];

    // impl Trait for Type { ... }
    // impl Type { ... }
    const implRegex = /^impl\s+(?:(\w+)\s+for\s+)?(\w+)\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(implRegex);

      if (match) {
        const trait = match[1];
        const type = match[2];

        const endLine = this.findBlockEnd(lines, i);
        const methods = this.extractFunctions(lines.slice(i + 1, endLine), filePath);

        impls.push({
          type,
          trait,
          methods
        });
      }
    }

    return impls;
  }

  /**
   * Extract constants
   */
  private extractConstants(lines: string[]): RustConstant[] {
    const constants: RustConstant[] = [];
    const constRegex = /^(pub\s+)?const\s+(\w+)\s*:\s*([\w<>]+)\s*=\s*(.+?);/;

    for (const line of lines) {
      const match = line.trim().match(constRegex);
      if (match) {
        constants.push({
          name: match[2],
          type: match[3],
          value: match[4],
          visibility: match[1] ? 'public' : 'private'
        });
      }
    }

    return constants;
  }

  /**
   * Parse function parameters
   */
  private parseParameters(params: string): RustParameter[] {
    if (!params.trim()) return [];

    const result: RustParameter[] = [];
    const parts = this.splitParameters(params);

    for (const part of parts) {
      // mut &name: Type
      // &mut name: Type
      // name: Type
      const match = part.match(/^(mut\s+)?(&mut\s+|&)?(\w+)\s*:\s*(.+)/);
      if (match) {
        result.push({
          name: match[3],
          type: match[4].trim(),
          isMutable: !!match[1] || !!match[2]?.includes('mut'),
          isReference: !!match[2]
        });
      }
    }

    return result;
  }

  /**
   * Split parameters (handle generics)
   */
  private splitParameters(params: string): string[] {
    const result: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of params) {
      if (char === '<' || char === '(') depth++;
      if (char === '>' || char === ')') depth--;

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
   * Extract attributes (#[...])
   */
  private extractAttributes(lines: string[], fnLine: number): string[] {
    const attributes: string[] = [];

    for (let i = fnLine - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('#[')) {
        attributes.unshift(trimmed);
      } else if (trimmed.length > 0 && !trimmed.startsWith('//')) {
        break;
      }
    }

    return attributes;
  }

  /**
   * Extract documentation comments (///)
   */
  private extractDocumentation(lines: string[], lineIndex: number): string | undefined {
    const docs: string[] = [];

    for (let i = lineIndex - 1; i >= 0; i--) {
      const line = lines[i].trim();

      if (line.startsWith('///')) {
        docs.unshift(line.substring(3).trim());
      } else if (line.length === 0) {
        continue;
      } else {
        break;
      }
    }

    return docs.length > 0 ? docs.join('\n') : undefined;
  }

  /**
   * Parse visibility
   */
  private parseVisibility(vis?: string): 'public' | 'private' | 'pub(crate)' | 'pub(super)' {
    if (!vis) return 'private';
    if (vis.includes('pub(crate)')) return 'pub(crate)';
    if (vis.includes('pub(super)')) return 'pub(super)';
    if (vis.includes('pub')) return 'public';
    return 'private';
  }

  /**
   * Find end of block
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
      /\bwhile\s+/g,
      /\bfor\s+/g,
      /\bmatch\s+/g,
      /\b=>\s*/g,  // match arms
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

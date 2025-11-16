/**
 * C# AST Parser
 *
 * Parses C# code to extract classes, methods, properties, and other structures
 * Uses regex-based parsing (can be enhanced with Roslyn API)
 *
 * Phase 6: Multi-Language Support
 */

import * as fs from 'fs';

/**
 * C# Method
 */
export interface CSharpMethod {
  name: string;
  file: string;
  line: number;
  endLine: number;
  parameters: CSharpParameter[];
  returnType: string;
  body: string;
  complexity: number;
  visibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  isStatic: boolean;
  isVirtual: boolean;
  isOverride: boolean;
  isAbstract: boolean;
  isSealed: boolean;
  isAsync: boolean;
  attributes: string[];
  documentation?: string;
  genericParameters: string[];
}

/**
 * C# Property
 */
export interface CSharpProperty {
  name: string;
  type: string;
  visibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  isStatic: boolean;
  isVirtual: boolean;
  isOverride: boolean;
  isAbstract: boolean;
  hasGetter: boolean;
  hasSetter: boolean;
  isAutoProperty: boolean;
  attributes: string[];
  documentation?: string;
}

/**
 * C# Class
 */
export interface CSharpClass {
  name: string;
  file: string;
  line: number;
  endLine: number;
  namespace?: string;
  baseClass?: string;
  interfaces: string[];
  methods: CSharpMethod[];
  properties: CSharpProperty[];
  fields: CSharpField[];
  events: CSharpEvent[];
  nestedClasses: CSharpClass[];
  visibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  isAbstract: boolean;
  isSealed: boolean;
  isStatic: boolean;
  isPartial: boolean;
  isInterface: boolean;
  isStruct: boolean;
  isRecord: boolean;
  attributes: string[];
  documentation?: string;
  genericParameters: string[];
}

/**
 * C# Parameter
 */
export interface CSharpParameter {
  name: string;
  type: string;
  defaultValue?: string;
  isRef: boolean;
  isOut: boolean;
  isIn: boolean;
  isParams: boolean;
  isNullable: boolean;
  attributes: string[];
}

/**
 * C# Field
 */
export interface CSharpField {
  name: string;
  type: string;
  visibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  isStatic: boolean;
  isReadonly: boolean;
  isConst: boolean;
  defaultValue?: string;
  attributes: string[];
}

/**
 * C# Event
 */
export interface CSharpEvent {
  name: string;
  type: string;
  visibility: 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected';
  isStatic: boolean;
  attributes: string[];
}

/**
 * C# Using Statement
 */
export interface CSharpUsing {
  namespace: string;
  alias?: string;
  isStatic: boolean;
}

/**
 * Parsed C# File
 */
export interface ParsedCSharpFile {
  file: string;
  namespace?: string;
  usings: CSharpUsing[];
  classes: CSharpClass[];
  interfaces: CSharpClass[];
  structs: CSharpClass[];
  records: CSharpClass[];
  enums: CSharpEnum[];
  language: 'csharp';
}

/**
 * C# Enum
 */
export interface CSharpEnum {
  name: string;
  file: string;
  line: number;
  endLine: number;
  namespace?: string;
  visibility: 'public' | 'private' | 'protected' | 'internal';
  baseType?: string;
  values: CSharpEnumValue[];
  attributes: string[];
  documentation?: string;
}

/**
 * C# Enum Value
 */
export interface CSharpEnumValue {
  name: string;
  value?: string;
  attributes: string[];
}

/**
 * C# AST Parser
 */
export class CSharpParser {
  /**
   * Parse C# file
   */
  async parseFile(filePath: string): Promise<ParsedCSharpFile> {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this.parseCode(content, filePath);
  }

  /**
   * Parse C# code string
   */
  async parseCode(code: string, filePath: string = 'Unknown.cs'): Promise<ParsedCSharpFile> {
    const lines = code.split('\n');

    // Extract namespace
    const namespace = this.extractNamespace(code);

    // Extract using statements
    const usings = this.extractUsings(lines);

    // Extract types
    const classes: CSharpClass[] = [];
    const interfaces: CSharpClass[] = [];
    const structs: CSharpClass[] = [];
    const records: CSharpClass[] = [];
    const enums: CSharpEnum[] = [];

    const types = this.extractTypes(lines, filePath, namespace);

    for (const type of types) {
      if (type.isInterface) {
        interfaces.push(type);
      } else if (type.isStruct) {
        structs.push(type);
      } else if (type.isRecord) {
        records.push(type);
      } else {
        classes.push(type);
      }
    }

    const extractedEnums = this.extractEnums(lines, filePath, namespace);
    enums.push(...extractedEnums);

    return {
      file: filePath,
      namespace,
      usings,
      classes,
      interfaces,
      structs,
      records,
      enums,
      language: 'csharp'
    };
  }

  /**
   * Extract namespace declaration
   */
  private extractNamespace(code: string): string | undefined {
    const match = code.match(/^\s*namespace\s+([\w.]+)/m);
    return match ? match[1] : undefined;
  }

  /**
   * Extract using statements
   */
  private extractUsings(lines: string[]): CSharpUsing[] {
    const usings: CSharpUsing[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // using static System.Math;
      const staticMatch = trimmed.match(/^using\s+static\s+([\w.]+);/);
      if (staticMatch) {
        usings.push({
          namespace: staticMatch[1],
          isStatic: true
        });
        continue;
      }

      // using Alias = System.Collections.Generic;
      const aliasMatch = trimmed.match(/^using\s+(\w+)\s*=\s*([\w.]+);/);
      if (aliasMatch) {
        usings.push({
          namespace: aliasMatch[2],
          alias: aliasMatch[1],
          isStatic: false
        });
        continue;
      }

      // using System.Collections;
      const normalMatch = trimmed.match(/^using\s+([\w.]+);/);
      if (normalMatch) {
        usings.push({
          namespace: normalMatch[1],
          isStatic: false
        });
      }
    }

    return usings;
  }

  /**
   * Extract classes, interfaces, structs, records
   */
  private extractTypes(lines: string[], filePath: string, namespace?: string): CSharpClass[] {
    const types: CSharpClass[] = [];
    const typeRegex = /^(public\s+|private\s+|protected\s+|internal\s+)?(static\s+|abstract\s+|sealed\s+|partial\s+)*(class|interface|struct|record)\s+(\w+)(<([\w,\s]+)>)?/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(typeRegex);

      if (match) {
        const visibility = this.parseVisibility(match[1]);
        const modifiers = match[2] || '';
        const typeKeyword = match[3];
        const name = match[4];
        const genericParams = match[6] ? match[6].split(',').map(s => s.trim()) : [];

        // Find type end
        const endLine = this.findBlockEnd(lines, i);

        // Extract base class and interfaces
        const declaration = this.getFullDeclaration(lines, i);
        const baseMatch = declaration.match(/:\s*([\w.<>,\s]+)/);
        let baseClass: string | undefined;
        let interfaces: string[] = [];

        if (baseMatch) {
          const bases = baseMatch[1].split(',').map(s => s.trim());
          // First is base class if not an interface, rest are interfaces
          if (typeKeyword === 'class' && bases.length > 0) {
            baseClass = bases[0];
            interfaces = bases.slice(1);
          } else {
            interfaces = bases;
          }
        }

        const type: CSharpClass = {
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          namespace,
          baseClass,
          interfaces,
          methods: [],
          properties: [],
          fields: [],
          events: [],
          nestedClasses: [],
          visibility,
          isAbstract: modifiers.includes('abstract'),
          isSealed: modifiers.includes('sealed'),
          isStatic: modifiers.includes('static'),
          isPartial: modifiers.includes('partial'),
          isInterface: typeKeyword === 'interface',
          isStruct: typeKeyword === 'struct',
          isRecord: typeKeyword === 'record',
          attributes: this.extractAttributes(lines, i),
          documentation: this.extractDocumentation(lines, i),
          genericParameters: genericParams
        };

        // Extract type body
        const typeBody = lines.slice(i + 1, endLine);
        type.methods = this.extractMethods(typeBody, filePath, i + 1);
        type.properties = this.extractProperties(typeBody);
        type.fields = this.extractFields(typeBody);
        type.events = this.extractEvents(typeBody);
        type.nestedClasses = this.extractTypes(typeBody, filePath, namespace);

        types.push(type);
      }
    }

    return types;
  }

  /**
   * Extract methods
   */
  private extractMethods(lines: string[], filePath: string, startLine: number): CSharpMethod[] {
    const methods: CSharpMethod[] = [];
    const methodRegex = /^(public\s+|private\s+|protected\s+|internal\s+)?(static\s+|virtual\s+|override\s+|abstract\s+|sealed\s+|async\s+)*([\w<>[\]?]+)\s+(\w+)(<([\w,\s]+)>)?\s*\((.*?)\)/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(methodRegex);

      if (match && !trimmed.includes('=') && !trimmed.startsWith('//')) {
        const visibility = this.parseVisibility(match[1]);
        const modifiers = match[2] || '';
        const returnType = match[3];
        const name = match[4];
        const genericParams = match[6] ? match[6].split(',').map(s => s.trim()) : [];
        const params = match[7];

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
          isVirtual: modifiers.includes('virtual'),
          isOverride: modifiers.includes('override'),
          isAbstract: modifiers.includes('abstract'),
          isSealed: modifiers.includes('sealed'),
          isAsync: modifiers.includes('async'),
          attributes: this.extractAttributes(lines, i),
          documentation: this.extractDocumentation(lines, i),
          genericParameters: genericParams
        });
      }
    }

    return methods;
  }

  /**
   * Extract properties
   */
  private extractProperties(lines: string[]): CSharpProperty[] {
    const properties: CSharpProperty[] = [];
    const propRegex = /^(public\s+|private\s+|protected\s+|internal\s+)?(static\s+|virtual\s+|override\s+|abstract\s+)*([\w<>[\]?]+)\s+(\w+)\s*\{\s*(.+?)\s*\}/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(propRegex);

      if (match) {
        const visibility = this.parseVisibility(match[1]);
        const modifiers = match[2] || '';
        const type = match[3];
        const name = match[4];
        const accessors = match[5];

        const hasGetter = accessors.includes('get');
        const hasSetter = accessors.includes('set');
        const isAutoProperty = accessors.includes('get;') || accessors.includes('set;');

        properties.push({
          name,
          type,
          visibility,
          isStatic: modifiers.includes('static'),
          isVirtual: modifiers.includes('virtual'),
          isOverride: modifiers.includes('override'),
          isAbstract: modifiers.includes('abstract'),
          hasGetter,
          hasSetter,
          isAutoProperty,
          attributes: [],
          documentation: undefined
        });
      }
    }

    return properties;
  }

  /**
   * Extract fields
   */
  private extractFields(lines: string[]): CSharpField[] {
    const fields: CSharpField[] = [];
    const fieldRegex = /^(public\s+|private\s+|protected\s+|internal\s+)?(static\s+|readonly\s+|const\s+)*([\w<>[\]?]+)\s+(\w+)(\s*=\s*(.+?))?;/;

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(fieldRegex);

      if (match) {
        const visibility = this.parseVisibility(match[1]);
        const modifiers = match[2] || '';
        const type = match[3];
        const name = match[4];
        const defaultValue = match[6];

        fields.push({
          name,
          type,
          visibility,
          isStatic: modifiers.includes('static'),
          isReadonly: modifiers.includes('readonly'),
          isConst: modifiers.includes('const'),
          defaultValue,
          attributes: []
        });
      }
    }

    return fields;
  }

  /**
   * Extract events
   */
  private extractEvents(lines: string[]): CSharpEvent[] {
    const events: CSharpEvent[] = [];
    const eventRegex = /^(public\s+|private\s+|protected\s+|internal\s+)?(static\s+)?event\s+([\w<>]+)\s+(\w+);/;

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(eventRegex);

      if (match) {
        const visibility = this.parseVisibility(match[1]);
        const isStatic = !!match[2];
        const type = match[3];
        const name = match[4];

        events.push({
          name,
          type,
          visibility,
          isStatic,
          attributes: []
        });
      }
    }

    return events;
  }

  /**
   * Extract enums
   */
  private extractEnums(lines: string[], filePath: string, namespace?: string): CSharpEnum[] {
    const enums: CSharpEnum[] = [];
    const enumRegex = /^(public\s+|private\s+|protected\s+|internal\s+)?enum\s+(\w+)(?:\s*:\s*(\w+))?/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(enumRegex);

      if (match) {
        const visibility = this.parseVisibility(match[1]);
        const name = match[2];
        const baseType = match[3];

        const endLine = this.findBlockEnd(lines, i);
        const enumBody = lines.slice(i + 1, endLine);

        const values = this.extractEnumValues(enumBody);

        // Enums don't support compound visibility modifiers
        const enumVisibility = visibility === 'protected internal' || visibility === 'private protected'
          ? 'internal'
          : visibility as 'public' | 'private' | 'protected' | 'internal';

        enums.push({
          name,
          file: filePath,
          line: i + 1,
          endLine: endLine + 1,
          namespace,
          visibility: enumVisibility,
          baseType,
          values,
          attributes: this.extractAttributes(lines, i),
          documentation: this.extractDocumentation(lines, i)
        });
      }
    }

    return enums;
  }

  /**
   * Extract enum values
   */
  private extractEnumValues(lines: string[]): CSharpEnumValue[] {
    const values: CSharpEnumValue[] = [];
    const valueRegex = /^(\w+)(?:\s*=\s*(.+?))?[,]?$/;

    for (const line of lines) {
      const trimmed = line.trim().replace(/,$/, '');
      const match = trimmed.match(valueRegex);

      if (match) {
        values.push({
          name: match[1],
          value: match[2],
          attributes: []
        });
      }
    }

    return values;
  }

  /**
   * Parse method parameters
   */
  private parseParameters(paramsStr: string): CSharpParameter[] {
    if (!paramsStr.trim()) return [];

    const params = this.splitParameters(paramsStr);
    return params.map(param => {
      const trimmed = param.trim();

      const isRef = trimmed.startsWith('ref ');
      const isOut = trimmed.startsWith('out ');
      const isIn = trimmed.startsWith('in ');
      const isParams = trimmed.startsWith('params ');

      // Remove modifiers
      let cleaned = trimmed
        .replace(/^ref\s+/, '')
        .replace(/^out\s+/, '')
        .replace(/^in\s+/, '')
        .replace(/^params\s+/, '');

      // Extract type and name
      const parts = cleaned.split(/\s+/);
      const type = parts.slice(0, -1).join(' ');
      const name = parts[parts.length - 1];

      const isNullable = type.includes('?');

      let defaultValue: string | undefined;
      if (cleaned.includes('=')) {
        const equalIndex = cleaned.indexOf('=');
        defaultValue = cleaned.substring(equalIndex + 1).trim();
      }

      return {
        name: name.replace(/=.*$/, '').trim(),
        type,
        defaultValue,
        isRef,
        isOut,
        isIn,
        isParams,
        isNullable,
        attributes: []
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
   * Extract attributes ([Attribute])
   */
  private extractAttributes(lines: string[], targetLine: number): string[] {
    const attributes: string[] = [];

    for (let i = targetLine - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        attributes.unshift(trimmed);
      } else if (trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
        break;
      }
    }

    return attributes;
  }

  /**
   * Extract XML documentation comments
   */
  private extractDocumentation(lines: string[], targetLine: number): string | undefined {
    let documentation = '';

    for (let i = targetLine - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith('///')) {
        documentation = trimmed + '\n' + documentation;
      } else if (trimmed.length > 0 && !trimmed.startsWith('[')) {
        break;
      }
    }

    return documentation.trim() || undefined;
  }

  /**
   * Parse visibility modifier
   */
  private parseVisibility(modifier?: string): 'public' | 'private' | 'protected' | 'internal' | 'protected internal' | 'private protected' {
    if (!modifier) return 'private';
    if (modifier.includes('protected internal')) return 'protected internal';
    if (modifier.includes('private protected')) return 'private protected';
    if (modifier.includes('public')) return 'public';
    if (modifier.includes('private')) return 'private';
    if (modifier.includes('protected')) return 'protected';
    if (modifier.includes('internal')) return 'internal';
    return 'private';
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
      /\bwhile\s*\(/g,
      /\bfor\s*\(/g,
      /\bforeach\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /\&\&/g,
      /\|\|/g,
      /\?/g,  // Ternary operator
      /\?\?/g // Null-coalescing operator
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

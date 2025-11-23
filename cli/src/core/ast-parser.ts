// AST Parser for TypeScript/JavaScript
// Parses code into structured format for AI analysis

import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

/**
 * Represents a parsed function
 */
export interface ParsedFunction {
  name: string;
  file: string;
  line: number;
  endLine: number;
  parameters: Parameter[];
  returnType: string;
  body: string;
  complexity: number;
  isAsync: boolean;
  isExported: boolean;
  isStatic?: boolean; // For class methods
  documentation?: string;
  dependencies: string[];
}

/**
 * Function parameter
 */
export interface Parameter {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
}

/**
 * Represents a parsed class
 */
export interface ParsedClass {
  name: string;
  file: string;
  line: number;
  endLine: number;
  isExported: boolean;
  isAbstract: boolean;
  extends?: string[];
  implements?: string[];
  properties: Property[];
  methods: ParsedFunction[];
  documentation?: string;
}

/**
 * Class property
 */
export interface Property {
  name: string;
  type: string;
  visibility: "public" | "private" | "protected";
  isStatic: boolean;
  isReadonly: boolean;
}

/**
 * Import statement
 */
export interface Import {
  module: string;
  imports: string[];
  isDefault: boolean;
  isNamespace: boolean;
}

/**
 * Export statement
 */
export interface Export {
  name: string;
  type: "function" | "class" | "variable" | "type";
  isDefault: boolean;
}

/**
 * Parsed file
 */
export interface ParsedFile {
  path: string;
  language: "typescript" | "javascript";
  sourceCode: string;
  hash: string;
  loc: number;
  functions: ParsedFunction[];
  classes: ParsedClass[];
  imports: Import[];
  exports: Export[];
  complexity: number;
  lastModified: Date;
}

/**
 * AST Parser for TypeScript/JavaScript
 */
export class ASTParser {
  /**
   * Parse a TypeScript/JavaScript file
   */
  async parseFile(filePath: string): Promise<ParsedFile> {
    const sourceCode = fs.readFileSync(filePath, "utf-8");
    const language = this.detectLanguage(filePath);

    // Create TypeScript source file
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    // Extract all elements
    const functions = this.extractFunctions(sourceFile, filePath);
    const classes = this.extractClasses(sourceFile, filePath);
    const imports = this.extractImports(sourceFile);
    const exports = this.extractExports(sourceFile);

    // Calculate metrics
    const loc = this.countLOC(sourceCode);
    const complexity = this.calculateFileComplexity(functions, classes);
    const hash = this.hashContent(sourceCode);

    return {
      path: filePath,
      language,
      sourceCode,
      hash,
      loc,
      functions,
      classes,
      imports,
      exports,
      complexity,
      lastModified: fs.statSync(filePath).mtime,
    };
  }

  /**
   * Detect language from file extension
   */
  private detectLanguage(filePath: string): "typescript" | "javascript" {
    const ext = path.extname(filePath).toLowerCase();
    return ext === ".ts" || ext === ".tsx" ? "typescript" : "javascript";
  }

  /**
   * Extract all functions from AST
   */
  private extractFunctions(
    sourceFile: ts.SourceFile,
    filePath: string
  ): ParsedFunction[] {
    const functions: ParsedFunction[] = [];

    const visit = (node: ts.Node) => {
      // Function declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        functions.push(
          this.parseFunctionDeclaration(node, sourceFile, filePath)
        );
      }

      // Arrow functions assigned to variables
      else if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach((declaration) => {
          if (
            declaration.initializer &&
            (ts.isArrowFunction(declaration.initializer) ||
              ts.isFunctionExpression(declaration.initializer))
          ) {
            functions.push(
              this.parseVariableFunction(declaration, sourceFile, filePath)
            );
          }
        });
      }

      // Method declarations (handled in class extraction)

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return functions;
  }

  /**
   * Parse function declaration
   */
  private parseFunctionDeclaration(
    node: ts.FunctionDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): ParsedFunction {
    const name = node.name?.getText(sourceFile) || "anonymous";
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart()
    );
    const endLine = sourceFile.getLineAndCharacterOfPosition(
      node.getEnd()
    ).line;

    const parameters = this.extractParameters(node, sourceFile);
    const returnType = this.extractReturnType(node, sourceFile);
    const body = node.body?.getText(sourceFile) || "";
    const complexity = this.calculateComplexity(node);
    const isAsync = !!node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.AsyncKeyword
    );
    const isExported = this.isExported(node);
    const documentation = this.extractDocumentation(node, sourceFile);
    const dependencies = this.extractDependencies(node, sourceFile);

    return {
      name,
      file: filePath,
      line: line + 1,
      endLine: endLine + 1,
      parameters,
      returnType,
      body,
      complexity,
      isAsync,
      isExported,
      documentation,
      dependencies,
    };
  }

  /**
   * Parse variable function (arrow or function expression)
   */
  private parseVariableFunction(
    declaration: ts.VariableDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): ParsedFunction {
    const name = declaration.name.getText(sourceFile);
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      declaration.getStart()
    );
    const endLine = sourceFile.getLineAndCharacterOfPosition(
      declaration.getEnd()
    ).line;

    const func = declaration.initializer as
      | ts.ArrowFunction
      | ts.FunctionExpression;
    const parameters = this.extractParametersFromArrow(func, sourceFile);
    const returnType = func.type?.getText(sourceFile) || "any";
    const body = func.body.getText(sourceFile);
    const complexity = this.calculateComplexity(func);
    const isAsync = !!func.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.AsyncKeyword
    );
    const isExported = this.isExported(declaration.parent.parent as ts.Node);
    const documentation = this.extractDocumentation(
      declaration.parent.parent as ts.Node,
      sourceFile
    );
    const dependencies = this.extractDependencies(func, sourceFile);

    return {
      name,
      file: filePath,
      line: line + 1,
      endLine: endLine + 1,
      parameters,
      returnType,
      body,
      complexity,
      isAsync,
      isExported,
      documentation,
      dependencies,
    };
  }

  /**
   * Extract classes from AST
   */
  private extractClasses(
    sourceFile: ts.SourceFile,
    filePath: string
  ): ParsedClass[] {
    const classes: ParsedClass[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        classes.push(this.parseClass(node, sourceFile, filePath));
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return classes;
  }

  /**
   * Parse class declaration
   */
  private parseClass(
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): ParsedClass {
    const name = node.name?.getText(sourceFile) || "anonymous";
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const endLine = sourceFile.getLineAndCharacterOfPosition(
      node.getEnd()
    ).line;
    const isExported = this.isExported(node);
    const isAbstract = !!node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.AbstractKeyword
    );

    // Extract inheritance
    const extendsClause = node.heritageClauses?.find(
      (c) => c.token === ts.SyntaxKind.ExtendsKeyword
    );
    const implementsClause = node.heritageClauses?.find(
      (c) => c.token === ts.SyntaxKind.ImplementsKeyword
    );

    const extendsList = extendsClause?.types.map((t) =>
      t.expression.getText(sourceFile)
    );
    const implementsList = implementsClause?.types.map((t) =>
      t.expression.getText(sourceFile)
    );

    // Extract members
    const properties: Property[] = [];
    const methods: ParsedFunction[] = [];

    node.members.forEach((member) => {
      if (ts.isPropertyDeclaration(member)) {
        properties.push(this.parseProperty(member, sourceFile));
      } else if (ts.isMethodDeclaration(member)) {
        methods.push(this.parseMethod(member, sourceFile, filePath));
      }
    });

    const documentation = this.extractDocumentation(node, sourceFile);

    return {
      name,
      file: filePath,
      line: line + 1,
      endLine: endLine + 1,
      isExported,
      isAbstract,
      extends: extendsList,
      implements: implementsList,
      properties,
      methods,
      documentation,
    };
  }

  /**
   * Parse class property
   */
  private parseProperty(
    member: ts.PropertyDeclaration,
    sourceFile: ts.SourceFile
  ): Property {
    const name = member.name.getText(sourceFile);
    const type = member.type?.getText(sourceFile) || "any";
    const visibility = this.getVisibility(member);
    const isStatic = !!member.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.StaticKeyword
    );
    const isReadonly = !!member.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword
    );

    return { name, type, visibility, isStatic, isReadonly };
  }

  /**
   * Parse class method
   */
  private parseMethod(
    member: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): ParsedFunction {
    const name = member.name.getText(sourceFile);
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      member.getStart()
    );
    const endLine = sourceFile.getLineAndCharacterOfPosition(
      member.getEnd()
    ).line;
    const parameters = this.extractParameters(member, sourceFile);
    const returnType = this.extractReturnType(member, sourceFile);
    const body = member.body?.getText(sourceFile) || "";
    const complexity = this.calculateComplexity(member);
    const isAsync = !!member.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.AsyncKeyword
    );
    const isStatic = !!member.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.StaticKeyword
    );
    const documentation = this.extractDocumentation(member, sourceFile);
    const dependencies = this.extractDependencies(member, sourceFile);

    return {
      name,
      file: filePath,
      line: line + 1,
      endLine: endLine + 1,
      parameters,
      returnType,
      body,
      complexity,
      isAsync,
      isExported: false, // Methods are part of classes
      isStatic,
      documentation,
      dependencies,
    };
  }

  /**
   * Extract function parameters
   */
  private extractParameters(
    node: ts.FunctionDeclaration | ts.MethodDeclaration,
    sourceFile: ts.SourceFile
  ): Parameter[] {
    return node.parameters.map((param) => ({
      name: param.name.getText(sourceFile),
      type: param.type?.getText(sourceFile) || "any",
      optional: !!param.questionToken,
      defaultValue: param.initializer?.getText(sourceFile),
    }));
  }

  /**
   * Extract parameters from arrow function
   */
  private extractParametersFromArrow(
    node: ts.ArrowFunction | ts.FunctionExpression,
    sourceFile: ts.SourceFile
  ): Parameter[] {
    return node.parameters.map((param) => ({
      name: param.name.getText(sourceFile),
      type: param.type?.getText(sourceFile) || "any",
      optional: !!param.questionToken,
      defaultValue: param.initializer?.getText(sourceFile),
    }));
  }

  /**
   * Extract return type
   */
  private extractReturnType(
    node: ts.FunctionDeclaration | ts.MethodDeclaration,
    sourceFile: ts.SourceFile
  ): string {
    return node.type?.getText(sourceFile) || "void";
  }

  /**
   * Extract imports
   */
  private extractImports(sourceFile: ts.SourceFile): Import[] {
    const imports: Import[] = [];

    sourceFile.statements.forEach((statement) => {
      if (ts.isImportDeclaration(statement)) {
        const module = (statement.moduleSpecifier as ts.StringLiteral).text;
        const importClause = statement.importClause;

        if (!importClause) return;

        const importNames: string[] = [];
        let isDefault = false;
        let isNamespace = false;

        // Default import
        if (importClause.name) {
          importNames.push(importClause.name.text);
          isDefault = true;
        }

        // Named imports
        if (importClause.namedBindings) {
          if (ts.isNamedImports(importClause.namedBindings)) {
            importClause.namedBindings.elements.forEach((element) => {
              importNames.push(element.name.text);
            });
          } else if (ts.isNamespaceImport(importClause.namedBindings)) {
            importNames.push(importClause.namedBindings.name.text);
            isNamespace = true;
          }
        }

        imports.push({ module, imports: importNames, isDefault, isNamespace });
      }
    });

    return imports;
  }

  /**
   * Extract exports
   */
  private extractExports(sourceFile: ts.SourceFile): Export[] {
    const exports: Export[] = [];

    sourceFile.statements.forEach((statement) => {
      // Export declarations (export function/class/const)
      if (
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isVariableStatement(statement)
      ) {
        const isExported = this.isExported(statement);
        const isDefault = this.isDefaultExport(statement);

        if (isExported) {
          let name = "";
          let type: Export["type"] = "variable";

          if (ts.isFunctionDeclaration(statement) && statement.name) {
            name = statement.name.text;
            type = "function";
          } else if (ts.isClassDeclaration(statement) && statement.name) {
            name = statement.name.text;
            type = "class";
          } else if (ts.isVariableStatement(statement)) {
            const declaration = statement.declarationList.declarations[0];
            name = declaration.name.getText(sourceFile);
            type = "variable";
          }

          if (name) {
            exports.push({ name, type, isDefault });
          }
        }
      }
      // Handle standalone export default statements: export default identifier;
      else if (ts.isExportAssignment(statement)) {
        if (statement.isExportEquals) {
          // export = identifier (CommonJS style)
          const name = statement.expression.getText(sourceFile);
          exports.push({ name, type: "variable", isDefault: true });
        } else {
          // export default identifier
          const name = statement.expression.getText(sourceFile);
          exports.push({ name, type: "variable", isDefault: true });
        }
      }
      // Handle named re-exports: export { name1, name2 }
      else if (ts.isExportDeclaration(statement)) {
        if (
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause)
        ) {
          statement.exportClause.elements.forEach((element) => {
            const name = element.name.text;
            const alias = element.propertyName?.text;
            exports.push({
              name: alias || name,
              type: "variable",
              isDefault: false,
            });
          });
        }
      }
    });

    return exports;
  }

  /**
   * Calculate cyclomatic complexity
   */
  private calculateComplexity(node: ts.Node): number {
    let complexity = 1; // Base complexity

    const visit = (n: ts.Node) => {
      // Decision points add to complexity
      if (
        ts.isIfStatement(n) ||
        ts.isConditionalExpression(n) ||
        ts.isCaseClause(n) ||
        ts.isCatchClause(n) ||
        ts.isWhileStatement(n) ||
        ts.isDoStatement(n) ||
        ts.isForStatement(n) ||
        ts.isForInStatement(n) ||
        ts.isForOfStatement(n)
      ) {
        complexity++;
      }

      // Logical operators
      if (ts.isBinaryExpression(n)) {
        if (
          n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          n.operatorToken.kind === ts.SyntaxKind.BarBarToken
        ) {
          complexity++;
        }
      }

      ts.forEachChild(n, visit);
    };

    visit(node);
    return complexity;
  }

  /**
   * Calculate file-level complexity
   */
  private calculateFileComplexity(
    functions: ParsedFunction[],
    classes: ParsedClass[]
  ): number {
    let total = 0;

    functions.forEach((f) => {
      total += f.complexity;
    });

    classes.forEach((c) => {
      c.methods.forEach((m) => {
        total += m.complexity;
      });
    });

    return total;
  }

  /**
   * Extract JSDoc documentation
   */
  private extractDocumentation(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): string | undefined {
    // Get both the main comment text and tags
    const jsDocComments = ts.getJSDocCommentsAndTags(node);
    if (jsDocComments.length === 0) return undefined;

    const parts: string[] = [];

    // Extract main comment text and tags
    jsDocComments.forEach((comment) => {
      if (ts.isJSDoc(comment)) {
        // Main JSDoc comment text
        const commentText = comment.comment;
        if (typeof commentText === "string" && commentText.trim()) {
          parts.push(commentText.trim());
        } else if (Array.isArray(commentText)) {
          // Multi-line comment
          const text = commentText
            .map((c) => (typeof c === "string" ? c : c.text))
            .join(" ")
            .trim();
          if (text) parts.push(text);
        }

        // Also extract tags from the JSDoc node
        if (comment.tags) {
          comment.tags.forEach((tag) => {
            if (tag.comment) {
              const tagComment =
                typeof tag.comment === "string"
                  ? tag.comment
                  : Array.isArray(tag.comment)
                  ? tag.comment
                      .map((c) => (typeof c === "string" ? c : c.text))
                      .join(" ")
                  : "";
              if (tagComment) {
                parts.push(`${tag.tagName.text}: ${tagComment}`);
              }
            }
          });
        }
      } else if (
        comment.kind === ts.SyntaxKind.JSDocTag ||
        comment.kind === ts.SyntaxKind.JSDocParameterTag ||
        comment.kind === ts.SyntaxKind.JSDocReturnTag
      ) {
        // Standalone JSDoc tags (@param, @returns, etc.)
        const tag = comment as ts.JSDocTag;
        if (tag.comment) {
          const tagComment =
            typeof tag.comment === "string"
              ? tag.comment
              : Array.isArray(tag.comment)
              ? tag.comment
                  .map((c) => (typeof c === "string" ? c : c.text))
                  .join(" ")
              : "";
          if (tagComment) {
            parts.push(`${tag.tagName.text}: ${tagComment}`);
          }
        }
      }
    });

    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  /**
   * Extract function dependencies (calls to other functions)
   */
  private extractDependencies(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): string[] {
    const dependencies = new Set<string>();

    const visit = (n: ts.Node) => {
      // Function calls
      if (ts.isCallExpression(n)) {
        const expr = n.expression;
        if (ts.isIdentifier(expr)) {
          dependencies.add(expr.text);
        } else if (ts.isPropertyAccessExpression(expr)) {
          dependencies.add(expr.name.text);
        }
      }

      ts.forEachChild(n, visit);
    };

    visit(node);
    return Array.from(dependencies);
  }

  /**
   * Check if node is exported
   */
  private isExported(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    return !!modifiers?.some(
      (m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword
    );
  }

  /**
   * Check if node is default export
   */
  private isDefaultExport(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    return !!modifiers?.some(
      (m: ts.Modifier) => m.kind === ts.SyntaxKind.DefaultKeyword
    );
  }

  /**
   * Get member visibility
   */
  private getVisibility(
    member: ts.PropertyDeclaration
  ): "public" | "private" | "protected" {
    if (
      member.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)
    ) {
      return "private";
    }
    if (
      member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword)
    ) {
      return "protected";
    }
    return "public";
  }

  /**
   * Count lines of code (non-blank, non-comment)
   */
  private countLOC(sourceCode: string): number {
    const lines = sourceCode.split("\n");
    let count = 0;
    let inMultiLineComment = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (trimmed.length === 0) continue;

      // Handle multi-line comments
      if (inMultiLineComment) {
        // Check if this line ends the multi-line comment
        if (trimmed.includes("*/")) {
          inMultiLineComment = false;
          // Check if there's code after the comment end
          const afterComment = trimmed.split("*/")[1]?.trim();
          if (afterComment && afterComment.length > 0) {
            count++;
          }
        }
        continue;
      }

      // Check for start of multi-line comment
      if (trimmed.startsWith("/*")) {
        inMultiLineComment = true;
        // Check if comment ends on same line
        if (trimmed.includes("*/")) {
          inMultiLineComment = false;
          // Check if there's code after the comment
          const afterComment = trimmed.split("*/")[1]?.trim();
          if (afterComment && afterComment.length > 0) {
            count++;
          }
        }
        continue;
      }

      // Skip single-line comments
      if (trimmed.startsWith("//")) continue;

      // Count non-comment, non-empty lines
      count++;
    }

    return count;
  }

  /**
   * Hash file content for change detection
   */
  private hashContent(content: string): string {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(content).digest("hex");
  }
}

// Export singleton instance
export const astParser = new ASTParser();

/**
 * JavaScript / TypeScript source analysis on the TypeScript compiler AST.
 *
 * Syntactic only: `createSourceFile` with no Program or type checker, so the
 * cost stays linear in file size on hostile input. Errors lean towards missed
 * findings (any same-named reference counts as a use).
 */
import type * as TS from 'typescript';
import type { SourceAnalysis, FnInfo, ClassInfo } from './source-analysis';

let tsModule: typeof TS | null = null;

function getTs(): typeof TS {
  if (!tsModule) {
    // Lazy: typescript is large and only needed when a JS/TS file is scanned.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    tsModule = require('typescript') as typeof TS;
  }
  return tsModule;
}

const SAFE_NUMBERS = new Set(['0', '1', '100', '1000']);

/** Split source into comment text and comment-free text with the TypeScript scanner (regex and template aware). */
function lexJs(ts: typeof TS, content: string, jsx: boolean): { comments: string; noComments: string } {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    jsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    content
  );
  const K = ts.SyntaxKind;
  const operandKinds = new Set<TS.SyntaxKind>([
    K.Identifier, K.NumericLiteral, K.BigIntLiteral, K.StringLiteral, K.RegularExpressionLiteral,
    K.CloseParenToken, K.CloseBracketToken, K.CloseBraceToken, K.ThisKeyword, K.SuperKeyword,
    K.TemplateTail, K.NoSubstitutionTemplateLiteral, K.PlusPlusToken, K.MinusMinusToken,
    K.TrueKeyword, K.FalseKeyword, K.NullKeyword, K.PrivateIdentifier,
  ]);
  const comments: string[] = [];
  const noComments: string[] = [];
  const blank = (t: string) => t.replace(/[^\r\n]/g, ' ');
  const templateDepth: number[] = [];
  let prev: TS.SyntaxKind = K.Unknown;

  let kind = scanner.scan();
  while (kind !== K.EndOfFileToken) {
    if ((kind === K.SlashToken || kind === K.SlashEqualsToken) && !operandKinds.has(prev)) {
      kind = scanner.reScanSlashToken();
    } else if (kind === K.CloseBraceToken && templateDepth.length > 0 && templateDepth[templateDepth.length - 1] === 0) {
      kind = scanner.reScanTemplateToken(false);
      if (kind === K.TemplateTail) {
        templateDepth.pop();
      }
    } else if (kind === K.TemplateHead) {
      templateDepth.push(0);
    } else if (kind === K.OpenBraceToken && templateDepth.length > 0) {
      templateDepth[templateDepth.length - 1]++;
    } else if (kind === K.CloseBraceToken && templateDepth.length > 0) {
      templateDepth[templateDepth.length - 1]--;
    }
    const text = scanner.getTokenText();
    if (kind === K.SingleLineCommentTrivia || kind === K.MultiLineCommentTrivia || kind === K.ShebangTrivia) {
      comments.push(text);
      noComments.push(blank(text));
    } else {
      comments.push(blank(text));
      noComments.push(text);
      if (kind !== K.WhitespaceTrivia && kind !== K.NewLineTrivia) {
        prev = kind;
      }
    }
    kind = scanner.scan();
  }
  return { comments: comments.join(''), noComments: noComments.join('') };
}

interface FnRec extends FnInfo {
  node: TS.Node;
  listed: boolean;
}

interface ClassRec {
  info: ClassInfo;
  fields: Set<string>;
}

export function analyzeJs(content: string, filePath: string, language: 'javascript' | 'typescript'): SourceAnalysis {
  const ts = getTs();
  const K = ts.SyntaxKind;
  const isTs = language === 'typescript';
  const lexed = lexJs(ts, content, !isTs);

  const result: SourceAnalysis = {
    language,
    noComments: lexed.noComments,
    comments: lexed.comments,
    functions: [],
    classes: [],
    emptyCatchLines: [],
    unreachableLines: [],
    unusedVariables: [],
    magicNumbers: [],
    imports: [],
    cyclomatic: 1,
    cognitive: 0,
  };

  const sf = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const refs = new Map<string, number[]>();
  const decls: Array<{ name: string; pos: number; line: number; scopeStart: number; scopeEnd: number }> = [];
  const fnStack: FnRec[] = [];
  const classStack: ClassRec[] = [];
  let cognitive = 0;

  const isFunctionLike = (n: TS.Node): n is TS.FunctionLikeDeclaration =>
    ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n);

  const nameOf = (n: TS.FunctionLikeDeclaration): string | undefined => {
    if (ts.isConstructorDeclaration(n)) {
      return 'constructor';
    }
    const own = (n as TS.FunctionDeclaration).name;
    if (own && (ts.isIdentifier(own) || ts.isStringLiteral(own) || ts.isPrivateIdentifier(own))) {
      return own.text;
    }
    const p = n.parent;
    if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
      return p.name.text;
    }
    if (p && (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
      return p.name.text;
    }
    if (p && ts.isBinaryExpression(p) && p.operatorToken.kind === K.EqualsToken) {
      if (ts.isPropertyAccessExpression(p.left)) {
        return p.left.name.text;
      }
      if (ts.isIdentifier(p.left)) {
        return p.left.text;
      }
    }
    return undefined;
  };

  const isPropertyNamePosition = (n: TS.Identifier): boolean => {
    const p = n.parent;
    if (!p) {
      return false;
    }
    return (
      (ts.isPropertyAccessExpression(p) && p.name === n) ||
      (ts.isPropertyAssignment(p) && p.name === n) ||
      ((ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) ||
        ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) ||
        ts.isEnumMember(p)) && p.name === n) ||
      (ts.isQualifiedName(p) && p.right === n)
    );
  };

  const scopeOf = (n: TS.Node): TS.Node => {
    let cur: TS.Node | undefined = n.parent;
    while (cur && !isFunctionLike(cur) && !ts.isSourceFile(cur)) {
      cur = cur.parent;
    }
    return cur || sf;
  };

  const checkUnreachable = (statements: readonly TS.Statement[]) => {
    for (let i = 0; i < statements.length - 1; i++) {
      const k = statements[i].kind;
      if (k === K.ReturnStatement || k === K.ThrowStatement || k === K.BreakStatement || k === K.ContinueStatement) {
        const next = statements.slice(i + 1).find(s =>
          !ts.isFunctionDeclaration(s) && !ts.isInterfaceDeclaration(s) && !ts.isTypeAliasDeclaration(s) &&
          !ts.isEmptyStatement(s) && !ts.isEnumDeclaration(s) && !ts.isClassDeclaration(s)
        );
        if (next) {
          result.unreachableLines.push(lineOf(next.getStart(sf)));
        }
        return;
      }
    }
  };

  const isInsideConstant = (n: TS.Node): boolean => {
    for (let cur: TS.Node | undefined = n.parent; cur; cur = cur.parent) {
      if (isFunctionLike(cur) || ts.isClassLike(cur)) {
        return false;
      }
      if (ts.isVariableDeclarationList(cur)) {
        return (cur.flags & ts.NodeFlags.Const) !== 0;
      }
      if (ts.isEnumMember(cur) || ts.isLiteralTypeNode(cur) || ts.isElementAccessExpression(cur)) {
        return true;
      }
      if ((ts.isPropertyDeclaration(cur)) && cur.modifiers?.some(m => m.kind === K.ReadonlyKeyword)) {
        return true;
      }
      if (cur.kind >= K.FirstStatement && cur.kind <= K.LastStatement) {
        return false;
      }
    }
    return false;
  };

  const visit = (node: TS.Node, nesting: number): void => {
    let childNesting = nesting;

    if (ts.isIdentifier(node)) {
      if (!isPropertyNamePosition(node)) {
        const list = refs.get(node.text);
        if (list) {
          list.push(node.getStart(sf));
        } else {
          refs.set(node.text, [node.getStart(sf)]);
        }
      }
    } else if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node)) {
      checkUnreachable(node.statements);
    } else if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      checkUnreachable(node.statements);
    }

    if (isFunctionLike(node) && node.body) {
      const name = nameOf(node);
      const rec: FnRec = {
        node,
        listed: name !== undefined,
        name: name ?? 'anonymous',
        startLine: lineOf(node.getStart(sf)),
        endLine: lineOf(node.end),
        paramCount: node.parameters.filter(p => !(ts.isIdentifier(p.name) && p.name.text === 'this')).length,
        returnCount: 0,
      };
      fnStack.push(rec);
      if (fnStack.length > 1) {
        childNesting = nesting + 1;
      }
    } else if (ts.isClassLike(node)) {
      classStack.push({
        info: { name: node.name?.text ?? 'anonymous', line: lineOf(node.getStart(sf)), methodCount: 0, fieldCount: 0 },
        fields: new Set(),
      });
      for (const m of node.members) {
        const cls = classStack[classStack.length - 1];
        if (ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
          cls.info.methodCount++;
        } else if (ts.isPropertyDeclaration(m) && !m.modifiers?.some(mod => mod.kind === K.StaticKeyword)) {
          cls.fields.add(m.name.getText(sf));
        }
      }
    } else if (ts.isReturnStatement(node) && fnStack.length > 0) {
      fnStack[fnStack.length - 1].returnCount++;
    } else if (ts.isIfStatement(node)) {
      result.cyclomatic++;
      const isElseIf = ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
      cognitive += isElseIf ? 1 : 1 + nesting;
      visit(node.expression, nesting);
      visit(node.thenStatement, nesting + 1);
      if (node.elseStatement) {
        if (ts.isIfStatement(node.elseStatement)) {
          visit(node.elseStatement, nesting);
        } else {
          cognitive += 1;
          visit(node.elseStatement, nesting + 1);
        }
      }
      return;
    } else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) ||
               ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      result.cyclomatic++;
      cognitive += 1 + nesting;
      childNesting = nesting + 1;
    } else if (ts.isSwitchStatement(node)) {
      cognitive += 1 + nesting;
      childNesting = nesting + 1;
    } else if (ts.isCaseClause(node)) {
      result.cyclomatic++;
    } else if (ts.isCatchClause(node)) {
      result.cyclomatic++;
      cognitive += 1 + nesting;
      childNesting = nesting + 1;
      const inner = content.slice(node.block.getStart(sf) + 1, node.block.end - 1);
      if (inner.trim() === '') {
        result.emptyCatchLines.push(lineOf(node.getStart(sf)));
      }
    } else if (ts.isConditionalExpression(node)) {
      result.cyclomatic++;
      cognitive += 1 + nesting;
      childNesting = nesting + 1;
    } else if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === K.AmpersandAmpersandToken || op === K.BarBarToken || op === K.QuestionQuestionToken) {
        result.cyclomatic++;
        const p = node.parent;
        const continuesChain = p && ts.isBinaryExpression(p) && p.operatorToken.kind === op && p.left === node;
        if (!continuesChain) {
          cognitive += 1;
        }
      } else if (op === K.EqualsToken && classStack.length > 0 && fnStack.length > 0 &&
                 ts.isConstructorDeclaration(fnStack[fnStack.length - 1].node) &&
                 ts.isPropertyAccessExpression(node.left) && node.left.expression.kind === K.ThisKeyword) {
        classStack[classStack.length - 1].fields.add(node.left.name.text);
      }
    } else if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label) {
      cognitive += 1;
    } else if (ts.isNumericLiteral(node)) {
      const raw = node.getText(sf);
      const isMagic = (/^\d[\d_]*$/.test(raw) && raw.replace(/_/g, '').length >= 2) || /^\d+\.\d+$/.test(raw);
      if (isMagic && !SAFE_NUMBERS.has(raw) && !isInsideConstant(node)) {
        result.magicNumbers.push({ value: raw, line: lineOf(node.getStart(sf)) });
      }
    } else if (ts.isVariableDeclaration(node)) {
      const list = node.parent;
      const stmt = list && ts.isVariableDeclarationList(list) ? list.parent : undefined;
      if (stmt && ts.isVariableStatement(stmt) && ts.isIdentifier(node.name) && !node.name.text.startsWith('_') &&
          !stmt.modifiers?.some(m => m.kind === K.ExportKeyword || m.kind === K.DeclareKeyword)) {
        const scope = scopeOf(stmt);
        decls.push({
          name: node.name.text,
          pos: node.name.getStart(sf),
          line: lineOf(node.getStart(sf)),
          scopeStart: scope.getStart(sf),
          scopeEnd: scope.end,
        });
      }
    } else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        result.imports.push(node.moduleSpecifier.text);
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) &&
               ts.isStringLiteral(node.moduleReference.expression)) {
      result.imports.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]) &&
               ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === K.ImportKeyword)) {
      result.imports.push(node.arguments[0].text);
    }

    ts.forEachChild(node, child => visit(child, childNesting));

    if (isFunctionLike(node) && node.body) {
      const rec = fnStack.pop();
      if (rec && rec.listed) {
        result.functions.push({
          name: rec.name,
          startLine: rec.startLine,
          endLine: rec.endLine,
          paramCount: rec.paramCount,
          returnCount: rec.returnCount,
        });
      }
    } else if (ts.isClassLike(node)) {
      const cls = classStack.pop();
      if (cls) {
        cls.info.fieldCount = cls.fields.size;
        result.classes.push(cls.info);
      }
    }
  };

  try {
    visit(sf, 0);
  } catch (error) {
    // Pathologically deep nesting can overflow the recursive walk; keep the lexed views and skip AST findings.
    if (!(error instanceof RangeError)) {
      throw error;
    }
    return { ...result, functions: [], classes: [], emptyCatchLines: [], unreachableLines: [], unusedVariables: [], magicNumbers: [], imports: [], cyclomatic: 1, cognitive: 0 };
  }

  if (!filePath.endsWith('.d.ts')) {
    for (const d of decls) {
      const uses = (refs.get(d.name) || []).filter(pos => pos !== d.pos && pos >= d.scopeStart && pos <= d.scopeEnd);
      if (uses.length === 0) {
        result.unusedVariables.push({ name: d.name, line: d.line });
      }
    }
  }
  result.cognitive = Math.round(cognitive);
  return result;
}

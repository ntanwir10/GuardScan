/**
 * Shared source analysis for the code smell detector and the code metrics analyzer.
 *
 * JS/TS go through the TypeScript AST (js-analysis.ts). Every other language is
 * lexed first (comments and string literals blanked, offsets preserved) and the
 * structural rules then run on the blanked text. All scanning is linear-time:
 * no regex here can backtrack super-linearly on hostile input.
 */
import * as fs from 'fs';
import * as path from 'path';
import { lexSource, LexLanguage } from '../utils/source-lexer';
import { analyzeJs } from './js-analysis';

export type SourceLanguage = 'javascript' | 'typescript' | LexLanguage;

export interface FnInfo {
  name: string;
  startLine: number;
  endLine: number;
  paramCount: number;
  returnCount: number;
}

export interface ClassInfo {
  name: string;
  line: number;
  methodCount: number;
  fieldCount: number;
}

export interface SourceAnalysis {
  language: SourceLanguage;
  /** Comments blanked, strings kept; same length as the input. */
  noComments: string;
  /** Only comment text kept; same length as the input. */
  comments: string;
  functions: FnInfo[];
  classes: ClassInfo[];
  emptyCatchLines: number[];
  unreachableLines: number[];
  unusedVariables: Array<{ name: string; line: number }>;
  magicNumbers: Array<{ value: string; line: number }>;
  /** Import specifiers; relative ones start with "." and bare ones are packages (or repo-root paths for Python). */
  imports: string[];
  /** File-level McCabe total: 1 plus every decision point. */
  cyclomatic: number;
  /** File-level cognitive complexity total. */
  cognitive: number;
}

/** Files larger than this are skipped: they are generated or minified, and analysis cost scales with size. */
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

const LANGUAGE_BY_EXT: Record<string, SourceLanguage> = {
  '.js': 'javascript',
  '.ts': 'typescript',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cs': 'csharp',
};

export function languageOf(file: string): SourceLanguage | undefined {
  return LANGUAGE_BY_EXT[path.extname(file).toLowerCase()];
}

/** Walk a repository (depth <= 5), skipping symlinks, with one bad entry never aborting its directory. */
export function findSourceFiles(root: string, skipDirs: string[], accept: (name: string) => boolean): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 5) {
      return;
    }
    let items: string[];
    try {
      items = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const item of items) {
      if (skipDirs.includes(item)) {
        continue;
      }
      const full = path.join(dir, item);
      try {
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) {
          continue;
        }
        if (stat.isDirectory()) {
          walk(full, depth + 1);
        } else if (stat.isFile() && stat.size <= MAX_SOURCE_BYTES && accept(item)) {
          files.push(full);
        }
      } catch {
        // Skip entries that vanish or cannot be read.
      }
    }
  };
  walk(root, 0);
  return files;
}

function emptyAnalysis(language: SourceLanguage, content: string): SourceAnalysis {
  return {
    language, noComments: content, comments: content.replace(/[^\r\n]/g, ' '), functions: [], classes: [],
    emptyCatchLines: [], unreachableLines: [], unusedVariables: [], magicNumbers: [], imports: [], cyclomatic: 1, cognitive: 0,
  };
}

/** Analyze one file. Never throws: a file that cannot be analyzed yields an empty analysis. */
export function analyzeSource(content: string, file: string): SourceAnalysis | undefined {
  const language = languageOf(file);
  if (!language) {
    return undefined;
  }
  try {
    if (language === 'javascript' || language === 'typescript') {
      return analyzeJs(content, file, language);
    }
    return analyzeGeneric(content, language);
  } catch {
    return emptyAnalysis(language, content);
  }
}

// ---------------------------------------------------------------------------
// Generic (non JS/TS) analysis on lexed text
// ---------------------------------------------------------------------------

interface Span extends FnInfo {
  /** Offset of the function name. */
  start: number;
  /** Body range in the code view (braces included for brace languages). */
  bodyStart: number;
  bodyEnd: number;
}

interface Ctx {
  language: LexLanguage;
  code: string;
  comments: string;
  noComments: string;
  lines: string[];
  lineStarts: number[];
  match: Int32Array;
  lineOf(offset: number): number;
  /** Remaining character budget for rescans of overlapping ranges (nested bodies), so nesting cannot go quadratic. */
  budget: number;
  rubyEnds?: Map<number, number>;
  pythonEnds?: Map<number, number>;
  /** 1 for lines that start inside a multiline string literal. */
  stringCont: Uint8Array;
  /** Anonymous function bodies (PHP closures, Go func literals): they own their `return`s but are never reported. */
  anon: Span[];
  /** Leading-whitespace width per line, or -1 for blank lines (computed once: deep indentation makes rescans costly). */
  indents: Int32Array;
}

const BRACE_LANGS = new Set<LexLanguage>(['go', 'java', 'php', 'c', 'cpp', 'csharp']);
const CALL_KEYWORDS = new Set([
  'if', 'for', 'foreach', 'while', 'switch', 'catch', 'return', 'new', 'else', 'elseif', 'sizeof', 'using', 'lock',
  'synchronized', 'fixed', 'typeof', 'when', 'do', 'try', 'throw', 'await', 'case', 'select', 'defer', 'go', 'in',
  'is', 'as', 'delegate', 'nameof', 'checked', 'unchecked', 'decltype', 'alignof', 'assert', 'static_assert',
  'function', 'func', 'and', 'or', 'not', 'defined', 'elif', 'except', 'with', 'print', 'echo', 'isset', 'unset',
  'empty', 'list', 'array', 'exit', 'die', 'catch_all', 'extends', 'implements', 'where', 'this', 'super', 'base',
]);

function isWordChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36;
}

function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) {
    i++;
  }
  return i;
}

function buildCtx(content: string, language: LexLanguage): Ctx {
  const lexed = lexSource(content, language);
  const code = lexed.code;
  const lines = code.split('\n');
  const lineStarts: number[] = [];
  let off = 0;
  for (const l of lines) {
    lineStarts.push(off);
    off += l.length + 1;
  }
  const match = new Int32Array(code.length).fill(-1);
  const braces: number[] = [];
  const parens: number[] = [];
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    const stack = c === 123 || c === 125 ? braces : c === 40 || c === 41 ? parens : null;
    if (!stack) {
      continue;
    }
    if (c === 123 || c === 40) {
      stack.push(i);
    } else if (stack.length > 0) {
      const open = stack.pop() as number;
      match[open] = i;
      match[i] = open;
    }
  }
  const indents = new Int32Array(lines.length);
  lines.forEach((l, i) => {
    const w = indentOf(l);
    indents[i] = l.slice(w).trim() === '' ? -1 : w;
  });
  const stringCont = new Uint8Array(lines.length);
  let nextLine = 0;
  for (const nl of lexed.stringNewlines) {
    while (nextLine < lines.length && lineStarts[nextLine] <= nl) {
      nextLine++;
    }
    if (nextLine < lines.length) {
      stringCont[nextLine] = 1;
    }
  }
  if (language === 'python') {
    // Lines inside open brackets are implicit continuations: like string lines, their indentation never ends a block.
    let depth = 0;
    let line = 0;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
      } else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) {
        depth--;
      } else if (ch === '\n') {
        line++;
        if (depth > 0 && line < lines.length) {
          stringCont[line] = 1;
        }
      }
    }
  }
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo + 1;
  };
  return { language, code, comments: lexed.comments, noComments: lexed.noComments, lines, lineStarts, match, lineOf, indents, stringCont, anon: [], budget: 8 * code.length + 100000 };
}

/** Split a parameter list on top-level commas, so "a, Map<K, V> b" is two parameters. */
function countParams(list: string, language: LexLanguage): number {
  let depth = 0;
  let count = 0;
  let fragStart = 0;
  const angle = language === 'java' || language === 'csharp' || language === 'cpp';
  const flush = (end: number): void => {
    const frag = list.slice(fragStart, end).trim();
    // Python's `/` and bare `*` only separate parameter kinds.
    if (frag !== '' && !(language === 'python' && (frag === '/' || frag === '*'))) {
      count++;
    }
    fragStart = end + 1;
  };
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '(' || ch === '[' || ch === '{' || (angle && ch === '<')) {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}' || (angle && ch === '>' && list[i - 1] !== '-' && list[i - 1] !== '=')) {
      depth = Math.max(0, depth - 1);
    } else if (ch === ',' && depth === 0) {
      flush(i);
    }
  }
  flush(list.length);
  return count;
}

function paramCountOf(list: string, language: LexLanguage): number {
  const trimmed = list.trim();
  if (trimmed === '' || trimmed === 'void') {
    return 0;
  }
  let n = countParams(trimmed, language);
  if (language === 'python' || language === 'ruby') {
    const first = trimmed.split(',')[0].trim();
    if (language === 'python' && (first === 'self' || first === 'cls')) {
      n--;
    }
  }
  return Math.max(0, n);
}

function bodyAfterSignature(ctx: Ctx, from: number, limit = 160): number {
  const end = Math.min(ctx.code.length, from + limit);
  for (let i = from; i < end; i++) {
    const c = ctx.code.charCodeAt(i);
    if (c === 123) {
      return i;
    }
    if (c === 59 || c === 125 || c === 61) {
      return -1;
    }
  }
  return -1;
}

function braceFunctions(ctx: Ctx): Span[] {
  const { code, match, language } = ctx;
  const out: Span[] = [];
  let lastSigEnd = -1;
  const accept = (nameStart: number, name: string, open: number): void => {
    const close = match[open];
    if (close === -1 || nameStart < lastSigEnd) {
      return;
    }
    const body = bodyAfterSignature(ctx, close + 1);
    if (body === -1 || match[body] === -1) {
      return;
    }
    lastSigEnd = body;
    out.push({
      name,
      start: nameStart,
      startLine: ctx.lineOf(nameStart),
      endLine: ctx.lineOf(match[body]),
      paramCount: paramCountOf(code.slice(open + 1, close), language),
      returnCount: 0,
      bodyStart: body,
      bodyEnd: match[body],
    });
  };

  const acceptAnon = (open: number): void => {
    const close = match[open];
    if (close === -1) {
      return;
    }
    let j = close + 1;
    if (language === 'go') {
      // `func(f func() error) {` : an unmatched `)` before the body means this `func` is a parameter type.
      for (let k = j, depth = 0; k < code.length && k < j + 160 && code[k] !== '{'; k++) {
        if (code[k] === '(') {
          depth++;
        } else if (code[k] === ')' && depth-- === 0) {
          return;
        }
      }
    }
    if (language === 'php') {
      while (j < code.length && /\s/.test(code[j])) {
        j++;
      }
      if (code.startsWith('use', j) && !isWordChar(code.charCodeAt(j + 3))) {
        j += 3;
        while (j < code.length && /\s/.test(code[j])) {
          j++;
        }
        if (code[j] === '(' && match[j] !== -1) {
          j = match[j] + 1;
        }
      }
    }
    const body = bodyAfterSignature(ctx, j);
    if (body !== -1 && match[body] !== -1) {
      ctx.anon.push({ name: '', start: open, startLine: ctx.lineOf(open), endLine: ctx.lineOf(match[body]), paramCount: 0, returnCount: 0, bodyStart: body, bodyEnd: match[body] });
    }
  };

  if (language === 'go' || language === 'php') {
    const keyword = language === 'go' ? /\bfunc\b/g : /\bfunction\b/g;
    let m: RegExpExecArray | null;
    while ((m = keyword.exec(code)) !== null) {
      let i = m.index + m[0].length;
      const skipWs = () => {
        while (i < code.length && /\s/.test(code[i])) {
          i++;
        }
      };
      skipWs();
      if (language === 'php' && code[i] === '&') {
        i++;
        skipWs();
      }
      if (language === 'php' && code[i] === '(') {
        acceptAnon(i);
        continue;
      }
      let paramsOpen = -1;
      if (language === 'go' && code[i] === '(') {
        if (match[i] === -1) {
          continue;
        }
        paramsOpen = i;
        i = match[i] + 1;
        skipWs();
      }
      const nameStart = i;
      while (i < code.length && isWordChar(code.charCodeAt(i))) {
        i++;
      }
      if (i === nameStart) {
        if (paramsOpen !== -1) {
          acceptAnon(paramsOpen);
        }
        continue;
      }
      const name = code.slice(nameStart, i);
      skipWs();
      if (language === 'go' && code[i] === '[') {
        const rel = code.slice(i, i + 120).indexOf(']');
        if (rel === -1) {
          continue;
        }
        i += rel + 1;
        skipWs();
      }
      if (code[i] === '(') {
        accept(nameStart, name, i);
      } else if (paramsOpen !== -1) {
        acceptAnon(paramsOpen);
      }
    }
    return out;
  }

  let p = code.indexOf('(');
  while (p !== -1) {
    let j = p;
    while (j > 0 && (code[j - 1] === ' ' || code[j - 1] === '\t')) {
      j--;
    }
    let s = j;
    while (s > 0 && isWordChar(code.charCodeAt(s - 1))) {
      s--;
    }
    const name = code.slice(s, j);
    if (name && !CALL_KEYWORDS.has(name) && !/^\d/.test(name) && match[p] !== -1) {
      let q = s;
      while (q > 0 && /\s/.test(code[q - 1])) {
        q--;
      }
      const before = q > 0 ? code[q - 1] : '';
      let w = q;
      while (w > 0 && isWordChar(code.charCodeAt(w - 1))) {
        w--;
      }
      const prevWord = code.slice(w, q);
      // A declared name never follows `(`, `,`, `!`, `=`, `|`, `?` or `&&`: those are calls inside a condition or expression.
      const inExpression = (before !== '' && '(,!=|?'.includes(before)) || (before === '&' && code[q - 2] === '&');
      if (!inExpression && before !== '@' && before !== '[' && before !== '.' && prevWord !== 'new' && prevWord !== 'else' &&
          prevWord !== 'return' && prevWord !== 'throw' && !(before === '>' && code[q - 2] === '-')) {
        accept(s, name, p);
      }
    }
    p = code.indexOf('(', p + 1);
  }
  return out;
}

// The endless `=` follows a parameter list or whitespace; a setter name such as `value=(v)` is not an endless definition.
const RUBY_ENDLESS = /^def\s+[\w.?!]+(?:\([^)]*\)\s*|\s+)=(?![=~>])/;

/** Match every Ruby block opener to its `end` in one pass; an opener with no `end` runs to the last line. */
function rubyEnd(ctx: Ctx, startLineIdx: number): number {
  if (!ctx.rubyEnds) {
    const ends = new Map<number, number>();
    const stack: number[] = [];
    ctx.lines.forEach((raw, i) => {
      const t = raw.trim();
      if (/^(?:if|unless|while|until|case|begin|for|class|module)\b/.test(t) || (/^def\b/.test(t) && !RUBY_ENDLESS.test(t))) {
        stack.push(i);
      }
      if (!/^(?:while|until|for)\b/.test(t) && /\bdo(?:\s*\|[^|]*\|)?$/.test(t)) {
        stack.push(i);
      }
      if (/^end\b/.test(t) || (/\bend$/.test(t) && !/^def\b.*=/.test(t))) {
        const opener = stack.pop();
        if (opener !== undefined) {
          ends.set(opener, i);
        }
      }
    });
    ctx.rubyEnds = ends;
  }
  return ctx.rubyEnds.get(startLineIdx) ?? ctx.lines.length - 1;
}

/**
 * End line of every Python def and class in one pass: a stack of open headers, closed by the first real dedent. Lines that
 * start inside a multiline string are body, never a dedent. Keyed by the header's last signature line.
 */
function pythonEnds(ctx: Ctx): Map<number, number> {
  const heads: Array<{ sigEnd: number; indent: number }> = [];
  const re = /^([ \t]*)(?:(?:async[ \t]+)?def[ \t]+\w+[ \t]*\(|class[ \t]+\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ctx.code)) !== null) {
    if (m[0].endsWith('(')) {
      const close = ctx.match[m.index + m[0].length - 1];
      if (close !== -1) {
        heads.push({ sigEnd: ctx.lineOf(close) - 1, indent: m[1].length });
      }
    } else {
      heads.push({ sigEnd: ctx.lineOf(m.index) - 1, indent: m[1].length });
    }
  }
  const ends = new Map<number, number>();
  const open: Array<{ sigEnd: number; indent: number }> = [];
  let last = 0;
  let h = 0;
  for (let i = 0; i < ctx.lines.length; i++) {
    const w = ctx.indents[i];
    if (w === -1 && !ctx.stringCont[i]) {
      continue;
    }
    if (!ctx.stringCont[i]) {
      while (open.length > 0 && open[open.length - 1].indent >= w) {
        const done = open.pop() as { sigEnd: number };
        ends.set(done.sigEnd, Math.max(done.sigEnd, last));
      }
    }
    while (h < heads.length && heads[h].sigEnd <= i) {
      open.push(heads[h++]);
    }
    last = i;
  }
  for (const done of open) {
    ends.set(done.sigEnd, Math.max(done.sigEnd, last));
  }
  return ends;
}

function indentFunctions(ctx: Ctx): Span[] {
  const { code, language } = ctx;
  const out: Span[] = [];
  const re = language === 'python'
    ? /^([ \t]*)(?:async[ \t]+)?def[ \t]+(\w+)[ \t]*\(/gm
    : /^([ \t]*)def[ \t]+(?:self\.)?([\w?!=]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const defLine = ctx.lineOf(m.index);
    const defIdx = defLine - 1;
    let paramText = '';
    let sigEndIdx = defIdx;
    if (language === 'python') {
      const open = m.index + m[0].length - 1;
      const close = ctx.match[open];
      if (close === -1) {
        continue;
      }
      paramText = code.slice(open + 1, close);
      sigEndIdx = ctx.lineOf(close) - 1;
    } else {
      const afterName = m.index + m[0].length;
      if (code[afterName] === '(' && ctx.match[afterName] !== -1) {
        paramText = code.slice(afterName + 1, ctx.match[afterName]);
        sigEndIdx = ctx.lineOf(ctx.match[afterName]) - 1;
      } else {
        const eol = code.indexOf('\n', afterName);
        paramText = code.slice(afterName, eol === -1 ? code.length : eol).replace(/=.*$/, '');
      }
    }
    let endIdx: number;
    if (language === 'python') {
      const rest = ctx.lines[sigEndIdx].slice(ctx.lines[sigEndIdx].lastIndexOf(':') + 1).trim();
      endIdx = rest !== '' ? sigEndIdx : (ctx.pythonEnds ??= pythonEnds(ctx)).get(sigEndIdx) ?? sigEndIdx;
    } else {
      endIdx = RUBY_ENDLESS.test(ctx.lines[defIdx].trim()) ? defIdx : rubyEnd(ctx, defIdx);
    }
    const bodyStart = ctx.lineStarts[Math.min(sigEndIdx + 1, ctx.lineStarts.length - 1)] ?? code.length;
    const bodyEnd = (ctx.lineStarts[endIdx] ?? 0) + (ctx.lines[endIdx]?.length ?? 0);
    out.push({
      name: m[2],
      start: m.index,
      startLine: defLine,
      endLine: endIdx + 1,
      paramCount: paramCountOf(paramText, language),
      returnCount: 0,
      bodyStart: endIdx === sigEndIdx ? ctx.lineStarts[sigEndIdx] : bodyStart,
      bodyEnd,
    });
  }
  return out;
}

/** Assign each ascending offset to the innermost span containing it. */
function innermost(offsets: number[], spans: Span[]): Array<Span | undefined> {
  const sorted = [...spans].sort((a, b) => a.bodyStart - b.bodyStart || b.bodyEnd - a.bodyEnd);
  const stack: Span[] = [];
  let next = 0;
  return offsets.map(off => {
    while (next < sorted.length && sorted[next].bodyStart <= off) {
      stack.push(sorted[next++]);
    }
    while (stack.length > 0 && stack[stack.length - 1].bodyEnd < off) {
      stack.pop();
    }
    return stack.length > 0 ? stack[stack.length - 1] : undefined;
  });
}

function countReturns(ctx: Ctx, spans: Span[]): void {
  const offsets: number[] = [];
  const re = /\breturn\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ctx.code)) !== null) {
    offsets.push(m.index);
  }
  innermost(offsets, ctx.anon.length > 0 ? [...spans, ...ctx.anon] : spans).forEach(span => {
    if (span) {
      span.returnCount++;
    }
  });
}

function classes(ctx: Ctx, spans: Span[]): ClassInfo[] {
  const { code, language } = ctx;
  const out: ClassInfo[] = [];
  const ranges: Array<{ info: ClassInfo; start: number; end: number; indent: number }> = [];

  if (language === 'python' || language === 'ruby') {
    const re = /^([ \t]*)class[ \t]+(\w+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const idx = ctx.lineOf(m.index) - 1;
      const endIdx = language === 'python' ? ((ctx.pythonEnds ??= pythonEnds(ctx)).get(idx) ?? idx) : rubyEnd(ctx, idx);
      ranges.push({
        info: { name: m[2], line: idx + 1, methodCount: 0, fieldCount: 0 },
        start: ctx.lineStarts[idx],
        end: (ctx.lineStarts[endIdx] ?? 0) + (ctx.lines[endIdx]?.length ?? 0),
        indent: m[1].length,
      });
    }
  } else {
    const re = /\bclass\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const before = code.slice(Math.max(0, m.index - 12), m.index).trimEnd();
      if (/(?:enum|<|,)$/.test(before)) {
        continue;
      }
      const body = bodyAfterSignature(ctx, m.index + m[0].length, 240);
      if (body === -1 || ctx.match[body] === -1) {
        continue;
      }
      ranges.push({
        info: { name: m[1], line: ctx.lineOf(m.index), methodCount: 0, fieldCount: 0 },
        start: body,
        end: ctx.match[body],
        indent: 0,
      });
    }
  }

  // Owner of each function: the innermost class range containing it (one sorted sweep, not a scan per function).
  const byStart = [...ranges].sort((x, y) => x.start - y.start);
  const owners = new Map<Span, (typeof ranges)[number]>();
  const open: Array<(typeof ranges)[number]> = [];
  let next = 0;
  for (const fn of [...spans].sort((x, y) => x.start - y.start)) {
    while (next < byStart.length && byStart[next].start < fn.start) {
      open.push(byStart[next++]);
    }
    while (open.length > 0 && open[open.length - 1].end < fn.start) {
      open.pop();
    }
    if (open.length > 0) {
      owners.set(fn, open[open.length - 1]);
    }
  }

  // A function nested inside another function of the same class is not a method.
  const isNestedIn = (fn: Span, owner: { start: number }) =>
    spans.length <= 3000 && spans.some(o => o !== fn && o.start > owner.start && o.start < fn.start && fn.start <= o.bodyEnd);
  for (const fn of spans) {
    const owner = owners.get(fn);
    if (owner && !isNestedIn(fn, owner)) {
      owner.info.methodCount++;
    }
  }

  for (const r of ranges) {
    const fields = new Set<string>();
    if ((language === 'python' || language === 'ruby') && (ctx.budget -= r.end - r.start) < 0) {
      // Nested classes rescan the same text; stop once the shared budget is spent.
    } else if (language === 'python') {
      const text = code.slice(r.start, r.end);
      for (const m of text.matchAll(/\bself\.(\w+)\s*(?::[^=\n]+)?=(?!=)/g)) {
        fields.add(m[1]);
      }
      for (const m of text.matchAll(/^([ \t]+)(\w+)[ \t]*(?::[^=\n]+)?=(?!=)/gm)) {
        if (m[1].length === r.indent + 4 || m[1].length === r.indent + 2 || m[1].length === r.indent + 1) {
          fields.add(m[2]);
        }
      }
    } else if (language === 'ruby') {
      const text = code.slice(r.start, r.end);
      for (const m of text.matchAll(/@(\w+)\s*(?:\|\||\+|-)?=(?!=)/g)) {
        fields.add(m[1]);
      }
      for (const m of text.matchAll(/^[ \t]*attr_(?:accessor|reader|writer)[ \t]+([^\n]+)/gm)) {
        for (const sym of m[1].matchAll(/:(\w+)/g)) {
          fields.add(sym[1]);
        }
      }
    } else {
      let i = r.start + 1;
      let segStart = i;
      while (i < r.end) {
        const c = code[i];
        if (c === '{' && ctx.match[i] !== -1) {
          i = ctx.match[i] + 1;
          segStart = i;
          continue;
        }
        if (c === '}') {
          segStart = i + 1;
        } else if (c === ';') {
          const seg = code.slice(segStart, i);
          const lhs = seg.split('=')[0];
          if (seg.trim() !== '' && !lhs.includes('(') && !/^\s*(?:using|typedef|return|import|friend|namespace|public:|private:|protected:)\b/.test(seg)) {
            fields.add(seg.trim());
          }
          segStart = i + 1;
        }
        i++;
      }
    }
    r.info.fieldCount = fields.size;
    out.push(r.info);
  }
  return out;
}

function tokenCounts(ctx: Ctx, from: number, to: number): Map<string, number> | undefined {
  if ((ctx.budget -= to - from) < 0) {
    return undefined;
  }
  const counts = new Map<string, number>();
  const re = ctx.language === 'php' ? /\$?[A-Za-z_]\w*/g : /[A-Za-z_]\w*/g;
  const text = ctx.code.slice(from, to);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    counts.set(m[0], (counts.get(m[0]) || 0) + 1);
  }
  return counts;
}

const DECL_NOT_TYPES = new Set(['return', 'else', 'throw', 'new', 'delete', 'case', 'goto', 'using', 'namespace', 'import', 'package', 'yield', 'await', 'typeof', 'echo', 'print']);

function unusedVariables(ctx: Ctx, spans: Span[]): Array<{ name: string; line: number }> {
  const { code, language } = ctx;
  let re: RegExp;
  switch (language) {
    case 'python':
      re = /^[ \t]*([A-Za-z_]\w*)[ \t]*(?::[^=\n]*)?=(?!=)/gm;
      break;
    case 'ruby':
      re = /^[ \t]*([a-z_]\w*)[ \t]*=(?![=~>])/gm;
      break;
    case 'php':
      re = /^[ \t]*(\$[A-Za-z_]\w*)[ \t]*=(?![=>])/gm;
      break;
    case 'go':
      re = /^[ \t]*([A-Za-z_]\w*(?:[ \t]*,[ \t]*[A-Za-z_]\w*)*)[ \t]*:=|^[ \t]*var[ \t]+([A-Za-z_]\w*)/gm;
      break;
    default:
      re = /^[ \t]*(?:(?:final|const|static|readonly|var|auto|unsigned|signed|long|short|volatile|struct)[ \t]+)*([\w.<>[\],?]+)(?:[ \t]*[*&]+)?[ \t]+(\w+)[ \t]*=(?!=)/gm;
  }
  const found: Array<{ offset: number; name: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (language === 'go') {
      const names = (m[1] ?? m[2]).split(',').map(s => s.trim());
      const at = m.index + m[0].indexOf(names[0]);
      names.forEach(n => found.push({ offset: at, name: n }));
    } else if (language === 'java' || language === 'csharp' || language === 'c' || language === 'cpp') {
      if (!DECL_NOT_TYPES.has(m[1])) {
        found.push({ offset: m.index, name: m[2] });
      }
    } else {
      found.push({ offset: m.index, name: m[1] });
    }
  }
  const owners = innermost(found.map(f => f.offset), spans);
  const cache = new Map<Span, Map<string, number>>();
  const seen = new Set<string>();
  const out: Array<{ name: string; line: number }> = [];
  found.forEach((f, idx) => {
    const owner = owners[idx];
    if (!owner || f.name === '_' || f.name.startsWith('_') || f.name === 'self') {
      return;
    }
    let counts = cache.get(owner);
    if (!counts) {
      counts = tokenCounts(ctx, owner.bodyStart, owner.bodyEnd);
      if (!counts) {
        return;
      }
      cache.set(owner, counts);
    }
    const line = ctx.lineOf(f.offset);
    const key = `${line}:${f.name}`;
    if ((counts.get(f.name) || 0) <= 1 && !seen.has(key)) {
      seen.add(key);
      out.push({ name: f.name, line });
    }
  });
  return out;
}

const LABEL_START = /^(?:case\b|default\b|else\b|elif\b|elsif\b|except\b|finally\b|rescue\b|ensure\b|when\b|end\b|catch\b|[})\]])/;

function unreachable(ctx: Ctx): number[] {
  const out: number[] = [];
  const { lines, language } = ctx;
  const stmt = /^[ \t]*(?:return|throw|raise|break|continue)\b/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!stmt.test(line)) {
      continue;
    }
    if (language === 'ruby' && /\b(?:if|unless|while|until)\b/.test(line)) {
      continue;
    }
    const indent = indentOf(line);
    let depth = 0;
    let end = i;
    for (let j = i; j < lines.length && j < i + 60; j++) {
      const l = lines[j];
      for (let k = 0; k < l.length; k++) {
        const c = l[k];
        depth += c === '(' || c === '[' || c === '{' ? 1 : c === ')' || c === ']' || c === '}' ? -1 : 0;
      }
      end = j;
      const trimmed = l.trimEnd();
      const continues = depth > 0 || /[,+\-*/&|\\=(]$/.test(trimmed);
      if (!continues) {
        break;
      }
    }
    let next = end + 1;
    while (next < lines.length && lines[next].trim() === '') {
      next++;
    }
    if (next >= lines.length) {
      continue;
    }
    const nextLine = lines[next];
    if (indentOf(nextLine) === indent && !LABEL_START.test(nextLine.trim()) && !/^\w+:\s*$/.test(nextLine.trim())) {
      out.push(next + 1);
    }
    i = Math.max(i, end);
  }
  return out;
}

function emptyCatches(ctx: Ctx): number[] {
  const out: number[] = [];
  const { code, lines, language } = ctx;
  const hasComment = (from: number, to: number) => /\S/.test(ctx.comments.slice(from, to));
  if (language === 'python') {
    for (let i = 0; i < lines.length; i++) {
      const m = /^([ \t]*)except\b[^\n]*?:(.*)/.exec(lines[i]);
      if (!m) {
        continue;
      }
      const isPass = (s: string) => /^(?:pass|\.\.\.)$/.test(s.trim());
      if (m[2].trim() !== '') {
        if (isPass(m[2]) && !hasComment(ctx.lineStarts[i], ctx.lineStarts[i] + lines[i].length)) {
          out.push(i + 1);
        }
        continue;
      }
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '' && !hasComment(ctx.lineStarts[j], ctx.lineStarts[j] + lines[j].length)) {
        j++;
      }
      if (j < lines.length && indentOf(lines[j]) > m[1].length && isPass(lines[j])) {
        let k = j + 1;
        while (k < lines.length && lines[k].trim() === '') {
          k++;
        }
        const bodyEnd = ctx.lineStarts[j] + lines[j].length;
        // Comments after `pass` count while they stay indented inside the handler suite.
        let trailing = false;
        for (let t = j + 1; t < k && !trailing; t++) {
          trailing = hasComment(ctx.lineStarts[t], ctx.lineStarts[t] + lines[t].length) && indentOf(ctx.comments.slice(ctx.lineStarts[t], ctx.lineStarts[t] + lines[t].length)) > m[1].length;
        }
        if ((k >= lines.length || indentOf(lines[k]) <= m[1].length) && !trailing && !hasComment(ctx.lineStarts[i], bodyEnd)) {
          out.push(i + 1);
        }
      }
    }
    return out;
  }
  if (language === 'ruby') {
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*rescue\b/.test(lines[i]) || /\brescue\b.*\bthen\b\s*\S/.test(lines[i])) {
        continue;
      }
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '' && !hasComment(ctx.lineStarts[j], ctx.lineStarts[j] + lines[j].length)) {
        j++;
      }
      if (j < lines.length && /^\s*(?:end|rescue|ensure|else)\b/.test(lines[j]) &&
          !hasComment(ctx.lineStarts[i], ctx.lineStarts[j])) {
        out.push(i + 1);
      }
    }
    return out;
  }
  if (language === 'go' || language === 'c') {
    return out;
  }
  const re = /\bcatch\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    let i = m.index + 5;
    while (i < code.length && /\s/.test(code[i])) {
      i++;
    }
    if (code[i] === '(') {
      if (ctx.match[i] === -1 || ctx.match[i] - i > 200) {
        continue;
      }
      i = ctx.match[i] + 1;
      while (i < code.length && /\s/.test(code[i])) {
        i++;
      }
    }
    if (language === 'csharp' && code.startsWith('when', i) && !isWordChar(code.charCodeAt(i + 4))) {
      i += 4;
      while (i < code.length && /\s/.test(code[i])) {
        i++;
      }
      if (code[i] !== '(' || ctx.match[i] === -1) {
        continue;
      }
      i = ctx.match[i] + 1;
      while (i < code.length && /\s/.test(code[i])) {
        i++;
      }
    }
    if (code[i] !== '{' || ctx.match[i] === -1) {
      continue;
    }
    const close = ctx.match[i];
    if (code.slice(i + 1, close).trim() === '' && !hasComment(i + 1, close)) {
      out.push(ctx.lineOf(m.index));
    }
  }
  return out;
}

function magicNumbers(ctx: Ctx): Array<{ value: string; line: number }> {
  const out: Array<{ value: string; line: number }> = [];
  const re = /(?<![\w.$])(\d[\d_]*(?:\.\d+)?)(?![\w.])/g;
  const skipLine = /\b(?:const|final|readonly|static|constexpr|define|enum)\b|^\s*#/;
  const safe = new Set(['0', '1', '100', '1000']);
  ctx.lines.forEach((line, idx) => {
    if (!/\d/.test(line) || skipLine.test(line) || /^\s*[A-Z][A-Z0-9_]*\s*(?::[^=]+)?=/.test(line)) {
      return;
    }
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      const raw = m[1];
      const isMagic = (/^\d[\d_]*$/.test(raw) && raw.replace(/_/g, '').length >= 2) || /^\d+\.\d+$/.test(raw);
      if (isMagic && !safe.has(raw)) {
        out.push({ value: raw, line: idx + 1 });
      }
    }
  });
  return out;
}

function importsOf(ctx: Ctx): string[] {
  const { noComments, code, language } = ctx;
  const out: string[] = [];
  const add = (re: RegExp, map: (m: RegExpExecArray) => string | string[] | undefined) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(noComments)) !== null) {
      // The keyword must be real code: strings are blanked in the code view, so a docstring that mentions an import is skipped.
      const kw = m.index + (m[0].length - m[0].trimStart().length);
      const v = code.charCodeAt(kw) === 32 ? undefined : map(m);
      if (v) {
        out.push(...(Array.isArray(v) ? v : [v]));
      }
    }
  };
  if (language === 'python') {
    add(/^[ \t]*(?:from[ \t]+([\w.]+)[ \t]+import\b([^\n]*)|import[ \t]+([\w.]+))/gm, m => {
      const mod = m[1] ?? m[3];
      const dots = /^\.*/.exec(mod)?.[0].length ?? 0;
      const rest = mod.slice(dots).replace(/\./g, '/');
      // Absolute imports (`import os`) have no dots and no prefix; `repeat(-1)` would throw and blank the file's analysis.
      const prefix = dots === 0 ? '' : dots === 1 ? './' : '../'.repeat(dots - 1);
      if (dots > 0 && rest === '' && m[2]) {
        // `from . import b` imports the sibling module b, not the package itself.
        const names = m[2].replace(/[()]/g, '').split(',').map(n => n.trim().split(/\s+/)[0]).filter(n => /^\w+$/.test(n));
        if (names.length > 0) {
          return names.map(n => prefix + n);
        }
      }
      return dots === 0 ? rest : `${prefix}${rest}`;
    });
  } else if (language === 'ruby') {
    add(/^[ \t]*require_relative[ \t]*\(?[ \t]*['"]([^'"\n]+)['"]/gm, m => (m[1].startsWith('.') ? m[1] : `./${m[1]}`));
  } else if (language === 'php') {
    add(/\b(?:require|include)(?:_once)?[ \t]*\(?[ \t]*['"]([^'"\n]+)['"]/g, m => (m[1].startsWith('.') ? m[1] : `./${m[1]}`));
  }
  return out;
}

/**
 * Count `?:` ternaries in C-family code regardless of spacing. A `?` counts only when a `:` closes it in the
 * same statement at the same bracket depth, so `?.`, `??`, `?[` (C#), `?>`, `<?`, `?->`, generic wildcards and
 * nullable types add nothing. One pass; the pending-`?` stack per bracket frame keeps it linear.
 */
function countTernaries(code: string, language: LexLanguage): number {
  const frames: number[] = [0];
  let count = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') {
      if (c === '{') {
        let b = i - 1;
        while (b >= 0 && (code[b] === ' ' || code[b] === '\t' || code[b] === '\n' || code[b] === '\r')) {
          b--;
        }
        if (code[b] === ')') {
          frames[frames.length - 1] = 0;
        }
      }
      frames.push(0);
    } else if (c === ')' || c === ']' || c === '}') {
      if (frames.length > 1) {
        frames.pop();
      }
      if (c === '}') {
        frames[frames.length - 1] = 0;
      }
    } else if (c === ';') {
      frames[frames.length - 1] = 0;
    } else if (c === '?') {
      const next = code[i + 1];
      if (next === '?') {
        i++;
        if (code[i + 1] === '=') {
          i++;
        }
      } else if (next === '.' || next === '>' || (next === '[' && language === 'csharp') ||
                 (next === '-' && code[i + 2] === '>') || code[i - 1] === '<') {
        continue;
      } else {
        frames[frames.length - 1]++;
      }
    } else if (c === ':') {
      if (code[i + 1] === ':') {
        i++;
      } else if (frames[frames.length - 1] > 0) {
        frames[frames.length - 1]--;
        count++;
      }
    }
  }
  return count;
}

function cyclomaticOf(ctx: Ctx): number {
  const { code, language } = ctx;
  let re: RegExp;
  const guard = '(?<![#.$@\\w])';
  if (language === 'python') {
    re = new RegExp(`${guard}(?:if|elif|for|while|except|case|and|or)\\b`, 'g');
  } else if (language === 'ruby') {
    re = new RegExp(`${guard}(?:if|elsif|unless|while|until|for|when|rescue|and|or)\\b|&&|\\|\\||\\s\\?\\s`, 'g');
  } else if (language === 'go') {
    re = new RegExp(`${guard}(?:if|for|case)\\b|&&|\\|\\|`, 'g');
  } else {
    re = new RegExp(`${guard}(?:if|for|foreach|while|case|catch|elseif)\\b|&&|\\|\\|`, 'g');
  }
  const matches = code.match(re);
  return 1 + (matches ? matches.length : 0) + (language === 'ruby' || language === 'python' || language === 'go' ? 0 : countTernaries(code, language));
}

function cognitiveOf(ctx: Ctx): number {
  const { lines, language } = ctx;
  let total = 0;
  const logical = language === 'python' || language === 'ruby' || language === 'php' ? /&&|\|\||\band\b|\bor\b/g : /&&|\|\|/g;
  const sequences = (line: string): number => {
    let prev = '';
    let n = 0;
    for (const m of line.matchAll(logical)) {
      const op = m[0] === 'and' ? '&&' : m[0] === 'or' ? '||' : m[0];
      if (op !== prev) {
        n++;
      }
      prev = op;
    }
    return n;
  };

  if (language === 'python' || language === 'ruby') {
    const stack: number[] = [];
    const control = /^[ \t]*(if|elif|elsif|else|for|while|until|unless|case|when|except|rescue|try|with|finally)\b/;
    for (const line of lines) {
      if (line.trim() === '') {
        continue;
      }
      const ind = indentOf(line);
      while (stack.length > 0 && stack[stack.length - 1] >= ind) {
        stack.pop();
      }
      const m = control.exec(line);
      if (m) {
        const kw = m[1];
        if (kw === 'elif' || kw === 'elsif' || kw === 'else') {
          total += 1;
          stack.push(ind);
        } else if (kw === 'case') {
          total += 1 + stack.length;
        } else if (kw !== 'when' && kw !== 'try' && kw !== 'with' && kw !== 'finally') {
          total += 1 + stack.length;
          stack.push(ind);
        }
      }
      total += sequences(line);
    }
    return total;
  }

  const stack: boolean[] = [];
  let nest = 0;
  let pending = false;
  const control = /(?<![#.\w$@])(else\s+if|elseif|else|if|for|foreach|while|switch|catch)\b/g;
  for (const line of lines) {
    let rest = line;
    let lead = /^\s*/.exec(rest)?.[0].length ?? 0;
    while (rest[lead] === '}') {
      if (stack.length > 0 && stack.pop()) {
        nest--;
      }
      lead++;
      while (rest[lead] === ' ' || rest[lead] === '\t') {
        lead++;
      }
    }
    rest = rest.slice(lead);
    for (const m of rest.matchAll(control)) {
      pending = true;
      total += m[1].startsWith('else') ? 1 : 1 + nest;
    }
    total += sequences(rest);
    for (const ch of rest) {
      if (ch === '{') {
        stack.push(pending);
        if (pending) {
          nest++;
        }
        pending = false;
      } else if (ch === '}') {
        if (stack.length > 0 && stack.pop()) {
          nest--;
        }
      } else if (ch === ';') {
        pending = false;
      }
    }
  }
  return total;
}

function analyzeGeneric(content: string, language: LexLanguage): SourceAnalysis {
  const ctx = buildCtx(content, language);
  const spans = BRACE_LANGS.has(language) ? braceFunctions(ctx) : indentFunctions(ctx);
  countReturns(ctx, spans);
  return {
    language,
    noComments: ctx.noComments,
    comments: ctx.comments,
    functions: spans.map(s => ({ name: s.name, startLine: s.startLine, endLine: s.endLine, paramCount: s.paramCount, returnCount: s.returnCount })),
    classes: classes(ctx, spans),
    emptyCatchLines: emptyCatches(ctx),
    unreachableLines: unreachable(ctx),
    unusedVariables: unusedVariables(ctx, spans),
    magicNumbers: magicNumbers(ctx),
    imports: importsOf(ctx),
    cyclomatic: cyclomaticOf(ctx),
    cognitive: Math.round(cognitiveOf(ctx)),
  };
}

/**
 * Linear-time lexer that separates comments and string literals from code.
 *
 * Every returned view has exactly the same length as the input, with newlines
 * kept in place, so offsets and line numbers map one to one. These tools scan
 * untrusted repositories, so this is a hand-written character loop: each
 * character is visited a bounded number of times and there is no regex
 * backtracking on file contents.
 */

export type LexLanguage = 'python' | 'go' | 'java' | 'ruby' | 'php' | 'c' | 'cpp' | 'csharp';

export interface LexedSource {
  /** Comments and string interiors blanked (quote delimiters kept). */
  code: string;
  /** Only comment text kept, everything else blanked. */
  comments: string;
  /** Comments blanked, strings kept as written. */
  noComments: string;
  /** Offsets of newlines inside string literals: the line after each one starts inside the string. */
  stringNewlines: number[];
}

type Interpolation = 'python-f' | 'ruby' | 'csharp' | 'php';

interface Spec {
  line: string[];
  block: Array<[string, string]>;
  /** Single-line quote characters (a newline ends an unterminated string). */
  quotes: string;
  /** Multi-line triple quote delimiters. */
  triples: string[];
  /** Multi-line raw string delimiter with no escapes (Go backtick). */
  raw: string[];
  rubyBlockComments?: boolean;
}

const C_BLOCK: Array<[string, string]> = [['/*', '*/']];

const SPECS: Record<LexLanguage, Spec> = {
  python: { line: ['#'], block: [], quotes: '"\'', triples: ['"""', "'''"], raw: [] },
  go: { line: ['//'], block: C_BLOCK, quotes: '"\'', triples: [], raw: ['`'] },
  java: { line: ['//'], block: C_BLOCK, quotes: '"\'', triples: ['"""'], raw: [] },
  ruby: { line: ['#'], block: [], quotes: '"\'', triples: [], raw: [], rubyBlockComments: true },
  php: { line: ['//', '#'], block: C_BLOCK, quotes: '"\'', triples: [], raw: [] },
  c: { line: ['//'], block: C_BLOCK, quotes: '"\'', triples: [], raw: [] },
  cpp: { line: ['//'], block: C_BLOCK, quotes: '"\'', triples: [], raw: [] },
  csharp: { line: ['//'], block: C_BLOCK, quotes: '"\'', triples: ['"""'], raw: [] },
};

export function blank(text: string): string {
  return text.replace(/[^\r\n]/g, ' ');
}

/** Blank a string body but keep interpolated expressions so identifiers inside them still count as uses. */
function keepInterpolation(body: string, mode: Interpolation): string {
  const out: string[] = [];
  const opener = mode === 'ruby' ? '#{' : '{';
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (mode === 'php') {
      let j = i + 1;
      if (ch === '$' && /[A-Za-z_]/.test(body[j] || '')) {
        while (j < body.length && /\w/.test(body[j])) {
          j++;
        }
        out.push(body.slice(i, j));
        i = j;
        continue;
      }
    } else if (body.startsWith(opener, i)) {
      if (mode !== 'ruby' && body[i + 1] === '{') {
        out.push('  ');
        i += 2;
        continue;
      }
      let depth = 1;
      let j = i + opener.length;
      while (j < body.length && depth > 0) {
        depth += body[j] === '{' ? 1 : body[j] === '}' ? -1 : 0;
        j++;
      }
      const innerEnd = depth === 0 ? j - 1 : j;
      out.push(' '.repeat(opener.length), body.slice(i + opener.length, innerEnd), depth === 0 ? ' ' : '');
      i = j;
      continue;
    }
    out.push(ch === '\n' || ch === '\r' ? ch : ' ');
    i++;
  }
  return out.join('');
}

export function lexSource(content: string, language: LexLanguage): LexedSource {
  const spec = SPECS[language];
  const n = content.length;
  const code: string[] = [];
  const comments: string[] = [];
  const noComments: string[] = [];
  const stringNewlines: number[] = [];

  let plainStart = 0;
  const flushPlain = (end: number) => {
    if (end > plainStart) {
      const text = content.slice(plainStart, end);
      code.push(text);
      noComments.push(text);
      comments.push(blank(text));
    }
  };
  const addComment = (start: number, end: number) => {
    const text = content.slice(start, end);
    code.push(blank(text));
    noComments.push(blank(text));
    comments.push(text);
  };
  const addString = (start: number, end: number, bodyStart: number, bodyEnd: number, interpolation?: Interpolation) => {
    const text = content.slice(start, end);
    const body = content.slice(bodyStart, bodyEnd);
    for (let nl = text.indexOf('\n'); nl !== -1; nl = text.indexOf('\n', nl + 1)) {
      stringNewlines.push(start + nl);
    }
    const kept = interpolation ? keepInterpolation(body, interpolation) : blank(body);
    code.push(content.slice(start, bodyStart), kept, content.slice(bodyEnd, end));
    noComments.push(text);
    comments.push(blank(text));
  };

  let i = 0;
  let atLineStart = true;
  while (i < n) {
    const ch = content[i];

    if (ch === '\n') {
      atLineStart = true;
      i++;
      continue;
    }
    const wasLineStart = atLineStart;
    if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
      atLineStart = false;
    }

    if (spec.rubyBlockComments && wasLineStart && content.startsWith('=begin', i)) {
      flushPlain(i);
      const endIdx = content.indexOf('\n=end', i);
      let end = n;
      if (endIdx !== -1) {
        const eol = content.indexOf('\n', endIdx + 1);
        end = eol === -1 ? n : eol;
      }
      addComment(i, end);
      i = plainStart = end;
      continue;
    }

    const lineTok = spec.line.find(tok => content.startsWith(tok, i));
    // `#[` starts a PHP attribute and `#{` is Ruby interpolation inside a regex, heredoc or %Q string.
    const notComment = lineTok === '#' && ((language === 'php' && content[i + 1] === '[') || (language === 'ruby' && content[i + 1] === '{'));
    if (lineTok && !notComment) {
      flushPlain(i);
      const eol = content.indexOf('\n', i);
      const end = eol === -1 ? n : eol;
      addComment(i, end);
      i = plainStart = end;
      continue;
    }

    const blockTok = spec.block.find(([open]) => content.startsWith(open, i));
    if (blockTok) {
      flushPlain(i);
      const close = content.indexOf(blockTok[1], i + blockTok[0].length);
      const end = close === -1 ? n : close + blockTok[1].length;
      addComment(i, end);
      i = plainStart = end;
      continue;
    }

    const rawTok = spec.raw.find(tok => content.startsWith(tok, i));
    if (rawTok) {
      flushPlain(i);
      const close = content.indexOf(rawTok, i + rawTok.length);
      const end = close === -1 ? n : close + rawTok.length;
      addString(i, end, i + rawTok.length, close === -1 ? end : close, undefined);
      i = plainStart = end;
      continue;
    }

    const tripleTok = spec.triples.find(tok => content.startsWith(tok, i));
    if (tripleTok) {
      flushPlain(i);
      let j = i + 3;
      while (j < n && !content.startsWith(tripleTok, j)) {
        j += content[j] === '\\' ? 2 : 1;
      }
      const end = j >= n ? n : j + 3;
      addString(i, end, i + 3, j >= n ? n : j, interpolationFor(content, i, '"', language));
      i = plainStart = end;
      continue;
    }

    if (spec.quotes.includes(ch) && !isCppDigitSeparator(content, i, language)) {
      flushPlain(i);
      const verbatim = language === 'csharp' && ch === '"' && content[i - 1] === '@';
      let j = i + 1;
      while (j < n) {
        const c = content[j];
        if (verbatim) {
          if (c === '"') {
            if (content[j + 1] === '"') {
              j += 2;
              continue;
            }
            break;
          }
          j++;
        } else {
          if (c === '\\') {
            j += 2;
            continue;
          }
          // PHP quoted strings may span lines; elsewhere a newline ends an unterminated literal.
          if (c === ch || (c === '\n' && language !== 'php')) {
            break;
          }
          j++;
        }
      }
      const closed = j < n && content[j] === ch;
      const bodyEnd = Math.min(j, n);
      const end = closed ? j + 1 : bodyEnd;
      addString(i, end, i + 1, bodyEnd, interpolationFor(content, i, ch, language));
      i = plainStart = end;
      continue;
    }

    i++;
  }
  flushPlain(n);

  return { code: code.join(''), comments: comments.join(''), noComments: noComments.join(''), stringNewlines };
}

function isCppDigitSeparator(content: string, i: number, language: LexLanguage): boolean {
  return (language === 'c' || language === 'cpp') && content[i] === "'" && /[0-9a-fA-F]/.test(content[i - 1] || '');
}

function interpolationFor(content: string, i: number, quote: string, language: LexLanguage): Interpolation | undefined {
  if (language === 'python') {
    const prefix = content.slice(Math.max(0, i - 2), i).toLowerCase();
    return /f$|f[rb]$|[rb]f$/.test(prefix) ? 'python-f' : undefined;
  }
  if (quote !== '"') {
    return undefined;
  }
  if (language === 'php' || language === 'ruby') {
    return language;
  }
  if (language === 'csharp' && (content[i - 1] === '$' || (content[i - 1] === '@' && content[i - 2] === '$'))) {
    return 'csharp';
  }
  return undefined;
}

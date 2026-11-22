import * as path from 'path';
import { GuardScanError } from '../utils/error-handler';
import { Finding } from '../utils/reporter';

/** A line-check finding. Descriptions are fixed per rule: a flagged line can hold a secret, so its text is never copied. */
export interface StagedLintFinding extends Finding {
  ruleId: string;
  line: number;
}

type Language = 'js' | 'python' | 'ruby' | 'php' | 'go' | 'java';

interface Rule {
  ruleId: string;
  severity: Finding['severity'];
  category: string;
  description: string;
  suggestion: string;
}

interface CodeRule extends Rule {
  patterns: Partial<Record<Language, readonly RegExp[]>>;
}

const LANGUAGES: Readonly<Record<string, Language>> = {
  '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'js', '.tsx': 'js', '.mts': 'js', '.cts': 'js',
  '.py': 'python', '.rb': 'ruby', '.php': 'php', '.go': 'go', '.java': 'java',
};

const C_FULL_LINE_COMMENT = /^\s*(?:\/\/|\/\*|\*(?:\s|\/|$))/;
const FULL_LINE_COMMENT: Readonly<Record<Language, RegExp>> = {
  js: C_FULL_LINE_COMMENT, go: C_FULL_LINE_COMMENT, java: C_FULL_LINE_COMMENT,
  python: /^\s*#/, ruby: /^\s*#/,
  // `#[` opens a PHP 8 attribute, not a comment.
  php: /^\s*(?:\/\/|\/\*|\*(?:\s|\/|$)|#(?!\[))/,
};
// A comment opening before a TODO marker; `://` in a URL does not open one.
const C_COMMENT_OPENING = /(?:^|[^:])\/\/|\/\*|^\s*\*/;
const COMMENT_OPENING: Readonly<Record<Language, RegExp>> = {
  js: C_COMMENT_OPENING, go: C_COMMENT_OPENING, java: C_COMMENT_OPENING,
  python: /#/, ruby: /#/, php: /(?:^|[^:])\/\/|\/\*|^\s*\*|#/,
};

const CONFLICT_BOUNDARY = /^(?:<{7}|>{7}) /;
const CONFLICT_SEPARATOR = /^={7}$/;
// Only the last character matters; `[ \t]+$` backtracks quadratically on long space runs.
const TRAILING_WHITESPACE = /[ \t]$/;
const TODO_MARKER = /\b(?:TODO|FIXME|XXX)\b/;
// shortcut: longer lines (usually minified or generated) skip the code rules; raise the cap if real code needs it.
const MAX_CODE_LINE_CHARS = 4096;

const CONFLICT_MARKER: Rule = {
  ruleId: 'guardscan.lint.merge-conflict-marker',
  severity: 'high',
  category: 'Lint: Merge Conflict Marker',
  description: 'Merge conflict marker on a line this commit adds.',
  suggestion: 'Resolve the conflict and remove the marker lines before committing.',
};
const TRAILING_SPACE: Rule = {
  ruleId: 'guardscan.lint.trailing-whitespace',
  severity: 'info',
  category: 'Lint: Trailing Whitespace',
  description: 'Trailing whitespace on a line this commit adds.',
  suggestion: 'Remove the spaces or tabs at the end of the line.',
};
const TODO_COMMENT: Rule = {
  ruleId: 'guardscan.lint.todo-comment',
  severity: 'info',
  category: 'Lint: TODO Comment',
  description: 'TODO, FIXME, or XXX comment on a line this commit adds.',
  suggestion: 'Finish the work, or track it in an issue and reference the issue in the comment.',
};

// An upper-case SQL statement opening a string literal; requiring the second keyword keeps prose such as "DELETE " out.
const SQL_DQ = String.raw`"\s*(?:SELECT\s[^"]*?\bFROM|INSERT\s+INTO|UPDATE\s[^"]*?\bSET|DELETE\s+FROM)\b[^"]*`;
const SQL_SQ = SQL_DQ.replace(/"/g, "'");
const SQL_BT = SQL_DQ.replace(/"/g, '`');
const SQL_LITERAL = String.raw`(?:${SQL_DQ}"|${SQL_SQ}')`;
const SQL_CONCAT = new RegExp(String.raw`${SQL_LITERAL}\s*\+`);

const CODE_RULES: readonly CodeRule[] = [
  {
    ruleId: 'guardscan.lint.debug-statement',
    severity: 'low',
    category: 'Lint: Debug Statement',
    description: 'Leftover debug statement on a line this commit adds.',
    suggestion: 'Remove the debug statement, or use the project logger.',
    patterns: {
      js: [/(?<![\w$.])debugger\s*(?:;|$)/, /\bconsole\.(?:log|debug|trace)\s*\(/],
      python: [/(?<![\w.])breakpoint\s*\(\s*\)/, /\bi?pdb\.set_trace\s*\(/, /^\s*import\s+i?pdb\b/],
      ruby: [/\bbinding\.pry\b/, /(?<![\w.:'"])byebug\b(?!['"])/],
      php: [/(?<!\bfunction\s+)(?<![\w$>:\\])(?:var_dump|dd|dump)\s*\(/],
      go: [/\bspew\.Dump\s*\(/],
      java: [/\bSystem\.out\.println\s*\(/, /\.printStackTrace\s*\(\s*\)/],
    },
  },
  {
    ruleId: 'guardscan.pattern.dynamic-code-execution',
    severity: 'medium',
    category: 'Code Pattern: Dynamic Code Execution',
    description: 'Dynamic code execution on a line this commit adds.',
    suggestion: 'Do not evaluate strings as code; parse the data explicitly or dispatch to known functions.',
    patterns: {
      js: [/(?<![\w$.])eval\s*\(/, /\bnew\s+Function\s*\(/],
      python: [/(?<!\bdef\s+)(?<![\w.])(?:eval|exec)\s*\(/],
      php: [/(?<!\bfunction\s+)(?<![\w$>:\\])eval\s*\(/],
      ruby: [/(?<!\bdef\s+)(?<![\w.:])eval(?:\s*\(|\s+[\w"'@])/],
    },
  },
  {
    ruleId: 'guardscan.pattern.unsafe-yaml-load',
    severity: 'medium',
    category: 'Code Pattern: Unsafe YAML Load',
    description: 'yaml.load without SafeLoader on a line this commit adds.',
    suggestion: 'Use yaml.safe_load, or pass Loader=yaml.SafeLoader.',
    patterns: {python: [/\byaml\.(?:load|load_all)\s*\((?!.*SafeLoader)/]},
  },
  {
    ruleId: 'guardscan.pattern.unsafe-deserialization',
    severity: 'medium',
    category: 'Code Pattern: Unsafe Deserialization',
    description: 'pickle deserialization on a line this commit adds.',
    suggestion: 'Never unpickle untrusted data; use a data-only format such as JSON.',
    patterns: {python: [/\b(?:pickle|cPickle)\.loads?\s*\(/]},
  },
  {
    ruleId: 'guardscan.pattern.sql-string-building',
    severity: 'medium',
    category: 'Code Pattern: SQL String Building',
    description: 'SQL built by string concatenation or interpolation on a line this commit adds.',
    suggestion: 'Use parameterized queries or prepared statements.',
    patterns: {
      js: [SQL_CONCAT, new RegExp(String.raw`${SQL_BT}\$\{`)],
      python: [
        SQL_CONCAT,
        new RegExp(String.raw`\b(?:[fF][rR]?|[rR][fF])(?:${SQL_DQ}|${SQL_SQ})\{`),
        new RegExp(String.raw`${SQL_LITERAL}\s*(?:%\s*[\w(]|\.format\s*\()`),
      ],
      ruby: [SQL_CONCAT, new RegExp(String.raw`${SQL_DQ}#\{`)],
      php: [new RegExp(String.raw`${SQL_LITERAL}\s*\.\s*\$`), new RegExp(String.raw`${SQL_DQ}\$[A-Za-z_]`)],
      go: [SQL_CONCAT],
      java: [SQL_CONCAT],
    },
  },
  {
    ruleId: 'guardscan.pattern.shell-command-injection',
    severity: 'medium',
    category: 'Code Pattern: Shell Command Injection',
    description: 'Shell command built from a string on a line this commit adds.',
    suggestion: 'Pass the program and its arguments as an array without a shell, for example execFile or subprocess.run([...]).',
    patterns: {
      python: [/\bsubprocess\.\w+\s*\(.*\bshell\s*=\s*True\b/],
      js: [/(?:\b(?:child_process|childProcess|cp)\.|(?<![\w$.]))exec(?:Sync)?\s*\(\s*(?:`[^`]*\$\{|"[^"]*"\s*\+|'[^']*'\s*\+|[\w$.]+\s*\+)/],
    },
  },
];

function finding(rule: Rule, file: string, line: number): StagedLintFinding {
  const {ruleId, severity, category, description, suggestion} = rule;
  return {ruleId, severity, category, file, line, description, suggestion};
}

/**
 * Check the lines a commit adds to one staged text blob. `added` lists 1-based line numbers,
 * or `all` when the blob has no earlier text version to compare against.
 */
export function lintStagedText(file: string, content: string, added: readonly number[] | 'all'): StagedLintFinding[] {
  const lines = content.split('\n');
  // A final newline ends the last line rather than starting another.
  if (lines[lines.length - 1] === '') {lines.pop();}
  const numbers = added === 'all' ? lines.map((_line, index) => index + 1) : added;
  const texts = numbers.map(number => {
    if (!Number.isInteger(number) || number < 1 || number > lines.length) {
      throw new GuardScanError('Unexpected output from git diff; staged content was not scanned.', 'STAGED_GIT_OUTPUT');
    }
    return lines[number - 1].replace(/\r$/, '');
  });
  const language: Language | undefined = LANGUAGES[path.posix.extname(file).toLowerCase()];
  // A lone `=======` is also a Markdown or reStructuredText heading underline, so it counts only beside a real marker.
  const conflicted = texts.some(text => CONFLICT_BOUNDARY.test(text));
  const findings: StagedLintFinding[] = [];
  texts.forEach((text, index) => {
    const line = numbers[index];
    if (CONFLICT_BOUNDARY.test(text) || (conflicted && CONFLICT_SEPARATOR.test(text))) {
      findings.push(finding(CONFLICT_MARKER, file, line));
    }
    if (TRAILING_WHITESPACE.test(text)) {findings.push(finding(TRAILING_SPACE, file, line));}
    if (!language || text.length > MAX_CODE_LINE_CHARS) {return;}
    const todo = TODO_MARKER.exec(text);
    if (todo && COMMENT_OPENING[language].test(text.slice(0, todo.index))) {
      findings.push(finding(TODO_COMMENT, file, line));
    }
    if (FULL_LINE_COMMENT[language].test(text)) {return;}
    for (const rule of CODE_RULES) {
      if (rule.patterns[language]?.some(pattern => pattern.test(text))) {findings.push(finding(rule, file, line));}
    }
  });
  return findings;
}

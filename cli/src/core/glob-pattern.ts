import {expand} from '@isaacs/brace-expansion';

export function normalizeGlobPatternForPlatform(pattern: string, platform = process.platform): string {
  if (platform !== 'win32') {return pattern;}

  // Native separators before glob syntax (notably \**\*.ts) are still
  // separators. Preserve explicit paired escapes for legal literal filename
  // characters, such as /\[fixture\]/, without hiding native wildcard paths.
  const pairs: Record<string, string> = {'[': ']', '{': '}', '(': ')'};
  const openings: Array<{index: number; closing: string}> = [];
  const escapes = new Set<number>();
  for (let index = 0; index < pattern.length; index++) {
    if (pattern[index] === '/') {openings.length = 0;}
    if (pattern[index] !== '\\') {continue;}
    const next = pattern[index + 1] || '';
    if (pairs[next]) {
      openings.push({index, closing: pairs[next]});
    } else if (openings.at(-1)?.closing === next) {
      escapes.add(openings.pop()!.index);
      escapes.add(index);
    } else {
      openings.length = 0;
      if (next === '!' && index > 0 && pattern[index - 1] === '/') {
        escapes.add(index);
      }
    }
    index++;
  }
  return pattern.replace(/\\/g, (separator, index: number) => escapes.has(index) ? separator : '/');
}

const MAX_GLOB_PATTERN_EXPANSIONS = 10_000;
const MAX_GLOB_PATTERN_BRACE_DEPTH = 64;
const MAX_GLOB_PATTERN_BRACES = 64;
const MAX_GLOB_PATTERN_LENGTH = 16_384;
const MAX_GLOB_EXPANSION_WORK_BYTES = 8 * 1024 * 1024;

export function expandGlobPattern(pattern: string): string[] {
  if (pattern.length > MAX_GLOB_PATTERN_LENGTH) {
    throw new Error(`Glob pattern length exceeds ${MAX_GLOB_PATTERN_LENGTH}`);
  }
  const braceStarts: number[] = [];
  const rangeSizes: number[] = [];
  let braceCount = 0;
  for (let index = 0; index < pattern.length; index++) {
    if (pattern[index] === '\\') {
      index++;
      continue;
    }
    if (pattern[index] === '{') {
      braceStarts.push(index);
      if (braceStarts.length > MAX_GLOB_PATTERN_BRACE_DEPTH) {
        throw new Error(`Glob pattern exceeds the maximum brace nesting depth of ${MAX_GLOB_PATTERN_BRACE_DEPTH}`);
      }
      if (++braceCount > MAX_GLOB_PATTERN_BRACES) {
        throw new Error(`Glob pattern exceeds the maximum brace count of ${MAX_GLOB_PATTERN_BRACES}`);
      }
    } else if (pattern[index] === '}' && braceStarts.length > 0) {
      const startIndex = braceStarts.pop()!;
      const range = pattern.slice(startIndex + 1, index)
        .match(/^(-?\d+|[a-zA-Z])\.\.(-?\d+|[a-zA-Z])(?:\.\.(-?\d+))?$/);
      if (!range) {continue;}
      const numeric = /^-?\d+$/.test(range[1]) && /^-?\d+$/.test(range[2]);
      const alphabetic = /^[a-zA-Z]$/.test(range[1]) && /^[a-zA-Z]$/.test(range[2]);
      if (!numeric && !alphabetic) {continue;}
      const start = numeric ? Number(range[1]) : range[1].charCodeAt(0);
      const end = numeric ? Number(range[2]) : range[2].charCodeAt(0);
      const step = range[3] === undefined ? 1 : Math.abs(Number(range[3]));
      if (step === 0) {throw new Error('Glob sequence step must be nonzero');}
      const distance = Math.abs(end - start);
      if (![start, end, step, distance].every(Number.isSafeInteger)) {
        throw new Error('Glob sequence values must be safe integers');
      }
      rangeSizes.push(Math.floor(distance / step) + 1);
    }
  }

  // Preserve escaped glob syntax: the expansion library otherwise unescapes it
  // before the glob matcher sees it (for example, a literal \{a,b\} directory).
  let escapePrefix = '__GUARDSCAN_GLOB_ESCAPE_';
  while (pattern.includes(escapePrefix)) {escapePrefix += '_';}
  const escapes: string[] = [];
  const protectedPattern = pattern.replace(/\\./g, value => {
    escapes.push(value);
    return `${escapePrefix}${escapes.length - 1}__`;
  });
  // The library's max caps final output only, not range allocations or recursive
  // intermediate arrays. Bound those paths before invoking it as well.
  const expansionLimit = Math.max(1, Math.min(MAX_GLOB_PATTERN_EXPANSIONS,
    Math.floor(MAX_GLOB_EXPANSION_WORK_BYTES /
      (Math.max(1, protectedPattern.length) * Math.max(1, braceCount) ** 2))));
  if (rangeSizes.some(size => size > expansionLimit)) {
    throw new Error(`Glob range expansion exceeds the bounded count of ${expansionLimit}`);
  }
  const expansions = expand(protectedPattern, {max: expansionLimit + 1});
  if (expansions.length > expansionLimit) {
    throw new Error(`Glob pattern exceeds the bounded expansion count of ${expansionLimit}`);
  }
  const escapePattern = new RegExp(`${escapePrefix}(\\d+)__`, 'g');
  return expansions.map(value => value.replace(escapePattern, (_token, index: string) => escapes[Number(index)]));
}

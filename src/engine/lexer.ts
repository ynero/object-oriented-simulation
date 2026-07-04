export type TokenKind =
  | 'keyword' | 'identifier' | 'integer' | 'double' | 'string' | 'boolean' | 'null'
  | 'lparen' | 'rparen' | 'lbrace' | 'rbrace' | 'semicolon' | 'comma' | 'dot'
  | 'assign' | 'plusassign' | 'minusassign'
  | 'plus' | 'minus' | 'star' | 'slash' | 'percent'
  | 'eq' | 'neq' | 'lt' | 'gt' | 'lte' | 'gte'
  | 'and' | 'or' | 'not'
  | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
}

const KEYWORDS = new Set([
  'class', 'int', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'long',
  'String', 'void', 'new', 'return', 'this', 'if', 'else', 'while', 'for',
  'public', 'private', 'protected', 'static', 'final', 'extends', 'super',
]);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\n') { line++; i++; continue; }
    if (/[ \t\r]/.test(ch)) { i++; continue; }

    // Line comment
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    // Block comment
    if (source[i] === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }

    // String literal
    if (ch === '"') {
      let str = '';
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') {
          i++;
          const esc: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\' };
          str += esc[source[i]] ?? source[i];
        } else {
          str += source[i];
        }
        i++;
      }
      i++; // closing quote
      tokens.push({ kind: 'string', value: str, line });
      continue;
    }

    // Number
    if (/[0-9]/.test(ch)) {
      let num = '';
      let isDouble = false;
      while (i < source.length && /[0-9]/.test(source[i])) num += source[i++];
      if (source[i] === '.' && /[0-9]/.test(source[i + 1])) {
        isDouble = true;
        num += source[i++];
        while (i < source.length && /[0-9]/.test(source[i])) num += source[i++];
      }
      tokens.push({ kind: isDouble ? 'double' : 'integer', value: num, line });
      continue;
    }

    // Identifier / keyword
    if (/[a-zA-Z_$]/.test(ch)) {
      let id = '';
      while (i < source.length && /[a-zA-Z0-9_$]/.test(source[i])) id += source[i++];
      if (id === 'true' || id === 'false') tokens.push({ kind: 'boolean', value: id, line });
      else if (id === 'null') tokens.push({ kind: 'null', value: 'null', line });
      else if (KEYWORDS.has(id)) tokens.push({ kind: 'keyword', value: id, line });
      else tokens.push({ kind: 'identifier', value: id, line });
      continue;
    }

    // Multi-char operators
    const two = source.slice(i, i + 2);
    if (two === '==') { tokens.push({ kind: 'eq', value: '==', line }); i += 2; continue; }
    if (two === '!=') { tokens.push({ kind: 'neq', value: '!=', line }); i += 2; continue; }
    if (two === '<=') { tokens.push({ kind: 'lte', value: '<=', line }); i += 2; continue; }
    if (two === '>=') { tokens.push({ kind: 'gte', value: '>=', line }); i += 2; continue; }
    if (two === '&&') { tokens.push({ kind: 'and', value: '&&', line }); i += 2; continue; }
    if (two === '||') { tokens.push({ kind: 'or', value: '||', line }); i += 2; continue; }
    if (two === '+=') { tokens.push({ kind: 'plusassign', value: '+=', line }); i += 2; continue; }
    if (two === '-=') { tokens.push({ kind: 'minusassign', value: '-=', line }); i += 2; continue; }

    // Single-char
    const single: Record<string, TokenKind> = {
      '(': 'lparen', ')': 'rparen', '{': 'lbrace', '}': 'rbrace',
      ';': 'semicolon', ',': 'comma', '.': 'dot',
      '=': 'assign', '+': 'plus', '-': 'minus', '*': 'star',
      '/': 'slash', '%': 'percent', '<': 'lt', '>': 'gt', '!': 'not',
    };
    if (single[ch]) { tokens.push({ kind: single[ch], value: ch, line }); i++; continue; }

    i++; // skip unknown chars
  }

  tokens.push({ kind: 'eof', value: '', line });
  return tokens;
}

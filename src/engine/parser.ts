import { tokenize, Token, TokenKind } from './lexer';
import type {
  Program, ClassDecl, FieldDecl, ConstructorDecl, MethodDecl, Param,
  Statement, VarDeclStmt, AssignStmt, ExprStmt, ReturnStmt, IfStmt, WhileStmt, ForStmt,
  Expr, LiteralExpr, IdentifierExpr, BinaryExpr, UnaryExpr,
  FieldAccessExpr, ArrayAccessExpr, MethodCallExpr, NewObjectExpr, NewArrayExpr, ArrayInitExpr, ThisExpr, NullLiteral,
} from './types';

const PRIMITIVE_TYPES = new Set(['int', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'long', 'String', 'void']);
const MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'final']);

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) { this.tokens = tokens; }

  private peek(offset = 0): Token { return this.tokens[this.pos + offset] ?? { kind: 'eof', value: '', line: 0 }; }
  private advance(): Token { return this.tokens[this.pos++]; }
  private line(): number { return this.peek().line; }

  private check(kind: TokenKind, value?: string): boolean {
    const t = this.peek();
    return t.kind === kind && (value === undefined || t.value === value);
  }

  private eat(kind: TokenKind, value?: string): Token {
    const t = this.peek();
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new Error(`Line ${t.line}: expected ${value ?? kind}, got '${t.value}'`);
    }
    return this.advance();
  }

  private match(kind: TokenKind, value?: string): boolean {
    if (this.check(kind, value)) { this.advance(); return true; }
    return false;
  }

  private skipModifiers(): void {
    while (MODIFIERS.has(this.peek().value) && this.peek().kind === 'keyword') this.advance();
  }

  private isType(): boolean {
    const t = this.peek();
    return (t.kind === 'keyword' && PRIMITIVE_TYPES.has(t.value)) || t.kind === 'identifier';
  }

  private parseType(): string {
    const t = this.advance();
    let type = t.value;
    // Handle generic type params: ArrayList<String> → skip <...>
    if (this.check('lt')) this.skipGenericTypeParams();
    // Handle array type suffix: int[] → 'int[]'
    while (this.check('lbracket')) {
      this.advance();
      if (this.check('rbracket')) this.advance();
      type += '[]';
    }
    return type;
  }

  private skipGenericTypeParams(): void {
    let depth = 0;
    while (!this.check('eof')) {
      if (this.check('lt')) { depth++; this.advance(); }
      else if (this.check('gt')) { depth--; this.advance(); if (depth <= 0) break; }
      else this.advance();
    }
  }

  // ── Top level ─────────────────────────────────────────────────────────────

  parseProgram(): Program {
    const classes: ClassDecl[] = [];
    const statements: Statement[] = [];

    while (!this.check('eof')) {
      this.skipModifiers();
      if (this.check('keyword', 'class')) {
        classes.push(this.parseClassDecl());
      } else {
        const stmt = this.parseStatement();
        if (stmt) statements.push(stmt);
      }
    }

    return { kind: 'Program', classes, statements };
  }

  // ── Class ─────────────────────────────────────────────────────────────────

  private parseClassDecl(): ClassDecl {
    const ln = this.line();
    this.eat('keyword', 'class');
    const name = this.eat('identifier').value;

    // Skip "extends X"
    if (this.check('keyword', 'extends')) { this.advance(); this.advance(); }

    this.eat('lbrace');

    const fields: FieldDecl[] = [];
    const constructors: ConstructorDecl[] = [];
    const methods: MethodDecl[] = [];

    while (!this.check('rbrace') && !this.check('eof')) {
      this.skipModifiers();
      const memberLine = this.line();
      const t0 = this.peek(0);
      const t1 = this.peek(1);

      // Constructor: ClassName (
      if ((t0.kind === 'identifier' || t0.kind === 'keyword') && t0.value === name && t1.kind === 'lparen') {
        this.advance(); // consume class name
        const params = this.parseParams();
        this.eat('lbrace');
        const body = this.parseStatements();
        this.eat('rbrace');
        constructors.push({ kind: 'ConstructorDecl', name, params, body, line: memberLine });
        continue;
      }

      // Method or field: Type name ...
      if (!this.isType()) { this.advance(); continue; } // safety skip
      const type = this.parseType();
      const memberName = this.eat('identifier').value;

      if (this.check('lparen')) {
        // Method
        const params = this.parseParams();
        this.eat('lbrace');
        const body = this.parseStatements();
        this.eat('rbrace');
        methods.push({ kind: 'MethodDecl', returnType: type, name: memberName, params, body, line: memberLine });
      } else {
        // Field (with optional initializer)
        if (this.check('assign')) {
          this.advance();
          this.parseExpr(); // consume initializer (ignored for now)
        }
        this.match('semicolon');
        fields.push({ kind: 'FieldDecl', type, name: memberName, line: memberLine });
      }
    }

    this.eat('rbrace');
    return { kind: 'ClassDecl', name, fields, constructors, methods, line: ln };
  }

  private parseParams(): Param[] {
    this.eat('lparen');
    const params: Param[] = [];
    while (!this.check('rparen') && !this.check('eof')) {
      const type = this.parseType();
      const name = this.eat('identifier').value;
      params.push({ type, name });
      this.match('comma');
    }
    this.eat('rparen');
    return params;
  }

  private parseStatements(): Statement[] {
    const stmts: Statement[] = [];
    while (!this.check('rbrace') && !this.check('eof')) {
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  // ── Statements ────────────────────────────────────────────────────────────

  private parseStatement(): Statement | null {
    this.skipModifiers();
    if (this.check('eof') || this.check('rbrace')) return null;

    const ln = this.line();
    const t0 = this.peek(0);
    const t1 = this.peek(1);
    const t2 = this.peek(2);

    // Return
    if (t0.kind === 'keyword' && t0.value === 'return') {
      this.advance();
      if (this.check('semicolon')) { this.advance(); return { kind: 'ReturnStmt', line: ln }; }
      const val = this.parseExpr();
      this.match('semicolon');
      return { kind: 'ReturnStmt', value: val, line: ln };
    }

    // If
    if (t0.kind === 'keyword' && t0.value === 'if') {
      return this.parseIf();
    }

    // While
    if (t0.kind === 'keyword' && t0.value === 'while') {
      return this.parseWhile();
    }

    // For
    if (t0.kind === 'keyword' && t0.value === 'for') {
      return this.parseFor();
    }

    // Variable declaration: primitive-type identifier (handles int[] arr too)
    if (t0.kind === 'keyword' && PRIMITIVE_TYPES.has(t0.value) && t1.kind === 'identifier') {
      return this.parseVarDecl();
    }
    // int[] arr — after [] the next token is identifier
    if (t0.kind === 'keyword' && PRIMITIVE_TYPES.has(t0.value) && t1.kind === 'lbracket') {
      return this.parseVarDecl();
    }

    // Variable declaration: ClassName identifier = ...  (two consecutive identifiers then = or ;)
    if (
      t0.kind === 'identifier' &&
      (t1.kind === 'identifier') &&
      (t2.kind === 'assign' || t2.kind === 'semicolon')
    ) {
      return this.parseVarDecl();
    }
    // ClassName[] identifier = ...  — EMPTY brackets (type suffix) followed by identifier name
    // Distinct from matrix[row] where the bracket contains an expression
    if (
      t0.kind === 'identifier' &&
      t1.kind === 'lbracket' &&
      this.peek(2).kind === 'rbracket' &&
      this.peek(3).kind === 'identifier'
    ) {
      return this.parseVarDecl();
    }
    // ClassName<Generic> identifier = ...  (e.g. ArrayList<String> list)
    if (t0.kind === 'identifier' && t1.kind === 'lt') {
      return this.parseVarDecl();
    }

    // Otherwise: assignment or expression statement
    return this.parseExprOrAssignStmt();
  }

  private parseVarDecl(): VarDeclStmt {
    const ln = this.line();
    const type = this.parseType();
    const name = this.eat('identifier').value;
    let init: Expr;
    if (this.check('assign')) {
      this.advance();
      init = this.parseExpr();
    } else {
      // Default value
      const defaultVal: Expr = { kind: 'NullLiteral', line: ln };
      init = defaultVal;
    }
    this.match('semicolon');
    return { kind: 'VarDeclStmt', type, name, init, line: ln };
  }

  private parseExprOrAssignStmt(): Statement {
    const ln = this.line();
    const expr = this.parseExpr();

    if (this.check('assign')) {
      this.advance();
      const value = this.parseExpr();
      this.match('semicolon');
      if (expr.kind !== 'IdentifierExpr' && expr.kind !== 'FieldAccessExpr' && expr.kind !== 'ArrayAccessExpr') {
        throw new Error(`Line ${ln}: invalid assignment target`);
      }
      return { kind: 'AssignStmt', target: expr as IdentifierExpr | FieldAccessExpr | ArrayAccessExpr, value, line: ln };
    }

    this.match('semicolon');
    return { kind: 'ExprStmt', expr, line: ln };
  }

  private parseIf(): IfStmt {
    const ln = this.line();
    this.eat('keyword', 'if');
    this.eat('lparen');
    const condition = this.parseExpr();
    this.eat('rparen');
    const thenBranch = this.parseBlock();
    let elseBranch: Statement[] | undefined;
    if (this.check('keyword', 'else')) {
      this.advance();
      elseBranch = this.parseBlock();
    }
    return { kind: 'IfStmt', condition, thenBranch, elseBranch, line: ln };
  }

  private parseWhile(): WhileStmt {
    const ln = this.line();
    this.eat('keyword', 'while');
    this.eat('lparen');
    const condition = this.parseExpr();
    this.eat('rparen');
    const body = this.parseBlock();
    return { kind: 'WhileStmt', condition, body, line: ln };
  }

  private parseFor(): ForStmt {
    const ln = this.line();
    this.eat('keyword', 'for');
    this.eat('lparen');

    // Init — parse without consuming the ';' as a statement terminator
    let init: Statement | undefined;
    if (!this.check('semicolon')) {
      const t0 = this.peek(0);
      const t1 = this.peek(1);
      if ((t0.kind === 'keyword' && PRIMITIVE_TYPES.has(t0.value)) || t0.kind === 'identifier') {
        // Likely a var decl: int i = 0
        const type = this.parseType();
        const name = this.eat('identifier').value;
        let initExpr: Expr = { kind: 'NullLiteral', line: ln };
        if (this.check('assign')) { this.advance(); initExpr = this.parseExpr(); }
        init = { kind: 'VarDeclStmt', type, name, init: initExpr, line: ln };
      } else {
        init = { kind: 'ExprStmt', expr: this.parseExpr(), line: ln };
      }
    }
    this.eat('semicolon');

    // Condition
    let condition: Expr | undefined;
    if (!this.check('semicolon')) condition = this.parseExpr();
    this.eat('semicolon');

    // Update — no trailing semicolon, ends at ')'
    let update: Statement | undefined;
    if (!this.check('rparen')) {
      const updExpr = this.parseExpr();
      if (this.check('assign')) {
        this.advance();
        const val = this.parseExpr();
        update = { kind: 'AssignStmt', target: updExpr as IdentifierExpr | FieldAccessExpr | ArrayAccessExpr, value: val, line: ln };
      } else {
        update = { kind: 'ExprStmt', expr: updExpr, line: ln };
      }
    }
    this.eat('rparen');

    const body = this.parseBlock();
    return { kind: 'ForStmt', init, condition, update, body, line: ln };
  }

  private parseBlock(): Statement[] {
    if (this.check('lbrace')) {
      this.eat('lbrace');
      const stmts = this.parseStatements();
      this.eat('rbrace');
      return stmts;
    }
    const s = this.parseStatement();
    return s ? [s] : [];
  }

  // ── Expressions (recursive descent, operator precedence) ──────────────────

  parseExpr(): Expr { return this.parseOr(); }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.check('or')) {
      const ln = this.line(); this.advance();
      left = { kind: 'BinaryExpr', op: '||', left, right: this.parseAnd(), line: ln };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseEquality();
    while (this.check('and')) {
      const ln = this.line(); this.advance();
      left = { kind: 'BinaryExpr', op: '&&', left, right: this.parseEquality(), line: ln };
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseComparison();
    while (this.check('eq') || this.check('neq')) {
      const ln = this.line(); const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseComparison(), line: ln };
    }
    return left;
  }

  private parseComparison(): Expr {
    let left = this.parseAddition();
    while (this.check('lt') || this.check('gt') || this.check('lte') || this.check('gte')) {
      const ln = this.line(); const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseAddition(), line: ln };
    }
    return left;
  }

  private parseAddition(): Expr {
    let left = this.parseMultiplication();
    while (this.check('plus') || this.check('minus')) {
      const ln = this.line(); const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseMultiplication(), line: ln };
    }
    return left;
  }

  private parseMultiplication(): Expr {
    let left = this.parseUnary();
    while (this.check('star') || this.check('slash') || this.check('percent')) {
      const ln = this.line(); const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseUnary(), line: ln };
    }
    return left;
  }

  private parseUnary(): Expr {
    const ln = this.line();
    if (this.check('minus')) { this.advance(); return { kind: 'UnaryExpr', op: '-', operand: this.parseUnary(), line: ln }; }
    if (this.check('not')) { this.advance(); return { kind: 'UnaryExpr', op: '!', operand: this.parseUnary(), line: ln }; }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    while (true) {
      const ln = this.line();
      if (this.check('lbracket')) {
        // Array element access: arr[i]
        this.advance();
        const index = this.parseExpr();
        this.eat('rbracket');
        expr = { kind: 'ArrayAccessExpr', array: expr, index, line: ln };
      } else if (this.check('dot')) {
        this.advance();
        const name = this.advance().value;
        if (this.check('lparen')) {
          this.eat('lparen');
          const args: Expr[] = [];
          while (!this.check('rparen') && !this.check('eof')) {
            args.push(this.parseExpr());
            this.match('comma');
          }
          this.eat('rparen');
          expr = { kind: 'MethodCallExpr', object: expr, method: name, args, line: ln };
        } else {
          expr = { kind: 'FieldAccessExpr', object: expr, field: name, line: ln };
        }
      } else if (this.check('plusplus')) {
        this.advance();
        expr = { kind: 'UnaryExpr', op: '++', operand: expr, line: ln };
      } else if (this.check('minusminus')) {
        this.advance();
        expr = { kind: 'UnaryExpr', op: '--', operand: expr, line: ln };
      } else {
        break;
      }
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const ln = this.line();
    const t = this.peek();

    // Integer literal
    if (t.kind === 'integer') {
      this.advance();
      return { kind: 'LiteralExpr', literalType: 'int', value: parseInt(t.value), line: ln };
    }

    // Double literal
    if (t.kind === 'double') {
      this.advance();
      return { kind: 'LiteralExpr', literalType: 'double', value: parseFloat(t.value), line: ln };
    }

    // String literal
    if (t.kind === 'string') {
      this.advance();
      return { kind: 'LiteralExpr', literalType: 'String', value: t.value, line: ln };
    }

    // Boolean literal
    if (t.kind === 'boolean') {
      this.advance();
      return { kind: 'LiteralExpr', literalType: 'boolean', value: t.value === 'true', line: ln };
    }

    // null
    if (t.kind === 'null') {
      this.advance();
      return { kind: 'NullLiteral', line: ln };
    }

    // this
    if (t.kind === 'keyword' && t.value === 'this') {
      this.advance();
      return { kind: 'ThisExpr', line: ln };
    }

    // Array literal: {1, 2, 3}
    if (t.kind === 'lbrace') {
      this.advance();
      const elements: Expr[] = [];
      while (!this.check('rbrace') && !this.check('eof')) {
        elements.push(this.parseExpr());
        this.match('comma');
      }
      this.eat('rbrace');
      return { kind: 'ArrayInitExpr', elements, line: ln };
    }

    // new int[n] / new ClassName(args) / new ArrayList<>()
    if (t.kind === 'keyword' && t.value === 'new') {
      this.advance();
      const typeName = this.advance().value;
      // Skip generic type params: new ArrayList<String>() or new ArrayList<>()
      if (this.check('lt')) this.skipGenericTypeParams();
      if (this.check('lbracket')) {
        // Array creation: new int[n], new int[n][m], etc.
        const dimensions: Expr[] = [];
        while (this.check('lbracket') && this.peek(1).kind !== 'rbracket') {
          this.advance(); // consume [
          dimensions.push(this.parseExpr());
          this.eat('rbracket');
        }
        // Skip trailing empty [] type suffixes (e.g. new int[3][])
        while (this.check('lbracket') && this.peek(1).kind === 'rbracket') {
          this.advance(); this.advance();
        }
        // Optional empty initializer braces
        if (this.check('lbrace')) { this.advance(); this.eat('rbrace'); }
        return { kind: 'NewArrayExpr', elementType: typeName, dimensions, line: ln };
      }
      // Object creation
      this.eat('lparen');
      const args: Expr[] = [];
      while (!this.check('rparen') && !this.check('eof')) {
        args.push(this.parseExpr());
        this.match('comma');
      }
      this.eat('rparen');
      return { kind: 'NewObjectExpr', className: typeName, args, line: ln };
    }

    // Grouped expression
    if (t.kind === 'lparen') {
      this.advance();
      const expr = this.parseExpr();
      this.eat('rparen');
      return expr;
    }

    // Identifier or method call without object
    if (t.kind === 'identifier') {
      this.advance();
      if (this.check('lparen')) {
        this.eat('lparen');
        const args: Expr[] = [];
        while (!this.check('rparen') && !this.check('eof')) {
          args.push(this.parseExpr());
          this.match('comma');
        }
        this.eat('rparen');
        return { kind: 'MethodCallExpr', object: null, method: t.value, args, line: ln };
      }
      return { kind: 'IdentifierExpr', name: t.value, line: ln };
    }

    // Unexpected token — skip it and return a null literal to avoid infinite loops
    this.advance();
    return { kind: 'NullLiteral', line: ln };
  }
}

export function parse(source: string): Program {
  const tokens = tokenize(source);
  return new Parser(tokens).parseProgram();
}

export { Parser };

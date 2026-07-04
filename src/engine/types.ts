// ── Runtime memory model ──────────────────────────────────────────────────────

export interface Reference {
  kind: 'ref';
  heapId: string | null; // null = null reference
}

export type VarValue = number | boolean | Reference;

export interface Variable {
  name: string;
  type: string;
  value: VarValue;
}

export interface StackFrame {
  id: string;
  label: string;
  variables: Variable[];
}

export interface HeapObject {
  id: string;
  className: string;
  fields: Variable[];
  isString?: boolean;
  stringValue?: string;
}

export interface MemoryState {
  stack: StackFrame[];
  heap: HeapObject[];
  output: string[];
}

export interface SimulationStep {
  line: number;
  description: string;
  state: MemoryState;
  newHeapIds: string[];
  newVarKeys: string[];    // "frameId:varName"
  changedHeapId?: string;
  changedField?: string;
}

// ── AST ──────────────────────────────────────────────────────────────────────

export interface Program {
  kind: 'Program';
  classes: ClassDecl[];
  statements: Statement[];
}

export interface ClassDecl {
  kind: 'ClassDecl';
  name: string;
  fields: FieldDecl[];
  constructors: ConstructorDecl[];
  methods: MethodDecl[];
  line: number;
}

export interface FieldDecl {
  kind: 'FieldDecl';
  type: string;
  name: string;
  line: number;
}

export interface Param {
  type: string;
  name: string;
}

export interface ConstructorDecl {
  kind: 'ConstructorDecl';
  name: string;
  params: Param[];
  body: Statement[];
  line: number;
}

export interface MethodDecl {
  kind: 'MethodDecl';
  returnType: string;
  name: string;
  params: Param[];
  body: Statement[];
  line: number;
}

export type Statement =
  | VarDeclStmt
  | AssignStmt
  | ExprStmt
  | ReturnStmt
  | IfStmt
  | WhileStmt;

export interface VarDeclStmt {
  kind: 'VarDeclStmt';
  type: string;
  name: string;
  init: Expr;
  line: number;
}

export interface AssignStmt {
  kind: 'AssignStmt';
  target: IdentifierExpr | FieldAccessExpr;
  value: Expr;
  line: number;
}

export interface ExprStmt {
  kind: 'ExprStmt';
  expr: Expr;
  line: number;
}

export interface ReturnStmt {
  kind: 'ReturnStmt';
  value?: Expr;
  line: number;
}

export interface IfStmt {
  kind: 'IfStmt';
  condition: Expr;
  thenBranch: Statement[];
  elseBranch?: Statement[];
  line: number;
}

export interface WhileStmt {
  kind: 'WhileStmt';
  condition: Expr;
  body: Statement[];
  line: number;
}

export type Expr =
  | LiteralExpr
  | IdentifierExpr
  | BinaryExpr
  | UnaryExpr
  | FieldAccessExpr
  | MethodCallExpr
  | NewObjectExpr
  | ThisExpr
  | NullLiteral;

export interface LiteralExpr {
  kind: 'LiteralExpr';
  literalType: 'int' | 'double' | 'boolean' | 'String';
  value: number | boolean | string;
  line: number;
}

export interface IdentifierExpr {
  kind: 'IdentifierExpr';
  name: string;
  line: number;
}

export interface BinaryExpr {
  kind: 'BinaryExpr';
  op: string;
  left: Expr;
  right: Expr;
  line: number;
}

export interface UnaryExpr {
  kind: 'UnaryExpr';
  op: string;
  operand: Expr;
  line: number;
}

export interface FieldAccessExpr {
  kind: 'FieldAccessExpr';
  object: Expr;
  field: string;
  line: number;
}

export interface MethodCallExpr {
  kind: 'MethodCallExpr';
  object: Expr | null;
  method: string;
  args: Expr[];
  line: number;
}

export interface NewObjectExpr {
  kind: 'NewObjectExpr';
  className: string;
  args: Expr[];
  line: number;
}

export interface ThisExpr {
  kind: 'ThisExpr';
  line: number;
}

export interface NullLiteral {
  kind: 'NullLiteral';
  line: number;
}

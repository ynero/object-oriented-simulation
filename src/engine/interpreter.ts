import { parse } from './parser';
import type {
  Program, ClassDecl, Statement, Expr,
  MemoryState, StackFrame, HeapObject, Variable, VarValue, Reference, SimulationStep,
} from './types';

// Internal value type used during expression evaluation (may include raw strings before boxing)
type EvalValue = number | boolean | string | Reference;

const NULL_REF: Reference = { kind: 'ref', heapId: null };

function isRef(v: EvalValue): v is Reference {
  return typeof v === 'object' && v !== null && (v as Reference).kind === 'ref';
}

function isPrimitive(type: string): boolean {
  return ['int', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'long'].includes(type);
}

// ── Interpreter class ─────────────────────────────────────────────────────────

export class Interpreter {
  private heap = new Map<string, HeapObject>();
  private callStack: StackFrame[] = [];
  private output: string[] = [];
  private steps: SimulationStep[] = [];
  private stringCounter = 0;
  private objectCounter = 0;
  private frameCounter = 0;
  private classes = new Map<string, ClassDecl>();
  private thisStack: (Reference | null)[] = [];

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private newStringId(): string { return `s_${this.stringCounter++}`; }
  private newObjectId(): string { return `o_${this.objectCounter++}`; }

  private newFrameId(): string {
    return `f${this.frameCounter++}`;
  }

  private get currentThis(): Reference | null {
    return this.thisStack[this.thisStack.length - 1] ?? null;
  }

  private currentFrame(): StackFrame {
    return this.callStack[this.callStack.length - 1];
  }

  private snapshot(): MemoryState {
    return {
      stack: this.callStack.map(f => ({
        ...f,
        variables: f.variables.map(v => ({ ...v })),
      })),
      heap: Array.from(this.heap.values()).map(o => ({
        ...o,
        fields: o.fields.map(f => ({ ...f })),
      })),
      output: [...this.output],
    };
  }

  private addStep(
    line: number,
    description: string,
    opts: {
      newHeapIds?: string[];
      newVarKeys?: string[];
      changedHeapId?: string;
      changedField?: string;
    } = {}
  ): void {
    this.steps.push({
      line,
      description,
      state: this.snapshot(),
      newHeapIds: opts.newHeapIds ?? [],
      newVarKeys: opts.newVarKeys ?? [],
      changedHeapId: opts.changedHeapId,
      changedField: opts.changedField,
    });
  }

  // ── Variable lookup ──────────────────────────────────────────────────────────

  private lookupVar(name: string): VarValue | undefined {
    for (let i = this.callStack.length - 1; i >= 0; i--) {
      const v = this.callStack[i].variables.find(v => v.name === name);
      if (v !== undefined) return v.value;
    }
    return undefined;
  }

  private setVar(name: string, value: VarValue): boolean {
    for (let i = this.callStack.length - 1; i >= 0; i--) {
      const v = this.callStack[i].variables.find(v => v.name === name);
      if (v !== undefined) { v.value = value; return true; }
    }
    return false;
  }

  private declareVar(name: string, type: string, value: VarValue): string {
    const frame = this.currentFrame();
    frame.variables.push({ name, type, value });
    return `${frame.id}:${name}`;
  }

  // ── String boxing ────────────────────────────────────────────────────────────

  private boxString(s: string): Reference {
    const id = this.newStringId();
    this.heap.set(id, {
      id,
      className: 'String',
      fields: [],
      isString: true,
      stringValue: s,
    });
    return { kind: 'ref', heapId: id };
  }

  private unboxString(ref: Reference): string {
    if (ref.heapId === null) return 'null';
    const obj = this.heap.get(ref.heapId);
    return obj?.stringValue ?? `<ref:${ref.heapId}>`;
  }

  // Convert EvalValue to VarValue for storage (boxes strings)
  private toVarValue(val: EvalValue, type: string): VarValue {
    if (typeof val === 'string') return this.boxString(val);
    return val as VarValue;
  }

  // Convert VarValue to EvalValue for computation (unboxes string refs)
  private toEvalValue(val: VarValue): EvalValue {
    if (isRef(val)) {
      const obj = val.heapId ? this.heap.get(val.heapId) : null;
      if (obj?.isString) return obj.stringValue ?? '';
    }
    return val as EvalValue;
  }

  private evalValueToDisplay(val: EvalValue, type?: string): string {
    if (isRef(val)) {
      if (val.heapId === null) return 'null';
      const obj = this.heap.get(val.heapId);
      if (obj?.isString) return `"${obj.stringValue}"`;
      return `@${val.heapId}`;
    }
    if (typeof val === 'string') return `"${val}"`;
    return String(val);
  }

  // True if val is a Java String (raw string literal or ref to String heap object)
  private isStringVal(val: EvalValue): boolean {
    if (typeof val === 'string') return true;
    if (isRef(val) && val.heapId !== null) {
      return this.heap.get(val.heapId)?.isString === true;
    }
    return false;
  }

  // Convert any EvalValue to a Java-style string for concatenation (no wrapping quotes)
  private toJavaString(val: EvalValue): string {
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return String(val);
    if (typeof val === 'boolean') return String(val);
    if (isRef(val)) {
      if (val.heapId === null) return 'null';
      const obj = this.heap.get(val.heapId);
      if (obj?.isString) return obj.stringValue ?? '';
      if (obj) return `${obj.className}@${obj.id}`;
      return 'null';
    }
    return String(val);
  }

  // ── Expression evaluation ────────────────────────────────────────────────────

  private evalExpr(expr: Expr): EvalValue {
    switch (expr.kind) {
      case 'LiteralExpr':
        return expr.value as EvalValue;

      case 'NullLiteral':
        return NULL_REF;

      case 'ThisExpr': {
        const ref = this.currentThis;
        return ref ?? NULL_REF;
      }

      case 'IdentifierExpr': {
        const val = this.lookupVar(expr.name);
        if (val !== undefined) return this.toEvalValue(val);
        // Java: unqualified name can also refer to an instance field (implicit this)
        const thisRef = this.currentThis;
        if (thisRef?.heapId) {
          const obj = this.heap.get(thisRef.heapId);
          const field = obj?.fields.find(f => f.name === expr.name);
          if (field !== undefined) return this.toEvalValue(field.value);
        }
        throw new Error(`Line ${expr.line}: undefined variable '${expr.name}'`);
      }

      case 'FieldAccessExpr': {
        // Math.PI and similar class constants
        if (expr.object.kind === 'IdentifierExpr' && expr.object.name === 'Math') {
          if (expr.field === 'PI') return Math.PI;
          if (expr.field === 'E') return Math.E;
          throw new Error(`Line ${expr.line}: Math.${expr.field} is not supported`);
        }
        // Handle System.out.println chain: FieldAccess on FieldAccess
        const objVal = this.evalExpr(expr.object);
        if (!isRef(objVal) || objVal.heapId === null) {
          throw new Error(`Line ${expr.line}: field access on non-object`);
        }
        const obj = this.heap.get(objVal.heapId);
        if (!obj) throw new Error(`Line ${expr.line}: heap object not found`);
        const field = obj.fields.find(f => f.name === expr.field);
        if (!field) return NULL_REF;
        return this.toEvalValue(field.value);
      }

      case 'BinaryExpr': {
        const l = this.evalExpr(expr.left);
        const r = this.evalExpr(expr.right);
        // String concatenation: if either side is a String, concatenate as strings
        if (expr.op === '+' && (this.isStringVal(l) || this.isStringVal(r))) {
          return this.toJavaString(l) + this.toJavaString(r);
        }
        const ln = typeof l === 'number' ? l : 0;
        const rn = typeof r === 'number' ? r : 0;
        switch (expr.op) {
          case '+': return ln + rn;
          case '-': return ln - rn;
          case '*': return ln * rn;
          case '/': return rn !== 0 ? ln / rn : 0;
          case '%': return ln % rn;
          case '<': return ln < rn;
          case '>': return ln > rn;
          case '<=': return ln <= rn;
          case '>=': return ln >= rn;
          case '==': return l === r;
          case '!=': return l !== r;
          case '&&': return !!(l) && !!(r);
          case '||': return !!(l) || !!(r);
        }
        return false;
      }

      case 'UnaryExpr': {
        const val = this.evalExpr(expr.operand);
        if (expr.op === '-' && typeof val === 'number') return -val;
        if (expr.op === '!') return !val;
        return val;
      }

      case 'MethodCallExpr': {
        // System.out.println / print: skip evaluating the System.out object chain
        if (expr.method === 'println' || expr.method === 'print') {
          return this.evalMethodCall(null, expr.method, expr.args, expr.line);
        }
        // Math class built-in methods
        if (expr.object?.kind === 'IdentifierExpr' && expr.object.name === 'Math') {
          return this.evalMathMethod(expr.method, expr.args, expr.line);
        }
        return this.evalMethodCall(expr.object ? this.evalExpr(expr.object) : null, expr.method, expr.args, expr.line);
      }

      case 'NewObjectExpr': {
        return this.evalNew(expr.className, expr.args, expr.line);
      }
    }
  }

  // Evaluate args in order. String literals are immediately boxed as heap objects so that
  // the "create String" step appears BEFORE the call/object-creation step that uses them.
  private evalArgs(argExprs: Expr[]): VarValue[] {
    return argExprs.map(a => {
      const val = this.evalExpr(a);
      if (typeof val === 'string') {
        const ref = this.boxString(val);
        this.addStep(a.line, `Allocate String "${val}" on heap`, { newHeapIds: [ref.heapId!] });
        return ref;
      }
      return val as VarValue;
    });
  }

  private evalNew(className: string, argExprs: Expr[], line: number): Reference {
    const classDef = this.classes.get(className);
    if (!classDef) throw new Error(`Line ${line}: class '${className}' not found`);

    // Evaluate all arguments first (boxing strings with steps) — Java evaluates args
    // left-to-right before constructing the object.
    const args = this.evalArgs(argExprs);

    // Create heap object with default field values
    const id = this.newObjectId();
    const fields: Variable[] = classDef.fields.map(f => ({
      name: f.name,
      type: f.type,
      value: isPrimitive(f.type) ? 0 : NULL_REF,
    }));
    const obj: HeapObject = { id, className, fields };
    this.heap.set(id, obj);
    const ref: Reference = { kind: 'ref', heapId: id };

    this.addStep(line, `Create new ${className} object (${id})`, { newHeapIds: [id] });

    // Execute constructor — pick the one whose parameter count matches
    const ctor = classDef.constructors.find(c => c.params.length === args.length)
      ?? classDef.constructors[0];
    if (ctor) {
      const frame: StackFrame = { id: this.newFrameId(), label: `${className}(${ctor.params.map(p => p.type).join(', ')})`, variables: [] };
      // Bind params — args are already VarValue (strings already boxed above)
      ctor.params.forEach((p, i) => {
        frame.variables.push({ name: p.name, type: p.type, value: args[i] ?? NULL_REF });
      });
      this.callStack.push(frame);
      this.thisStack.push(ref);

      this.addStep(line, `Enter ${className} constructor`, { newVarKeys: ctor.params.map(p => `${frame.id}:${p.name}`) });

      for (const stmt of ctor.body) {
        const ret = this.execStatement(stmt);
        if (ret === 'return') break;
      }

      this.thisStack.pop();
      this.callStack.pop();
      this.addStep(line, `Exit ${className} constructor`);
    }

    return ref;
  }

  private evalMethodCall(objVal: EvalValue | null, method: string, argExprs: Expr[], line: number): EvalValue {
    // System.out.println special case
    if (method === 'println') {
      const args = argExprs.map(a => this.evalExpr(a));
      const text = args.map(a => {
        if (typeof a === 'string') return a;
        if (typeof a === 'number' || typeof a === 'boolean') return String(a);
        if (isRef(a)) {
          if (a.heapId === null) return 'null';
          const obj = this.heap.get(a.heapId);
          if (obj?.isString) return obj.stringValue ?? '';
          return obj ? `${obj.className}@${obj.id}` : 'null';
        }
        return String(a);
      }).join('');
      this.output.push(text);
      this.addStep(line, `System.out.println("${text}")`);
      return NULL_REF;
    }

    // print (without newline) - same handling
    if (method === 'print') {
      return this.evalMethodCall(objVal, 'println', argExprs, line);
    }

    // Static method call (no object qualifier) — search all registered classes
    if (objVal === null) {
      for (const [, cls] of this.classes) {
        const methodDef = cls.methods.find(m => m.name === method);
        if (methodDef) {
          const args = this.evalArgs(argExprs);
          const frame: StackFrame = { id: this.newFrameId(), label: `${cls.name}.${method}()`, variables: [] };
          methodDef.params.forEach((p, i) => {
            frame.variables.push({ name: p.name, type: p.type, value: args[i] ?? NULL_REF });
          });
          this.callStack.push(frame);
          this.thisStack.push(null);
          this.addStep(line, `Call ${cls.name}.${method}()`, {
            newVarKeys: methodDef.params.map(p => `${frame.id}:${p.name}`),
          });
          let returnValue: EvalValue = NULL_REF;
          for (const stmt of methodDef.body) {
            const ret = this.execStatement(stmt);
            if (ret !== undefined && ret !== 'return') { returnValue = ret as EvalValue; break; }
            if (ret === 'return') break;
          }
          this.thisStack.pop();
          this.callStack.pop();
          this.addStep(line, `Return from ${cls.name}.${method}()`);
          return returnValue;
        }
      }
      throw new Error(`Line ${line}: static method '${method}' not found`);
    }

    // User-defined instance method call
    if (!isRef(objVal) || objVal.heapId === null) {
      throw new Error(`Line ${line}: method call on non-object`);
    }
    const obj = this.heap.get(objVal.heapId!);
    if (!obj) throw new Error(`Line ${line}: heap object not found`);

    const classDef = this.classes.get(obj.className);
    if (!classDef) throw new Error(`Line ${line}: class '${obj.className}' not found`);

    const methodDef = classDef.methods.find(m => m.name === method);
    if (!methodDef) throw new Error(`Line ${line}: method '${method}' not found on ${obj.className}`);

    // Box string args with steps before pushing the call frame
    const args = this.evalArgs(argExprs);
    const frame: StackFrame = { id: this.newFrameId(), label: `${obj.className}.${method}()`, variables: [] };
    methodDef.params.forEach((p, i) => {
      frame.variables.push({ name: p.name, type: p.type, value: args[i] ?? NULL_REF });
    });

    this.callStack.push(frame);
    this.thisStack.push(objVal as Reference);

    this.addStep(line, `Call ${obj.className}.${method}()`, {
      newVarKeys: methodDef.params.map(p => `${frame.id}:${p.name}`),
    });

    let returnValue: EvalValue = NULL_REF;
    for (const stmt of methodDef.body) {
      const ret = this.execStatement(stmt);
      if (ret !== undefined && ret !== 'return') {
        returnValue = ret as EvalValue;
        break;
      }
      if (ret === 'return') break;
    }

    this.thisStack.pop();
    this.callStack.pop();
    this.addStep(line, `Return from ${obj.className}.${method}()`);

    return returnValue;
  }

  private evalMathMethod(method: string, argExprs: Expr[], line: number): number {
    const args = argExprs.map(a => this.evalExpr(a)) as number[];
    switch (method) {
      case 'sqrt':  return Math.sqrt(args[0]);
      case 'pow':   return Math.pow(args[0], args[1]);
      case 'abs':   return Math.abs(args[0]);
      case 'max':   return Math.max(args[0], args[1]);
      case 'min':   return Math.min(args[0], args[1]);
      case 'floor': return Math.floor(args[0]);
      case 'ceil':  return Math.ceil(args[0]);
      case 'round': return Math.round(args[0]);
      case 'log':   return Math.log(args[0]);
      case 'log10': return Math.log10(args[0]);
      default: throw new Error(`Line ${line}: Math.${method}() is not supported`);
    }
  }

  // ── Statement execution ──────────────────────────────────────────────────────

  private execStatement(stmt: Statement): EvalValue | 'return' | undefined {
    switch (stmt.kind) {
      case 'VarDeclStmt': {
        const val = this.evalExpr(stmt.init);
        const stored: VarValue = typeof val === 'string' ? this.boxString(val) : val as VarValue;
        const newHeapIds: string[] = [];
        if (isRef(stored) && stored.heapId) {
          const obj = this.heap.get(stored.heapId);
          if (obj?.isString) newHeapIds.push(stored.heapId);
        }
        const key = this.declareVar(stmt.name, stmt.type, stored);
        this.addStep(stmt.line, `Declare ${stmt.type} ${stmt.name} = ${this.evalValueToDisplay(val)}`, {
          newVarKeys: [key],
          newHeapIds,
        });
        return undefined;
      }

      case 'AssignStmt': {
        const val = this.evalExpr(stmt.value);

        if (stmt.target.kind === 'IdentifierExpr') {
          const name = stmt.target.name;
          const stored: VarValue = typeof val === 'string' ? this.boxString(val) : val as VarValue;
          if (!this.setVar(name, stored)) {
            // Not a local variable — fall through to implicit this.field assignment
            const thisRef = this.currentThis;
            if (thisRef?.heapId) {
              const thisObj = this.heap.get(thisRef.heapId);
              if (thisObj) {
                const field = thisObj.fields.find(f => f.name === name);
                if (field) {
                  const newHeapIds: string[] = [];
                  if (isRef(stored) && stored.heapId) {
                    const ro = this.heap.get(stored.heapId);
                    if (ro?.isString) newHeapIds.push(stored.heapId);
                  }
                  field.value = stored;
                  this.addStep(stmt.line, `Set ${thisObj.className}.${name} = ${this.evalValueToDisplay(val)}`, {
                    changedHeapId: thisObj.id,
                    changedField: name,
                    newHeapIds,
                  });
                  return undefined;
                }
              }
            }
          }
          this.addStep(stmt.line, `${name} = ${this.evalValueToDisplay(val)}`);
        } else {
          // FieldAccessExpr
          const target = stmt.target;
          let objRef: EvalValue;
          if (target.object.kind === 'ThisExpr') {
            objRef = this.currentThis ?? NULL_REF;
          } else {
            objRef = this.evalExpr(target.object);
          }

          if (!isRef(objRef) || objRef.heapId === null) {
            throw new Error(`Line ${stmt.line}: field assignment on non-object`);
          }
          const obj = this.heap.get(objRef.heapId);
          if (!obj) throw new Error(`Line ${stmt.line}: heap object not found`);

          const stored: VarValue = typeof val === 'string' ? this.boxString(val) : val as VarValue;
          const newHeapIds: string[] = [];
          if (isRef(stored) && stored.heapId) {
            const refObj = this.heap.get(stored.heapId);
            if (refObj?.isString) newHeapIds.push(stored.heapId);
          }

          const fieldVar = obj.fields.find(f => f.name === target.field);
          if (fieldVar) {
            fieldVar.value = stored;
          } else {
            obj.fields.push({ name: target.field, type: 'unknown', value: stored });
          }

          this.addStep(stmt.line, `Set ${obj.className}.${target.field} = ${this.evalValueToDisplay(val)}`, {
            changedHeapId: obj.id,
            changedField: target.field,
            newHeapIds,
          });
        }
        return undefined;
      }

      case 'ExprStmt': {
        this.evalExpr(stmt.expr);
        return undefined;
      }

      case 'ReturnStmt': {
        if (stmt.value) {
          const val = this.evalExpr(stmt.value);
          this.addStep(stmt.line, `return ${this.evalValueToDisplay(val)}`);
          return val;
        }
        this.addStep(stmt.line, `return`);
        return 'return';
      }

      case 'IfStmt': {
        const cond = this.evalExpr(stmt.condition);
        this.addStep(stmt.line, `if (${!!cond}) → ${!!cond ? 'true branch' : 'false branch'}`);
        const branch = !!cond ? stmt.thenBranch : (stmt.elseBranch ?? []);
        for (const s of branch) {
          const r = this.execStatement(s);
          if (r !== undefined) return r;
        }
        return undefined;
      }

      case 'WhileStmt': {
        let iterations = 0;
        while (iterations < 100) { // guard against infinite loops
          const cond = this.evalExpr(stmt.condition);
          this.addStep(stmt.line, `while (${!!cond})`);
          if (!cond) break;
          for (const s of stmt.body) {
            const r = this.execStatement(s);
            if (r !== undefined) return r;
          }
          iterations++;
        }
        return undefined;
      }
    }
  }

  // ── Entry point ──────────────────────────────────────────────────────────────

  run(source: string): SimulationStep[] {
    this.heap.clear();
    this.callStack = [];
    this.output = [];
    this.steps = [];
    this.stringCounter = 0;
    this.objectCounter = 0;
    this.frameCounter = 0;
    this.classes.clear();
    this.thisStack = [];

    const program = parse(source);

    for (const cls of program.classes) {
      this.classes.set(cls.name, cls);
    }

    // Find the first class that has a static main(String[] args) method
    let mainFound = false;
    for (const cls of program.classes) {
      const mainMethod = cls.methods.find(m => m.name === 'main');
      if (mainMethod) {
        mainFound = true;
        const frame: StackFrame = {
          id: this.newFrameId(),
          label: `${cls.name}.main()`,
          variables: [],
        };
        this.callStack.push(frame);
        this.thisStack.push(null);

        this.addStep(mainMethod.line, `Entering ${cls.name}.main()`);

        for (const stmt of mainMethod.body) {
          const ret = this.execStatement(stmt);
          if (ret !== undefined) break;
        }

        this.thisStack.pop();
        this.callStack.pop();
        break;
      }
    }

    // Fallback: run top-level statements (no class/main required)
    if (!mainFound) {
      const frame: StackFrame = { id: this.newFrameId(), label: 'main', variables: [] };
      this.callStack.push(frame);
      this.thisStack.push(null);
      this.addStep(0, 'Program starts');
      for (const stmt of program.statements) {
        this.execStatement(stmt);
      }
    }

    if (!this.steps.length || this.steps[this.steps.length - 1].description !== 'Program ends') {
      this.addStep(0, 'Program ends');
    }

    return this.steps;
  }
}

export function runSimulation(source: string): SimulationStep[] {
  return new Interpreter().run(source);
}

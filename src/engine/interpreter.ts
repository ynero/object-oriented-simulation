import { parse } from './parser';
import type {
  Program, ClassDecl, Statement, Expr,
  MemoryState, StackFrame, HeapObject, Variable, VarValue, Reference, SimulationStep,
  IdentifierExpr, FieldAccessExpr, ArrayAccessExpr,
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
  private pendingLine = '';
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
        elements: o.elements ? [...o.elements] : undefined,
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
    const existing = frame.variables.find(v => v.name === name);
    if (existing) { existing.value = value; return `${frame.id}:${name}`; }
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
      if (obj?.isArray && obj.elements) {
        const parts = obj.elements.map(e => this.toJavaString(this.toEvalValue(e)));
        return `[${parts.join(', ')}]`;
      }
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
        const objVal = this.evalExpr(expr.object);
        if (!isRef(objVal) || objVal.heapId === null) {
          throw new Error(`Line ${expr.line}: field access on non-object`);
        }
        const obj = this.heap.get(objVal.heapId);
        if (!obj) throw new Error(`Line ${expr.line}: heap object not found`);
        // .length on arrays and ArrayLists
        if (expr.field === 'length' && obj.isArray) return obj.elements?.length ?? 0;
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
        if ((expr.op === '++' || expr.op === '--') && typeof val === 'number') {
          const newVal = expr.op === '++' ? val + 1 : val - 1;
          if (expr.operand.kind === 'IdentifierExpr') {
            const name = (expr.operand as IdentifierExpr).name;
            if (!this.setVar(name, newVal)) {
              const thisRef = this.currentThis;
              if (thisRef?.heapId) {
                const obj = this.heap.get(thisRef.heapId);
                const field = obj?.fields.find(f => f.name === name);
                if (field) field.value = newVal;
              }
            }
          } else if (expr.operand.kind === 'ArrayAccessExpr') {
            const aa = expr.operand as ArrayAccessExpr;
            const arrRef = this.evalExpr(aa.array);
            const idx = this.evalExpr(aa.index) as number;
            if (isRef(arrRef) && arrRef.heapId) {
              const arrObj = this.heap.get(arrRef.heapId);
              if (arrObj?.isArray && arrObj.elements) arrObj.elements[idx] = newVal;
            }
          }
          return val; // post-increment: return original value
        }
        return val;
      }

      case 'ArrayAccessExpr': {
        const arrRef = this.evalExpr(expr.array);
        if (!isRef(arrRef) || arrRef.heapId === null) throw new Error(`Line ${expr.line}: array access on non-array`);
        const arrObj = this.heap.get(arrRef.heapId);
        if (!arrObj?.isArray || !arrObj.elements) throw new Error(`Line ${expr.line}: not an array`);
        const idx = this.evalExpr(expr.index) as number;
        if (idx < 0 || idx >= arrObj.elements.length) throw new Error(`Line ${expr.line}: array index ${idx} out of bounds (length ${arrObj.elements.length})`);
        return this.toEvalValue(arrObj.elements[idx]);
      }

      case 'NewArrayExpr': {
        const dims = expr.dimensions.map(d => this.evalExpr(d) as number);
        if (dims.length === 1) return this.evalNewArray(expr.elementType, dims[0], expr.line);
        return this.evalNewArrayND(expr.elementType, dims, expr.line);
      }

      case 'ArrayInitExpr': {
        const elements = expr.elements.map(e => {
          const v = this.evalExpr(e);
          if (typeof v === 'string') {
            const ref = this.boxString(v);
            this.addStep(e.line, `Allocate String "${v}" on heap`, { newHeapIds: [ref.heapId!] });
            return ref;
          }
          return v as VarValue;
        });
        const id = this.newObjectId();
        const elementType = this.inferElementType(elements);
        const obj: HeapObject = { id, className: `${elementType}[]`, fields: [], isArray: true, arrayElementType: elementType, elements };
        this.heap.set(id, obj);
        const ref: Reference = { kind: 'ref', heapId: id };
        this.addStep(0, `Create ${elementType}[${elements.length}] array (${id})`, { newHeapIds: [id] });
        return ref;
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
    // ArrayList built-in
    if (className === 'ArrayList') {
      const id = this.newObjectId();
      const obj: HeapObject = { id, className: 'ArrayList', fields: [], isArray: true, arrayElementType: 'Object', elements: [] };
      this.heap.set(id, obj);
      const ref: Reference = { kind: 'ref', heapId: id };
      this.addStep(line, `Create ArrayList (${id})`, { newHeapIds: [id] });
      return ref;
    }

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
    // System.out.println / print
    if (method === 'println' || method === 'print') {
      const args = argExprs.map(a => this.evalExpr(a));
      const text = args.map(a => this.toJavaString(a)).join('');
      if (method === 'print') {
        this.pendingLine += text;
        this.addStep(line, `System.out.print("${text}")`);
      } else {
        const fullLine = this.pendingLine + text;
        this.pendingLine = '';
        this.output.push(fullLine);
        this.addStep(line, `System.out.println("${fullLine}")`);
      }
      return NULL_REF;
    }

    // ArrayList / array built-in methods
    if (isRef(objVal) && objVal.heapId) {
      const listObj = this.heap.get(objVal.heapId);
      if (listObj?.isArray && listObj.elements !== undefined) {
        const elems = listObj.elements;
        switch (method) {
          case 'add': {
            const args = this.evalArgs(argExprs);
            if (args.length === 2) {
              // add(index, element) — insert at position
              const idx = args[0] as number;
              elems.splice(idx, 0, args[1]);
              this.addStep(line, `${listObj.className}.add(${idx}, ${this.evalValueToDisplay(args[1])})`, { changedHeapId: listObj.id });
            } else {
              elems.push(args[0]);
              this.addStep(line, `${listObj.className}.add(${this.evalValueToDisplay(args[0])})`, { changedHeapId: listObj.id });
            }
            return { kind: 'ref', heapId: null } as Reference;
          }
          case 'get': {
            const args = argExprs.map(a => this.evalExpr(a));
            const idx = args[0] as number;
            if (idx < 0 || idx >= elems.length) throw new Error(`Line ${line}: index ${idx} out of bounds (size ${elems.length})`);
            this.addStep(line, `${listObj.className}.get(${idx})`, { changedHeapId: listObj.id, changedField: String(idx) });
            return this.toEvalValue(elems[idx]) as Reference;
          }
          case 'set': {
            const args = this.evalArgs(argExprs);
            const idx = args[0] as number;
            const old = elems[idx];
            elems[idx] = args[1];
            this.addStep(line, `${listObj.className}.set(${idx}, ${this.evalValueToDisplay(args[1])})`, { changedHeapId: listObj.id, changedField: String(idx) });
            return this.toEvalValue(old) as Reference;
          }
          case 'remove': {
            const args = argExprs.map(a => this.evalExpr(a));
            const idx = args[0] as number;
            const removed = elems.splice(idx, 1)[0];
            this.addStep(line, `${listObj.className}.remove(${idx})`, { changedHeapId: listObj.id });
            return this.toEvalValue(removed) as Reference;
          }
          case 'size': {
            this.addStep(line, `${listObj.className}.size() = ${elems.length}`);
            return elems.length;
          }
          case 'length': {
            return elems.length;
          }
          case 'isEmpty': {
            const empty = elems.length === 0;
            this.addStep(line, `${listObj.className}.isEmpty() = ${empty}`);
            return empty;
          }
          case 'clear': {
            elems.length = 0;
            this.addStep(line, `${listObj.className}.clear()`, { changedHeapId: listObj.id });
            return NULL_REF;
          }
          case 'contains': {
            const args = argExprs.map(a => this.evalExpr(a));
            const needle = this.toJavaString(args[0]);
            const found = elems.some(e => this.toJavaString(this.toEvalValue(e)) === needle);
            this.addStep(line, `${listObj.className}.contains() = ${found}`);
            return found;
          }
          case 'toString': {
            const parts = elems.map(e => this.toJavaString(this.toEvalValue(e)));
            return `[${parts.join(', ')}]`;
          }
        }
      }
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

  private evalNewArrayND(elementType: string, dims: number[], line: number): Reference {
    // Create inner arrays without steps, then one outer step
    const innerRefs: string[] = [];
    const createInner = (depth: number): Reference => {
      const id = this.newObjectId();
      innerRefs.push(id);
      const innerElementType = depth === 1 ? elementType : elementType + '[]'.repeat(dims.length - depth);
      const elements: VarValue[] = depth === 1
        ? new Array(dims[dims.length - 1]).fill(isPrimitive(elementType) ? 0 : NULL_REF)
        : Array.from({ length: dims[dims.length - depth] }, () => createInner(depth - 1));
      const className = elementType + '[]'.repeat(depth);
      const obj: HeapObject = { id, className, fields: [], isArray: true, arrayElementType: innerElementType, elements };
      this.heap.set(id, obj);
      return { kind: 'ref', heapId: id };
    };

    const outerRef = createInner(dims.length);
    const outerObj = this.heap.get(outerRef.heapId!)!;
    this.addStep(line, `Create ${outerObj.className} (${dims.join('×')}) array (${outerRef.heapId})`, {
      newHeapIds: innerRefs,
    });
    return outerRef;
  }

  private evalNewArray(elementType: string, size: number, line: number): Reference {
    const id = this.newObjectId();
    const defaultVal: VarValue = isPrimitive(elementType) ? 0 : NULL_REF;
    const elements: VarValue[] = new Array(size).fill(defaultVal);
    const obj: HeapObject = { id, className: `${elementType}[]`, fields: [], isArray: true, arrayElementType: elementType, elements };
    this.heap.set(id, obj);
    const ref: Reference = { kind: 'ref', heapId: id };
    this.addStep(line, `Create ${elementType}[${size}] array (${id})`, { newHeapIds: [id] });
    return ref;
  }

  private inferElementType(elements: VarValue[]): string {
    if (elements.length === 0) return 'Object';
    const first = elements[0];
    if (isRef(first) && first.heapId) {
      const obj = this.heap.get(first.heapId);
      return obj?.isString ? 'String' : (obj?.className ?? 'Object');
    }
    if (typeof first === 'number') return Number.isInteger(first) ? 'int' : 'double';
    if (typeof first === 'boolean') return 'boolean';
    return 'Object';
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
        } else if (stmt.target.kind === 'ArrayAccessExpr') {
          // arr[i] = val
          const target = stmt.target as ArrayAccessExpr;
          const arrRef = this.evalExpr(target.array);
          if (!isRef(arrRef) || arrRef.heapId === null) throw new Error(`Line ${stmt.line}: array assignment on non-array`);
          const arrObj = this.heap.get(arrRef.heapId);
          if (!arrObj?.isArray || !arrObj.elements) throw new Error(`Line ${stmt.line}: not an array`);
          const idx = this.evalExpr(target.index) as number;
          const stored: VarValue = typeof val === 'string' ? this.boxString(val) : val as VarValue;
          const newHeapIds: string[] = [];
          if (isRef(stored) && stored.heapId) {
            const ro = this.heap.get(stored.heapId);
            if (ro?.isString) newHeapIds.push(stored.heapId);
          }
          arrObj.elements[idx] = stored;
          this.addStep(stmt.line, `Set ${arrObj.className}[${idx}] = ${this.evalValueToDisplay(val)}`, {
            changedHeapId: arrObj.id,
            changedField: String(idx),
            newHeapIds,
          });
        } else {
          // FieldAccessExpr
          const target = stmt.target as FieldAccessExpr;
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

      case 'ForStmt': {
        if (stmt.init) this.execStatement(stmt.init);
        let iterations = 0;
        while (iterations < 1000) {
          if (stmt.condition) {
            const cond = this.evalExpr(stmt.condition);
            this.addStep(stmt.line, `for (${!!cond})`);
            if (!cond) break;
          }
          for (const s of stmt.body) {
            const r = this.execStatement(s);
            if (r !== undefined) return r;
          }
          if (stmt.update) this.execStatement(stmt.update);
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
    this.pendingLine = '';
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

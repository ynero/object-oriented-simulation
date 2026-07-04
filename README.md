# Java OOP Simulator
# Author: ynero
# https://github.com/ynero

A browser-based tool that animates Java code execution step by step, showing exactly how objects and variables are organized in memory.

## What it does

- **Left panel** — Monaco code editor where you write Java code
- **Right panel** — Live memory visualization split into Stack and Heap
- **Bottom bar** — Step through execution one statement at a time, or drag the slider to jump to any point

Each step highlights the active line in the editor and animates changes in memory — new stack frames, heap objects being created, fields being assigned, and method calls being entered and exited.

## Supported Java subset

| Feature | Example |
|---|---|
| Primitive variables | `int x = 5;` |
| String variables | `String name = "Alice";` |
| Class declarations | `class Dog { ... }` |
| Constructors | `Dog(String name, int age) { ... }` |
| Object creation | `Dog d = new Dog("Rex", 3);` |
| Field access/assignment | `d.age = 4;` |
| Method calls | `d.bark();` |
| `System.out.println` | `System.out.println(name);` |
| `if` / `while` | basic control flow |
| Arithmetic & comparison | `+`, `-`, `*`, `/`, `==`, `<`, `&&`, etc. |

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or newer
- npm (comes with Node.js)

## Setup

```bash
# 1. Install dependencies (only needed once)
npm install

# 2. Start the development server
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## Usage

1. Write (or edit) Java code in the left editor
2. Click **▶ Run** to compile and start the simulation
3. Use **Step Forward →** / **← Step Back** to move through execution one step at a time
4. Drag the **slider** at the bottom right to jump to any step
5. Click **↺ Reset** to go back to step 1 without re-compiling
6. Edit the code and click **▶ Run** again at any time

## Build for production

```bash
npm run build
```

The output is placed in `dist/` and can be served with any static file host.

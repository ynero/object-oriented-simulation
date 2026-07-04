import { useState } from 'react';
import { CodeEditor } from './components/CodeEditor';
import { MemoryView } from './components/MemoryView';
import { ControlBar } from './components/ControlBar';
import { useSimulation } from './hooks/useSimulation';

const DEFAULT_CODE = `class Dog {
    String name;
    int age;

    Dog(String name, int age) {
        this.name = name;
        this.age = age;
    }

    void bark() {
        System.out.println(name + " says: Woof!");
    }
}

class Main {
    public static void main(String[] args) {
        int x = 10;
        Dog d1 = new Dog("Rex", 3);
        Dog d2 = new Dog("Buddy", 5);
        d1.age = 4;
        d1.bark();
        d2.bark();
    }
}
`;

export default function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const sim = useSimulation();

  const activeLine = sim.currentStep?.line ?? 0;

  return (
    <div className="app-layout">
      <header className="app-header">
        <span className="app-logo">☕</span>
        <span className="app-title">Java OOP Simulator</span>
        <span className="app-subtitle">Step-by-step memory visualization</span>
      </header>

      <div className="main-area">
        <div className="left-pane">
          <CodeEditor
            value={code}
            onChange={setCode}
            activeLine={activeLine}
          />
        </div>

        <div className="right-pane">
          <MemoryView step={sim.currentStep} />
        </div>
      </div>

      <ControlBar
        status={sim.status}
        stepIndex={sim.stepIndex}
        totalSteps={sim.steps.length}
        canStepForward={sim.canStepForward}
        canStepBack={sim.canStepBack}
        description={sim.status === 'error' ? sim.errorMsg : (sim.currentStep?.description ?? '')}
        onCompile={() => sim.compile(code)}
        onStepForward={sim.stepForward}
        onStepBack={sim.stepBack}
        onReset={sim.reset}
        onJumpTo={sim.jumpTo}
      />
    </div>
  );
}

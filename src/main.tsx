import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, background: '#0f1117', color: '#f87171', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <div style={{ fontSize: 18, marginBottom: 16 }}>⚠ App failed to start</div>
          <div style={{ fontSize: 13 }}>{String(this.state.error)}</div>
          {this.state.error.stack && (
            <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8' }}>{this.state.error.stack}</div>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

window.addEventListener('error', (e) => {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="padding:32px;background:#0f1117;color:#f87171;font-family:monospace;white-space:pre-wrap"><div style="font-size:18px;margin-bottom:16px">⚠ JS Error (uncaught)</div><div>${e.message}</div><div style="margin-top:12px;font-size:11px;color:#94a3b8">${e.filename}:${e.lineno}</div></div>`;
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

import React, { useState, useEffect, useRef } from 'react';

const DebugConsole: React.FC = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    const formatArg = (arg: any) => {
      try {
        if (arg instanceof Error) {
          return `${arg.name}: ${arg.message}\n${arg.stack || ''}`;
        }
        if (typeof arg === 'object') {
          return JSON.stringify(arg);
        }
        return String(arg);
      } catch (e) {
        return '[Circular/Unserializable]';
      }
    };

    console.log = (...args) => {
      const message = args.map(formatArg).join(' ');
      setLogs(prev => [...prev, `[LOG] ${message}`].slice(-100)); // Keep last 100
      originalLog.apply(console, args);
    };

    console.error = (...args) => {
      const message = args.map(formatArg).join(' ');
      setLogs(prev => [...prev, `[ERR] ${message}`].slice(-100));
      originalError.apply(console, args);
    };

    console.warn = (...args) => {
      const message = args.map(formatArg).join(' ');
      setLogs(prev => [...prev, `[WRN] ${message}`].slice(-100));
      originalWarn.apply(console, args);
    };

    return () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, []);

  useEffect(() => {
    if (isVisible && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isVisible]);

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 9999,
          background: 'rgba(0,0,0,0.7)',
          color: '#0f0',
          border: '1px solid #0f0',
          padding: '8px',
          borderRadius: '4px',
          fontFamily: 'monospace',
          fontSize: '12px',
        }}
      >
        DEBUG
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.9)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: '12px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '8px', borderBottom: '1px solid #0f0', display: 'flex', justifyContent: 'space-between' }}>
        <span>Debug Console</span>
        <div>
          <button onClick={() => setLogs([])} style={{ marginRight: '10px', background: 'transparent', color: '#0f0', border: '1px solid #0f0' }}>Clear</button>
          <button onClick={() => setIsVisible(false)} style={{ background: 'transparent', color: '#f00', border: '1px solid #f00' }}>Close</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {logs.map((log, i) => (
          <div key={i} style={{ marginBottom: '4px', borderBottom: '1px solid #333' }}>
            {log}
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

export default DebugConsole;

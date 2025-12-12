import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface ConsoleProps {
  logs: LogEntry[];
  onClear: () => void;
}

const Console: React.FC<ConsoleProps> = ({ logs, onClear }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="flex flex-col h-48 bg-slate-950 border-t border-slate-800">
      <div className="flex justify-between items-center px-4 py-1 bg-slate-900 border-b border-slate-800">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Serial Monitor</span>
        <button 
          onClick={onClear}
          className="text-xs text-slate-500 hover:text-white transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-1">
        {logs.length === 0 && (
          <div className="text-slate-600 italic">No output...</div>
        )}
        {logs.map((log) => (
          <div key={log.id} className={`${log.type === 'error' ? 'text-red-400' : log.type === 'system' ? 'text-blue-400' : 'text-slate-300'}`}>
            <span className="text-slate-600 mr-2">[{new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}]</span>
            {log.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default Console;

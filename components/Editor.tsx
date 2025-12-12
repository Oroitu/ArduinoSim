import React from 'react';

interface EditorProps {
  code: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}

const Editor: React.FC<EditorProps> = ({ code, onChange, disabled }) => {
  return (
    <div className="flex flex-col h-full bg-slate-950 rounded-lg border border-slate-700 overflow-hidden">
      <div className="bg-slate-800 px-4 py-2 text-xs font-mono text-slate-400 border-b border-slate-700 flex justify-between items-center">
        <span>sketch.js</span>
        <span className="text-slate-500">Javascript Mode</span>
      </div>
      <textarea
        value={code}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex-1 w-full h-full bg-transparent text-sm font-mono p-4 text-emerald-400 focus:outline-none resize-none spellcheck-false"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
    </div>
  );
};

export default Editor;

import React from 'react';
import type { AgentToolCallEvent } from '../../types/agent';

interface ToolConfirmModalProps {
  toolCall: AgentToolCallEvent | null;
  onConfirm: (approved: boolean) => void;
}

export const ToolConfirmModal: React.FC<ToolConfirmModalProps> = ({
  toolCall,
  onConfirm,
}) => {
  if (!toolCall || toolCall.status !== 'requires_confirmation') return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-dark-surface border border-red-500/30 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4 animate-scale-up">
        <div className="flex items-center gap-3 text-red-400">
          <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-xl shrink-0">
            ⚠️
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-100">
              High-Risk Action Confirmation
            </h3>
            <p className="text-xs text-red-300">
              The AI Assistant requested a destructive or state-resetting operation.
            </p>
          </div>
        </div>

        <div className="bg-dark-bg border border-dark-border rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between items-center text-xs text-gray-400">
            <span>Requested Tool:</span>
            <span className="font-mono text-brand-primary font-bold">
              {toolCall.tool_name}
            </span>
          </div>
          <div className="border-t border-dark-border pt-2">
            <span className="text-xs text-gray-400 block mb-1">Parameters:</span>
            <pre className="text-xs font-mono bg-dark-surface p-2 rounded text-gray-200 overflow-x-auto max-h-40">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>
        </div>

        <div className="text-xs text-gray-400">
          Please confirm whether you want to allow this action to execute on your remote Jupyter environment.
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={() => onConfirm(false)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-dark-bg hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors"
          >
            Deny & Stop
          </button>
          <button
            onClick={() => onConfirm(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-primary hover:bg-brand-primary/80 text-white shadow-lg shadow-brand-primary/20 transition-all"
          >
            Approve & Execute
          </button>
        </div>
      </div>
    </div>
  );
};

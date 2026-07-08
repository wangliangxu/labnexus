import React, { useEffect, useState } from 'react';
import type { AgentTrace } from '../../types/agent';
import { agentListTraces } from '../../services/tauriIpc';
import './Agent.css';

interface TraceViewerModalProps {
  onClose: () => void;
}

export const TraceViewerModal: React.FC<TraceViewerModalProps> = ({ onClose }) => {
  const [traces, setTraces] = useState<AgentTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrace, setSelectedTrace] = useState<AgentTrace | null>(null);

  useEffect(() => {
    agentListTraces(30)
      .then((data) => {
        setTraces(data);
        if (data.length > 0) setSelectedTrace(data[0]);
      })
      .catch((err) => console.error('Failed to load traces:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-4xl bg-dark-surface border border-dark-border rounded-2xl p-6 shadow-2xl animate-scale-up flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between pb-4 border-b border-dark-border">
          <div className="flex items-center gap-2">
            <span className="text-xl">📊</span>
            <h3 className="text-lg font-bold text-white">
              Agent Execution Audit Logs & Traces
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white px-2 py-1 text-sm rounded hover:bg-dark-border"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-hidden pt-4 grid grid-cols-3 gap-4">
          {/* Left list: Traces */}
          <div className="col-span-1 border-r border-dark-border pr-3 overflow-y-auto flex flex-col gap-2">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
              Recent Executions
            </h4>
            {loading ? (
              <div className="text-xs text-gray-400 py-4 text-center">Loading audit traces...</div>
            ) : traces.length === 0 ? (
              <div className="text-xs text-gray-500 py-8 text-center">No execution traces recorded yet.</div>
            ) : (
              traces.map((trace) => (
                <div
                  key={trace.id}
                  onClick={() => setSelectedTrace(trace)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col gap-1.5 ${
                    selectedTrace?.id === trace.id
                      ? 'border-brand-primary bg-brand-primary/10'
                      : 'border-dark-border hover:bg-dark-border/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                      trace.status === 'Completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {trace.status}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">
                      {trace.total_duration_ms}ms
                    </span>
                  </div>
                  <p className="text-xs text-white font-medium truncate">
                    {trace.task_prompt}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-gray-500">
                    <span>{new Date(trace.start_time).toLocaleTimeString()}</span>
                    {trace.matched_skill && (
                      <span className="text-brand-primary font-mono">/{trace.matched_skill}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Right panel: Timeline step details */}
          <div className="col-span-2 overflow-y-auto pl-1 flex flex-col gap-3">
            {selectedTrace ? (
              <>
                <div className="bg-dark-bg/50 p-3 rounded-xl border border-dark-border flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-300">Task Prompt</span>
                    <span className="text-[10px] text-gray-400 font-mono">ID: {selectedTrace.id}</span>
                  </div>
                  <p className="text-sm text-white font-semibold">{selectedTrace.task_prompt}</p>
                  <div className="flex gap-3 text-xs text-gray-400 mt-2 pt-2 border-t border-dark-border">
                    <span>Duration: <strong className="text-white">{selectedTrace.total_duration_ms} ms</strong></span>
                    <span>Steps: <strong className="text-white">{selectedTrace.steps.length}</strong></span>
                    {selectedTrace.matched_skill && (
                      <span>Skill: <strong className="text-brand-primary">{selectedTrace.matched_skill}</strong></span>
                    )}
                  </div>
                </div>

                <h4 className="text-xs font-bold text-brand-primary uppercase tracking-wider mt-2">
                  ReAct Step Timeline
                </h4>

                <div className="flex flex-col gap-2.5">
                  {selectedTrace.steps.map((step) => (
                    <div
                      key={step.step_number}
                      className="p-3 rounded-xl border border-dark-border bg-dark-bg/30 flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center font-bold font-mono text-[11px]">
                            {step.step_number}
                          </span>
                          <span className="font-bold text-xs text-white">{step.step_type}</span>
                          {step.tool_name && (
                            <span className="text-[11px] font-mono bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                              {step.tool_name}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-gray-400">
                          +{step.duration_ms} ms
                        </span>
                      </div>
                      <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap bg-dark-bg p-2 rounded border border-dark-border mt-1 max-h-32 overflow-y-auto">
                        {step.content}
                      </pre>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                Select an execution trace from the left panel to inspect the ReAct timeline.
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-dark-border mt-4">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-gray-300 hover:text-white bg-dark-border/50 hover:bg-dark-border rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

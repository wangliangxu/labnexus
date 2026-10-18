import React, { useEffect, useState } from 'react';
import type { Skill } from '../../types/agent';
import { agentListSkills } from '../../services/tauriIpc';
import './Agent.css';

interface SkillSelectorProps {
  onSelectSkill: (skill: Skill) => void;
  onClose: () => void;
}

export const SkillSelector: React.FC<SkillSelectorProps> = ({
  onSelectSkill,
  onClose,
}) => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  useEffect(() => {
    agentListSkills()
      .then((data) => {
        setSkills(data);
        if (data.length > 0) setSelectedSkill(data[0]);
      })
      .catch((err) => console.error('Failed to load skills:', err))
      .finally(() => setLoading(false));
  }, []);

  const filteredSkills = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()) ||
      s.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-xl bg-dark-surface border border-dark-border rounded-2xl p-6 shadow-2xl animate-scale-up flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between pb-4 border-b border-dark-border">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <h3 className="text-lg font-bold text-gray-100">
              Scientific Workflow Skills
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-100 px-2 py-1 text-sm rounded hover:bg-dark-border"
          >
            ✕
          </button>
        </div>

        <div className="pt-4 pb-2">
          <input
            type="text"
            placeholder="Search skills (e.g. data analysis, debug, report)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-primary"
          />
        </div>

        <div className="flex-1 overflow-y-auto pt-2 grid grid-cols-1 gap-2">
          {loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              Loading built-in scientific workflows...
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              No matching workflow skills found.
            </div>
          ) : (
            filteredSkills.map((skill) => (
              <div
                key={skill.id}
                onClick={() => setSelectedSkill(skill)}
                className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col gap-1 ${
                  selectedSkill?.id === skill.id
                    ? 'border-brand-primary bg-brand-primary/10 shadow-sm'
                    : 'border-dark-border hover:bg-dark-border/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-gray-100 flex items-center gap-1.5">
                    <span className="text-brand-primary">⚡</span>
                    {skill.name}
                  </span>
                  <span className="text-[10px] font-mono bg-dark-bg px-2 py-0.5 rounded text-gray-400 border border-dark-border">
                    /{skill.id}
                  </span>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed">
                  {skill.description}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-gray-400 font-medium">
                    Steps: {skill.steps.length}
                  </span>
                  <div className="flex gap-1 flex-wrap">
                    {skill.trigger_keywords.slice(0, 3).map((kw, i) => (
                      <span
                        key={i}
                        className="text-[9px] bg-dark-bg/80 px-1.5 py-0.5 rounded text-gray-400"
                      >
                        #{kw}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {selectedSkill && (
          <div className="mt-4 pt-4 border-t border-dark-border bg-dark-bg/50 p-3 rounded-xl">
            <h4 className="text-xs font-bold text-brand-primary uppercase tracking-wider mb-2">
              Workflow Steps Preview
            </h4>
            <div className="max-h-32 overflow-y-auto flex flex-col gap-1.5">
              {selectedSkill.steps.map((st) => (
                <div key={st.step_number} className="text-xs text-gray-300 flex items-start gap-2">
                  <span className="font-mono text-brand-primary font-bold">
                    {st.step_number}.
                  </span>
                  <div>
                    <span className="font-semibold text-gray-100">{st.title}: </span>
                    <span className="text-gray-400">{st.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-dark-border mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-gray-100 rounded-lg hover:bg-dark-border transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!selectedSkill}
            onClick={() => {
              if (selectedSkill) {
                onSelectSkill(selectedSkill);
                onClose();
              }
            }}
            className="px-5 py-2 text-xs font-bold text-white bg-brand-primary hover:bg-brand-primary/80 rounded-lg shadow-brand-primary/20 transition-all disabled:opacity-50"
          >
            Run Workflow Skill
          </button>
        </div>
      </div>
    </div>
  );
};

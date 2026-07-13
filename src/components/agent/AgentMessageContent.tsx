import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, CornerDownLeft, Wrench } from 'lucide-react';
import { marked } from 'marked';
import type { AgentMessage, ToolCall } from '../../types/agent';

interface MarkdownMessageProps {
  content: string;
  onUseCode?: (code: string) => void;
}

function sanitizeMarkdown(content: string): string {
  const raw = marked.parse(content, { breaks: true, gfm: true });
  if (typeof raw !== 'string' || typeof DOMParser === 'undefined') return content;
  const document = new DOMParser().parseFromString(raw, 'text/html');
  document.querySelectorAll('script, style, iframe, object, embed, img').forEach((node) => node.remove());
  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && value.startsWith('javascript:'))) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.tagName === 'A') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noreferrer noopener');
    }
  });
  return document.body.innerHTML;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, onUseCode }) => {
  const segments = useMemo(() => {
    const output: Array<{ type: 'markdown' | 'code'; value: string; language?: string }> = [];
    const pattern = /```([\w.+-]*)\n([\s\S]*?)```/g;
    let cursor = 0;
    for (const match of content.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > cursor) output.push({ type: 'markdown', value: content.slice(cursor, index) });
      output.push({ type: 'code', language: match[1] || 'text', value: match[2].replace(/\n$/, '') });
      cursor = index + match[0].length;
    }
    if (cursor < content.length) output.push({ type: 'markdown', value: content.slice(cursor) });
    return output.length > 0 ? output : [{ type: 'markdown' as const, value: content }];
  }, [content]);

  return (
    <div className="agent-markdown">
      {segments.map((segment, index) => segment.type === 'code' ? (
        <CodeBlock key={`${index}-${segment.language}`} code={segment.value} language={segment.language || 'text'} onUse={onUseCode} />
      ) : (
        <div key={index} dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(segment.value) }} />
      ))}
    </div>
  );
};

const CodeBlock: React.FC<{ code: string; language: string; onUse?: (code: string) => void }> = ({ code, language, onUse }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="agent-code-block">
      <div className="agent-code-block__header">
        <span>{language}</span>
        <div className="flex items-center gap-1">
          {onUse && (
            <button type="button" onClick={() => onUse(code)} aria-label="Use code in prompt" title="Use code in prompt">
              <CornerDownLeft size={13} /> Use
            </button>
          )}
          <button type="button" onClick={copy} aria-label="Copy code" title="Copy code">
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
};

interface ToolExecutionCardProps {
  call: ToolCall;
  result?: AgentMessage;
}

export const ToolExecutionCard: React.FC<ToolExecutionCardProps> = ({ call, result }) => {
  const [expanded, setExpanded] = useState(false);
  const failed = result?.content.toLowerCase().includes('error') || result?.content.toLowerCase().includes('failed');
  const state = result ? (failed ? 'Failed' : 'Completed') : 'Requested';
  return (
    <div className={`agent-tool-card ${failed ? 'agent-tool-card--error' : ''}`}>
      <button type="button" className="agent-tool-card__summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={14} />
        <span className="agent-tool-card__name">{call.function.name}</span>
        <span className={`agent-tool-card__state ${result ? (failed ? 'error' : 'success') : ''}`}>{state}</span>
      </button>
      {expanded && (
        <div className="agent-tool-card__details">
          <div><span>Arguments</span><pre>{formatJson(call.function.arguments)}</pre></div>
          {result && <div><span>Result</span><pre>{result.content}</pre></div>}
        </div>
      )}
    </div>
  );
};

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

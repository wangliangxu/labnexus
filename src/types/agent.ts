/**
 * agent.ts — TypeScript definitions for AI Agent ReAct messages, tools, and configuration.
 */

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  timestamp: string;
}

export interface AgentChatContext {
  notebook_path?: string;
  active_cell_index?: number;
  active_cell_code?: string;
  kernel_status?: string;
  last_error?: string;
}

export interface AgentStreamEvent {
  session_id: string;
  chunk_type: 'thought' | 'answer' | 'done' | 'error';
  content: string;
}

export interface AgentToolCallEvent {
  session_id: string;
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'error' | 'requires_confirmation';
  result?: string;
}

export interface RemoteApiConfig {
  enabled: boolean;
  api_key: string;
  base_url: string;
  chat_model: string;
  reasoning_model: string;
  temperature: number;
  top_p: number;
  timeout_seconds: number;
}

export interface OllamaConfig {
  enabled: boolean;
  base_url: string;
  chat_model: string;
  temperature: number;
  top_p: number;
  timeout_seconds: number;
}

export interface AiConfig {
  provider: 'remote' | 'ollama';
  remote: RemoteApiConfig;
  ollama: OllamaConfig;
}

export interface SkillParameter {
  name: string;
  description: string;
  required: boolean;
  default_value?: string;
}

export interface SkillStep {
  step_number: number;
  title: string;
  description: string;
  suggested_tool?: string;
  suggested_code?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  trigger_keywords: string[];
  parameters: SkillParameter[];
  steps: SkillStep[];
  system_prompt_addon: string;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface TraceStep {
  step_number: number;
  step_type: string;
  content: string;
  tool_name?: string;
  duration_ms: number;
  timestamp: string;
}

export interface AgentTrace {
  id: string;
  task_prompt: string;
  status: string;
  start_time: string;
  end_time?: string;
  total_duration_ms: number;
  steps: TraceStep[];
  matched_skill?: string;
  used_knowledge_ids: string[];
}

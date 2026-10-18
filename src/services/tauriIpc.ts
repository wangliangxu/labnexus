/**
 * Tauri IPC service — Type-safe wrappers for Tauri invoke calls.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  LocalJupyterInstallation,
  JupyterServerConfig,
  JupyterHubLoginConfig,
  ServerConnection,
  ContentItem,
  KernelInfo,
  SessionInfo,
  TerminalInfo,
} from '../types/jupyter';

// ─── Jupyter Connection ────────────────────────────────────────────

export async function jupyterConnect(
  config: JupyterServerConfig
): Promise<ServerConnection> {
  return invoke('jupyter_connect', { config });
}

export async function jupyterHubLogin(
  req: JupyterHubLoginConfig
): Promise<ServerConnection> {
  return invoke('jupyter_hub_login', { req });
}

export async function jupyterDisconnect(serverId: string): Promise<void> {
  return invoke('jupyter_disconnect', { serverId });
}

export async function jupyterListServers(): Promise<ServerConnection[]> {
  return invoke('jupyter_list_servers');
}

export async function jupyterSetActive(serverId: string): Promise<void> {
  return invoke('jupyter_set_active', { serverId });
}

export async function jupyterRestartHubServer(
  serverId: string,
  restartUrl: string
): Promise<ServerConnection> {
  return invoke('jupyter_restart_hub_server', { serverId, restartUrl });
}

export function jupyterDetectLocal(): Promise<LocalJupyterInstallation | null> {
  return invoke('jupyter_detect_local');
}

export function jupyterStartLocal(): Promise<ServerConnection> {
  return invoke('jupyter_start_local');
}

// ─── Contents API ──────────────────────────────────────────────────

export async function jupyterListContents(
  path: string,
  serverId?: string
): Promise<ContentItem> {
  return invoke('jupyter_list_contents', { serverId, path });
}

export async function jupyterGetContent(
  path: string,
  serverId?: string
): Promise<ContentItem> {
  return invoke('jupyter_get_content', { serverId, path });
}

export async function jupyterSaveContent(
  path: string,
  content: unknown,
  serverId?: string
): Promise<ContentItem> {
  return invoke('jupyter_save_content', { serverId, path, content });
}

export async function jupyterCreateContent(
  path: string,
  contentType: string,
  serverId?: string
): Promise<ContentItem> {
  return invoke('jupyter_create_content', { serverId, path, contentType });
}

export async function jupyterDeleteContent(
  path: string,
  serverId?: string
): Promise<void> {
  return invoke('jupyter_delete_content', { serverId, path });
}

// ─── Kernels API ───────────────────────────────────────────────────

export async function jupyterListKernels(
  serverId?: string
): Promise<KernelInfo[]> {
  return invoke('jupyter_list_kernels', { serverId });
}

export async function jupyterStartKernel(
  kernelName: string,
  serverId?: string
): Promise<KernelInfo> {
  return invoke('jupyter_start_kernel', { serverId, kernelName });
}

export async function jupyterShutdownKernel(
  kernelId: string,
  serverId?: string
): Promise<void> {
  return invoke('jupyter_shutdown_kernel', { serverId, kernelId });
}

export async function jupyterInterruptKernel(
  kernelId: string,
  serverId?: string
): Promise<void> {
  return invoke('jupyter_interrupt_kernel', { serverId, kernelId });
}

export async function jupyterRestartKernel(
  kernelId: string,
  serverId?: string
): Promise<void> {
  return invoke('jupyter_restart_kernel', { serverId, kernelId });
}

// ─── Sessions API ──────────────────────────────────────────────────

export async function jupyterListSessions(
  serverId?: string
): Promise<SessionInfo[]> {
  return invoke('jupyter_list_sessions', { serverId });
}

export async function jupyterCreateSession(
  path: string,
  kernelName: string,
  serverId?: string
): Promise<SessionInfo> {
  return invoke('jupyter_create_session', { serverId, path, kernelName });
}

// ─── Kernel WebSocket API ──────────────────────────────────────────

export async function jupyterConnectKernelWs(
  kernelId: string,
  serverId?: string
): Promise<void> {
  return invoke('jupyter_connect_kernel_ws', { serverId, kernelId });
}

export async function jupyterSendKernelMsg(
  kernelId: string,
  msg: unknown
): Promise<void> {
  return invoke('jupyter_send_kernel_msg', { kernelId, msg });
}

export async function jupyterDisconnectKernelWs(
  kernelId: string
): Promise<void> {
  return invoke('jupyter_disconnect_kernel_ws', { kernelId });
}

// ─── AI Agent API ──────────────────────────────────────────────────

import type { AgentChatContext, AgentMessage, AgentSessionListItem, AiConfig, ExternalMcpConfigFile, Skill, KnowledgeEntry, AgentTrace } from '../types/agent';

export async function agentRunTask(
  sessionId: string,
  runId: string,
  prompt: string,
  context?: AgentChatContext
): Promise<void> {
  return invoke('agent_run_task', { sessionId, runId, prompt, context });
}

export async function agentConfirmTool(
  sessionId: string,
  runId: string,
  toolCallId: string,
  approved: boolean,
  approvalScope: 'once' | 'session' = 'once'
): Promise<void> {
  return invoke('agent_confirm_tool', {
    sessionId,
    runId,
    toolCallId,
    approved,
    approvalScope,
  });
}

export async function agentCancelTask(
  sessionId: string,
  runId?: string,
  interruptKernel: boolean = false
): Promise<void> {
  return invoke('agent_cancel_task', { sessionId, runId, interruptKernel });
}

export async function agentCompleteNotebookAction(
  actionId: string,
  success: boolean,
  message: string
): Promise<void> {
  return invoke('agent_complete_notebook_action', { actionId, success, message });
}

export async function agentGetConfig(): Promise<AiConfig> {
  return invoke('agent_get_config');
}

export async function agentSaveConfig(config: AiConfig): Promise<void> {
  return invoke('agent_save_config', { config });
}

export async function agentGetMcpConfig(): Promise<ExternalMcpConfigFile> {
  return invoke('agent_get_mcp_config');
}

export async function agentSaveMcpConfig(config: ExternalMcpConfigFile): Promise<string[]> {
  return invoke('agent_save_mcp_config', { config });
}

export async function agentMcpCapabilities(serverId: string): Promise<Record<string, unknown>> {
  return invoke('agent_mcp_capabilities', { serverId });
}

export async function agentMcpListResources(serverId: string): Promise<Record<string, unknown>> {
  return invoke('agent_mcp_list_resources', { serverId });
}

export async function agentMcpListResourceTemplates(serverId: string): Promise<Record<string, unknown>> {
  return invoke('agent_mcp_list_resource_templates', { serverId });
}

export async function agentMcpReadResource(serverId: string, uri: string): Promise<Record<string, unknown>> {
  return invoke('agent_mcp_read_resource', { serverId, uri });
}

export async function agentMcpListPrompts(serverId: string): Promise<Record<string, unknown>> {
  return invoke('agent_mcp_list_prompts', { serverId });
}

export async function agentMcpGetPrompt(
  serverId: string,
  name: string,
  promptArguments: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  return invoke('agent_mcp_get_prompt', { serverId, name, arguments: promptArguments });
}

export async function agentGetHistory(
  sessionId: string
): Promise<AgentMessage[]> {
  return invoke('agent_get_history', { sessionId });
}

export async function agentClearSession(sessionId: string): Promise<void> {
  return invoke('agent_clear_session', { sessionId });
}

export async function agentListSessions(): Promise<AgentSessionListItem[]> {
  return invoke('agent_list_sessions');
}

export async function agentCreateSession(
  sessionId: string,
  title: string,
  context?: AgentChatContext
): Promise<void> {
  return invoke('agent_create_session', { sessionId, title, context });
}

export async function agentRenameSession(sessionId: string, title: string): Promise<void> {
  return invoke('agent_rename_session', { sessionId, title });
}

export async function agentListSkills(): Promise<Skill[]> {
  return invoke('agent_list_skills');
}

export async function agentListKnowledge(): Promise<KnowledgeEntry[]> {
  return invoke('agent_list_knowledge');
}

export async function agentSaveKnowledge(entry: KnowledgeEntry): Promise<void> {
  return invoke('agent_save_knowledge', { entry });
}

export async function agentDeleteKnowledge(id: string): Promise<void> {
  return invoke('agent_delete_knowledge', { id });
}

export async function agentListTraces(limit?: number): Promise<AgentTrace[]> {
  return invoke('agent_list_traces', { limit });
}

// ─── Terminals API ─────────────────────────────────────────────────

export async function jupyterListTerminals(serverId?: string): Promise<TerminalInfo[]> {
  return invoke('jupyter_list_terminals', { serverId });
}

export async function jupyterCreateTerminal(serverId?: string): Promise<TerminalInfo> {
  return invoke('jupyter_create_terminal', { serverId });
}

export async function jupyterDeleteTerminal(name: string, serverId?: string): Promise<void> {
  return invoke('jupyter_delete_terminal', { name, serverId });
}

export async function jupyterConnectTerminal(name: string, serverId?: string): Promise<void> {
  return invoke('jupyter_connect_terminal', { name, serverId });
}

export async function jupyterSendTerminalInput(name: string, data: string, serverId?: string): Promise<void> {
  return invoke('jupyter_send_terminal_input', { name, data, serverId });
}

export async function jupyterResizeTerminal(name: string, rows: number, cols: number, serverId?: string): Promise<void> {
  return invoke('jupyter_resize_terminal', { name, rows, cols, serverId });
}

export async function jupyterDisconnectTerminal(name: string, serverId?: string): Promise<void> {
  return invoke('jupyter_disconnect_terminal', { name, serverId });
}

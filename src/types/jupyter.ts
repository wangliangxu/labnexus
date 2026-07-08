/**
 * Jupyter-related TypeScript types.
 * Mirrors the Rust types in src-tauri/src/jupyter/types.rs.
 */

// ─── Server & Connection ───────────────────────────────────────────

export interface JupyterServerConfig {
  id: string;
  name: string;
  base_url: string;
  token?: string;
  proxy?: ProxyConfig;
}

export interface JupyterHubLoginConfig {
  id?: string;
  url: string;
  username: string;
  password: string;
  proxy?: ProxyConfig;
  name?: string;
}

export interface ProxyConfig {
  proxy_type: 'socks5' | 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ServerInfo {
  version: string;
  base_url: string;
  hostname: string;
  pid: number;
}

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface ServerConnection {
  config: JupyterServerConfig;
  status: ConnectionStatus;
  server_info?: ServerInfo;
  error_message?: string;
}

export interface TerminalInfo {
  name: string;
}

// ─── Contents API ──────────────────────────────────────────────────

export type ContentType = 'directory' | 'file' | 'notebook';

export interface ContentItem {
  name: string;
  path: string;
  content_type: ContentType;
  writable: boolean;
  created?: string;
  last_modified?: string;
  mimetype?: string;
  format?: string;
  content?: unknown;
  size?: number;
}

// ─── Notebook Document ─────────────────────────────────────────────

export interface NotebookDocument {
  nbformat: number;
  nbformat_minor: number;
  metadata: NotebookMetadata;
  cells: Cell[];
}

export interface NotebookMetadata {
  kernelspec?: KernelSpec;
  language_info?: LanguageInfo;
  [key: string]: unknown;
}

export interface KernelSpec {
  name: string;
  display_name: string;
  language?: string;
}

export interface LanguageInfo {
  name: string;
  version?: string;
  mimetype?: string;
  file_extension?: string;
}

// ─── Cells ─────────────────────────────────────────────────────────

export type CellType = 'code' | 'markdown' | 'raw';

export interface Cell {
  cell_type: CellType;
  source: string | string[];
  metadata: Record<string, unknown>;
  id?: string;
  execution_count?: number | null;
  outputs: CellOutput[];
}

// ─── Cell Outputs ──────────────────────────────────────────────────

export type CellOutput =
  | StreamOutput
  | DisplayDataOutput
  | ExecuteResultOutput
  | ErrorOutput;

export interface StreamOutput {
  output_type: 'stream';
  name: string;
  text: string | string[];
}

export interface DisplayDataOutput {
  output_type: 'display_data';
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ExecuteResultOutput {
  output_type: 'execute_result';
  execution_count: number;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ErrorOutput {
  output_type: 'error';
  ename: string;
  evalue: string;
  traceback: string[];
}

// ─── Kernel & Session ──────────────────────────────────────────────

export interface KernelInfo {
  id: string;
  name: string;
  last_activity?: string;
  execution_state?: string;
  connections?: number;
}

export type KernelStatus =
  | 'idle'
  | 'busy'
  | 'starting'
  | 'restarting'
  | 'dead'
  | 'error'
  | 'disconnected'
  | 'unknown';

export interface SessionInfo {
  id: string;
  path: string;
  name: string;
  session_type: string;
  kernel: KernelInfo;
}

// ─── Tauri Events ──────────────────────────────────────────────────

export interface JupyterConnectionEvent {
  server_id: string;
  status: ConnectionStatus;
  message?: string;
}

export interface KernelOutputEvent {
  msg_type: 'stream' | 'display_data' | 'execute_result' | 'error';
  cell_id: string;
  content: unknown;
}

export interface KernelStatusEvent {
  status: KernelStatus;
}

// ─── App Error ─────────────────────────────────────────────────────

export interface AppError {
  code: string;
  message: string;
}

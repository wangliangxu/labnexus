//! LabNexus — Main library entry point.
//!
//! Configures the Tauri application with all modules and command handlers.

mod agent;
mod commands;
mod error;
mod jupyter;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            // Jupyter connection management
            commands::jupyter::jupyter_connect,
            commands::jupyter::jupyter_hub_login,
            commands::jupyter::jupyter_disconnect,
            commands::jupyter::jupyter_list_servers,
            commands::jupyter::jupyter_set_active,
            commands::jupyter::jupyter_restart_hub_server,
            // Jupyter Contents API
            commands::jupyter::jupyter_list_contents,
            commands::jupyter::jupyter_get_content,
            commands::jupyter::jupyter_save_content,
            commands::jupyter::jupyter_create_content,
            commands::jupyter::jupyter_delete_content,
            // Jupyter Kernels API
            commands::jupyter::jupyter_list_kernels,
            commands::jupyter::jupyter_start_kernel,
            commands::jupyter::jupyter_shutdown_kernel,
            commands::jupyter::jupyter_interrupt_kernel,
            commands::jupyter::jupyter_restart_kernel,
            // Jupyter Sessions API
            commands::jupyter::jupyter_list_sessions,
            commands::jupyter::jupyter_create_session,
            // Jupyter Kernel WebSocket API
            commands::jupyter::jupyter_connect_kernel_ws,
            commands::jupyter::jupyter_send_kernel_msg,
            commands::jupyter::jupyter_disconnect_kernel_ws,
            // Jupyter Terminals API
            commands::jupyter::jupyter_list_terminals,
            commands::jupyter::jupyter_create_terminal,
            commands::jupyter::jupyter_delete_terminal,
            commands::jupyter::jupyter_connect_terminal,
            commands::jupyter::jupyter_send_terminal_input,
            commands::jupyter::jupyter_resize_terminal,
            commands::jupyter::jupyter_disconnect_terminal,
            // AI Agent API
            commands::agent::agent_run_task,
            commands::agent::agent_confirm_tool,
            commands::agent::agent_get_config,
            commands::agent::agent_save_config,
            commands::agent::agent_get_history,
            commands::agent::agent_clear_session,
            commands::agent::agent_list_skills,
            commands::agent::agent_list_knowledge,
            commands::agent::agent_save_knowledge,
            commands::agent::agent_delete_knowledge,
            commands::agent::agent_list_traces,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

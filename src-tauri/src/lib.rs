//! LabNexus — Main library entry point.
//!
//! Configures the Tauri application with all modules and command handlers.

mod agent;
mod commands;
mod error;
mod jupyter;
mod state;

use state::AppState;

#[cfg(desktop)]
fn app_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadataBuilder, Menu, PredefinedMenuItem};

    let menu = Menu::default(app)?;

    #[cfg(target_os = "macos")]
    if let Some(app_submenu) = menu
        .items()?
        .first()
        .and_then(|item| item.as_submenu())
    {
        let metadata = AboutMetadataBuilder::new()
            .name(Some(app.package_info().name.clone()))
            .version(Some(app.package_info().version.to_string()))
            .copyright(app.config().bundle.copyright.clone())
            .icon(Some(tauri::include_image!("./icons/128x128.png")))
            .build();
        let about = PredefinedMenuItem::about(app, None, Some(metadata))?;

        // The first item in Tauri's macOS application menu is its default About item.
        // Replace it so the native NSAboutPanel receives our icon explicitly instead
        // of relying on macOS application-icon discovery and its persistent cache.
        app_submenu.remove_at(0)?;
        app_submenu.insert(&about, 0)?;
    }

    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new());

    #[cfg(desktop)]
    let builder = builder.menu(app_menu);

    builder
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
            commands::agent::agent_cancel_task,
            commands::agent::agent_complete_notebook_action,
            commands::agent::agent_get_config,
            commands::agent::agent_save_config,
            commands::agent::agent_get_mcp_config,
            commands::agent::agent_save_mcp_config,
            commands::agent::agent_mcp_capabilities,
            commands::agent::agent_mcp_list_resources,
            commands::agent::agent_mcp_list_resource_templates,
            commands::agent::agent_mcp_read_resource,
            commands::agent::agent_mcp_list_prompts,
            commands::agent::agent_mcp_get_prompt,
            commands::agent::agent_get_history,
            commands::agent::agent_clear_session,
            commands::agent::agent_list_sessions,
            commands::agent::agent_create_session,
            commands::agent::agent_rename_session,
            commands::agent::agent_list_skills,
            commands::agent::agent_list_knowledge,
            commands::agent::agent_save_knowledge,
            commands::agent::agent_delete_knowledge,
            commands::agent::agent_list_traces,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

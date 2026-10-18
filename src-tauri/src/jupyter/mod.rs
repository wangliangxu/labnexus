//! Jupyter module — Remote JupyterLab connection management.
//!
//! This module provides:
//! - `client` — HTTP client for Jupyter REST API with proxy support
//! - `types` — Type definitions for Notebook, cells, outputs, and protocol messages

pub mod client;
pub mod terminal_ws;
pub mod types;
pub mod ws;

pub mod local;

pub mod serial_port;
pub mod checksums;
pub mod protocol;
pub mod commands;
pub mod state;
pub mod models;

use tauri::Manager;
use state::AppState;

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_serial_ports,
            commands::open_serial_port,
            commands::close_serial_port,
            commands::send_data,
            commands::get_port_status,
            commands::calculate_checksum,
            commands::parse_frame,
            commands::get_builtin_protocols,
            commands::save_quick_commands,
            commands::load_quick_commands,
            commands::save_protocol_templates,
            commands::load_protocol_templates,
            commands::write_log_file,
            commands::read_log_file,
            commands::export_csv,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use crate::checksums::*;
use crate::models::*;
use crate::protocol::*;
use crate::serial_port::*;
use crate::state::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

#[tauri::command]
pub fn list_serial_ports() -> Vec<SerialPortInfo> {
    enumerate_serial_ports()
}

#[tauri::command]
pub async fn open_serial_port(
    port_name: String,
    config: SerialConfig,
    app_state: tauri::State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    let id = open_port(port_name, config, app_state, window).await?;
    Ok(id.to_string())
}

#[tauri::command]
pub fn close_serial_port(
    port_id: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let id = Uuid::parse_str(&port_id).map_err(|e| e.to_string())?;
    close_port(id, &app_state)
}

#[derive(Deserialize)]
struct SendDataRequest {
    port_id: String,
    data: Vec<u8>,
}

#[tauri::command]
pub fn send_data(
    request: SendDataRequest,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let id = Uuid::parse_str(&request.port_id).map_err(|e| e.to_string())?;
    send_data_to_port(id, request.data, &app_state)
}

#[tauri::command]
pub fn get_port_status(
    port_id: String,
    app_state: tauri::State<'_, AppState>,
) -> Option<PortStatus> {
    let id = Uuid::parse_str(&port_id).ok()?;
    get_port_status(id, &app_state)
}

#[derive(Deserialize)]
struct ChecksumRequest {
    data: Vec<u8>,
    algorithm: ChecksumAlgorithm,
}

#[tauri::command]
pub fn calculate_checksum(request: ChecksumRequest) -> ChecksumResult {
    calculate_checksum(&request.data, &request.algorithm)
}

#[derive(Deserialize)]
struct ParseFrameRequest {
    data: Vec<u8>,
    template: ProtocolTemplate,
}

#[tauri::command]
pub fn parse_frame(request: ParseFrameRequest) -> Option<ParsedFrame> {
    parse_single_frame(&request.data, &request.template)
}

#[tauri::command]
pub fn get_builtin_protocols() -> Vec<ProtocolTemplate> {
    crate::protocol::get_builtin_protocols()
}

#[derive(Deserialize, Serialize)]
struct QuickCommandWrapper {
    commands: Vec<QuickCommand>,
}

fn get_commands_path(app_handle: tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app_handle.path_resolver().app_config_dir() {
        let _ = fs::create_dir_all(&dir);
        Some(dir.join("quick_commands.json"))
    } else {
        None
    }
}

fn get_templates_path(app_handle: tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app_handle.path_resolver().app_config_dir() {
        let _ = fs::create_dir_all(&dir);
        Some(dir.join("protocol_templates.json"))
    } else {
        None
    }
}

#[tauri::command]
pub fn save_quick_commands(
    commands: Vec<QuickCommand>,
    app_state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    *app_state.quick_commands.write() = commands.clone();
    if let Some(path) = get_commands_path(app_handle) {
        let wrapper = QuickCommandWrapper { commands };
        let json = serde_json::to_string_pretty(&wrapper).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn load_quick_commands(
    app_state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Vec<QuickCommand> {
    let loaded = if let Some(path) = get_commands_path(app_handle) {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(wrapper) = serde_json::from_str::<QuickCommandWrapper>(&content) {
                    wrapper.commands
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    let merged = if loaded.is_empty() {
        get_default_quick_commands()
    } else {
        loaded
    };

    *app_state.quick_commands.write() = merged.clone();
    merged
}

fn get_default_quick_commands() -> Vec<QuickCommand> {
    vec![
        QuickCommand {
            id: Uuid::new_v4(),
            name: "AT测试".to_string(),
            group: "AT指令".to_string(),
            data: "AT\r\n".to_string(),
            is_hex: false,
            shortcut: None,
        },
        QuickCommand {
            id: Uuid::new_v4(),
            name: "Modbus读保持寄存器".to_string(),
            group: "Modbus".to_string(),
            data: "01 03 00 00 00 0A C5 CD".to_string(),
            is_hex: true,
            shortcut: None,
        },
        QuickCommand {
            id: Uuid::new_v4(),
            name: "复位命令".to_string(),
            group: "系统".to_string(),
            data: "AA 55 02 01 00 00 02 A8 55 AA".to_string(),
            is_hex: true,
            shortcut: None,
        },
    ]
}

#[derive(Deserialize, Serialize)]
struct TemplateWrapper {
    templates: Vec<ProtocolTemplate>,
}

#[tauri::command]
pub fn save_protocol_templates(
    templates: Vec<ProtocolTemplate>,
    app_state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    *app_state.protocol_templates.write() = templates.clone();
    if let Some(path) = get_templates_path(app_handle) {
        let wrapper = TemplateWrapper { templates };
        let json = serde_json::to_string_pretty(&wrapper).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn load_protocol_templates(
    app_state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Vec<ProtocolTemplate> {
    let mut builtin = get_builtin_protocols();

    let custom = if let Some(path) = get_templates_path(app_handle) {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(wrapper) = serde_json::from_str::<TemplateWrapper>(&content) {
                    wrapper.templates
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    for t in &mut builtin {
        t.id = Uuid::new_v4();
    }
    builtin.extend(custom);

    *app_state.protocol_templates.write() = builtin.clone();
    builtin
}

#[derive(Deserialize)]
struct WriteLogRequest {
    path: String,
    entries: Vec<LogEntry>,
}

#[tauri::command]
pub fn write_log_file(request: WriteLogRequest) -> Result<(), String> {
    let path = PathBuf::from(&request.path);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(&request.entries).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_log_file(path: String) -> Result<Vec<LogEntry>, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let entries: Vec<LogEntry> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(entries)
}

#[derive(Deserialize)]
struct ExportCsvRequest {
    path: String,
    entries: Vec<LogEntry>,
}

#[tauri::command]
pub fn export_csv(request: ExportCsvRequest) -> Result<(), String> {
    let path = PathBuf::from(&request.path);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let mut csv = String::new();
    csv.push_str("时间戳,方向,端口,HEX数据,解析结果\n");

    for entry in &request.entries {
        let ts = entry.timestamp;
        let dir = match entry.direction {
            DataDirection::Rx => "RX",
            DataDirection::Tx => "TX",
        };
        let hex: String = entry
            .data
            .iter()
            .map(|b| format!("{:02X}", b))
            .collect::<Vec<_>>()
            .join(" ");
        let parsed = match &entry.parsed_frame {
            Some(frame) => {
                let fields: Vec<String> = frame
                    .fields
                    .iter()
                    .map(|f| format!("{}={}", f.name, f.parsed_value))
                    .collect();
                fields.join("; ")
            }
            None => String::new(),
        };
        csv.push_str(&format!(
            "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"\n",
            ts, dir, entry.port_name, hex, parsed
        ));
    }

    fs::write(path, csv).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct WriteTextFileRequest {
    path: String,
    content: String,
}

#[tauri::command]
pub fn write_text_file(request: WriteTextFileRequest) -> Result<(), String> {
    let path = PathBuf::from(&request.path);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(path, request.content).map_err(|e| e.to_string())
}

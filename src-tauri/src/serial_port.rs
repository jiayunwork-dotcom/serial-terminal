use crate::models::*;
use crate::state::*;
use anyhow::{Context, Result};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio_serial::SerialPortBuilderExt;
use uuid::Uuid;

fn convert_data_bits(bits: DataBits) -> tokio_serial::DataBits {
    match bits {
        DataBits::Five => tokio_serial::DataBits::Five,
        DataBits::Six => tokio_serial::DataBits::Six,
        DataBits::Seven => tokio_serial::DataBits::Seven,
        DataBits::Eight => tokio_serial::DataBits::Eight,
    }
}

fn convert_stop_bits(bits: StopBits) -> tokio_serial::StopBits {
    match bits {
        StopBits::One => tokio_serial::StopBits::One,
        StopBits::OnePointFive => tokio_serial::StopBits::OnePointFive,
        StopBits::Two => tokio_serial::StopBits::Two,
    }
}

fn convert_parity(parity: Parity) -> tokio_serial::Parity {
    match parity {
        Parity::None => tokio_serial::Parity::None,
        Parity::Odd => tokio_serial::Parity::Odd,
        Parity::Even => tokio_serial::Parity::Even,
        Parity::Mark => tokio_serial::Parity::Mark,
        Parity::Space => tokio_serial::Parity::Space,
    }
}

fn convert_flow_control(fc: FlowControl) -> tokio_serial::FlowControl {
    match fc {
        FlowControl::None => tokio_serial::FlowControl::None,
        FlowControl::RtsCts => tokio_serial::FlowControl::Hardware,
        FlowControl::XonXoff => tokio_serial::FlowControl::Software,
    }
}

pub fn enumerate_serial_ports() -> Vec<SerialPortInfo> {
    let mut result = Vec::new();
    match tokio_serial::available_ports() {
        Ok(ports) => {
            for p in ports {
                let (vid, pid, manufacturer, product, serial_number) = match &p.port_type {
                    tokio_serial::SerialPortType::UsbPort(info) => (
                        Some(info.vid),
                        Some(info.pid),
                        info.manufacturer.clone(),
                        info.product.clone(),
                        info.serial_number.clone(),
                    ),
                    _ => (None, None, None, None, None),
                };

                result.push(SerialPortInfo {
                    name: p.port_name.clone(),
                    display_name: p.port_name.clone(),
                    manufacturer,
                    product,
                    serial_number,
                    vid,
                    pid,
                });
            }
        }
        Err(e) => {
            eprintln!("Error enumerating serial ports: {}", e);
        }
    }
    result
}

pub async fn open_port(
    port_name: String,
    config: SerialConfig,
    app_state: tauri::State<'_, AppState>,
    window: tauri::Window,
) -> Result<Uuid, String> {
    let port_id = Uuid::new_v4();

    let builder = tokio_serial::new(&port_name, config.baud_rate)
        .data_bits(convert_data_bits(config.data_bits))
        .stop_bits(convert_stop_bits(config.stop_bits))
        .parity(convert_parity(config.parity))
        .flow_control(convert_flow_control(config.flow_control))
        .timeout(Duration::from_millis(config.timeout_ms));

    let port = builder
        .open_native_async()
        .map_err(|e| format!("无法打开串口 {}: {}", port_name, e))?;

    let (mut reader, mut writer) = tokio::io::split(port);

    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SerialCommand>();
    let (tx_tx, mut tx_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let connection = SerialConnection {
        id: port_id,
        port_name: port_name.clone(),
        config: config.clone(),
        tx_bytes: 0,
        rx_bytes: 0,
        connected: true,
        sender: Some(cmd_tx.clone()),
    };

    app_state
        .serial_connections
        .write()
        .insert(port_id, connection);

    let read_window = window.clone();
    let read_state = app_state.clone();
    let read_port_name = port_name.clone();
    let read_port_id = port_id;

    tokio::spawn(async move {
        let mut buf = vec![0u8; 4096];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) => {
                    let _ = read_window.emit(
                        "port-status-changed",
                        serde_json::json!({
                            "portId": read_port_id.to_string(),
                            "portName": read_port_name,
                            "connected": false,
                            "txBytes": 0u64,
                            "rxBytes": 0u64,
                            "error": Some("串口已关闭"),
                        }),
                    );
                    if let Some(mut conn) = read_state.serial_connections.write().get_mut(&read_port_id) {
                        conn.connected = false;
                    }
                    break;
                }
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    let timestamp = chrono::Local::now().timestamp_millis() as u64;

                    if let Some(mut conn) = read_state.serial_connections.write().get_mut(&read_port_id) {
                        conn.rx_bytes += n as u64;
                    }

                    let serial_data = SerialData {
                        port_id: read_port_id,
                        port_name: read_port_name.clone(),
                        direction: DataDirection::Rx,
                        timestamp,
                        data: data.clone(),
                    };

                    let _ = read_window.emit("serial-data", serde_json::to_value(&serial_data).unwrap_or_default());
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::TimedOut
                        && e.kind() != std::io::ErrorKind::WouldBlock
                    {
                        let _ = read_window.emit(
                            "port-error",
                            serde_json::json!({
                                "portId": read_port_id.to_string(),
                                "portName": read_port_name,
                                "message": format!("读取错误: {}", e),
                            }),
                        );
                        break;
                    }
                }
            }
        }
    });

    let write_window = window.clone();
    let write_state = app_state.clone();
    let write_port_name = port_name.clone();
    let write_port_id = port_id;

    tokio::spawn(async move {
        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(SerialCommand::Write(data)) => {
                            match writer.write_all(&data).await {
                                Ok(_) => {
                                    let timestamp = chrono::Local::now().timestamp_millis() as u64;
                                    if let Some(mut conn) = write_state.serial_connections.write().get_mut(&write_port_id) {
                                        conn.tx_bytes += data.len() as u64;
                                    }
                                    let serial_data = SerialData {
                                        port_id: write_port_id,
                                        port_name: write_port_name.clone(),
                                        direction: DataDirection::Tx,
                                        timestamp,
                                        data: data.clone(),
                                    };
                                    let _ = write_window.emit("serial-data", serde_json::to_value(&serial_data).unwrap_or_default());
                                }
                                Err(e) => {
                                    let _ = write_window.emit(
                                        "port-error",
                                        serde_json::json!({
                                            "portId": write_port_id.to_string(),
                                            "portName": write_port_name,
                                            "message": format!("写入错误: {}", e),
                                        }),
                                    );
                                }
                            }
                        }
                        Some(SerialCommand::Close) => {
                            break;
                        }
                        None => break,
                    }
                }
                else => {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
            }
        }
    });

    let status_window = window.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(200)).await;
            let status = {
                let conns = app_state.serial_connections.read();
                conns.get(&port_id).map(|c| PortStatus {
                    port_id: c.id,
                    port_name: c.port_name.clone(),
                    connected: c.connected,
                    config: c.config.clone(),
                    tx_bytes: c.tx_bytes,
                    rx_bytes: c.rx_bytes,
                    error: None,
                })
            };
            if let Some(s) = status {
                if !s.connected {
                    break;
                }
                let _ = status_window.emit("port-status", serde_json::to_value(&s).unwrap_or_default());
            } else {
                break;
            }
        }
    });

    Ok(port_id)
}

pub fn close_port(port_id: Uuid, app_state: &AppState) -> Result<(), String> {
    let mut conns = app_state.serial_connections.write();
    if let Some(conn) = conns.remove(&port_id) {
        if let Some(sender) = &conn.sender {
            let _ = sender.send(SerialCommand::Close);
        }
        Ok(())
    } else {
        Err(format!("未找到串口连接: {}", port_id))
    }
}

pub fn send_data_to_port(
    port_id: Uuid,
    data: Vec<u8>,
    app_state: &AppState,
) -> Result<(), String> {
    let conns = app_state.serial_connections.read();
    let conn = conns
        .get(&port_id)
        .ok_or_else(|| format!("未找到串口连接: {}", port_id))?;

    if !conn.connected {
        return Err("串口未连接".to_string());
    }

    let sender = conn
        .sender
        .as_ref()
        .ok_or_else(|| "串口发送通道未初始化".to_string())?;

    sender
        .send(SerialCommand::Write(data))
        .map_err(|e| format!("发送失败: {}", e))?;

    Ok(())
}

pub fn get_port_status(port_id: Uuid, app_state: &AppState) -> Option<PortStatus> {
    let conns = app_state.serial_connections.read();
    conns.get(&port_id).map(|c| PortStatus {
        port_id: c.id,
        port_name: c.port_name.clone(),
        connected: c.connected,
        config: c.config.clone(),
        tx_bytes: c.tx_bytes,
        rx_bytes: c.rx_bytes,
        error: None,
    })
}

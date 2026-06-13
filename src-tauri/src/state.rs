use std::collections::HashMap;
use parking_lot::RwLock;
use tokio::sync::mpsc;
use uuid::Uuid;
use crate::models::*;

pub struct AppState {
    pub serial_connections: RwLock<HashMap<Uuid, SerialConnection>>,
    pub event_sender: RwLock<Option<mpsc::UnboundedSender<AppEvent>>>,
    pub quick_commands: RwLock<Vec<QuickCommand>>,
    pub protocol_templates: RwLock<Vec<ProtocolTemplate>>,
    pub parse_state: RwLock<HashMap<Uuid, FrameParserState>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            serial_connections: RwLock::new(HashMap::new()),
            event_sender: RwLock::new(None),
            quick_commands: RwLock::new(Vec::new()),
            protocol_templates: RwLock::new(Vec::new()),
            parse_state: RwLock::new(HashMap::new()),
        }
    }
}

pub struct SerialConnection {
    pub id: Uuid,
    pub port_name: String,
    pub config: SerialConfig,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    pub connected: bool,
    pub sender: Option<mpsc::UnboundedSender<SerialCommand>>,
}

pub enum SerialCommand {
    Write(Vec<u8>),
    Close,
}

#[derive(Clone)]
pub enum AppEvent {
    SerialDataReceived(SerialData),
    SerialDataSent(SerialData),
    PortStatusChanged { port_id: Uuid, status: PortStatus },
    FrameParsed { port_id: Uuid, frame: ParsedFrame },
    Error { port_id: Uuid, message: String },
    ParsedFrameDropped { port_id: Uuid, dropped_bytes: usize },
}

pub struct FrameParserState {
    pub buffer: Vec<u8>,
    pub protocol_id: Option<Uuid>,
    pub frames: Vec<ParsedFrame>,
    pub dropped_frames: u64,
    pub crc_errors: u64,
}

impl Default for FrameParserState {
    fn default() -> Self {
        Self {
            buffer: Vec::new(),
            protocol_id: None,
            frames: Vec::new(),
            dropped_frames: 0,
            crc_errors: 0,
        }
    }
}

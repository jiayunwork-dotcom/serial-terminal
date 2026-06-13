use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::NaiveDateTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialPortInfo {
    pub name: String,
    pub display_name: String,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_number: Option<String>,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialConfig {
    pub baud_rate: u32,
    pub data_bits: DataBits,
    pub stop_bits: StopBits,
    pub parity: Parity,
    pub flow_control: FlowControl,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum DataBits {
    Five,
    Six,
    Seven,
    Eight,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum StopBits {
    One,
    OnePointFive,
    Two,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Parity {
    None,
    Odd,
    Even,
    Mark,
    Space,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum FlowControl {
    None,
    RtsCts,
    XonXoff,
}

impl Default for SerialConfig {
    fn default() -> Self {
        Self {
            baud_rate: 115200,
            data_bits: DataBits::Eight,
            stop_bits: StopBits::One,
            parity: Parity::None,
            flow_control: FlowControl::None,
            timeout_ms: 100,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortStatus {
    pub port_id: Uuid,
    pub port_name: String,
    pub connected: bool,
    pub config: SerialConfig,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialData {
    pub port_id: Uuid,
    pub port_name: String,
    pub direction: DataDirection,
    pub timestamp: u64,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DataDirection {
    Rx,
    Tx,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FieldType {
    FrameHeader,
    Length,
    UInt8,
    UInt16BE,
    UInt16LE,
    UInt32BE,
    UInt32LE,
    Int8,
    Int16BE,
    Int16LE,
    Float32BE,
    Float32LE,
    String,
    RawBytes,
    Checksum,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DisplayFormat {
    Decimal,
    Hexadecimal,
    Ascii,
    Binary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldDefinition {
    pub name: String,
    pub field_type: FieldType,
    pub byte_length: Option<usize>,
    pub length_ref_field: Option<String>,
    pub display_format: DisplayFormat,
    pub fixed_value: Option<Vec<u8>>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ChecksumAlgorithm {
    CRC8 {
        polynomial: u8,
        initial_value: u8,
        input_reflected: bool,
        output_reflected: bool,
        final_xor: u8,
    },
    CRC16Modbus,
    CRC16CCITT,
    CRC32,
    LRC,
    BCC,
    Checksum8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolTemplate {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub fields: Vec<FieldDefinition>,
    pub frame_delimiter: Option<Vec<u8>>,
    pub is_builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedField {
    pub name: String,
    pub field_type: FieldType,
    pub raw_bytes: Vec<u8>,
    pub parsed_value: String,
    pub offset: usize,
    pub length: usize,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedFrame {
    pub frame_id: Uuid,
    pub timestamp: u64,
    pub raw_data: Vec<u8>,
    pub fields: Vec<ParsedField>,
    pub checksum_valid: bool,
    pub error_message: Option<String>,
    pub frame_length: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecksumConfig {
    pub algorithm: ChecksumAlgorithm,
    pub start_offset: usize,
    pub end_offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecksumResult {
    pub algorithm: String,
    pub value: u64,
    pub hex: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCommand {
    pub id: Uuid,
    pub name: String,
    pub group: String,
    pub data: String,
    pub is_hex: bool,
    pub shortcut: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoSendTimed {
    pub enabled: bool,
    pub interval_ms: u32,
    pub data: String,
    pub is_hex: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequenceItem {
    pub id: Uuid,
    pub data: String,
    pub is_hex: bool,
    pub delay_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoSendSequence {
    pub enabled: bool,
    pub items: Vec<SequenceItem>,
    pub loop_forever: bool,
    pub current_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerCondition {
    pub match_pattern: Vec<u8>,
    pub match_type: MatchType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MatchType {
    Contains,
    StartsWith,
    ExactMatch,
    Regex,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoSendTrigger {
    pub enabled: bool,
    pub condition: TriggerCondition,
    pub response_data: String,
    pub is_hex: bool,
    pub delay_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: u64,
    pub direction: DataDirection,
    pub port_name: String,
    pub data: Vec<u8>,
    pub parsed_frame: Option<ParsedFrame>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorField {
    pub id: Uuid,
    pub field_name: String,
    pub protocol_id: Uuid,
    pub color: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorDataPoint {
    pub timestamp: u64,
    pub value: f64,
    pub field_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalDisplayMode {
    Ascii,
    Hex,
    Mixed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalLine {
    pub timestamp: u64,
    pub direction: DataDirection,
    pub port_name: String,
    pub data: Vec<u8>,
    pub is_frame_boundary: bool,
    pub parsed_frame_id: Option<Uuid>,
}

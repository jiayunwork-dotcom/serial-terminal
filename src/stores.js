import { writable, derived, get } from 'svelte/store';

export const serialPorts = writable([]);
export const refreshingPorts = writable(false);
export const openTabs = writable([]);
export const activeTabId = writable(null);
export const statusBarData = writable({
  totalRx: 0,
  totalTx: 0,
  connectedCount: 0,
  currentPort: '',
  isRecording: false,
  elapsed: 0,
});
export const showChecksumTool = writable(false);
export const showAutoSend = writable(false);
export const showMonitor = writable(false);
export const showLogPanel = writable(false);
export const showProtocolEditor = writable(false);
export const sidebarOpen = writable(true);
export const emulatorPanelOpen = writable(false);
export const emulatorState = writable({
  isRunning: false,
  selectedTemplate: 'modbus_rtu',
  currentScript: null,
  hostPortId: null,
  hostPortName: '',
  deviceLogs: [],
  variables: [],
  registerView: { startAddr: 0, countPerPage: 20 },
  stats: {
    requestsProcessed: 0,
    responsesSent: 0,
    matchFailures: 0,
    averageLatencyMs: 0,
  },
});
export const showScriptEditor = writable(false);

export const quickCommands = writable([]);
export const protocolTemplates = writable([]);

export const monitorFields = writable([]);
export const monitorData = writable([]);
export const monitorPaused = writable(false);
export const monitorAutoScale = writable(true);

export const autoSendConfig = writable({
  timed: { enabled: false, interval_ms: 500, data: '', is_hex: true },
  sequence: { enabled: false, items: [], loop_forever: false, current_index: 0 },
  trigger: { enabled: false, condition: { match_pattern: [], match_type: 'Contains' }, response_data: '', is_hex: true, delay_ms: 0 }
});

export const playbackState = writable({
  isPlaying: false,
  isPaused: false,
  speed: 1.0,
  progress: 0,
  entries: [],
  currentIndex: 0,
});

export function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function formatTimestamp(ms) {
  const d = new Date(ms);
  const pad = (n) => n.toString().padStart(2, '0');
  const mmm = Math.floor(ms % 1000).toString().padStart(3, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${mmm}`;
}

export function bytesToHex(bytes) {
  if (!bytes) return '';
  return Array.from(bytes).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

export function hexToBytes(hexStr) {
  if (!hexStr) return [];
  const cleaned = hexStr.replace(/[^0-9A-Fa-f]/g, '');
  if (cleaned.length % 2 !== 0) return [];
  const bytes = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.substr(i, 2), 16));
  }
  return bytes;
}

export function bytesToAscii(bytes) {
  if (!bytes) return '';
  return Array.from(bytes).map(b => {
    if (b >= 0x20 && b < 0x7F) return String.fromCharCode(b);
    return '.';
  }).join('');
}

export function asciiToBytes(str) {
  if (!str) return [];
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i) & 0xFF);
  }
  return bytes;
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

export function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export const DEFAULT_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
export const DATA_BITS_OPTIONS = [5, 6, 7, 8];
export const STOP_BITS_OPTIONS = [
  { value: 'One', label: '1' },
  { value: 'OnePointFive', label: '1.5' },
  { value: 'Two', label: '2' },
];
export const PARITY_OPTIONS = [
  { value: 'None', label: 'None' },
  { value: 'Odd', label: 'Odd' },
  { value: 'Even', label: 'Even' },
  { value: 'Mark', label: 'Mark' },
  { value: 'Space', label: 'Space' },
];
export const FLOW_CONTROL_OPTIONS = [
  { value: 'None', label: 'None' },
  { value: 'RtsCts', label: 'RTS-CTS' },
  { value: 'XonXoff', label: 'XON-XOFF' },
];
export const DISPLAY_MODE_OPTIONS = [
  { value: 'Ascii', label: 'ASCII' },
  { value: 'Hex', label: 'HEX' },
  { value: 'Mixed', label: '混合' },
];
export const FIELD_TYPE_OPTIONS = [
  { value: 'FrameHeader', label: '帧头' },
  { value: 'Length', label: '长度' },
  { value: 'UInt8', label: 'uint8' },
  { value: 'UInt16BE', label: 'uint16 BE' },
  { value: 'UInt16LE', label: 'uint16 LE' },
  { value: 'UInt32BE', label: 'uint32 BE' },
  { value: 'UInt32LE', label: 'uint32 LE' },
  { value: 'Int8', label: 'int8' },
  { value: 'Int16BE', label: 'int16 BE' },
  { value: 'Int16LE', label: 'int16 LE' },
  { value: 'Float32BE', label: 'float32 BE' },
  { value: 'Float32LE', label: 'float32 LE' },
  { value: 'String', label: '字符串' },
  { value: 'RawBytes', label: '原始字节' },
  { value: 'Checksum', label: '校验' },
];
export const DISPLAY_FORMAT_OPTIONS = [
  { value: 'Decimal', label: '十进制' },
  { value: 'Hexadecimal', label: '十六进制' },
  { value: 'Ascii', label: 'ASCII' },
  { value: 'Binary', label: '二进制' },
];
export const CHECKSUM_ALGORITHM_OPTIONS = [
  { value: 'CRC8', label: 'CRC8 (自定义)' },
  { value: 'CRC16Modbus', label: 'CRC16-Modbus' },
  { value: 'CRC16CCITT', label: 'CRC16-CCITT' },
  { value: 'CRC32', label: 'CRC32' },
  { value: 'LRC', label: 'LRC' },
  { value: 'BCC', label: 'BCC (异或)' },
  { value: 'Checksum8', label: '累加和 Checksum' },
];

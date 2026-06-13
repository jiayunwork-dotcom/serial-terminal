let invokeFn = null;
let listenFn = null;
let emitFn = null;
let dialogOpen = null;
let dialogSave = null;

export function setTauriApis(invoke, listen, emit, openDialog, saveDialog) {
  invokeFn = invoke;
  listenFn = listen;
  emitFn = emit;
  dialogOpen = openDialog;
  dialogSave = saveDialog;
}

export async function invoke(cmd, args) {
  if (!invokeFn) return Promise.reject(new Error('Tauri APIs not initialized'));
  return invokeFn(cmd, args);
}

export async function tauriInvoke(cmd, args) {
  return invoke(cmd, args);
}

export function tauriListen(event, cb) {
  if (!listenFn) return function() {};
  return listenFn(event, cb);
}

export function tauriEmit(event, payload) {
  if (emitFn) emitFn(event, payload);
}

export async function showOpenDialog(options) {
  if (!dialogOpen) return null;
  return dialogOpen(options);
}

export async function showSaveDialog(options) {
  if (!dialogSave) return null;
  return dialogSave(options);
}

export const mockEnabled = function() { return !!invokeFn; };

export async function listSerialPorts() {
  try {
    return await invoke('list_serial_ports');
  } catch (e) {
    console.warn('Tauri not available, using mock ports');
    return [
      { name: 'COM1', display_name: 'COM1', manufacturer: 'Mock', product: 'Mock Serial', serial_number: 'MOCK001', vid: 0x1234, pid: 0x5678 },
      { name: 'COM3', display_name: 'COM3 - USB Serial', manufacturer: 'FTDI', product: 'USB-SERIAL', serial_number: 'FT12345', vid: 0x0403, pid: 0x6001 },
      { name: 'COM5', display_name: 'COM5 - CH340', manufacturer: 'QinHeng', product: 'USB-SERIAL CH340', serial_number: null, vid: 0x1A86, pid: 0x7523 },
    ];
  }
}

export async function openSerialPort(portName, config) {
  try {
    return await invoke('open_serial_port', { port_name: portName, config: config });
  } catch (e) {
    console.warn('Mock open port', portName);
    await new Promise(function(r) { setTimeout(r, 300); });
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

export async function closeSerialPort(portId) {
  if (portId && (portId.startsWith('vpipe-') || portId.startsWith('emu-'))) {
    return { success: true, note: 'emulator pipe bypass' };
  }
  try {
    return await invoke('close_serial_port', { port_id: portId });
  } catch (e) {
    console.warn('Mock close port', portId);
    return null;
  }
}

export async function sendSerialData(portId, data) {
  if (portId && (portId.startsWith('vpipe-') || portId.startsWith('emu-'))) {
    return { success: true, note: 'emulator pipe bypass' };
  }
  try {
    return await invoke('send_data', { request: { port_id: portId, data: Array.from(data) } });
  } catch (e) {
    console.warn('Mock send data', portId, data);
    return null;
  }
}

export async function getPortStatus(portId) {
  try {
    return await invoke('get_port_status', { port_id: portId });
  } catch (e) {
    return null;
  }
}

export async function calcChecksum(data, algorithm) {
  try {
    return await invoke('calculate_checksum', { request: { data: Array.from(data), algorithm: algorithm } });
  } catch (e) {
    var algo = typeof algorithm === 'string' ? algorithm : Object.keys(algorithm)[0];
    if (algo === 'CRC16Modbus' || algorithm === 'CRC16Modbus') {
      var crc = 0xFFFF;
      for (var i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (var j = 0; j < 8; j++) {
          if (crc & 1) {
            crc = (crc >>> 1) ^ 0xA001;
          } else {
            crc = crc >>> 1;
          }
        }
      }
      crc &= 0xFFFF;
      return {
        algorithm: 'CRC16-Modbus',
        value: crc,
        hex: crc.toString(16).toUpperCase().padStart(4, '0'),
        bytes: [crc & 0xFF, (crc >> 8) & 0xFF],
      };
    }
    if (algo === 'BCC' || algorithm === 'BCC') {
      var bcc = 0;
      for (var k = 0; k < data.length; k++) bcc ^= data[k];
      return {
        algorithm: 'BCC',
        value: bcc,
        hex: bcc.toString(16).toUpperCase().padStart(2, '0'),
        bytes: [bcc],
      };
    }
    if (algo === 'Checksum8' || algorithm === 'Checksum8') {
      var sum = 0;
      for (var m = 0; m < data.length; m++) sum += data[m];
      sum &= 0xFF;
      return {
        algorithm: 'Checksum',
        value: sum,
        hex: sum.toString(16).toUpperCase().padStart(2, '0'),
        bytes: [sum],
      };
    }
    if (algo === 'CRC16CCITT' || algorithm === 'CRC16CCITT') {
      var crc2 = 0x0000;
      for (var n = 0; n < data.length; n++) {
        crc2 ^= (data[n] << 8);
        for (var p = 0; p < 8; p++) {
          if (crc2 & 0x8000) {
            crc2 = (crc2 << 1) ^ 0x1021;
          } else {
            crc2 = crc2 << 1;
          }
        }
        crc2 &= 0xFFFF;
      }
      return {
        algorithm: 'CRC16-CCITT',
        value: crc2,
        hex: crc2.toString(16).toUpperCase().padStart(4, '0'),
        bytes: [(crc2 >> 8) & 0xFF, crc2 & 0xFF],
      };
    }
    return { algorithm: 'Unknown', value: 0, hex: '00', bytes: [0] };
  }
}

export async function parseFrame(data, template) {
  try {
    var req = { request: { data: Array.from(data), template: template } };
    return await invoke('parse_frame', req);
  } catch (e) {
    return null;
  }
}

export async function getBuiltinProtocols() {
  try {
    return await invoke('get_builtin_protocols');
  } catch (e) {
    return [];
  }
}

export async function saveQuickCommands(commands) {
  try {
    return await invoke('save_quick_commands', { commands: commands });
  } catch (e) {
    localStorage.setItem('quick_commands', JSON.stringify(commands));
    return null;
  }
}

export async function loadQuickCommands() {
  try {
    return await invoke('load_quick_commands');
  } catch (e) {
    var saved = localStorage.getItem('quick_commands');
    return saved ? JSON.parse(saved) : [];
  }
}

export async function saveProtocolTemplates(templates) {
  try {
    return await invoke('save_protocol_templates', { templates: templates });
  } catch (e) {
    localStorage.setItem('protocol_templates', JSON.stringify(templates));
    return null;
  }
}

export async function loadProtocolTemplates() {
  try {
    return await invoke('load_protocol_templates');
  } catch (e) {
    var saved = localStorage.getItem('protocol_templates');
    return saved ? JSON.parse(saved) : [];
  }
}

export async function writeLogFile(path, entries) {
  try {
    var req2 = { request: { path: path, entries: entries } };
    return await invoke('write_log_file', req2);
  } catch (e) {
    localStorage.setItem('log_' + Date.now(), JSON.stringify(entries));
    return null;
  }
}

export async function readLogFile(path) {
  try {
    return await invoke('read_log_file', { path: path });
  } catch (e) {
    return [];
  }
}

export async function exportCsv(path, entries) {
  try {
    var req3 = { request: { path: path, entries: entries } };
    return await invoke('export_csv', req3);
  } catch (e) {
    return null;
  }
}

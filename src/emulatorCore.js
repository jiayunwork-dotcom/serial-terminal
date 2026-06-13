export class VirtualSerialPipe {
  constructor(id = 'vpipe-' + Math.random().toString(36).slice(2, 10)) {
    this.id = id;
    this.hostName = 'EMU-HOST-' + id.slice(-4).toUpperCase();
    this.deviceName = 'EMU-DEV-' + id.slice(-4).toUpperCase();
    this.hostListeners = [];
    this.deviceListeners = [];
    this.hostBuffer = [];
    this.deviceBuffer = [];
    this.isOpen = false;
  }

  open() {
    this.isOpen = true;
    this.hostBuffer = [];
    this.deviceBuffer = [];
  }

  close() {
    this.isOpen = false;
  }

  onHostData(fn) {
    this.hostListeners.push(fn);
    return () => { this.hostListeners = this.hostListeners.filter(x => x !== fn); };
  }

  onDeviceData(fn) {
    this.deviceListeners.push(fn);
    return () => { this.deviceListeners = this.deviceListeners.filter(x => x !== fn); };
  }

  writeToHost(data) {
    if (!this.isOpen) return;
    const arr = Array.isArray(data) ? [...data] : Array.from(data);
    this.hostBuffer.push(...arr);
    const event = {
      data: [...arr],
      timestamp: Date.now(),
      direction: 'Rx',
      portName: this.hostName,
      portId: 'emu-' + this.id,
    };
    for (const l of this.hostListeners) {
      try { l(event); } catch (e) { console.error(e); }
    }
  }

  writeToDevice(data) {
    if (!this.isOpen) return;
    const arr = Array.isArray(data) ? [...data] : Array.from(data);
    this.deviceBuffer.push(...arr);
    const event = {
      data: [...arr],
      timestamp: Date.now(),
      direction: 'Tx',
      portName: this.deviceName,
      portId: 'emu-' + this.id,
    };
    for (const l of this.deviceListeners) {
      try { l(event); } catch (e) { console.error(e); }
    }
  }
}

export function crc16Modbus(bytes) {
  let crc = 0xFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xA001;
      else crc = crc >>> 1;
    }
  }
  return crc & 0xFFFF;
}

export function bcc(bytes) {
  let v = 0;
  for (const b of bytes) v ^= b;
  return v & 0xFF;
}

export function checksum8(bytes) {
  let v = 0;
  for (const b of bytes) v = (v + b) & 0xFF;
  return v;
}

export function float32ToBytesBE(v) {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, v, false);
  return Array.from(new Uint8Array(buf));
}

export function float32ToBytesLE(v) {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, v, true);
  return Array.from(new Uint8Array(buf));
}

export function bytesToFloat32BE(bytes, offset = 0) {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  for (let i = 0; i < 4; i++) view.setUint8(i, bytes[offset + i] || 0);
  return view.getFloat32(0, false);
}

export function bytesToFloat32LE(bytes, offset = 0) {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  for (let i = 0; i < 4; i++) view.setUint8(i, bytes[offset + i] || 0);
  return view.getFloat32(0, true);
}

export function uint16ToBytesBE(v) { return [(v >> 8) & 0xFF, v & 0xFF]; }
export function uint16ToBytesLE(v) { return [v & 0xFF, (v >> 8) & 0xFF]; }
export function bytesToUint16BE(bytes, offset = 0) { return ((bytes[offset] || 0) << 8) | (bytes[offset + 1] || 0); }
export function bytesToUint16LE(bytes, offset = 0) { return (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8); }

export function stringToBytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xFF);
  return bytes;
}

export function bytesToString(bytes) {
  return bytes.map(b => String.fromCharCode(b)).join('');
}

export const BUILTIN_TEMPLATES = {
  modbus_rtu: {
    name: 'Modbus RTU 从站',
    description: '支持功能码 03/06/16，维护100个16位寄存器，自动CRC16校验',
    defaultState: {
      slave_address: 1,
      registers: new Array(100).fill(0).map((_, i) => i),
    },
    stateSchema: [
      { key: 'slave_address', label: '从站地址', type: 'uint8', min: 1, max: 247 },
      { key: 'registers', label: '保持寄存器 (100个)', type: 'registers', count: 100 },
    ],
    script: {
      rules: [
        {
          id: 'fc03_read_holding',
          name: '功能码 0x03 读保持寄存器',
          trigger: { type: 'frame_match', pattern: [null, 0x03], mask: [0x01, 0xFF], min_length: 8 },
          action: { type: 'custom', handler: 'handleModbusFC03' },
        },
        {
          id: 'fc06_write_single',
          name: '功能码 0x06 写单寄存器',
          trigger: { type: 'frame_match', pattern: [null, 0x06], mask: [0x01, 0xFF], min_length: 8 },
          action: { type: 'custom', handler: 'handleModbusFC06' },
        },
        {
          id: 'fc16_write_multiple',
          name: '功能码 0x10 写多寄存器',
          trigger: { type: 'frame_match', pattern: [null, 0x10], mask: [0x01, 0xFF], min_length: 9 },
          action: { type: 'custom', handler: 'handleModbusFC16' },
        },
      ],
    },
  },

  sensor_collector: {
    name: '传感器数据采集器',
    description: '每秒主动上报帧：AA 55 + 长度 + 温度/湿度/气压(float32 LE) + BCC校验',
    defaultState: {
      temperature: 25.0,
      humidity: 60.0,
      pressure: 1013.25,
      report_interval_ms: 1000,
      temp_jitter: 0.5,
      humi_jitter: 2.0,
      press_jitter: 1.0,
    },
    stateSchema: [
      { key: 'temperature', label: '温度 (°C)', type: 'float32' },
      { key: 'humidity', label: '湿度 (%)', type: 'float32' },
      { key: 'pressure', label: '气压 (hPa)', type: 'float32' },
      { key: 'report_interval_ms', label: '上报间隔 (ms)', type: 'uint32', min: 100, max: 60000 },
      { key: 'temp_jitter', label: '温度波动幅度', type: 'float32', min: 0 },
      { key: 'humi_jitter', label: '湿度波动幅度', type: 'float32', min: 0 },
      { key: 'press_jitter', label: '气压波动幅度', type: 'float32', min: 0 },
    ],
    script: {
      rules: [
        {
          id: 'periodic_report',
          name: '周期性数据上报',
          trigger: { type: 'periodic', interval_ms_ref: 'report_interval_ms' },
          action: { type: 'custom', handler: 'handleSensorReport' },
        },
      ],
    },
  },

  at_device: {
    name: 'AT指令设备',
    description: 'AT+RST返回OK、AT+VER返回版本、AT+DATA?返回模拟传感器数据',
    defaultState: {
      version: 'AT-Device-v1.2.3',
      model: 'SIM-7600G',
      imei: '123456789012345',
      temp: 23.5,
      batt: 87,
      signal: 78,
    },
    stateSchema: [
      { key: 'version', label: '固件版本', type: 'string' },
      { key: 'model', label: '模块型号', type: 'string' },
      { key: 'imei', label: 'IMEI', type: 'string' },
      { key: 'temp', label: '温度', type: 'float32' },
      { key: 'batt', label: '电量 (%)', type: 'uint8', min: 0, max: 100 },
      { key: 'signal', label: '信号强度 (%)', type: 'uint8', min: 0, max: 100 },
    ],
    script: {
      rules: [
        {
          id: 'at_rst',
          name: 'AT+RST 复位',
          trigger: { type: 'ascii_match', prefix: 'AT+RST' },
          action: { type: 'custom', handler: 'handleAtRst' },
        },
        {
          id: 'at_ver',
          name: 'AT+VER 版本查询',
          trigger: { type: 'ascii_match', prefix: 'AT+VER' },
          action: { type: 'custom', handler: 'handleAtVer' },
        },
        {
          id: 'at_data',
          name: 'AT+DATA? 数据查询',
          trigger: { type: 'ascii_match', prefix: 'AT+DATA?' },
          action: { type: 'custom', handler: 'handleAtData' },
        },
        {
          id: 'at_model',
          name: 'AT+MODEL? 型号查询',
          trigger: { type: 'ascii_match', prefix: 'AT+MODEL?' },
          action: { type: 'custom', handler: 'handleAtModel' },
        },
        {
          id: 'at_imei',
          name: 'AT+IMEI? IMEI查询',
          trigger: { type: 'ascii_match', prefix: 'AT+IMEI?' },
          action: { type: 'custom', handler: 'handleAtImei' },
        },
        {
          id: 'at_test',
          name: 'AT 测试',
          trigger: { type: 'ascii_exact', text: 'AT' },
          action: { type: 'custom', handler: 'handleAtTest' },
        },
      ],
    },
  },
};

const CUSTOM_HANDLERS = {
  handleModbusFC03(ctx, frame) {
    if (frame.length < 8) return null;
    const slaveAddr = frame[0];
    if (slaveAddr !== ctx.state.slave_address) return null;
    const fc = frame[1];
    const startAddr = bytesToUint16BE(frame, 2);
    const quantity = bytesToUint16BE(frame, 4);
    const recvCrc = bytesToUint16LE(frame, 6);
    const calcCrc = crc16Modbus(frame.slice(0, 6));
    if (recvCrc !== calcCrc) return null;
    if (startAddr + quantity > 100) {
      const errResp = [slaveAddr, 0x83, 0x02];
      const c = crc16Modbus(errResp);
      return [...errResp, ...uint16ToBytesLE(c)];
    }
    const dataBytes = [];
    for (let i = 0; i < quantity; i++) {
      const val = ctx.state.registers[startAddr + i] || 0;
      dataBytes.push(...uint16ToBytesBE(val & 0xFFFF));
    }
    const resp = [slaveAddr, fc, dataBytes.length, ...dataBytes];
    const respCrc = crc16Modbus(resp);
    return [...resp, ...uint16ToBytesLE(respCrc)];
  },

  handleModbusFC06(ctx, frame) {
    if (frame.length < 8) return null;
    const slaveAddr = frame[0];
    if (slaveAddr !== ctx.state.slave_address) return null;
    const fc = frame[1];
    const regAddr = bytesToUint16BE(frame, 2);
    const value = bytesToUint16BE(frame, 4);
    const recvCrc = bytesToUint16LE(frame, 6);
    const calcCrc = crc16Modbus(frame.slice(0, 6));
    if (recvCrc !== calcCrc) return null;
    if (regAddr >= 100) {
      const errResp = [slaveAddr, 0x86, 0x02];
      const c = crc16Modbus(errResp);
      return [...errResp, ...uint16ToBytesLE(c)];
    }
    ctx.setState('registers[' + regAddr + ']', value & 0xFFFF);
    const resp = frame.slice(0, 6);
    const respCrc = crc16Modbus(resp);
    return [...resp, ...uint16ToBytesLE(respCrc)];
  },

  handleModbusFC16(ctx, frame) {
    if (frame.length < 9) return null;
    const slaveAddr = frame[0];
    if (slaveAddr !== ctx.state.slave_address) return null;
    const fc = frame[1];
    const startAddr = bytesToUint16BE(frame, 2);
    const quantity = bytesToUint16BE(frame, 4);
    const byteCount = frame[6];
    if (byteCount !== quantity * 2) return null;
    if (frame.length < 7 + byteCount + 2) return null;
    const recvCrc = bytesToUint16LE(frame, 7 + byteCount);
    const calcCrc = crc16Modbus(frame.slice(0, 7 + byteCount));
    if (recvCrc !== calcCrc) return null;
    if (startAddr + quantity > 100) {
      const errResp = [slaveAddr, 0x90, 0x02];
      const c = crc16Modbus(errResp);
      return [...errResp, ...uint16ToBytesLE(c)];
    }
    for (let i = 0; i < quantity; i++) {
      const val = bytesToUint16BE(frame, 7 + i * 2);
      ctx.setState('registers[' + (startAddr + i) + ']', val & 0xFFFF);
    }
    const resp = frame.slice(0, 6);
    const respCrc = crc16Modbus(resp);
    return [...resp, ...uint16ToBytesLE(respCrc)];
  },

  handleSensorReport(ctx) {
    const t = ctx.state.temperature + (Math.random() * 2 - 1) * (ctx.state.temp_jitter || 0);
    const h = ctx.state.humidity + (Math.random() * 2 - 1) * (ctx.state.humi_jitter || 0);
    const p = ctx.state.pressure + (Math.random() * 2 - 1) * (ctx.state.press_jitter || 0);
    ctx.setState('temperature', Math.round(t * 100) / 100);
    ctx.setState('humidity', Math.round(h * 100) / 100);
    ctx.setState('pressure', Math.round(p * 100) / 100);
    const payload = [
      ...float32ToBytesLE(t),
      ...float32ToBytesLE(h),
      ...float32ToBytesLE(p),
    ];
    const length = payload.length;
    const frame = [0xAA, 0x55, length, ...payload];
    const check = bcc(frame.slice(2));
    return [...frame, check];
  },

  handleAtRst(ctx) {
    return stringToBytes('RESET OK\r\nOK\r\n');
  },

  handleAtVer(ctx) {
    return stringToBytes('+VER: ' + ctx.state.version + '\r\nOK\r\n');
  },

  handleAtData(ctx) {
    return stringToBytes(
      '+TEMP: ' + ctx.state.temp + '\r\n' +
      '+BATT: ' + ctx.state.batt + '%\r\n' +
      '+SIG: ' + ctx.state.signal + '%\r\n' +
      'OK\r\n'
    );
  },

  handleAtModel(ctx) {
    return stringToBytes('+MODEL: ' + ctx.state.model + '\r\nOK\r\n');
  },

  handleAtImei(ctx) {
    return stringToBytes('+IMEI: ' + ctx.state.imei + '\r\nOK\r\n');
  },

  handleAtTest(ctx) {
    return stringToBytes('OK\r\n');
  },
};

function evalExpr(expr, ctx) {
  try {
    const keys = Object.keys(ctx);
    const vals = Object.values(ctx);
    const stateKeys = ctx && ctx.state && typeof ctx.state === 'object' ? Object.keys(ctx.state) : [];
    const stateVals = ctx && ctx.state && typeof ctx.state === 'object' ? Object.values(ctx.state) : [];
    const allKeys = [...keys, ...stateKeys];
    const allVals = [...vals, ...stateVals];
    const fn = new Function(...allKeys, 'return (' + expr + ');');
    return fn(...allVals);
  } catch (e) {
    return undefined;
  }
}

function evalBooleanExpr(expr, ctx) {
  const result = evalExpr(expr, ctx);
  if (typeof result === 'boolean') return result;
  if (typeof result === 'number') return result !== 0;
  if (typeof result === 'string') return result.length > 0;
  return !!result;
}

function expandTemplate(tpl, ctx) {
  if (typeof tpl === 'string') {
    return tpl.replace(/\$\{([^}]+)\}/g, (_, expr) => {
      const result = evalExpr(expr, ctx);
      if (typeof result === 'number') return result.toString();
      if (typeof result === 'string') return result;
      if (Array.isArray(result)) return result.join(',');
      return '';
    });
  }
  return tpl;
}

function matchFramePattern(frame, pattern, mask, minLength) {
  if (minLength && frame.length < minLength) return false;
  if (!pattern) return true;
  for (let i = 0; i < pattern.length; i++) {
    if (i >= frame.length) return false;
    const patVal = pattern[i];
    if (patVal === null || patVal === undefined) continue;
    const m = mask ? (mask[i] ?? 0xFF) : 0xFF;
    if ((frame[i] & m) !== (patVal & m)) return false;
  }
  return true;
}

export class ScriptEngine {
  constructor() {
    this.rules = [];
    this.state = {};
    this.stateMeta = {};
    this.onStateChange = null;
    this.onLog = null;
    this.onResponse = null;
    this.periodicTimers = new Map();
    this.startupDone = false;
    this.stats = {
      requestsProcessed: 0,
      responsesSent: 0,
      matchFailures: 0,
      responseLatencies: [],
    };
    this.customHandlers = { ...CUSTOM_HANDLERS };
    this._frameBuffer = [];
    this._frameTimer = null;
    this._frameTimeoutMs = 50;
    this._lastByteTs = 0;
    this._pollTimer = null;
  }

  setCustomHandler(name, fn) {
    this.customHandlers[name] = fn;
  }

  getCtx() {
    return {
      state: this.state,
      setState: (key, value) => this.setState(key, value),
      utils: {
        crc16Modbus, bcc, checksum8,
        float32ToBytesBE, float32ToBytesLE, bytesToFloat32BE,
        uint16ToBytesBE, uint16ToBytesLE, bytesToUint16BE, bytesToUint16LE,
        stringToBytes, bytesToString,
      },
      now: Date.now(),
    };
  }

  setState(path, value) {
    const keys = [];
    let re = /([^\.\[\]]+)/g;
    let m;
    while ((m = re.exec(path)) !== null) keys.push(m[1]);
    let obj = this.state;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (obj[k] === undefined || obj[k] === null) {
        obj[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      }
      obj = obj[k];
    }
    const lastKey = keys[keys.length - 1];
    const oldVal = obj[lastKey];
    obj[lastKey] = value;
    const ts = Date.now();
    this.stateMeta[path] = { lastModified: ts };
    if (oldVal !== value && this.onStateChange) {
      try { this.onStateChange(path, value, oldVal); } catch (e) { console.error(e); }
    }
  }

  getStateValue(path) {
    const keys = [];
    let re = /([^\.\[\]]+)/g;
    let m;
    while ((m = re.exec(path)) !== null) keys.push(m[1]);
    let obj = this.state;
    for (const k of keys) {
      if (obj === undefined || obj === null) return undefined;
      const ki = /^\d+$/.test(k) ? parseInt(k) : k;
      obj = obj[ki];
    }
    return obj;
  }

  loadScript(scriptObj, defaultState) {
    this.stopPeriodic();
    this.rules = [];
    if (!scriptObj || !scriptObj.rules) {
      throw new Error('脚本格式错误：缺少 rules 字段');
    }
    for (const rule of scriptObj.rules) {
      if (!rule.id || !rule.trigger || !rule.action) {
        throw new Error('规则缺少必要字段: ' + JSON.stringify(rule));
      }
      this.rules.push(rule);
    }
    if (defaultState) {
      this.state = JSON.parse(JSON.stringify(defaultState));
      this.stateMeta = {};
    }
    this.startupDone = false;
    this.stats = {
      requestsProcessed: 0,
      responsesSent: 0,
      matchFailures: 0,
      responseLatencies: [],
    };
    this.clearFrameBuffer();
    return true;
  }

  clearFrameBuffer() {
    this._frameBuffer = [];
    if (this._frameTimer) {
      clearTimeout(this._frameTimer);
      this._frameTimer = null;
    }
  }

  _getAsciiDelimiterFrames() {
    const delimiters = [
      [0x0D, 0x0A],
      [0x0A],
      [0x0D],
      [0x00],
    ];
    const results = [];
    let buf = [...this._frameBuffer];
    let i = 0;
    while (i < buf.length) {
      let foundIdx = -1;
      let foundLen = 0;
      for (const delim of delimiters) {
        if (i + delim.length > buf.length) continue;
        let ok = true;
        for (let j = 0; j < delim.length; j++) {
          if (buf[i + j] !== delim[j]) { ok = false; break; }
        }
        if (ok && (foundIdx === -1 || i < foundIdx)) {
          foundIdx = i;
          foundLen = delim.length;
        }
      }
      if (foundIdx !== -1) {
        const end = foundIdx + foundLen;
        const frame = buf.slice(0, end);
        if (frame.length > 0) results.push(frame);
        buf = buf.slice(end);
        i = 0;
      } else {
        i++;
      }
    }
    this._frameBuffer = buf;
    return results;
  }

  _tryExtractFixedFrames() {
    const results = [];
    let buf = [...this._frameBuffer];
    let changed = true;
    let guard = 50;
    while (changed && guard-- > 0) {
      changed = false;
      for (const rule of this.rules) {
        const trig = rule.trigger;
        if (trig.type !== 'frame_match') continue;
        const minLen = trig.min_length || (trig.pattern ? trig.pattern.length : 1);
        if (buf.length < minLen) continue;
        if (matchFramePattern(buf, trig.pattern, trig.mask, minLen)) {
          let frameLen = minLen;
          if (trig.pattern && frameLen < trig.pattern.length) frameLen = trig.pattern.length;
          if (trig.bytes_total_field) {
            const off = trig.bytes_total_field.offset || 0;
            const mul = trig.bytes_total_field.multiplier || 1;
            const add = trig.bytes_total_field.add || 0;
            const be = trig.bytes_total_field.endian !== 'le';
            if (off + 2 <= buf.length) {
              const l = be ? bytesToUint16BE(buf, off) : bytesToUint16LE(buf, off);
              frameLen = l * mul + add;
            }
          } else if (trig.length_field) {
            const off = trig.length_field.offset || 1;
            const add = trig.length_field.add || 0;
            if (off < buf.length) {
              frameLen = buf[off] + add;
            }
          } else if (trig.exact_length) {
            frameLen = trig.exact_length;
          }
          if (frameLen > 0 && buf.length >= frameLen) {
            const frame = buf.slice(0, frameLen);
            results.push(frame);
            buf = buf.slice(frameLen);
            changed = true;
            break;
          }
        }
      }
    }
    this._frameBuffer = buf;
    return results;
  }

  async _flushFrameBuffer() {
    if (this._frameBuffer.length === 0) return;
    let frames = [];
    frames = frames.concat(this._tryExtractFixedFrames());
    frames = frames.concat(this._getAsciiDelimiterFrames());
    if (this._frameBuffer.length > 0) {
      frames.push([...this._frameBuffer]);
      this._frameBuffer = [];
    }
    for (const frame of frames) {
      if (frame && frame.length > 0) {
        await this.processIncomingFrame(frame);
      }
    }
  }

  feedBytes(bytes) {
    if (!bytes || bytes.length === 0) return;
    const arr = Array.isArray(bytes) ? bytes : Array.from(bytes);
    this._frameBuffer.push(...arr);
    this._lastByteTs = Date.now();
    if (this._frameTimer) {
      clearTimeout(this._frameTimer);
    }
    const self = this;
    this._frameTimer = setTimeout(() => {
      self._flushFrameBuffer().catch(e => console.error('flush frame:', e));
    }, this._frameTimeoutMs);
    if (this._frameBuffer.length > 4096) {
      this._flushFrameBuffer().catch(e => console.error('force flush:', e));
    }
  }

  start() {
    this.runStartupRules();
    this.startPeriodic();
    const self = this;
    this._pollTimer = setInterval(() => {
      if (self._frameBuffer.length === 0) return;
      const elapsed = Date.now() - self._lastByteTs;
      if (elapsed >= self._frameTimeoutMs) {
        if (self._frameTimer) { clearTimeout(self._frameTimer); self._frameTimer = null; }
        self._flushFrameBuffer().catch(e => console.error('poll flush:', e));
      }
    }, 20);
  }

  stop() {
    this.stopPeriodic();
    this.clearFrameBuffer();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  runStartupRules() {
    if (this.startupDone) return;
    this.startupDone = true;
    const ctx = this.getCtx();
    for (const rule of this.rules) {
      if (rule.trigger.type !== 'startup') continue;
      this.executeAction(rule, ctx, null, null);
    }
  }

  startPeriodic() {
    for (const rule of this.rules) {
      if (rule.trigger.type !== 'periodic') continue;
      const interval = rule.trigger.interval_ms ||
        (rule.trigger.interval_ms_ref ? this.state[rule.trigger.interval_ms_ref] : 1000);
      if (!interval || interval < 10) continue;
      const timer = setInterval(() => {
        const ctx = this.getCtx();
        const effectiveInterval = rule.trigger.interval_ms_ref ?
          (this.state[rule.trigger.interval_ms_ref] || interval) : interval;
        if (rule.trigger.interval_ms_ref && timer._interval !== effectiveInterval) {
          clearInterval(timer);
          this.periodicTimers.delete(rule.id);
          const newTimer = setInterval(() => {
            const c = this.getCtx();
            this.executeAction(rule, c, null, null);
          }, effectiveInterval);
          newTimer._interval = effectiveInterval;
          this.periodicTimers.set(rule.id, newTimer);
          return;
        }
        this.executeAction(rule, ctx, null, null);
      }, interval);
      timer._interval = interval;
      this.periodicTimers.set(rule.id, timer);
    }
  }

  stopPeriodic() {
    for (const [, timer] of this.periodicTimers) clearInterval(timer);
    this.periodicTimers.clear();
  }

  async processIncomingFrame(frame, rawBytes) {
    const startTs = Date.now();
    this.stats.requestsProcessed++;
    const ctx = this.getCtx();
    ctx.rawFrame = frame;
    ctx.ascii = bytesToString(frame);

    const matchedRules = [];
    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      const trig = rule.trigger;
      let matched = false;
      if (trig.type === 'frame_match') {
        if (matchFramePattern(frame, trig.pattern, trig.mask, trig.min_length)) {
          matched = true;
        }
      } else if (trig.type === 'ascii_match') {
        const ascii = ctx.ascii.toLowerCase().trim();
        const prefix = (trig.prefix || '').toLowerCase();
        if (ascii.startsWith(prefix)) matched = true;
      } else if (trig.type === 'ascii_exact') {
        const ascii = ctx.ascii.trim();
        if (ascii === trig.text) matched = true;
      } else if (trig.type === 'ascii_contains') {
        const ascii = ctx.ascii.toLowerCase();
        const kw = (trig.keyword || '').toLowerCase();
        if (ascii.includes(kw)) matched = true;
      }
      if (matched) {
        matchedRules.push({ rule, index: i });
      }
    }

    if (matchedRules.length === 0) {
      this.stats.matchFailures++;
      if (this.onLog) this.onLog({ type: 'no_match', frame: [...frame] });
      return { matched: false };
    }

    matchedRules.sort((a, b) => {
      const pa = typeof a.rule.priority === 'number' ? a.rule.priority : 0;
      const pb = typeof b.rule.priority === 'number' ? b.rule.priority : 0;
      if (pb !== pa) return pb - pa;
      return a.index - b.index;
    });

    const topPriority = typeof matchedRules[0].rule.priority === 'number' ? matchedRules[0].rule.priority : 0;
    const rulesToExecute = [];
    for (const mr of matchedRules) {
      const p = typeof mr.rule.priority === 'number' ? mr.rule.priority : 0;
      const exclusive = mr.rule.exclusive !== false;
      if (p === topPriority) {
        rulesToExecute.push(mr);
        if (exclusive) break;
      } else if (p < topPriority) {
        if (!exclusive) {
          rulesToExecute.push(mr);
        } else {
          break;
        }
      }
    }

    for (const mr of rulesToExecute) {
      if (this.onLog) this.onLog({ type: 'rule_match', ruleId: mr.rule.id, ruleName: mr.rule.name });
      await this.executeAction(mr.rule, ctx, frame, rawBytes);
    }

    const latency = Date.now() - startTs;
    this.stats.responseLatencies.push({ ts: Date.now(), latency });
    if (this.stats.responseLatencies.length > 1000) {
      this.stats.responseLatencies.shift();
    }
    return { matched: true, rules: rulesToExecute.map(mr => mr.rule) };
  }

  async executeAction(rule, ctx, frame) {
    const action = rule.action;
    let responseBytes = null;
    let delayMs = action.delay_ms || rule.delay_ms || 0;

    try {
      if (action.type === 'fixed_response') {
        responseBytes = action.data ? [...action.data] : null;
      } else if (action.type === 'template_response') {
        const tplData = action.data_template || [];
        responseBytes = [];
        for (const item of tplData) {
          if (typeof item === 'number') {
            responseBytes.push(item & 0xFF);
          } else if (typeof item === 'string') {
            const expanded = expandTemplate(item, { ...ctx });
            if (/^0x/i.test(expanded)) {
              const n = parseInt(expanded);
              if (!isNaN(n)) responseBytes.push(n & 0xFF);
            } else {
              const n = parseInt(expanded);
              if (!isNaN(n) && expanded.trim() !== '') {
                responseBytes.push(n & 0xFF);
              } else {
                for (let i = 0; i < expanded.length; i++) {
                  responseBytes.push(expanded.charCodeAt(i) & 0xFF);
                }
              }
            }
          }
        }
      } else if (action.type === 'custom') {
        const handler = this.customHandlers[action.handler];
        if (handler) {
          responseBytes = handler(ctx, frame || []);
        } else {
          console.warn('Unknown handler:', action.handler);
        }
      } else if (action.type === 'set_state') {
        if (action.state_key !== undefined && action.state_value !== undefined) {
          const val = typeof action.state_value === 'string'
            ? evalExpr(action.state_value, ctx)
            : action.state_value;
          this.setState(action.state_key, val);
        }
      } else if (action.type === 'sequence') {
        const steps = action.steps || [];
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          if (step.delay_ms) {
            await new Promise(r => setTimeout(r, step.delay_ms));
          }
          if (step.data && step.data.length) {
            this.sendResponse([...step.data]);
          } else if (step.handler) {
            const h = this.customHandlers[step.handler];
            if (h) {
              const res = h(ctx, frame || []);
              if (res && res.length) this.sendResponse(res);
            }
          }
        }
        return;
      } else if (action.type === 'conditional') {
        const conditions = action.conditions || [];
        let chosenAction = null;
        for (const cond of conditions) {
          if (cond.expression && evalBooleanExpr(cond.expression, ctx)) {
            chosenAction = cond.action;
            break;
          }
        }
        if (!chosenAction && action.fallback_action) {
          chosenAction = action.fallback_action;
        }
        if (chosenAction) {
          const wrappedRule = { ...rule, action: chosenAction };
          await this.executeAction(wrappedRule, ctx, frame);
          return;
        }
      }

      if (action.state_changes && Array.isArray(action.state_changes)) {
        for (const sc of action.state_changes) {
          if (sc.key !== undefined) {
            const val = typeof sc.value === 'string'
              ? evalExpr(sc.value, ctx)
              : sc.value;
            this.setState(sc.key, val);
          }
        }
      }
    } catch (e) {
      console.error('Action execute error:', e);
      if (this.onLog) this.onLog({ type: 'error', message: e.message });
    }

    if (responseBytes && responseBytes.length) {
      if (delayMs > 0) {
        setTimeout(() => {
          this.sendResponse(responseBytes);
        }, delayMs);
      } else {
        this.sendResponse(responseBytes);
      }
    }
  }

  sendResponse(bytes) {
    this.stats.responsesSent++;
    if (this.onResponse) {
      try { this.onResponse(bytes); } catch (e) { console.error(e); }
    }
    if (this.onLog) {
      this.onLog({ type: 'response', bytes: [...bytes] });
    }
  }

  getStats() {
    const latencies = this.stats.responseLatencies.map(item =>
      typeof item === 'number' ? item : item.latency
    );
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;
    return {
      requestsProcessed: this.stats.requestsProcessed,
      responsesSent: this.stats.responsesSent,
      matchFailures: this.stats.matchFailures,
      averageLatencyMs: Math.round(avgLatency * 10) / 10,
      responseLatencies: this.stats.responseLatencies,
    };
  }

  resetStats() {
    this.stats = {
      requestsProcessed: 0,
      responsesSent: 0,
      matchFailures: 0,
      responseLatencies: [],
    };
  }
}

export function getTemplateScriptJson(templateKey) {
  const tpl = BUILTIN_TEMPLATES[templateKey];
  if (!tpl) return JSON.stringify({ rules: [] }, null, 2);
  return JSON.stringify(tpl.script, null, 2);
}

export function validateScript(jsonText) {
  try {
    const obj = JSON.parse(jsonText);
    if (!obj.rules || !Array.isArray(obj.rules)) {
      return { valid: false, error: '脚本必须包含 rules 数组' };
    }
    for (let i = 0; i < obj.rules.length; i++) {
      const rule = obj.rules[i];
      if (!rule.id) return { valid: false, error: `规则[${i}]缺少 id 字段` };
      if (!rule.trigger) return { valid: false, error: `规则[${rule.id}]缺少 trigger 字段` };
      if (!rule.action) return { valid: false, error: `规则[${rule.id}]缺少 action 字段` };
      const validTriggers = ['startup', 'periodic', 'frame_match', 'ascii_match', 'ascii_exact', 'ascii_contains'];
      if (!validTriggers.includes(rule.trigger.type)) {
        return { valid: false, error: `规则[${rule.id}]未知触发类型: ${rule.trigger.type}` };
      }
      const validActions = ['fixed_response', 'template_response', 'custom', 'set_state', 'sequence', 'conditional'];
      if (!validActions.includes(rule.action.type)) {
        return { valid: false, error: `规则[${rule.id}]未知动作类型: ${rule.action.type}` };
      }
      if (rule.action.type === 'conditional') {
        if (rule.action.conditions && !Array.isArray(rule.action.conditions)) {
          return { valid: false, error: `规则[${rule.id}]的 conditions 必须是数组` };
        }
        if (rule.action.conditions) {
          for (let j = 0; j < rule.action.conditions.length; j++) {
            const cond = rule.action.conditions[j];
            if (!cond.expression) {
              return { valid: false, error: `规则[${rule.id}]的条件[${j}]缺少 expression 字段` };
            }
            if (!cond.action) {
              return { valid: false, error: `规则[${rule.id}]的条件[${j}]缺少 action 字段` };
            }
            if (!validActions.includes(cond.action.type)) {
              return { valid: false, error: `规则[${rule.id}]的条件[${j}]未知动作类型: ${cond.action.type}` };
            }
          }
        }
        if (rule.action.fallback_action && !validActions.includes(rule.action.fallback_action.type)) {
          return { valid: false, error: `规则[${rule.id}]的 fallback_action 未知动作类型: ${rule.action.fallback_action.type}` };
        }
      }
      if (rule.priority !== undefined && typeof rule.priority !== 'number') {
        return { valid: false, error: `规则[${rule.id}]的 priority 必须是数字` };
      }
      if (rule.exclusive !== undefined && typeof rule.exclusive !== 'boolean') {
        return { valid: false, error: `规则[${rule.id}]的 exclusive 必须是布尔值` };
      }
    }
    return { valid: true, parsed: obj };
  } catch (e) {
    return { valid: false, error: 'JSON解析错误: ' + e.message };
  }
}

export const EMULATOR_TEMPLATE_KEYS = ['modbus_rtu', 'sensor_collector', 'at_device'];

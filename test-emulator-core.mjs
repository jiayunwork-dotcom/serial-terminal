import {
  VirtualSerialPipe,
  ScriptEngine,
  BUILTIN_TEMPLATES,
  EMULATOR_TEMPLATE_KEYS,
  validateScript,
  crc16Modbus,
  bcc,
  bytesToUint16BE,
  bytesToUint16LE,
  uint16ToBytesBE,
  uint16ToBytesLE,
  float32ToBytesLE,
  bytesToFloat32LE,
  stringToBytes,
  bytesToString,
} from './src/emulatorCore.js';

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passCount++;
    console.log('  ✓ PASS:', msg);
  } else {
    failCount++;
    failures.push(msg);
    console.log('  ✗ FAIL:', msg);
  }
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function hex(b) {
  return Array.from(b).map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

console.log('\n=== Test 1: 校验工具函数 ===');
{
  // CRC16-Modbus: 01 03 00 00 00 0A -> CRC数值 = 0xCDC5 (LE传输字节 C5 CD)
  const frame = [0x01, 0x03, 0x00, 0x00, 0x00, 0x0A];
  const crc = crc16Modbus(frame);
  assert(crc === 0xCDC5, `CRC16-Modbus: expected CDC5, got ${crc.toString(16).toUpperCase()}`);
  // 验证 LE 字节序与发送端一致: uint16ToBytesLE(0xCDC5) = [C5, CD]
  assert(bytesEqual(uint16ToBytesLE(crc), [0xC5, 0xCD]), `CRC-LE字节序: C5 CD = ${hex(uint16ToBytesLE(crc))}`);

  // BCC 校验: AA 55 0C <data>
  const bccData = [0x0C, 0x00, 0x00, 0x80, 0x41, 0x00, 0x00, 0x80, 0x41, 0x00, 0x00, 0x80, 0x41];
  const b = bcc(bccData);
  console.log('  (BCC calc for sensor frame body =', b.toString(16).toUpperCase().padStart(2,'0'), ')');

  // uint16转换
  assert(bytesToUint16BE([0x12, 0x34]) === 0x1234, 'bytesToUint16BE 1234');
  assert(bytesEqual(uint16ToBytesBE(0xABCD), [0xAB, 0xCD]), 'uint16ToBytesBE ABCD');
  assert(bytesEqual(uint16ToBytesLE(0xABCD), [0xCD, 0xAB]), 'uint16ToBytesLE ABCD');

  // float32 LE
  const fbytes = float32ToBytesLE(25.0);
  const fv = bytesToFloat32LE(fbytes);
  assert(Math.abs(fv - 25.0) < 0.001, `float32 LE round-trip 25.0: got ${fv}`);

  // 字符串转换
  assert(bytesToString(stringToBytes('OK\\r\\n')) === 'OK\\r\\n', 'string<->bytes roundtrip');
}

console.log('\n=== Test 2: VirtualSerialPipe 内存管道 ===');
{
  const pipe = new VirtualSerialPipe('test-pipe');
  pipe.open();
  assert(pipe.isOpen === true, '管道打开');
  assert(pipe.id === 'test-pipe', '管道ID');
  assert(pipe.hostName.startsWith('EMU-HOST-'), '主机端名称');
  assert(pipe.deviceName.startsWith('EMU-DEV-'), '设备端名称');

  let hostReceived = null;
  let deviceReceived = null;
  pipe.onHostData(e => { hostReceived = e.data; });
  pipe.onDeviceData(e => { deviceReceived = e.data; });

  // 设备端写入，主机端接收
  pipe.writeToHost([0x01, 0x03, 0x02, 0x00, 0x01, 0x79, 0x84]);
  assert(hostReceived !== null && bytesEqual(hostReceived, [0x01, 0x03, 0x02, 0x00, 0x01, 0x79, 0x84]), 'writeToHost -> onHostData');

  // 主机端写入，设备端接收
  pipe.writeToDevice([0x01, 0x03, 0x00, 0x00, 0x00, 0x0A, 0xC5, 0xCD]);
  assert(deviceReceived !== null && bytesEqual(deviceReceived, [0x01, 0x03, 0x00, 0x00, 0x00, 0x0A, 0xC5, 0xCD]), 'writeToDevice -> onDeviceData');

  pipe.close();
  assert(pipe.isOpen === false, '管道关闭');
}

console.log('\n=== Test 3: 脚本语法验证 (validateScript) ===');
{
  // 有效脚本
  const valid = validateScript(JSON.stringify({
    rules: [{
      id: 'r1',
      trigger: { type: 'frame_match', pattern: [0x01, 0x03] },
      action: { type: 'fixed_response', data: [0x01, 0x03, 0x00] },
    }]
  }));
  assert(valid.valid === true, '有效脚本验证通过');

  // 无效脚本 - 语法错误
  const invalid1 = validateScript('{ rules: [bad json');
  assert(invalid1.valid === false, 'JSON语法错误被捕获');
  assert(invalid1.error.includes('JSON'), '错误信息包含JSON');

  // 无效脚本 - 缺少rules
  const invalid2 = validateScript('{}');
  assert(invalid2.valid === false, '缺少rules字段被捕获');

  // 无效脚本 - 规则缺少字段
  const invalid3 = validateScript(JSON.stringify({ rules: [{ id: 'a' }] }));
  assert(invalid3.valid === false, '规则缺少trigger/action被捕获');

  // 无效脚本 - 未知触发类型
  const invalid4 = validateScript(JSON.stringify({
    rules: [{ id: 'r', trigger: { type: 'unknown' }, action: { type: 'custom', handler: 'x' } }]
  }));
  assert(invalid4.valid === false, '未知trigger.type被捕获');

  // 无效脚本 - 未知动作类型
  const invalid5 = validateScript(JSON.stringify({
    rules: [{ id: 'r', trigger: { type: 'startup' }, action: { type: 'bad_action' } }]
  }));
  assert(invalid5.valid === false, '未知action.type被捕获');
}

console.log('\n=== Test 4: 模板内置脚本有效性 ===');
{
  for (const key of EMULATOR_TEMPLATE_KEYS) {
    const tpl = BUILTIN_TEMPLATES[key];
    const v = validateScript(JSON.stringify(tpl.script));
    assert(v.valid === true, `模板 [${tpl.name}] 脚本有效`);
    assert(Array.isArray(tpl.stateSchema), `模板 [${tpl.name}] 有stateSchema`);
    assert(tpl.defaultState !== undefined, `模板 [${tpl.name}] 有defaultState`);
  }
}

console.log('\n=== Test 5: ScriptEngine - Modbus RTU FC03 读保持寄存器 ===');
{
  const engine = new ScriptEngine();
  const tpl = BUILTIN_TEMPLATES.modbus_rtu;
  engine.loadScript(tpl.script, tpl.defaultState);

  // 预置响应
  let responses = [];
  engine.onResponse = bytes => responses.push(bytes);
  engine.onLog = () => {};

  // 初始化状态: registers[0..9] = 0..9
  for (let i = 0; i < 10; i++) {
    engine.setState(`registers[${i}]`, i);
  }

  engine.start();

  // 构造请求: 从站1, FC03, 起始地址0, 读10个寄存器 => 01 03 00 00 00 0A C5 CD
  const req = [0x01, 0x03, 0x00, 0x00, 0x00, 0x0A];
  const crcReq = crc16Modbus(req);
  const fullReq = [...req, ...uint16ToBytesLE(crcReq)];

  await new Promise(r => setTimeout(r, 10));
  responses = [];
  await engine.processIncomingFrame(fullReq);
  await new Promise(r => setTimeout(r, 60)); // 等待帧缓冲超时

  assert(responses.length === 1, 'Modbus FC03返回1个响应');
  if (responses[0]) {
    const resp = responses[0];
    assert(resp[0] === 0x01, '响应从站地址=1');
    assert(resp[1] === 0x03, '响应功能码=03');
    assert(resp[2] === 20, '数据字节长度=20 (10个寄存器*2)');
    // 验证寄存器值: 0x0000, 0x0001, 0x0002 ... 0x0009
    for (let i = 0; i < 10; i++) {
      const val = bytesToUint16BE(resp, 3 + i * 2);
      assert(val === i, `寄存器[${i}] = ${i}, 实际=${val}`);
    }
    // 验证CRC
    const dataCrc = crc16Modbus(resp.slice(0, resp.length - 2));
    const respCrc = bytesToUint16LE(resp, resp.length - 2);
    assert(dataCrc === respCrc, `响应CRC正确, expected=${dataCrc.toString(16)} actual=${respCrc.toString(16)}`);
  }

  engine.stop();
}

console.log('\n=== Test 6: ScriptEngine - Modbus RTU FC06 写单寄存器 ===');
{
  const engine = new ScriptEngine();
  const tpl = BUILTIN_TEMPLATES.modbus_rtu;
  engine.loadScript(tpl.script, tpl.defaultState);

  let responses = [];
  engine.onResponse = bytes => responses.push(bytes);
  engine.onLog = () => {};
  engine.start();

  // 写寄存器[5] = 0x1234
  const writeBody = [0x01, 0x06, 0x00, 0x05, 0x12, 0x34];
  const writeCrc = crc16Modbus(writeBody);
  const writeReq = [...writeBody, ...uint16ToBytesLE(writeCrc)];

  await new Promise(r => setTimeout(r, 10));
  responses = [];
  await engine.processIncomingFrame(writeReq);
  await new Promise(r => setTimeout(r, 60));

  assert(responses.length === 1, 'FC06返回响应');
  assert(engine.state.registers[5] === 0x1234, `写后寄存器[5] = ${engine.state.registers[5]?.toString(16)}`);

  engine.stop();
}

console.log('\n=== Test 7: ScriptEngine - Modbus RTU FC16 写多寄存器 ===');
{
  const engine = new ScriptEngine();
  const tpl = BUILTIN_TEMPLATES.modbus_rtu;
  engine.loadScript(tpl.script, tpl.defaultState);

  let responses = [];
  engine.onResponse = bytes => responses.push(bytes);
  engine.onLog = () => {};
  engine.start();

  // 写寄存器[2..5] = 0x1111, 0x2222, 0x3333, 0x4444
  const values = [0x1111, 0x2222, 0x3333, 0x4444];
  const regBytes = [];
  for (const v of values) regBytes.push(...uint16ToBytesBE(v));
  const body = [0x01, 0x10, 0x00, 0x02, 0x00, 0x04, regBytes.length, ...regBytes];
  const crc = crc16Modbus(body);
  const req = [...body, ...uint16ToBytesLE(crc)];

  await new Promise(r => setTimeout(r, 10));
  responses = [];
  await engine.processIncomingFrame(req);
  await new Promise(r => setTimeout(r, 60));

  assert(responses.length === 1, 'FC16返回响应');
  for (let i = 0; i < values.length; i++) {
    assert(engine.state.registers[2+i] === values[i], `FC16后寄存器[${2+i}] = ${engine.state.registers[2+i]?.toString(16)} (expected ${values[i].toString(16)})`);
  }

  engine.stop();
}

console.log('\n=== Test 8: ScriptEngine - 帧缓冲分片组装 (feedBytes) ===');
{
  const engine = new ScriptEngine();
  const tpl = BUILTIN_TEMPLATES.modbus_rtu;
  engine.loadScript(tpl.script, tpl.defaultState);

  let responses = [];
  engine.onResponse = bytes => responses.push(bytes);
  engine.onLog = () => {};
  engine.start();

  // 分片发送 Modbus 请求 (分3片到达)
  const body = [0x01, 0x03, 0x00, 0x00, 0x00, 0x02];
  const crc = crc16Modbus(body);
  const full = [...body, ...uint16ToBytesLE(crc)]; // = 8 bytes

  responses = [];
  engine.feedBytes(full.slice(0, 3)); // 片1: 01 03 00
  await new Promise(r => setTimeout(r, 5));
  engine.feedBytes(full.slice(3, 6)); // 片2: 00 00 02
  await new Promise(r => setTimeout(r, 5));
  engine.feedBytes(full.slice(6));    // 片3: C5 CD (CRC)
  await new Promise(r => setTimeout(r, 100)); // 等待帧超时

  assert(responses.length === 1, `分片发送后仍然收到响应，实际=${responses.length}`);
  if (responses[0]) {
    assert(responses[0][1] === 0x03, '分片响应功能码正确');
    assert(responses[0][2] === 0x04, '分片响应数据长度正确(2寄存器*2=4)');
  }

  engine.stop();
}

console.log('\n=== Test 9: 传感器模板 - 周期性数据上报 ===');
{
  const engine = new ScriptEngine();
  const tpl = BUILTIN_TEMPLATES.sensor_collector;
  engine.loadScript(tpl.script, tpl.defaultState);

  // 设置短间隔(100ms)
  engine.setState('report_interval_ms', 100);

  let responses = [];
  engine.onResponse = bytes => responses.push(bytes);
  engine.onLog = () => {};
  engine.start();

  // 等待300ms，应该产生2-3次上报
  await new Promise(r => setTimeout(r, 320));

  const count = responses.length;
  console.log(`  (320ms内收到${count}次传感器上报)`);
  assert(count >= 2, `320ms内收到>=2次上报(100ms间隔), actual=${count}`);

  if (responses[0]) {
    const frame = responses[0];
    assert(frame[0] === 0xAA && frame[1] === 0x55, '传感器帧头 AA 55');
    const length = frame[2];
    assert(length === 12, `数据区长度=12 (3 float32), actual=${length}`);
    // 解析3个float
    const t = bytesToFloat32LE(frame, 3);
    const h = bytesToFloat32LE(frame, 7);
    const p = bytesToFloat32LE(frame, 11);
    console.log(`  (解析: t=${t.toFixed(2)}°C h=${h.toFixed(2)}% p=${p.toFixed(2)}hPa)`);
    assert(t > -50 && t < 100, `温度在合理范围: ${t}`);
    assert(h >= 0 && h <= 100, `湿度在合理范围: ${h}`);
    assert(p > 800 && p < 1200, `气压在合理范围: ${p}`);
    // BCC校验
    const calcBcc = bcc(frame.slice(2, frame.length - 1));
    assert(calcBcc === frame[frame.length - 1], `BCC校验正确 expected=${calcBcc.toString(16)} actual=${frame[frame.length-1].toString(16)}`);
  }

  engine.stop();
}

console.log('\n=== Test 10: AT指令模板 ===');
{
  const engine = new ScriptEngine();
  const tpl = BUILTIN_TEMPLATES.at_device;
  engine.loadScript(tpl.script, tpl.defaultState);

  let responses = [];
  engine.onResponse = bytes => responses.push(bytes);
  engine.onLog = () => {};
  engine.start();

  const cases = [
    { name: 'AT测试', input: 'AT', expectedSub: 'OK' },
    { name: 'AT+VER版本', input: 'AT+VER\\r\\n', expectedSub: 'VER:' },
    { name: 'AT+RST复位', input: 'AT+RST', expectedSub: 'RESET' },
    { name: 'AT+DATA?数据', input: 'AT+DATA?', expectedSub: '+TEMP:' },
    { name: 'AT+MODEL?型号', input: 'AT+MODEL?', expectedSub: '+MODEL:' },
    { name: 'AT+IMEI?串号', input: 'AT+IMEI?', expectedSub: '+IMEI:' },
  ];

  for (const c of cases) {
    responses = [];
    const reqBytes = stringToBytes(c.input);
    engine.feedBytes(reqBytes);
    await new Promise(r => setTimeout(r, 100));
    const allStr = responses.map(b => bytesToString(b)).join('');
    assert(allStr.includes(c.expectedSub), `AT [${c.name}]: 响应包含"${c.expectedSub}" (actual="${allStr.replace(/\\r/g,'<CR>').replace(/\\n/g,'<LF>').substring(0,80)}")`);
  }

  engine.stop();
}

console.log('\n=== Test 11: 状态变量读写与元数据 ===');
{
  const engine = new ScriptEngine();
  engine.loadScript({ rules: [] }, { x: 1, nested: { y: 2 }, arr: [10, 20, 30] });
  let changes = [];
  engine.onStateChange = (k, v, o) => changes.push({ k, v, o });

  engine.setState('x', 42);
  assert(engine.state.x === 42, 'setState x=42');
  engine.setState('nested.y', 99);
  assert(engine.state.nested.y === 99, 'setState nested.y=99');
  engine.setState('arr[1]', 200);
  assert(engine.state.arr[1] === 200, 'setState arr[1]=200');
  assert(changes.length === 3, `触发3次stateChange回调, actual=${changes.length}`);

  const meta = engine.stateMeta['x'];
  assert(meta && meta.lastModified > 0, 'stateMeta记录了lastModified');

  const val = engine.getStateValue('nested.y');
  assert(val === 99, `getStateValue nested.y = ${val}`);
  const val2 = engine.getStateValue('arr[2]');
  assert(val2 === 30, `getStateValue arr[2] = ${val2}`);
}

console.log('\n=== Test 12: 统计信息 ===');
{
  const engine = new ScriptEngine();
  const tpl = BUILTIN_TEMPLATES.modbus_rtu;
  engine.loadScript(tpl.script, tpl.defaultState);
  engine.onResponse = () => {};
  engine.onLog = () => {};
  engine.start();

  // 3次有效请求
  for (let i = 0; i < 3; i++) {
    const body = [0x01, 0x03, 0x00, i, 0x00, 0x01];
    const crc = crc16Modbus(body);
    await engine.processIncomingFrame([...body, ...uint16ToBytesLE(crc)]);
  }
  // 1次无效(从站地址不对，无法匹配自定义handler返回null，但frame匹配了)
  await engine.processIncomingFrame([0xFF, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00]);
  // 1次完全不匹配帧 (非Modbus模式的帧)
  await engine.processIncomingFrame([0xDE, 0xAD, 0xBE, 0xEF]);

  const s = engine.getStats();
  console.log(`  (stats: req=${s.requestsProcessed} resp=${s.responsesSent} fail=${s.matchFailures} lat=${s.averageLatencyMs}ms)`);
  assert(s.requestsProcessed === 5, `处理5个请求, actual=${s.requestsProcessed}`);
  assert(s.responsesSent >= 3, `至少3个响应有效, actual=${s.responsesSent}`);
  assert(s.averageLatencyMs >= 0, `平均延迟>=0`);

  engine.resetStats();
  const s2 = engine.getStats();
  assert(s2.requestsProcessed === 0, 'resetStats后统计归零');

  engine.stop();
}

console.log('\n=== Test 13: 动作延迟 & sequence序列 ===');
{
  const engine = new ScriptEngine();
  const script = {
    rules: [
      { id: 'delayed', name: '延迟响应',
        trigger: { type: 'frame_match', pattern: [0xAA], min_length: 1 },
        action: { type: 'fixed_response', delay_ms: 80, data: [0xBB] },
      },
      { id: 'seq', name: '序列动作',
        trigger: { type: 'frame_match', pattern: [0xCC], min_length: 1 },
        action: {
          type: 'sequence',
          steps: [
            { data: [0x10] },
            { delay_ms: 60 },
            { data: [0x20] },
            { delay_ms: 60 },
            { data: [0x30] },
          ]
        }
      },
      { id: 'setst', name: '仅改状态',
        trigger: { type: 'frame_match', pattern: [0xEE], min_length: 1 },
        action: { type: 'set_state', state_key: 'flag', state_value: 123 },
      },
    ]
  };
  engine.loadScript(script, { flag: 0 });
  let responses = [];
  engine.onResponse = b => responses.push({ bytes: b, ts: Date.now() });
  engine.onLog = () => {};
  engine.start();

  // 测试延迟
  const t0 = Date.now();
  await engine.processIncomingFrame([0xAA]);
  await new Promise(r => setTimeout(r, 120));
  assert(responses.length === 1, `延迟响应1条, actual=${responses.length}`);
  const lat = responses[0].ts - t0;
  assert(lat >= 60, `延迟>=60ms, actual=${lat}ms`);

  // 测试sequence
  responses = [];
  await engine.processIncomingFrame([0xCC]);
  await new Promise(r => setTimeout(r, 220));
  assert(responses.length === 3, `sequence产生3条响应, actual=${responses.length}`);
  if (responses.length >= 3) {
    assert(bytesEqual(responses[0].bytes, [0x10]), 'seq step1 = 0x10');
    assert(bytesEqual(responses[1].bytes, [0x20]), 'seq step2 = 0x20');
    assert(bytesEqual(responses[2].bytes, [0x30]), 'seq step3 = 0x30');
  }

  // 测试set_state
  await engine.processIncomingFrame([0xEE]);
  assert(engine.state.flag === 123, `set_state动作改变flag=${engine.state.flag}`);

  engine.stop();
}

console.log('\n=== Test 14: 多种触发类型 (startup/ascii/periodic) ===');
{
  const engine = new ScriptEngine();
  const script = {
    rules: [
      { id: 'su', name: '启动触发',
        trigger: { type: 'startup' },
        action: { type: 'set_state', state_key: 'started', state_value: true },
      },
      { id: 'per', name: '定时触发',
        trigger: { type: 'periodic', interval_ms: 60 },
        action: { type: 'fixed_response', data: [0xBE, 0xEF] },
      },
      { id: 'asc_match', name: 'ASCII前缀匹配',
        trigger: { type: 'ascii_match', prefix: '*IDN?' },
        action: { type: 'template_response', data_template: ['I','n','s','t','r','u','m','e','n','t','-','X','1','0','0','\r','\n'] },
      },
      { id: 'asc_exact', name: 'ASCII精确匹配',
        trigger: { type: 'ascii_exact', text: '*RST' },
        action: { type: 'set_state', state_key: 'resetCount', state_value: 'resetCount + 1' },
      },
      { id: 'asc_cont', name: 'ASCII包含匹配',
        trigger: { type: 'ascii_contains', keyword: 'ping' },
        action: { type: 'fixed_response', data: [0x50, 0x4F, 0x4E, 0x47] }, // PONG
      },
    ]
  };
  engine.loadScript(script, { started: false, resetCount: 0 });
  let responses = [];
  engine.onResponse = b => responses.push(bytesToString(b));
  engine.onLog = () => {};

  assert(engine.state.started === false, '启动前started=false');
  engine.start();
  assert(engine.state.started === true, '启动后startup规则触发started=true');

  // 定时触发
  await new Promise(r => setTimeout(r, 200));
  const periodicCount = responses.filter(r => r === String.fromCharCode(0xBE,0xEF) || (r.length===2 && r.charCodeAt(0)===0xBE && r.charCodeAt(1)===0xEF)).length;
  console.log(`  (periodic触发次数: ${periodicCount} in 200ms @ 60ms interval)`);
  assert(periodicCount >= 2, `periodic>=2次, actual=${periodicCount}`);
  responses = [];

  // ASCII前缀
  engine.feedBytes(stringToBytes('*IDN?\r\n'));
  await new Promise(r => setTimeout(r, 80));
  assert(responses.some(r => r.startsWith('Instrument')), '*IDN? -> Instrument-X100');
  responses = [];

  // ASCII精确
  engine.feedBytes(stringToBytes('*RST'));
  await new Promise(r => setTimeout(r, 80));
  assert(engine.state.resetCount === 1, `*RST精确匹配后 resetCount=${engine.state.resetCount}`);

  // ASCII包含
  engine.feedBytes(stringToBytes('send:ping:data'));
  await new Promise(r => setTimeout(r, 80));
  assert(responses.includes('PONG'), `包含"ping" -> PONG, actual=${JSON.stringify(responses)}`);

  engine.stop();
}

console.log('\\n=========================================');
console.log(`总结果: ${passCount} 通过, ${failCount} 失败`);
if (failures.length > 0) {
  console.log('\\n失败项:');
  failures.forEach(f => console.log('  -', f));
}
console.log('=========================================');

process.exit(failCount > 0 ? 1 : 0);

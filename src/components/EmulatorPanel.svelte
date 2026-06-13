<script>
  import { onMount, onDestroy, afterUpdate, tick, getContext } from 'svelte';
  import {
    emulatorState, showScriptEditor, formatTimestamp,
    bytesToHex, bytesToAscii, uuidv4,
  } from '../stores.js';
  import {
    VirtualSerialPipe, ScriptEngine, BUILTIN_TEMPLATES,
    getTemplateScriptJson, EMULATOR_TEMPLATE_KEYS,
    crc16Modbus, bcc,
  } from '../emulatorCore.js';
  import ScriptEditor from './ScriptEditor.svelte';

  export let onClose;

  const handlePortOpened = getContext('handlePortOpened');
  const handlePortClosed = getContext('handlePortClosed');
  const handleSerialData = getContext && getContext('injectHandleSerialData') ? getContext('injectHandleSerialData') : null;
  const injectEmulatorResponseToMain = getContext && getContext('injectEmulatorResponseToMain') ? getContext('injectEmulatorResponseToMain') : null;

  let pipe = null;
  let engine = new ScriptEngine();
  let currentScriptText = '';
  let currentScriptObj = null;
  let deviceLogEl = null;
  let autoScrollLogs = true;
  let statsTimer = null;
  let editingRegCell = null;
  let editingRegValue = '';
  let editingVarKey = null;
  let editingVarValue = '';
  let deviceSendHex = '';
  let logDisplayMode = 'Mixed';
  let latencyCanvas = null;
  let latencyCanvasCtx = null;
  let latencyDrawTimer = null;
  let recordingStartTs = 0;
  let playbackTimers = [];
  let newScenarioName = '';
  let showSaveScenarioDialog = false;
  const SCENARIO_STORAGE_KEY = 'emulator_scenarios_v1';

  let selectedTemplate = $emulatorState.selectedTemplate || 'modbus_rtu';

  $: currentTemplate = BUILTIN_TEMPLATES[selectedTemplate];
  $: isRunning = $emulatorState.isRunning;
  $: deviceLogs = $emulatorState.deviceLogs || [];
  $: emuStats = $emulatorState.stats || {};
  $: emuVars = $emulatorState.variables || [];
  $: regView = $emulatorState.registerView || { startAddr: 0, countPerPage: 20 };
  $: showEditor = $showScriptEditor;
  $: stateObj = engine.state;
  $: hasRegisters = selectedTemplate === 'modbus_rtu';

  function buildVariableList() {
    const vars = [];
    const tpl = BUILTIN_TEMPLATES[selectedTemplate];
    if (!tpl || !tpl.stateSchema) return;
    for (const field of tpl.stateSchema) {
      if (field.type === 'registers') continue;
      const val = engine.state[field.key];
      const meta = engine.stateMeta[field.key] || {};
      vars.push({
        key: field.key,
        label: field.label,
        type: field.type,
        value: val,
        lastModified: meta.lastModified || null,
        min: field.min,
        max: field.max,
      });
    }
    emulatorState.update(s => ({ ...s, variables: vars }));
  }

  function addDeviceLog(direction, data, extra = {}) {
    const line = {
      id: uuidv4(),
      timestamp: Date.now(),
      direction,
      data: Array.isArray(data) ? [...data] : Array.from(data || []),
      ...extra,
    };
    emulatorState.update(s => {
      const logs = [...(s.deviceLogs || []), line];
      const maxLogs = 5000;
      const trimmed = logs.length > maxLogs ? logs.slice(logs.length - maxLogs) : logs;
      let recordedFrames = s.recordedFrames || [];
      if (s.isRecording && (direction === 'Rx' || direction === 'Tx')) {
        recordedFrames = [...recordedFrames, {
          ts: line.timestamp,
          direction,
          data: line.data,
        }];
      }
      return { ...s, deviceLogs: trimmed, recordedFrames };
    });
  }

  function clearLogs() {
    emulatorState.update(s => ({ ...s, deviceLogs: [] }));
  }

  function refreshStats() {
    const stats = engine.getStats();
    emulatorState.update(s => ({ ...s, stats }));
  }

  function startEmulator() {
    if (isRunning) return;
    const tpl = BUILTIN_TEMPLATES[selectedTemplate];
    if (!tpl) {
      alert('请选择设备模板');
      return;
    }

    try {
      if (!currentScriptObj) {
        currentScriptText = getTemplateScriptJson(selectedTemplate);
        const v = JSON.parse(currentScriptText);
        currentScriptObj = v;
      }

      pipe = new VirtualSerialPipe();
      pipe.open();

      engine = new ScriptEngine();
      engine.loadScript(currentScriptObj, tpl.defaultState);

      engine.onLog = (evt) => {
        if (evt.type === 'rule_match') {
          addDeviceLog('EVENT', [], { event: `规则匹配: ${evt.ruleName} [${evt.ruleId}]` });
        } else if (evt.type === 'no_match') {
          addDeviceLog('WARN', evt.frame || [], { event: '⚠ 无匹配规则' });
        } else if (evt.type === 'error') {
          addDeviceLog('ERR', [], { event: '❌ 错误: ' + (evt.message || '') });
        }
      };

      engine.onResponse = (bytes) => {
        if (pipe && pipe.isOpen) {
          pipe.writeToHost(bytes);
          addDeviceLog('Tx', bytes);
        }
        if (injectEmulatorResponseToMain) {
          try { injectEmulatorResponseToMain(bytes); } catch (e) {}
        }
      };

      engine.onStateChange = () => {
        buildVariableList();
      };

      pipe.onHostData((evt) => {
        if (handleSerialData) {
          handleSerialData({
            portId: pipe.id,
            portName: pipe.hostName,
            direction: 'Rx',
            timestamp: evt.timestamp,
            data: evt.data,
          });
        }
      });

      pipe.onDeviceData(async (evt) => {
        addDeviceLog('Rx', evt.data);
        const frame = evt.data || [];
        if (frame.length > 0) {
          engine.feedBytes(frame);
          refreshStats();
        }
      });

      const hostPortId = pipe.id;
      const hostPortName = pipe.hostName;
      const hostConfig = {
        baud_rate: 115200,
        data_bits: 'Eight',
        stop_bits: 'One',
        parity: 'None',
        flow_control: 'None',
        timeout_ms: 100,
        is_emulator: true,
      };

      emulatorState.update(s => ({
        ...s,
        isRunning: true,
        hostPortId,
        hostPortName,
        deviceLogs: [],
        stats: engine.getStats(),
      }));

      handlePortOpened(hostPortId, hostPortName, hostConfig);

      setTimeout(() => {
        buildVariableList();
        engine.start();
        addDeviceLog('INFO', [], { event: '✅ 仿真器启动: ' + tpl.name });
        refreshStats();
      }, 100);

      statsTimer = setInterval(refreshStats, 500);
    } catch (e) {
      alert('启动仿真器失败: ' + (e.message || e));
      console.error(e);
      stopEmulator();
    }
  }

  function stopEmulator() {
    if (!confirm('确定要停止仿真器吗？将关闭虚拟串口连接。')) return;
    if (statsTimer) {
      clearInterval(statsTimer);
      statsTimer = null;
    }
    try {
      if (engine) engine.stop();
    } catch (e) {}
    if (pipe) {
      try { pipe.close(); } catch (e) {}
      try {
        handlePortClosed(pipe.id);
      } catch (e) {}
    }
    addDeviceLog('INFO', [], { event: '⏹ 仿真器已停止' });
    emulatorState.update(s => ({
      ...s,
      isRunning: false,
      hostPortId: null,
      hostPortName: '',
    }));
    pipe = null;
  }

  function sendFromDevice(dataHex) {
    if (!pipe || !isRunning) {
      alert('仿真器未运行');
      return;
    }
    const cleaned = dataHex.replace(/[^0-9A-Fa-f]/g, '');
    if (cleaned.length % 2 !== 0) {
      alert('请输入偶数个十六进制字符');
      return;
    }
    const bytes = [];
    for (let i = 0; i < cleaned.length; i += 2) {
      bytes.push(parseInt(cleaned.substr(i, 2), 16));
    }
    if (bytes.length === 0) return;
    pipe.writeToHost(bytes);
    addDeviceLog('Tx', bytes);
  }

  function handleScriptApply(text, parsed) {
    currentScriptText = text;
    currentScriptObj = parsed;
    try {
      engine.stopPeriodic();
      engine.loadScript(parsed, null);
      if (isRunning) {
        engine.startPeriodic();
        engine.runStartupRules();
      }
      alert('✅ 脚本已热更新，规则数: ' + parsed.rules.length);
      $showScriptEditor = false;
    } catch (e) {
      alert('脚本热更新失败: ' + e.message);
    }
  }

  function resetToTemplate() {
    if (!confirm('确定要重置为模板默认脚本？当前修改将丢失。')) return;
    currentScriptText = getTemplateScriptJson(selectedTemplate);
    try {
      currentScriptObj = JSON.parse(currentScriptText);
    } catch (e) {}
  }

  function handleTemplateChange(tplKey) {
    if (isRunning) {
      alert('请先停止仿真器再切换模板');
      return;
    }
    selectedTemplate = tplKey;
    emulatorState.update(s => ({ ...s, selectedTemplate: tplKey, registerView: { startAddr: 0, countPerPage: 20 } }));
    currentScriptText = getTemplateScriptJson(tplKey);
    try {
      currentScriptObj = JSON.parse(currentScriptText);
    } catch (e) {}
    buildVariableList();
  }

  function onDeviceSendKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value;
      sendFromDevice(val);
      e.target.value = '';
      deviceSendHex = '';
    }
  }

  function editRegisterCell(addr) {
    if (!isRunning) return;
    if (editingRegCell !== null) {
      applyRegisterEdit();
    }
    editingRegCell = addr;
    editingRegValue = (engine.state.registers[addr] || 0).toString();
    setTimeout(() => {
      const input = document.getElementById('reg-edit-' + addr);
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  }

  function applyRegisterEdit() {
    if (editingRegCell === null) return;
    const addr = editingRegCell;
    let val = parseInt(editingRegValue);
    if (isNaN(val)) val = 0;
    val = Math.max(0, Math.min(65535, val & 0xFFFF));
    if (engine && engine.state && engine.state.registers) {
      engine.setState('registers[' + addr + ']', val);
      buildVariableList();
    }
    editingRegCell = null;
    editingRegValue = '';
  }

  function cancelRegisterEdit() {
    editingRegCell = null;
    editingRegValue = '';
  }

  function editVariable(varKey) {
    if (!isRunning) return;
    if (editingVarKey !== null) {
      applyVariableEdit();
    }
    const field = (BUILTIN_TEMPLATES[selectedTemplate]?.stateSchema || []).find(f => f.key === varKey);
    if (!field || field.type === 'registers') return;
    editingVarKey = varKey;
    const val = engine.state[varKey];
    editingVarValue = val !== undefined && val !== null ? val.toString() : '';
    setTimeout(() => {
      const input = document.getElementById('var-edit-' + varKey);
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  }

  function applyVariableEdit() {
    if (editingVarKey === null) return;
    const key = editingVarKey;
    const field = (BUILTIN_TEMPLATES[selectedTemplate]?.stateSchema || []).find(f => f.key === key);
    let val = editingVarValue;
    try {
      if (field) {
        if (field.type === 'string') {
          val = val;
        } else if (field.type === 'float32') {
          val = parseFloat(val);
          if (isNaN(val)) val = 0;
        } else if (field.type === 'uint8' || field.type === 'uint16' || field.type === 'uint32') {
          val = parseInt(val);
          if (isNaN(val)) val = 0;
          if (field.min !== undefined) val = Math.max(field.min, val);
          if (field.max !== undefined) val = Math.min(field.max, val);
        }
      }
      engine.setState(key, val);
      buildVariableList();
    } catch (e) {}
    editingVarKey = null;
    editingVarValue = '';
  }

  function cancelVariableEdit() {
    editingVarKey = null;
    editingVarValue = '';
  }

  function resetStats() {
    if (engine) engine.resetStats();
    refreshStats();
  }

  function startRecording() {
    if (!isRunning) {
      alert('请先启动仿真器');
      return;
    }
    recordingStartTs = Date.now();
    emulatorState.update(s => ({ ...s, isRecording: true, recordedFrames: [] }));
  }

  function stopRecording() {
    emulatorState.update(s => ({ ...s, isRecording: false }));
    showSaveScenarioDialog = true;
    newScenarioName = '场景_' + new Date().toLocaleString().replace(/[\/:]/g, '-');
  }

  function loadSavedScenarios() {
    try {
      const raw = localStorage.getItem(SCENARIO_STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      emulatorState.update(s => ({ ...s, savedScenarios: list }));
    } catch (e) {
      emulatorState.update(s => ({ ...s, savedScenarios: [] }));
    }
  }

  function saveCurrentScenario() {
    const name = newScenarioName.trim();
    if (!name) {
      alert('请输入场景名称');
      return;
    }
    const recordedFrames = $emulatorState.recordedFrames || [];
    if (recordedFrames.length === 0) {
      alert('没有录制到任何帧数据');
      showSaveScenarioDialog = false;
      return;
    }
    const scenario = {
      id: 'scn_' + Date.now(),
      name,
      createdAt: Date.now(),
      frames: recordedFrames,
      durationMs: recordedFrames.length > 0
        ? recordedFrames[recordedFrames.length - 1].ts - recordedFrames[0].ts
        : 0,
    };
    try {
      const raw = localStorage.getItem(SCENARIO_STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      list.push(scenario);
      localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(list));
      emulatorState.update(s => ({ ...s, savedScenarios: list }));
      showSaveScenarioDialog = false;
      alert('✅ 场景已保存: ' + name);
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  }

  function cancelSaveScenario() {
    showSaveScenarioDialog = false;
    emulatorState.update(s => ({ ...s, recordedFrames: [] }));
  }

  function deleteScenario(id) {
    if (!confirm('确定要删除该场景吗？')) return;
    try {
      const raw = localStorage.getItem(SCENARIO_STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      const filtered = list.filter(s => s.id !== id);
      localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(filtered));
      emulatorState.update(s => ({ ...s, savedScenarios: filtered }));
    } catch (e) {}
  }

  function playScenario(scenario) {
    if (!isRunning) {
      alert('请先启动仿真器');
      return;
    }
    stopPlayback();
    const txFrames = (scenario.frames || []).filter(f => f.direction === 'Tx');
    if (txFrames.length === 0) {
      alert('该场景中没有设备端发送的帧（Tx）');
      return;
    }
    emulatorState.update(s => ({ ...s, isPlaying: true, playingScenarioId: scenario.id }));
    const baseTs = scenario.frames[0].ts;
    for (const f of txFrames) {
      const delay = f.ts - baseTs;
      const t = setTimeout(() => {
        if (!pipe || !isRunning) return;
        pipe.writeToHost(f.data);
        addDeviceLog('Tx', f.data);
        if (injectEmulatorResponseToMain) {
          try { injectEmulatorResponseToMain(f.data); } catch (e) {}
        }
      }, delay);
      playbackTimers.push(t);
    }
    const totalDelay = txFrames.length > 0
      ? (txFrames[txFrames.length - 1].ts - baseTs) + 50
      : 50;
    const endTimer = setTimeout(() => {
      emulatorState.update(s => ({ ...s, isPlaying: false, playingScenarioId: null }));
    }, totalDelay);
    playbackTimers.push(endTimer);
  }

  function stopPlayback() {
    for (const t of playbackTimers) clearTimeout(t);
    playbackTimers = [];
    emulatorState.update(s => ({ ...s, isPlaying: false, playingScenarioId: null }));
  }

  function setupLatencyCanvas() {
    if (!latencyCanvas) return;
    latencyCanvasCtx = latencyCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = latencyCanvas.getBoundingClientRect();
    latencyCanvas.width = rect.width * dpr;
    latencyCanvas.height = 80 * dpr;
    latencyCanvasCtx.scale(dpr, dpr);
    drawLatencyChart();
  }

  function drawLatencyChart() {
    if (!latencyCanvasCtx) return;
    const ctx = latencyCanvasCtx;
    const dpr = window.devicePixelRatio || 1;
    const w = latencyCanvas.width / dpr;
    const h = 80;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(30, 41, 59, 0.5)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    const latencies = (engine.getStats().responseLatencies || []).filter(
      item => Date.now() - (typeof item === 'number' ? (Date.now() - 60000) : item.ts) <= 60000
    );
    const now = Date.now();
    const windowMs = 60000;
    const data = latencies.filter(item => {
      const ts = typeof item === 'number' ? now : item.ts;
      return now - ts <= windowMs;
    }).map(item => ({
      ts: typeof item === 'number' ? now : item.ts,
      latency: typeof item === 'number' ? item : item.latency,
    }));
    if (data.length === 0) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
      ctx.font = '11px monospace';
      ctx.fillText('等待响应数据...', 6, h / 2 + 4);
      return;
    }
    const maxLatency = Math.max(...data.map(d => d.latency), 50);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const x = ((d.ts - (now - windowMs)) / windowMs) * w;
      const y = h - (d.latency / maxLatency) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.15)';
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(34, 211, 238, 0.1)';
    ctx.fill();
    ctx.fillStyle = '#22d3ee';
    ctx.font = '10px monospace';
    ctx.fillText(maxLatency.toFixed(0) + 'ms', 4, 12);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.fillText('0ms', 4, h - 2);
    ctx.fillText('-60s', 4, h / 2 + 4);
    ctx.fillText('now', w - 28, h / 2 + 4);
  }

  function navigateReg(dir) {
    emulatorState.update(s => {
      const tpl = BUILTIN_TEMPLATES[selectedTemplate];
      const maxAddr = (tpl?.stateSchema?.find(f => f.type === 'registers')?.count || 100);
      const perPage = s.registerView?.countPerPage || 20;
      let start = s.registerView?.startAddr || 0;
      start += dir * perPage;
      start = Math.max(0, Math.min(maxAddr - perPage, start));
      start = Math.max(0, start);
      return { ...s, registerView: { ...(s.registerView || {}), startAddr: start } };
    });
  }

  function formatLastModified(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.toLocaleTimeString();
  }

  function formatLogLine(line) {
    if (logDisplayMode === 'Ascii') {
      return bytesToAscii(line.data || []);
    } else if (logDisplayMode === 'Hex') {
      return bytesToHex(line.data || []);
    } else {
      return { hex: bytesToHex(line.data || []), ascii: bytesToAscii(line.data || []) };
    }
  }

  $: registersForDisplay = (() => {
    const empty = { rows: [], start: 0, count: 0, perPage: 0, cols: 4 };
    if (!engine.state || !engine.state.registers) return empty;
    const tpl = BUILTIN_TEMPLATES[selectedTemplate];
    const count = tpl?.stateSchema?.find(f => f.type === 'registers')?.count || 100;
    const perPage = regView.countPerPage || 20;
    const start = regView.startAddr || 0;
    const cols = 4;
    const rows = Math.ceil(perPage / cols);
    const result = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const addr = start + r * cols + c;
        if (addr < count) {
          row.push({
            addr,
            value: engine.state.registers[addr] ?? 0,
            hex: (engine.state.registers[addr] ?? 0).toString(16).toUpperCase().padStart(4, '0'),
          });
        } else {
          row.push(null);
        }
      }
      result.push(row);
    }
    return { rows: result, start, count, perPage, cols };
  })();

  afterUpdate(async () => {
    await tick();
    if (autoScrollLogs && deviceLogEl) {
      deviceLogEl.scrollTop = deviceLogEl.scrollHeight;
    }
  });

  onMount(() => {
    const tpl = BUILTIN_TEMPLATES[selectedTemplate];
    if (tpl) {
      currentScriptText = getTemplateScriptJson(selectedTemplate);
      try {
        currentScriptObj = JSON.parse(currentScriptText);
      } catch (e) {}
      buildVariableList();
    }
    loadSavedScenarios();
    latencyDrawTimer = setInterval(() => {
      drawLatencyChart();
    }, 500);
    setTimeout(() => setupLatencyCanvas(), 50);
    window.addEventListener('resize', setupLatencyCanvas);
  });

  onDestroy(() => {
    if (statsTimer) clearInterval(statsTimer);
    if (latencyDrawTimer) clearInterval(latencyDrawTimer);
    stopPlayback();
    window.removeEventListener('resize', setupLatencyCanvas);
    if (isRunning) {
      stopEmulator();
    }
  });

  export function forwardHostToDevice(bytes) {
    if (!pipe || !isRunning) return;
    pipe.writeToDevice(bytes);
  }

  export function getEngine() { return engine; }
  export function getPipe() { return pipe; }
</script>

<aside class="emulator-panel">
  <div class="ep-header">
    <div class="ep-title">
      <span class="ep-icon">🧪</span>
      <span>协议仿真器</span>
      {#if isRunning}
        <span class="badge badge-connected">运行中</span>
      {:else}
        <span class="badge badge-disconnected">已停止</span>
      {/if}
    </div>
    <button class="icon-btn" on:click={onClose} title="关闭面板">×</button>
  </div>

  <div class="ep-body">
    <div class="ep-section">
      <div class="ep-section-title">⚙️ 仿真配置</div>
      <div class="form-group">
        <label>设备模板</label>
        <select value={selectedTemplate} on:change={(e) => handleTemplateChange(e.target.value)} disabled={isRunning}>
          {#each EMULATOR_TEMPLATE_KEYS as k}
            <option value={k}>{BUILTIN_TEMPLATES[k].name}</option>
          {/each}
        </select>
        {#if currentTemplate}
          <div class="tpl-desc">{currentTemplate.description}</div>
        {/if}
      </div>

      {#if isRunning}
        <div class="port-info">
          <div class="info-row">
            <span class="info-k">上位机端:</span>
            <span class="info-v mono">{$emulatorState.hostPortName}</span>
          </div>
          <div class="info-row">
            <span class="info-k">设备端:</span>
            <span class="info-v mono">内部(仿真器)</span>
          </div>
        </div>
      {/if}

      <div class="btn-row">
        {#if !isRunning}
          <button class="btn-primary" on:click={startEmulator}>▶ 启动仿真器</button>
        {:else}
          <button class="btn-danger" on:click={stopEmulator}>⏹ 停止仿真器</button>
        {/if}
        <button class="btn-secondary" on:click={() => $showScriptEditor = true}>📝 编辑脚本</button>
      </div>
    </div>

    <div class="ep-section">
      <div class="ep-section-title">
        <span>📡 设备端手动发送</span>
      </div>
      <div class="device-send">
        <input
          type="text"
          bind:value={deviceSendHex}
          class="mono"
          placeholder="HEX数据，如: 01 03 00 00 00 0A C5 CD (Ctrl+Enter发送)"
          on:keydown={onDeviceSendKeydown}
          disabled={!isRunning}
        />
        <button on:click={() => { sendFromDevice(deviceSendHex); deviceSendHex = ''; }} disabled={!isRunning}>发送</button>
      </div>
    </div>

    <div class="ep-section ep-section-grow">
      <div class="ep-section-title">
        <span>📜 设备端通信日志</span>
        <div class="ep-title-tools">
          <select bind:value={logDisplayMode} class="ep-select-sm">
            <option value="Mixed">混合</option>
            <option value="Hex">HEX</option>
            <option value="Ascii">ASCII</option>
          </select>
          <button class="ep-btn-sm" on:click={() => autoScrollLogs = !autoScrollLogs} title={autoScrollLogs ? '自动滚动开启' : '自动滚动关闭'}>
            {autoScrollLogs ? '📜' : '🔒'}
          </button>
          <button class="ep-btn-sm" on:click={clearLogs} title="清空日志">🗑️</button>
        </div>
      </div>
      <div class="device-log" bind:this={deviceLogEl} on:scroll={(e) => {
        const el = e.target;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
        if (atBottom !== autoScrollLogs) autoScrollLogs = atBottom;
      }}>
        {#each deviceLogs as line (line.id)}
          <div class="log-line log-dir-{line.direction.toLowerCase()}">
            <span class="log-ts">{formatTimestamp(line.timestamp)}</span>
            {#if line.direction === 'Rx'}
              <span class="log-dir rx">→↓</span>
            {:else if line.direction === 'Tx'}
              <span class="log-dir tx">↑→</span>
            {:else if line.direction === 'INFO'}
              <span class="log-dir info">ℹ️</span>
            {:else if line.direction === 'EVENT'}
              <span class="log-dir event">⚡</span>
            {:else if line.direction === 'WARN'}
              <span class="log-dir warn">⚠️</span>
            {:else if line.direction === 'ERR'}
              <span class="log-dir err">❌</span>
            {/if}
            {#if line.event}
              <span class="log-event">{line.event}</span>
            {:else}
              {#if logDisplayMode === 'Mixed'}
                <span class="log-hex mono">{formatLogLine(line).hex}</span>
                <span class="log-ascii mono">{formatLogLine(line).ascii}</span>
              {:else}
                <span class="log-mono mono">{formatLogLine(line)}</span>
              {/if}
            {/if}
          </div>
        {/each}
        {#if deviceLogs.length === 0}
          <div class="log-empty">暂无日志，启动仿真器后将显示通信数据</div>
        {/if}
      </div>
    </div>

    {#if hasRegisters}
      <div class="ep-section">
        <div class="ep-section-title">
          <span>📋 寄存器监控</span>
          <div class="ep-title-tools">
            <button class="ep-btn-sm" on:click={() => navigateReg(-1)} disabled={registersForDisplay.start === 0}>◀</button>
            <span class="reg-page-info">
              {registersForDisplay.start} - {Math.min(registersForDisplay.start + registersForDisplay.perPage - 1, registersForDisplay.count - 1)} / {registersForDisplay.count}
            </span>
            <button class="ep-btn-sm" on:click={() => navigateReg(1)} disabled={registersForDisplay.start + registersForDisplay.perPage >= registersForDisplay.count}>▶</button>
          </div>
        </div>
        <div class="reg-table-wrap">
          <table class="reg-table">
            <thead>
              <tr>
                <th class="reg-addr-col">地址</th>
                {#each { length: registersForDisplay.cols } as _, c}
                  <th>+{c}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each registersForDisplay.rows as row, ri}
                <tr>
                  <td class="reg-addr-col mono">
                    {String(registersForDisplay.start + ri * registersForDisplay.cols).padStart(4, '0')}
                  </td>
                  {#each row as cell, ci}
                    <td>
                      {#if cell}
                        {#if editingRegCell === cell.addr}
                          <input
                            id="reg-edit-{cell.addr}"
                            type="text"
                            class="reg-edit-input mono"
                            bind:value={editingRegValue}
                            on:blur={applyRegisterEdit}
                            on:keydown={(e) => {
                              if (e.key === 'Enter') applyRegisterEdit();
                              if (e.key === 'Escape') cancelRegisterEdit();
                            }}
                          />
                        {:else}
                          <div
                            class="reg-cell mono"
                            class:editable={isRunning}
                            on:dblclick={() => editRegisterCell(cell.addr)}
                            title={isRunning ? '双击编辑: ' + cell.value : '寄存器值: ' + cell.value}
                          >
                            {cell.hex}
                          </div>
                        {/if}
                      {:else}
                        <div class="reg-cell empty">-</div>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}

    <div class="ep-section">
      <div class="ep-section-title">
        <span>📊 状态变量</span>
      </div>
      <div class="var-table-wrap">
        <table class="var-table">
          <thead>
            <tr>
              <th>变量名</th>
              <th>类型</th>
              <th>当前值</th>
              <th>上次修改</th>
            </tr>
          </thead>
          <tbody>
            {#each emuVars as v}
              <tr>
                <td class="var-label">{v.label}</td>
                <td class="var-type mono">{v.type}</td>
                <td>
                  {#if editingVarKey === v.key}
                    <input
                      id="var-edit-{v.key}"
                      type="text"
                      class="var-edit-input mono"
                      bind:value={editingVarValue}
                      on:blur={applyVariableEdit}
                      on:keydown={(e) => {
                        if (e.key === 'Enter') applyVariableEdit();
                        if (e.key === 'Escape') cancelVariableEdit();
                      }}
                    />
                  {:else}
                    <div
                      class="var-value mono"
                      class:editable={isRunning}
                      on:dblclick={() => editVariable(v.key)}
                      title={isRunning ? '双击编辑' : ''}
                    >
                      {v.value}
                    </div>
                  {/if}
                </td>
                <td class="var-time">{formatLastModified(v.lastModified)}</td>
              </tr>
            {/each}
            {#if emuVars.length === 0}
              <tr>
                <td colspan="4" class="var-empty">暂无变量</td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    <div class="ep-section">
      <div class="ep-section-title">
        <span>📈 统计信息</span>
        <button class="ep-btn-sm" on:click={resetStats} title="重置统计">🔄</button>
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{emuStats.requestsProcessed || 0}</div>
          <div class="stat-label">已处理请求</div>
        </div>
        <div class="stat-card">
          <div class="stat-value green">{emuStats.responsesSent || 0}</div>
          <div class="stat-label">已发送响应</div>
        </div>
        <div class="stat-card">
          <div class="stat-value red">{emuStats.matchFailures || 0}</div>
          <div class="stat-label">匹配失败</div>
        </div>
        <div class="stat-card">
          <div class="stat-value cyan">{emuStats.averageLatencyMs || 0} ms</div>
          <div class="stat-label">平均响应延迟</div>
        </div>
      </div>
      <div class="latency-chart-wrap">
        <canvas
          class="latency-canvas"
          bind:this={latencyCanvas}
          height="80"
        ></canvas>
      </div>
    </div>

    <div class="ep-section">
      <div class="ep-section-title">
        <span>🎬 场景录制与回放</span>
        <div class="ep-title-tools">
          {#if $emulatorState.isRecording}
            <span class="rec-indicator">● 录制中</span>
          {/if}
          {#if $emulatorState.isPlaying}
            <span class="play-indicator">▶ 回放中</span>
          {/if}
        </div>
      </div>
      <div class="rec-btn-row">
        {#if !$emulatorState.isRecording}
          <button
            class="btn-secondary"
            on:click={startRecording}
            disabled={!isRunning || $emulatorState.isPlaying}
          >
            ⏺ 开始录制
          </button>
        {:else}
          <button
            class="btn-danger"
            on:click={stopRecording}
          >
            ⏹ 停止录制
          </button>
        {/if}
        {#if $emulatorState.isPlaying}
          <button
            class="btn-secondary"
            on:click={stopPlayback}
          >
            ⏹ 停止回放
          </button>
        {/if}
      </div>
      {#if $emulatorState.recordedFrames && $emulatorState.recordedFrames.length > 0 && !$emulatorState.isRecording}
        <div class="record-info">
          已录制 {$emulatorState.recordedFrames.length} 帧
        </div>
      {/if}
      <div class="scenario-list">
        <div class="scenario-list-title">已保存场景：</div>
        {#if !$emulatorState.savedScenarios || $emulatorState.savedScenarios.length === 0}
          <div class="scenario-empty">暂无保存的场景</div>
        {:else}
          {#each $emulatorState.savedScenarios as scn}
            <div class="scenario-item" class:active={$emulatorState.playingScenarioId === scn.id}>
              <div class="scenario-info">
                <div class="scenario-name">{scn.name}</div>
                <div class="scenario-meta">
                  {new Date(scn.createdAt).toLocaleString()} · {scn.frames?.length || 0} 帧 · {(scn.durationMs / 1000).toFixed(1)}s
                </div>
              </div>
              <div class="scenario-actions">
                <button
                  class="ep-btn-sm"
                  on:click={() => playScenario(scn)}
                  disabled={!isRunning || $emulatorState.isRecording || $emulatorState.isPlaying}
                  title="回放该场景"
                >
                  ▶
                </button>
                <button
                  class="ep-btn-sm"
                  on:click={() => deleteScenario(scn.id)}
                  title="删除该场景"
                >
                  🗑
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>

  {#if showSaveScenarioDialog}
    <div class="modal-backdrop" on:click|self={cancelSaveScenario}>
      <div class="save-scn-modal">
        <div class="modal-header">
          <h3>💾 保存录制场景</h3>
          <button class="close-btn" on:click={cancelSaveScenario}>×</button>
        </div>
        <div class="modal-body">
          <label class="scn-label">场景名称</label>
          <input
            type="text"
            class="scn-input"
            bind:value={newScenarioName}
            placeholder="请输入场景名称"
          />
          <div class="scn-info">
            共录制 {$emulatorState.recordedFrames?.length || 0} 帧数据
          </div>
          <div class="scn-actions">
            <button class="btn-secondary" on:click={cancelSaveScenario}>取消</button>
            <button class="btn-primary" on:click={saveCurrentScenario}>✅ 保存</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if showEditor}
    <ScriptEditor
      scriptText={currentScriptText}
      onApply={handleScriptApply}
      onClose={() => $showScriptEditor = false}
    />
  {/if}
</aside>

<style>
  .emulator-panel {
    width: 420px;
    min-width: 360px;
    max-width: 520px;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    animation: slideInRight 0.25s ease-out;
  }

  @keyframes slideInRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .ep-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .ep-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 14px;
  }

  .ep-icon {
    font-size: 18px;
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-secondary);
  }

  .icon-btn:hover {
    background: var(--accent-red);
    color: #fff;
    border-color: var(--accent-red);
  }

  .ep-body {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 0;
  }

  .ep-section {
    padding: 12px;
    border-bottom: 1px solid var(--border-color);
  }

  .ep-section-grow {
    flex: 1;
    min-height: 180px;
    display: flex;
    flex-direction: column;
  }

  .ep-section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
  }

  .ep-title-tools {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .ep-select-sm {
    padding: 2px 6px;
    font-size: 11px;
    height: 24px;
  }

  .ep-btn-sm {
    width: 24px;
    height: 24px;
    padding: 0;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
  }

  .ep-btn-sm:hover:not(:disabled) {
    background: var(--accent-blue);
    border-color: var(--accent-blue);
  }

  .ep-btn-sm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .form-group {
    margin-bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-group label {
    font-size: 11px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .tpl-desc {
    font-size: 11px;
    color: var(--text-muted);
    padding: 6px 8px;
    background: var(--bg-input);
    border-radius: 4px;
    border-left: 3px solid var(--accent-cyan);
  }

  .port-info {
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 10px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    padding: 2px 0;
  }

  .info-k {
    color: var(--text-secondary);
  }

  .info-v {
    color: var(--accent-cyan);
    font-weight: 600;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .btn-row {
    display: flex;
    gap: 8px;
  }

  .btn-primary {
    flex: 1;
    padding: 8px 12px;
    background: var(--accent-green);
    border: 1px solid var(--accent-green);
    color: #000;
    font-weight: 600;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .btn-primary:hover:not(:disabled) {
    background: #22c55e;
    border-color: #22c55e;
    transform: translateY(-1px);
  }

  .btn-danger {
    flex: 1;
    padding: 8px 12px;
    background: var(--accent-red);
    border: 1px solid var(--accent-red);
    color: #fff;
    font-weight: 600;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .btn-danger:hover:not(:disabled) {
    background: #dc2626;
    border-color: #dc2626;
    transform: translateY(-1px);
  }

  .btn-secondary {
    flex: 1;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    font-weight: 500;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--accent-blue);
    border-color: var(--accent-blue);
    color: #fff;
  }

  .device-send {
    display: flex;
    gap: 6px;
  }

  .device-send input {
    flex: 1;
    font-size: 12px;
  }

  .device-send button {
    padding: 6px 14px;
    white-space: nowrap;
  }

  .device-log {
    flex: 1;
    min-height: 150px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 8px;
    overflow-y: auto;
    font-size: 12px;
    line-height: 1.5;
  }

  .log-line {
    display: flex;
    gap: 6px;
    padding: 2px 4px;
    border-radius: 3px;
    margin-bottom: 1px;
    align-items: flex-start;
  }

  .log-line:hover {
    background: rgba(74, 158, 255, 0.1);
  }

  .log-ts {
    color: var(--text-muted);
    font-size: 11px;
    flex-shrink: 0;
    font-family: var(--font-mono);
  }

  .log-dir {
    flex-shrink: 0;
    font-size: 11px;
    width: 24px;
    text-align: center;
  }

  .log-dir.rx { color: var(--accent-blue); }
  .log-dir.tx { color: var(--accent-green); }
  .log-dir.info { color: var(--accent-cyan); }
  .log-dir.event { color: var(--accent-yellow); }
  .log-dir.warn { color: var(--accent-orange); }
  .log-dir.err { color: var(--accent-red); }

  .log-hex {
    color: var(--accent-blue);
    margin-right: 8px;
    word-break: break-all;
  }

  .log-ascii {
    color: var(--accent-green);
    word-break: break-all;
  }

  .log-mono {
    word-break: break-all;
  }

  .log-event {
    color: var(--text-secondary);
    flex: 1;
  }

  .log-empty {
    text-align: center;
    color: var(--text-muted);
    padding: 20px;
    font-size: 12px;
  }

  .reg-page-info {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    padding: 0 4px;
  }

  .reg-table-wrap {
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    overflow: auto;
    max-height: 200px;
  }

  .reg-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .reg-table th,
  .reg-table td {
    padding: 4px 6px;
    text-align: center;
    border-bottom: 1px solid var(--border-color);
  }

  .reg-table th {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-weight: 500;
    font-size: 11px;
    position: sticky;
    top: 0;
  }

  .reg-addr-col {
    background: var(--bg-tertiary);
    color: var(--accent-cyan);
    font-weight: 500;
    position: sticky;
    left: 0;
  }

  .reg-cell {
    padding: 4px 8px;
    border-radius: 3px;
    transition: background 0.15s;
  }

  .reg-cell.editable {
    cursor: pointer;
  }

  .reg-cell.editable:hover {
    background: var(--accent-blue);
    color: #fff;
  }

  .reg-cell.empty {
    color: var(--text-muted);
  }

  .reg-edit-input {
    width: 60px;
    padding: 2px 4px;
    font-size: 12px;
    text-align: center;
  }

  .var-table-wrap {
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    overflow: auto;
    max-height: 180px;
  }

  .var-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .var-table th,
  .var-table td {
    padding: 6px 8px;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
  }

  .var-table th {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-weight: 500;
    font-size: 11px;
    position: sticky;
    top: 0;
  }

  .var-label {
    color: var(--text-primary);
    font-weight: 500;
  }

  .var-type {
    color: var(--accent-purple);
    font-size: 11px;
  }

  .var-value {
    color: var(--accent-cyan);
    padding: 2px 6px;
    border-radius: 3px;
    transition: background 0.15s;
  }

  .var-value.editable {
    cursor: pointer;
  }

  .var-value.editable:hover {
    background: var(--accent-blue);
    color: #fff;
  }

  .var-time {
    color: var(--text-muted);
    font-size: 11px;
  }

  .var-edit-input {
    width: 100%;
    padding: 2px 6px;
    font-size: 12px;
  }

  .var-empty {
    text-align: center;
    color: var(--text-muted);
    padding: 16px;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .stat-card {
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 10px;
    text-align: center;
  }

  .stat-value {
    font-size: 20px;
    font-weight: 700;
    color: var(--text-primary);
    font-family: var(--font-mono);
  }

  .stat-value.green { color: var(--accent-green); }
  .stat-value.red { color: var(--accent-red); }
  .stat-value.cyan { color: var(--accent-cyan); }

  .stat-label {
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .latency-chart-wrap {
    margin-top: 10px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg-input);
  }

  .latency-canvas {
    width: 100%;
    height: 80px;
    display: block;
  }

  .rec-btn-row {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }

  .rec-indicator {
    color: var(--accent-red);
    font-size: 12px;
    font-weight: 600;
    animation: blink 1s infinite;
  }

  .play-indicator {
    color: var(--accent-green);
    font-size: 12px;
    font-weight: 600;
    animation: blink 1s infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .record-info {
    font-size: 12px;
    color: var(--accent-cyan);
    margin-bottom: 8px;
    padding: 4px 8px;
    background: rgba(34, 211, 238, 0.1);
    border-radius: 4px;
  }

  .scenario-list {
    margin-top: 4px;
  }

  .scenario-list-title {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 6px;
    font-weight: 500;
  }

  .scenario-empty {
    font-size: 12px;
    color: var(--text-muted);
    padding: 12px;
    text-align: center;
    background: var(--bg-input);
    border-radius: 4px;
  }

  .scenario-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    margin-bottom: 6px;
    transition: all 0.15s;
  }

  .scenario-item:hover {
    border-color: var(--accent-blue);
  }

  .scenario-item.active {
    border-color: var(--accent-green);
    background: rgba(74, 222, 128, 0.05);
  }

  .scenario-info {
    flex: 1;
    min-width: 0;
  }

  .scenario-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scenario-meta {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .scenario-actions {
    display: flex;
    gap: 4px;
    margin-left: 8px;
    flex-shrink: 0;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(3px);
  }

  .save-scn-modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    width: 90%;
    max-width: 400px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 18px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
  }

  .modal-header h3 {
    font-size: 15px;
    color: var(--text-primary);
    margin: 0;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 22px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background: var(--accent-red);
    color: #fff;
  }

  .modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .scn-label {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .scn-input {
    width: 100%;
    padding: 8px 10px;
    font-size: 13px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-primary);
  }

  .scn-input:focus {
    outline: none;
    border-color: var(--accent-blue);
  }

  .scn-info {
    font-size: 12px;
    color: var(--text-muted);
  }

  .scn-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>

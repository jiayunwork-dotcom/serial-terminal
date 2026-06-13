<script>
  import { onMount, afterUpdate, tick } from 'svelte';
  import {
    openTabs, activeTabId, protocolTemplates,
    DISPLAY_MODE_OPTIONS, uuidv4, formatTimestamp,
    bytesToHex, hexToBytes, bytesToAscii, asciiToBytes,
  } from '../stores.js';
  import { sendSerialData, parseFrame } from '../tauriApi.js';
  import ParseResults from './ParseResults.svelte';

  export let tab;

  let terminalEl = null;
  let needScroll = true;
  let showHistory = false;

  $: currentTab = $openTabs.find(t => t.id === tab.id) || tab;

  $: lines = currentTab?.terminalLines || [];
  $: parseEnabled = currentTab?.parseEnabled || false;
  $: selectedProtocolId = currentTab?.selectedProtocolId;
  $: displayMode = currentTab?.displayMode || 'Mixed';
  $: autoScroll = currentTab?.autoScroll !== false;
  $: sendMode = currentTab?.sendMode || 'Ascii';
  $: sendContent = currentTab?.sendContent || '';
  $: sendHistory = currentTab?.sendHistory || [];

  function updateTab(patch) {
    openTabs.update(tabs => tabs.map(t =>
      t.id === tab.id ? { ...t, ...patch } : t
    ));
  }

  function setDisplayMode(mode) {
    updateTab({ displayMode: mode });
  }

  function toggleAutoScroll() {
    updateTab({ autoScroll: !autoScroll });
  }

  function toggleParse() {
    updateTab({ parseEnabled: !parseEnabled });
  }

  function selectProtocol(id) {
    updateTab({ selectedProtocolId: id });
  }

  function clearTerminal() {
    updateTab({ terminalLines: [], parseResults: [], droppedFrames: 0, crcErrors: 0, buffer: [] });
  }

  function onScroll() {
    if (!terminalEl) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalEl;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (atBottom !== autoScroll && atBottom) {
      updateTab({ autoScroll: true });
    }
  }

  function handleSendScroll(e) {
    const atBottom = e.target.scrollHeight - e.target.scrollTop - e.target.clientHeight < 50;
    needScroll = atBottom;
  }

  afterUpdate(async () => {
    await tick();
    if (autoScroll && terminalEl && needScroll) {
      terminalEl.scrollTop = terminalEl.scrollHeight;
    }
  });

  function parseLine(line) {
    const bytes = line.data || [];
    if (displayMode === 'Ascii') {
      return { type: 'ascii', content: bytesToAscii(bytes) };
    } else if (displayMode === 'Hex') {
      return { type: 'hex', content: bytesToHex(bytes) };
    } else {
      return { type: 'mixed', hex: bytesToHex(bytes), ascii: bytesToAscii(bytes), bytes };
    }
  }

  $: currentProtocol = $protocolTemplates.find(p => p.id === selectedProtocolId);

  let pendingParseBuffer = [];

  $: {
    if (parseEnabled && currentProtocol && lines.length > 0) {
      processNewLinesForParsing();
    }
  }

  let lastParsedLineIdx = -1;

  function processNewLinesForParsing() {
    const newRxLines = [];
    for (let i = lastParsedLineIdx + 1; i < lines.length; i++) {
      if (lines[i].direction === 'Rx') {
        newRxLines.push(lines[i]);
      }
      lastParsedLineIdx = i;
    }
    if (newRxLines.length === 0) return;

    const allBytes = [];
    for (const l of newRxLines) allBytes.push(...(l.data || []));

    const tabState = currentTab;
    let buffer = [...(tabState.buffer || []), ...allBytes];
    const allFrames = [...(tabState.parseResults || [])];
    let dropped = tabState.droppedFrames || 0;
    let crcErr = tabState.crcErrors || 0;

    const MAX_ATTEMPTS = 50;
    let attempts = 0;

    while (buffer.length > 0 && attempts < MAX_ATTEMPTS) {
      attempts++;
      const headerField = currentProtocol.fields?.find(f =>
        f.field_type === 'FrameHeader' && f.fixed_value?.length > 0
      );
      const header = headerField?.fixed_value || [];

      if (header.length > 0) {
        let found = -1;
        for (let i = 0; i <= buffer.length - header.length; i++) {
          let ok = true;
          for (let j = 0; j < header.length; j++) {
            if (buffer[i + j] !== header[j]) { ok = false; break; }
          }
          if (ok) { found = i; break; }
        }
        if (found === -1) {
          dropped += buffer.length > header.length ? buffer.length - header.length + 1 : 0;
          buffer = buffer.length > header.length - 1 ? buffer.slice(buffer.length - header.length + 1) : [];
          break;
        }
        if (found > 0) {
          dropped += found;
          buffer = buffer.slice(found);
        }
      }

      if (buffer.length < (currentProtocol.fields?.reduce((s, f) => s + (f.byte_length || 0), 0) || 1)) {
        break;
      }

      let pos = 0;
      const dynLens = {};
      let fields = [];
      let success = true;
      let parseError = null;

      for (let fi = 0; fi < currentProtocol.fields.length; fi++) {
        const f = currentProtocol.fields[fi];
        let blen = f.byte_length;
        if (!blen && f.length_ref_field) {
          blen = dynLens[f.length_ref_field];
          if (f.field_type === 'RawBytes' && dynLens[f.length_ref_field] !== undefined) {
            const prevFixedLen = currentProtocol.fields
              .slice(0, fi)
              .filter(ff => ff.length_ref_field !== f.length_ref_field)
              .reduce((s, ff) => s + (ff.byte_length || 0), 0);
            const lenDef = currentProtocol.fields.find(ff => ff.name === f.length_ref_field);
            if (lenDef && lenDef.byte_length) {
              const startData = pos;
              let skipCount = 0;
              for (let x = 0; x < fi; x++) {
                if (currentProtocol.fields[x].length_ref_field === f.length_ref_field) skipCount++;
              }
              if (skipCount > 0) {
                blen = Math.max(0, (dynLens[f.length_ref_field] || 0) - 1);
              }
            }
          }
        }
        if (!blen && (f.field_type === 'String')) {
          const delim = currentProtocol.frame_delimiter || [0x0D, 0x0A];
          let dfound = -1;
          for (let i = pos; i <= buffer.length - delim.length; i++) {
            let ok = true;
            for (let j = 0; j < delim.length; j++) {
              if (buffer[i + j] !== delim[j]) { ok = false; break; }
            }
            if (ok) { dfound = i; break; }
          }
          if (dfound === -1) { success = false; break; }
          blen = dfound - pos;
        }
        if (!blen) { success = false; break; }
        if (pos + blen > buffer.length) { success = false; break; }
        const raw = buffer.slice(pos, pos + blen);
        let val = '';
        if (f.fixed_value) {
          let ok = true;
          for (let j = 0; j < raw.length && j < f.fixed_value.length; j++) {
            if (raw[j] !== f.fixed_value[j]) { ok = false; break; }
          }
          if (!ok) {
            parseError = '帧头不匹配';
            success = false;
            break;
          }
        }
        const display = f.display_format || 'Hexadecimal';
        val = formatFieldValue(f.field_type, raw, display);
        if (f.field_type === 'Length') {
          dynLens[f.name] = raw[0] || 0;
        }
        const colors = ['#4a9eff','#4ade80','#fbbf24','#a78bfa','#fb923c','#22d3ee','#f472b6','#38bdf8','#facc15','#86efac','#c084fc','#f87171'];
        fields.push({
          name: f.name,
          field_type: f.field_type,
          raw_bytes: raw,
          parsed_value: val,
          offset: pos,
          length: blen,
          color: (colors[fi % colors.length]) + '25',
        });
        pos += blen;
      }

      if (!success) {
        if (parseError) {
          buffer.shift();
          dropped++;
        } else {
          break;
        }
        continue;
      }

      const rawData = buffer.slice(0, pos);
      let crcValid = true;
      let crcMsg = null;

      for (const pf of fields) {
        if (pf.field_type === 'Checksum') {
          const csData = rawData.slice(0, pf.offset);
          let expectedBytes = pf.raw_bytes;
          let calcBytes = [];
          if (currentProtocol.name === 'Modbus RTU' && expectedBytes.length === 2) {
            let crc = 0xFFFF;
            for (const b of csData) {
              crc ^= b;
              for (let i = 0; i < 8; i++) {
                crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : (crc >>> 1);
              }
            }
            crc &= 0xFFFF;
            calcBytes = [crc & 0xFF, (crc >> 8) & 0xFF];
          } else if (expectedBytes.length === 1) {
            const startIdx = fields.findIndex(f => f.field_type !== 'FrameHeader');
            const realData = rawData.slice(startIdx > 0 ? fields[startIdx].offset : 0, pf.offset);
            let bcc = 0;
            for (const b of realData) bcc ^= b;
            calcBytes = [bcc];
          }
          let match = calcBytes.length === expectedBytes.length;
          if (match) {
            for (let i = 0; i < calcBytes.length; i++) {
              if (calcBytes[i] !== expectedBytes[i]) { match = false; break; }
            }
          }
          if (!match) {
            crcValid = false;
            crcMsg = `CRC错误: 期望[${expectedBytes.map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' ')}] 计算[${calcBytes.map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' ')}]`;
            crcErr++;
          }
        }
      }

      allFrames.push({
        frame_id: uuidv4(),
        timestamp: Date.now(),
        raw_data: rawData,
        fields,
        checksum_valid: crcValid,
        error_message: crcMsg,
        frame_length: pos,
      });
      buffer = buffer.slice(pos);
    }

    updateTab({
      buffer,
      parseResults: allFrames,
      droppedFrames: dropped,
      crcErrors: crcErr,
    });
  }

  function formatFieldValue(ft, raw, display) {
    if (raw.length === 0) return '';
    switch (ft) {
      case 'UInt8':
      case 'FrameHeader': {
        if (display === 'Decimal') return `${raw[0]}`;
        if (display === 'Ascii') return raw[0] >= 32 && raw[0] < 127 ? String.fromCharCode(raw[0]) : '.';
        return '0x' + raw[0].toString(16).toUpperCase().padStart(2, '0');
      }
      case 'UInt16BE': {
        const v = raw.length >= 2 ? (raw[0] << 8) | raw[1] : 0;
        return display === 'Decimal' ? `${v}` : '0x' + v.toString(16).toUpperCase().padStart(4, '0');
      }
      case 'UInt16LE':
      case 'Checksum': {
        const v = raw.length >= 2 ? raw[0] | (raw[1] << 8) : 0;
        return display === 'Decimal' ? `${v}` : '0x' + v.toString(16).toUpperCase().padStart(4, '0');
      }
      case 'UInt32BE': {
        let v = 0;
        for (let i = 0; i < 4 && i < raw.length; i++) v = (v << 8) | raw[i];
        return display === 'Decimal' ? `${v}` : '0x' + v.toString(16).toUpperCase().padStart(8, '0');
      }
      case 'UInt32LE': {
        let v = 0;
        for (let i = Math.min(4, raw.length) - 1; i >= 0; i--) v = (v << 8) | raw[i];
        return display === 'Decimal' ? `${v}` : '0x' + v.toString(16).toUpperCase().padStart(8, '0');
      }
      case 'Int8': {
        const v = (raw[0] << 24) >> 24;
        return display === 'Decimal' ? `${v}` : '0x' + (raw[0] & 0xFF).toString(16).padStart(2, '0');
      }
      case 'Int16BE': {
        const v = raw.length >= 2 ? ((raw[0] << 24) | (raw[1] << 16)) >> 16 : 0;
        return `${v}`;
      }
      case 'Int16LE': {
        const v = raw.length >= 2 ? ((raw[1] << 24) | (raw[0] << 16)) >> 16 : 0;
        return `${v}`;
      }
      case 'Float32BE': {
        if (raw.length < 4) return '';
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        for (let i = 0; i < 4; i++) view.setUint8(i, raw[i]);
        return view.getFloat32(0, false).toFixed(4);
      }
      case 'Float32LE': {
        if (raw.length < 4) return '';
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        for (let i = 0; i < 4; i++) view.setUint8(i, raw[i]);
        return view.getFloat32(0, true).toFixed(4);
      }
      case 'Length': {
        return `${raw[0] || 0}`;
      }
      case 'String': {
        return raw.map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
      }
      case 'RawBytes':
      default: {
        if (display === 'Ascii') return raw.map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
        if (display === 'Decimal') return raw.join(' ');
        return raw.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
      }
    }
  }

  async function doSend() {
    if (!currentTab?.connected) {
      alert('串口未连接');
      return;
    }
    let bytes;
    if (sendMode === 'Hex') {
      bytes = hexToBytes(sendContent);
      if (bytes.length === 0) {
        alert('请输入有效的HEX数据');
        return;
      }
    } else {
      bytes = asciiToBytes(sendContent);
    }

    try {
      await sendSerialData(tab.id, bytes);

      const txLine = {
        id: uuidv4(),
        timestamp: Date.now(),
        direction: 'Tx',
        portName: currentTab.portName,
        data: bytes,
      };

      const history = [{ content: sendContent, mode: sendMode, time: Date.now() },
        ...(currentTab.sendHistory || []).slice(0, 19)];

      updateTab({
        terminalLines: [...(currentTab.terminalLines || []), txLine],
        sendHistory: history,
      });

    } catch (e) {
      alert('发送失败: ' + (e.message || e));
    }
  }

  function handleKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doSend();
    }
  }

  function useHistoryItem(item) {
    updateTab({ sendContent: item.content });
    if (item.mode) updateTab({ sendMode: item.mode });
    showHistory = false;
  }

  function runQuickCommand(detail) {
    const { data, isHex, portFilter } = detail;
    if (portFilter && portFilter !== tab.id) return;
    if (isHex) {
      updateTab({ sendMode: 'Hex', sendContent: data });
    } else {
      updateTab({ sendMode: 'Ascii', sendContent: data });
    }
    setTimeout(() => doSend(), 0);
  }

  onMount(() => {
    document.addEventListener('quick-command-send', (e) => runQuickCommand(e.detail || {}));
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="serial-tab">
  <div class="tab-toolbar">
    <div class="tb-left">
      <div class="mode-switch">
        {#each DISPLAY_MODE_OPTIONS as opt}
          <button
            class="mode-btn"
            class:active={displayMode === opt.value}
            on:click={() => setDisplayMode(opt.value)}
          >{opt.label}</button>
        {/each}
      </div>
      <button class="toolbar-btn" class:active={autoScroll} on:click={toggleAutoScroll} title="自动滚动">
        ⬇ {autoScroll ? '自动滚动' : '滚动锁定'}
      </button>
      <button class="toolbar-btn" on:click={clearTerminal} title="清空">
        🗑 清空
      </button>
    </div>

    <div class="tb-right">
      <div class="parse-controls">
        <label class="switch-wrap">
          <input type="checkbox" bind:checked={parseEnabled} on:change={toggleParse} />
          <span class="switch-label">🔓 帧解析</span>
        </label>
        <select
          bind:value={selectedProtocolId}
          on:change={(e) => selectProtocol(e.target.value)}
          disabled={!parseEnabled}
        >
          <option value="">-- 选择协议 --</option>
          {#each $protocolTemplates as p}
            <option value={p.id}>{p.name} {#if p.is_builtin}(内置){/if}</option>
          {/each}
        </select>
        {#if parseEnabled && currentProtocol}
          <span class="parse-stats">
            ✔ {currentTab.parseResults?.length || 0} |
            ❌ {currentTab.crcErrors || 0} |
            ⏭ {currentTab.droppedFrames || 0}
          </span>
        {/if}
      </div>
    </div>
  </div>

  <div class="terminal-layout">
    <div class="terminal-area">
      <div class="rx-area">
        <div class="area-header">
          <span>📥 接收区域 ({currentTab.rxBytes || 0} B)</span>
        </div>
        <div
          class="terminal-content monospace scrollbar-thin"
          bind:this={terminalEl}
          on:scroll={onScroll}
          on:scrollend={onScroll}
        >
          {#if lines.length === 0}
            <div class="no-data">等待数据...</div>
          {/if}
          {#each lines as line (line.id)}
            {@const parsed = parseLine(line)}
            {@const isRx = line.direction === 'Rx'}
            {@const arrow = isRx ? '←' : '→'}
            {@const color = isRx ? 'var(--rx-color)' : 'var(--tx-color)'}
            <div class="term-line" class:rx={isRx} class:tx={!isRx}>
              <span class="term-time">[{formatTimestamp(line.timestamp)}]</span>
              <span class="term-arrow" style="color:{color}">{arrow}</span>
              {#if parsed.type === 'mixed'}
                <span class="term-hex">{parsed.hex}</span>
                <span class="term-ascii">{parsed.ascii}</span>
              {:else}
                <span class={parsed.type === 'ascii' ? 'term-ascii' : 'term-hex'}>
                  {parsed.content}
                </span>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <div class="tx-area">
        <div class="area-header">
          <span>📤 发送区域 ({currentTab.txBytes || 0} B)</span>
          <div class="tx-controls">
            <div class="send-mode">
              <button
                class="mode-btn"
                class:active={sendMode === 'Ascii'}
                on:click={() => updateTab({ sendMode: 'Ascii' })}
              >ASCII</button>
              <button
                class="mode-btn"
                class:active={sendMode === 'Hex'}
                on:click={() => updateTab({ sendMode: 'Hex' })}
              >HEX</button>
            </div>
            <button class="history-btn" on:click={() => showHistory = !showHistory} title="历史记录">
              📜 {sendHistory.length}
            </button>
          </div>
        </div>
        <div class="tx-body">
          {#if showHistory && sendHistory.length > 0}
            <div class="history-dropdown">
              <div class="history-title">最近 20 条发送历史：</div>
              {#each sendHistory as h, i}
                <div class="history-item" on:click={() => useHistoryItem(h)}>
                  <span class="h-index">[{i + 1}]</span>
                  <span class="h-mode">{h.mode === 'Hex' ? 'HEX' : 'ASC'}</span>
                  <span class="h-content">{h.content.length > 60 ? h.content.slice(0, 60) + '...' : h.content}</span>
                  <span class="h-time">{new Date(h.time).toLocaleTimeString()}</span>
                </div>
              {/each}
            </div>
          {/if}
          <textarea
            class="tx-input monospace"
            bind:value={sendContent}
            on:input={() => updateTab({ sendContent })}
            on:keydown={handleKeydown}
            placeholder={sendMode === 'Hex'
              ? '输入HEX，如: AA 55 01 02 03 (空格或无分隔)  [Ctrl+Enter 发送]'
              : '输入ASCII文本发送  [Ctrl+Enter 发送]'
            }
            rows="4"
          />
          <button class="send-btn primary" on:click={doSend}>
            ⚡ 发送 <span class="kbd-hint">(Ctrl+Enter)</span>
          </button>
        </div>
      </div>
    </div>

    {#if parseEnabled && currentProtocol}
      <ParseResults
        parseResults={currentTab.parseResults || []}
        protocol={currentProtocol}
      />
    {/if}
  </div>
</div>

<style>
  .serial-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    padding: 10px;
    gap: 8px;
  }
  .tab-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    gap: 12px;
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .tb-left, .tb-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .mode-switch, .send-mode {
    display: inline-flex;
    background: var(--bg-input);
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border-color);
  }
  .mode-btn {
    padding: 5px 12px;
    font-size: 12px;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--text-secondary);
  }
  .mode-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  .mode-btn.active {
    background: var(--accent-blue);
    color: #fff;
  }
  .toolbar-btn {
    padding: 5px 10px;
    font-size: 12px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
  }
  .toolbar-btn.active {
    color: var(--accent-green);
    border-color: var(--accent-green);
  }
  .parse-controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .switch-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 13px;
  }
  .switch-label {
    font-size: 13px;
  }
  .parse-stats {
    font-size: 12px;
    font-family: var(--font-mono);
    background: var(--bg-input);
    padding: 4px 10px;
    border-radius: 4px;
    color: var(--text-secondary);
  }
  .terminal-layout {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 380px;
    gap: 8px;
    overflow: hidden;
    min-height: 0;
  }
  @media (max-width: 900px) {
    .terminal-layout {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr auto;
    }
  }
  .terminal-area {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: hidden;
    min-width: 0;
  }
  .rx-area, .tx-area {
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .rx-area {
    flex: 1;
    min-height: 0;
  }
  .tx-area {
    height: 200px;
    flex-shrink: 0;
  }
  .area-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .tx-controls {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .terminal-content {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .no-data {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }
  .term-line {
    display: flex;
    gap: 6px;
    padding: 1px 0;
    flex-wrap: wrap;
  }
  .term-line.rx { background: rgba(74, 158, 255, 0.03); }
  .term-line.tx { background: rgba(74, 222, 128, 0.03); }
  .term-time {
    color: var(--text-muted);
    flex-shrink: 0;
    font-size: 12px;
  }
  .term-arrow {
    flex-shrink: 0;
    font-weight: bold;
  }
  .term-hex {
    color: var(--accent-cyan);
    font-size: 13px;
    word-break: break-all;
  }
  .term-ascii {
    color: var(--text-primary);
    font-size: 13px;
    word-break: break-all;
  }
  .term-line.mixed .term-hex { flex: 1; min-width: 200px; }
  .term-line.mixed .term-ascii {
    flex: 0.6;
    min-width: 150px;
    color: var(--text-secondary);
    padding-left: 10px;
    border-left: 1px dashed var(--border-color);
    margin-left: 10px;
  }
  .tx-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 8px;
    gap: 8px;
    position: relative;
    overflow: hidden;
  }
  .history-dropdown {
    position: absolute;
    top: 8px;
    left: 8px;
    right: 8px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    z-index: 10;
    max-height: 150px;
    overflow-y: auto;
    padding: 6px;
  }
  .history-title {
    font-size: 11px;
    color: var(--text-muted);
    padding: 4px 6px;
    margin-bottom: 4px;
  }
  .history-item {
    display: flex;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    align-items: center;
  }
  .history-item:hover {
    background: var(--bg-tertiary);
  }
  .h-index { color: var(--text-muted); min-width: 30px; }
  .h-mode {
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--accent-cyan);
    color: #000;
    font-size: 10px;
    font-weight: 600;
  }
  .h-content { flex: 1; font-family: var(--font-mono); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .h-time { color: var(--text-muted); font-size: 11px; }
  .history-btn {
    padding: 4px 8px;
    font-size: 12px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 4px;
  }
  .tx-input {
    flex: 1;
    resize: none;
    font-size: 13px;
    min-height: 60px;
  }
  .send-btn {
    align-self: flex-end;
    padding: 8px 24px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .kbd-hint {
    font-size: 11px;
    opacity: 0.7;
    font-weight: normal;
  }
</style>

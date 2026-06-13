<script>
  import {
    playbackState, statusBarData, openTabs, activeTabId,
    formatTimestamp, bytesToHex, formatFileSize, uuidv4
  } from '../stores.js';
  import { showOpenDialog, showSaveDialog, writeLogFile, readLogFile, exportCsv, sendSerialData } from '../tauriApi.js';

  export let onClose;

  let logEntries = [];
  let loadedPath = '';
  let playbackTimer = null;
  let exporting = false;

  $: isPlaying = $playbackState.isPlaying;
  $: isPaused = $playbackState.isPaused;
  $: speed = $playbackState.speed;
  $: progress = $playbackState.progress;
  $: entries = $playbackState.entries;
  $: currentIndex = $playbackState.currentIndex;

  $: totalBytes = logEntries.reduce((s, e) => s + (e.data?.length || 0), 0);
  $: rxCount = logEntries.filter(e => e.direction === 'Rx' || e.direction === 0).length;
  $: txCount = logEntries.filter(e => e.direction === 'Tx' || e.direction === 1).length;

  async function openLogFile() {
    try {
      const selected = await showOpenDialog({
        multiple: false,
        filters: [{ name: 'Log Files', extensions: ['json', 'log'] }],
      });
      if (selected && (selected.file || selected)) {
        const path = typeof selected === 'string' ? selected : (selected.file || selected.path);
        const loaded = await readLogFile(path);
        logEntries = loaded || [];
        loadedPath = path;
        $playbackState = { ...$playbackState, entries: logEntries, currentIndex: 0, progress: 0 };
      }
    } catch (e) {
      console.warn('open log error', e);
      const mock = generateMockLog();
      logEntries = mock;
      $playbackState = { ...$playbackState, entries: mock, currentIndex: 0, progress: 0 };
    }
  }

  function generateMockLog() {
    const mock = [];
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      const isRx = Math.random() > 0.4;
      const len = Math.floor(Math.random() * 20) + 4;
      const data = [];
      for (let j = 0; j < len; j++) data.push(Math.floor(Math.random() * 256));
      mock.push({
        timestamp: now + i * (Math.random() * 800 + 200),
        direction: isRx ? 'Rx' : 'Tx',
        port_name: 'COM3',
        data,
        parsed_frame: null,
      });
    }
    return mock;
  }

  function saveCurrentRecording() {
    alert('录制功能将保存 statusBar 中的实时数据。当前为演示模式。');
  }

  async function doExportCsv() {
    if (logEntries.length === 0) { alert('暂无数据可导出'); return; }
    try {
      exporting = true;
      let savePath = loadedPath ? loadedPath.replace(/\.[^.]+$/, '.csv') : 'serial_log.csv';
      try {
        const dlg = await showSaveDialog({
          defaultPath: savePath,
          filters: [{ name: 'CSV Files', extensions: ['csv'] }],
        });
        if (dlg) {
          savePath = typeof dlg === 'string' ? dlg : (dlg.file || dlg.path || savePath);
        }
      } catch(e) {}
      await exportCsv(savePath, logEntries);
      alert('导出成功: ' + savePath);
    } catch(e) {
      exportToBrowserCsv();
    } finally {
      exporting = false;
    }
  }

  function exportToBrowserCsv() {
    let csv = '时间戳,方向,端口,HEX数据,解析结果\n';
    for (const e of logEntries) {
      const ts = e.timestamp;
      const dir = e.direction === 'Rx' || e.direction === 0 ? 'RX' : 'TX';
      const hex = bytesToHex(e.data);
      const parsed = e.parsed_frame ? e.parsed_frame.fields.map(f => `${f.name}=${f.parsed_value}`).join('; ') : '';
      csv += `"${ts}","${dir}","${e.port_name || ''}","${hex}","${parsed}"\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'serial_log_' + Date.now() + '.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function seekTo(index) {
    $playbackState = {
      ...$playbackState,
      currentIndex: index,
      progress: entries.length > 0 ? (index / entries.length) * 100 : 0,
    };
  }

  function togglePlay() {
    if (entries.length === 0) return;
    if (isPlaying) {
      pausePlayback();
    } else {
      startPlayback();
    }
  }

  function startPlayback() {
    if (entries.length === 0) return;
    if (playbackTimer) clearInterval(playbackTimer);
    $playbackState = { ...$playbackState, isPlaying: true, isPaused: false };

    runPlayback();
  }

  async function runPlayback() {
    let i = currentIndex;
    if (i >= entries.length) {
      i = 0;
      $playbackState = { ...$playbackState, currentIndex: 0, progress: 0 };
    }

    while (i < entries.length && $playbackState.isPlaying && !$playbackState.isPaused) {
      const entry = entries[i];
      if (entry.direction === 'Tx' || entry.direction === 1) {
        const pid = $activeTabId;
        if (pid && entry.data) {
          try { await sendSerialData(pid, entry.data); } catch(e) {}
        }
      }
      i++;
      $playbackState = {
        ...$playbackState,
        currentIndex: i,
        progress: entries.length > 0 ? (i / entries.length) * 100 : 0,
      };
      if (i < entries.length) {
        const next = entries[i];
        const curr = entries[i - 1];
        const delta = Math.max(10, Math.floor((next.timestamp - curr.timestamp) / speed));
        await new Promise(r => setTimeout(r, delta));
      }
    }

    if (i >= entries.length) {
      $playbackState = { ...$playbackState, isPlaying: false };
    }
  }

  function pausePlayback() {
    $playbackState = { ...$playbackState, isPlaying: false, isPaused: true };
  }

  function stopPlayback() {
    if (playbackTimer) { clearInterval(playbackTimer); playbackTimer = null; }
    $playbackState = { ...$playbackState, isPlaying: false, isPaused: false, currentIndex: 0, progress: 0 };
  }

  function setSpeed(s) {
    $playbackState = { ...$playbackState, speed: s };
  }

  function loadMock() {
    logEntries = generateMockLog();
    $playbackState = { ...$playbackState, entries: logEntries, currentIndex: 0, progress: 0 };
  }
</script>

<div class="modal-backdrop" on:click|self={onClose}>
  <div class="modal log-modal">
    <div class="modal-header">
      <h2>📂 数据记录与回放</h2>
      <button class="close-btn" on:click={onClose}>×</button>
    </div>
    <div class="modal-body log-body">
      <div class="log-toolbar">
        <div class="lt-left">
          <button class="btn-sm" on:click={openLogFile}>📂 加载日志</button>
          <button class="btn-sm" on:click={loadMock}>📋 加载示例</button>
          <button class="btn-sm" on:click={saveCurrentRecording} disabled={!$statusBarData.isRecording}>
            💾 保存录制
          </button>
          <button class="btn-sm primary" on:click={doExportCsv} disabled={exporting}>
            {exporting ? '导出中...' : '📊 导出CSV'}
          </button>
        </div>
        <div class="lt-right">
          <span>加载: {logEntries.length} 条</span>
          <span>📥 {rxCount} | 📤 {txCount}</span>
          <span>{formatFileSize(totalBytes)}</span>
        </div>
      </div>

      <div class="playback-bar">
        <button class="pb-btn" on:click={stopPlayback} title="停止">⏹</button>
        <button class="pb-btn play" on:click={togglePlay} title={isPlaying ? '暂停' : '播放'}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <div class="pb-progress" on:click={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          seekTo(Math.floor(pct * entries.length));
        }}>
          <div class="pb-fill" style="width:{progress}%"></div>
          <div class="pb-pointer" style="left:{progress}%"></div>
        </div>
        <span class="pb-count">{currentIndex}/{entries.length}</span>
        <div class="pb-speed">
          {#each [0.5, 1, 2, 4, 8] as s}
            <button
              class="sp-btn"
              class:active={speed === s}
              on:click={() => setSpeed(s)}
            >{s}x</button>
          {/each}
        </div>
      </div>

      <div class="log-list-wrap">
        <div class="log-list">
          <div class="log-header-row">
            <div style="width:120px">时间</div>
            <div style="width:50px">方向</div>
            <div style="width:80px">端口</div>
            <div style="flex:1">数据</div>
            <div style="width:70px;text-align:right">大小</div>
          </div>
          {#if logEntries.length === 0}
            <div class="log-empty">
              <div style="font-size:48px;opacity:0.3;margin-bottom:16px">📁</div>
              <p>暂无日志数据<br/>点击"加载日志"或"加载示例"查看数据</p>
            </div>
          {/if}
          {#each logEntries as entry, idx (idx)}
            <div
              class="log-row"
              class:rx={entry.direction === 'Rx' || entry.direction === 0}
              class:tx={entry.direction === 'Tx' || entry.direction === 1}
              class:current={idx === currentIndex}
              on:click={() => seekTo(idx)}
            >
              <div class="mono">{formatTimestamp(entry.timestamp)}</div>
              <div class="dir">
                {entry.direction === 'Rx' || entry.direction === 0
                  ? '<span style="color:var(--rx-color)">← RX</span>'
                  : '<span style="color:var(--tx-color)">→ TX</span>'
                }
              </div>
              <div>{entry.port_name || entry.portName || '-'}</div>
              <div class="mono hex-cell">{bytesToHex(entry.data)}</div>
              <div style="text-align:right" class="mono">{entry.data?.length || 0}B</div>
            </div>
          {/each}
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button on:click={onClose}>关闭</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    width: 1000px; max-width: 98vw; max-height: 92vh;
    display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  .modal-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 16px 20px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
  }
  .modal-header h2 { font-size: 18px; font-weight: 600; }
  .close-btn {
    width: 32px; height: 32px; border-radius: 50%;
    background: transparent; border: none;
    font-size: 24px; color: var(--text-secondary);
  }
  .close-btn:hover { background: var(--accent-red); color: #fff; }
  .modal-body {
    padding: 14px 18px; overflow-y: auto; flex: 1;
    display: flex; flex-direction: column; gap: 12px;
  }
  .modal-footer {
    padding: 12px 20px;
    background: var(--bg-tertiary);
    border-top: 1px solid var(--border-color);
    display: flex; justify-content: flex-end;
  }
  .log-toolbar {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 14px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    flex-wrap: wrap;
    gap: 10px;
  }
  .lt-left, .lt-right {
    display: flex; gap: 8px; align-items: center;
    flex-wrap: wrap;
  }
  .lt-right { font-size: 12px; color: var(--text-secondary); gap: 16px; font-family: var(--font-mono); }
  .btn-sm { padding: 5px 12px; font-size: 12px; }
  .btn-sm.primary { background: var(--accent-green); color: #000; border-color: var(--accent-green); }
  .playback-bar {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
  }
  .pb-btn {
    width: 34px; height: 34px;
    border-radius: 50%;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    font-size: 14px;
    display: flex; align-items: center; justify-content: center;
  }
  .pb-btn.play {
    background: var(--accent-blue);
    border-color: var(--accent-blue);
    color: #fff;
  }
  .pb-btn.play:hover { background: #3a8eef; }
  .pb-progress {
    flex: 1;
    height: 10px;
    background: var(--bg-input);
    border-radius: 5px;
    position: relative;
    cursor: pointer;
    border: 1px solid var(--border-color);
  }
  .pb-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-blue), var(--accent-cyan));
    border-radius: 4px;
    transition: width 0.1s linear;
  }
  .pb-pointer {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 14px;
    height: 14px;
    background: #fff;
    border: 2px solid var(--accent-blue);
    border-radius: 50%;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  }
  .pb-count {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
    min-width: 80px;
    text-align: center;
  }
  .pb-speed {
    display: flex;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    overflow: hidden;
  }
  .sp-btn {
    padding: 4px 8px;
    font-size: 11px;
    font-family: var(--font-mono);
    background: transparent;
    border: none;
    color: var(--text-secondary);
  }
  .sp-btn.active {
    background: var(--accent-cyan);
    color: #000;
    font-weight: 700;
  }
  .log-list-wrap {
    flex: 1;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--bg-input);
  }
  .log-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .log-header-row {
    display: flex;
    gap: 10px;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    font-size: 11px;
    color: var(--text-secondary);
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .log-row {
    display: flex;
    gap: 10px;
    padding: 6px 12px;
    font-size: 12px;
    border-bottom: 1px solid rgba(42,58,90,0.4);
    align-items: center;
    cursor: pointer;
    transition: background 0.1s;
  }
  .log-row.rx { background: rgba(74, 158, 255, 0.04); }
  .log-row.tx { background: rgba(74, 222, 128, 0.04); }
  .log-row:hover { background: rgba(255,255,255,0.04); }
  .log-row.current {
    background: rgba(74, 158, 255, 0.18) !important;
    box-shadow: inset 3px 0 0 var(--accent-blue);
  }
  .log-row > div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mono { font-family: var(--font-mono); }
  .hex-cell { color: var(--accent-cyan); font-size: 11px; }
  .dir { font-weight: 600; }
  .log-empty {
    padding: 60px 20px;
    text-align: center;
    color: var(--text-muted);
  }
</style>

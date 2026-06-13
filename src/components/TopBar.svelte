<script>
  import {
    showChecksumTool, showAutoSend, showMonitor, showLogPanel,
    showProtocolEditor, sidebarOpen, statusBarData, refreshingPorts,
  } from '../stores.js';

  export let onRefreshPorts;

  let elapsedTimer = null;
  let startTime = null;

  function startStopRecording() {
    $statusBarData = {
      ...$statusBarData,
      isRecording: !$statusBarData.isRecording,
      elapsed: 0,
    };
    if ($statusBarData.isRecording) {
      startTime = Date.now();
      elapsedTimer = setInterval(() => {
        if (startTime) {
          $statusBarData = {
            ...$statusBarData,
            elapsed: Math.floor((Date.now() - startTime) / 1000),
          };
        }
      }, 500);
    } else {
      if (elapsedTimer) clearInterval(elapsedTimer);
      startTime = null;
    }
  }

  function formatElapsed(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
  }
</script>

<header class="topbar">
  <div class="topbar-left">
    <button class="icon-btn" on:click={() => $sidebarOpen = !$sidebarOpen} title="切换侧边栏">
      ☰
    </button>
    <div class="app-title">
      <span class="logo">⚡</span>
      <span class="title-text">Serial Terminal</span>
    </div>
  </div>

  <div class="topbar-center">
    <button class="tb-btn" on:click={onRefreshPorts} disabled={$refreshingPorts}>
      <span>{$refreshingPorts ? '刷新中...' : '🔄 刷新串口'}</span>
    </button>
    <div class="divider-v"></div>
    <button class="tb-btn" on:click={() => $showProtocolEditor = true}>
      📋 协议编辑
    </button>
    <button class="tb-btn" on:click={() => $showChecksumTool = true}>
      🧮 校验计算
    </button>
    <div class="divider-v"></div>
    <button class="tb-btn" on:click={() => $showAutoSend = true}>
      ⏱️ 自动发送
    </button>
    <button class="tb-btn" on:click={() => $showMonitor = true}>
      📈 数据监控
    </button>
    <div class="divider-v"></div>
    <button class="tb-btn" class:recording={$statusBarData.isRecording} on:click={startStopRecording}>
      {$statusBarData.isRecording ? `⏹ 停止录制 (${formatElapsed($statusBarData.elapsed)})` : '⏺ 开始录制'}
    </button>
    <button class="tb-btn" on:click={() => $showLogPanel = true}>
      📂 日志/回放
    </button>
  </div>

  <div class="topbar-right">
    <span class="help-hint">Ctrl+Enter 发送</span>
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    height: 50px;
    flex-shrink: 0;
  }
  .topbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 200px;
  }
  .topbar-center {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    justify-content: center;
    flex-wrap: wrap;
  }
  .topbar-right {
    min-width: 160px;
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }
  .icon-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
  }
  .icon-btn:hover {
    background: var(--bg-input);
    border-color: var(--border-color);
  }
  .app-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-size: 16px;
    color: var(--text-primary);
  }
  .logo {
    font-size: 22px;
  }
  .title-text {
    background: linear-gradient(90deg, var(--accent-cyan), var(--accent-blue));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .tb-btn {
    padding: 6px 12px;
    font-size: 13px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    white-space: nowrap;
  }
  .tb-btn:hover {
    background: var(--accent-blue);
    border-color: var(--accent-blue);
  }
  .tb-btn.recording {
    background: var(--accent-red);
    border-color: var(--accent-red);
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  .divider-v {
    width: 1px;
    height: 24px;
    background: var(--border-color);
    margin: 0 4px;
  }
  .help-hint {
    color: var(--text-muted);
    font-size: 12px;
  }
</style>

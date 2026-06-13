<script>
  import { statusBarData, openTabs, activeTabId } from '../stores.js';
  import { formatFileSize, formatDuration } from '../stores.js';

  let currentTime = new Date().toLocaleTimeString();
  const timer = setInterval(() => {
    currentTime = new Date().toLocaleTimeString();
  }, 1000);
</script>

<footer class="statusbar">
  <div class="sb-left">
    <span class="sb-item" class:ok={$statusBarData.connectedCount > 0}>
      <span class="sb-dot"></span>
      连接: {$statusBarData.connectedCount}
    </span>
    {#if $statusBarData.currentPort}
      <span class="sb-item">
        📡 {$statusBarData.currentPort}
      </span>
    {/if}
    <span class="sb-item">
      📥 收: {formatFileSize($statusBarData.totalRx)}
    </span>
    <span class="sb-item">
      📤 发: {formatFileSize($statusBarData.totalTx)}
    </span>
  </div>

  <div class="sb-right">
    {#if $statusBarData.isRecording}
      <span class="sb-item recording">
        ● 录制中 {formatDuration($statusBarData.elapsed * 1000)}
      </span>
    {/if}
    <span class="sb-item">
      标签: {$openTabs.length}
    </span>
    <span class="sb-item time">
      🕐 {currentTime}
    </span>
  </div>
</footer>

<style>
  .statusbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    background: var(--bg-tertiary);
    border-top: 1px solid var(--border-color);
    height: 28px;
    font-size: 12px;
    flex-shrink: 0;
    color: var(--text-secondary);
  }
  .sb-left, .sb-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .sb-item {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .sb-item.ok {
    color: var(--accent-green);
  }
  .sb-item.recording {
    color: var(--accent-red);
    animation: blink 1s infinite;
  }
  @keyframes blink {
    50% { opacity: 0.6; }
  }
  .sb-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
  }
  .sb-item.ok .sb-dot {
    background: var(--accent-green);
    box-shadow: 0 0 6px var(--accent-green);
  }
  .time {
    color: var(--accent-cyan);
    font-family: var(--font-mono);
  }
</style>

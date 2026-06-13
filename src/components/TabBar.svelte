<script>
  import { formatFileSize, DATA_BITS_OPTIONS, STOP_BITS_OPTIONS, PARITY_OPTIONS, FLOW_CONTROL_OPTIONS } from '../stores.js';

  export let tabs = [];
  export let activeId = null;
  export let onSelect;
  export let onClose;

  function getDataBitsLabel(val) {
    const map = { Five: 5, Six: 6, Seven: 7, Eight: 8 };
    return map[val] || val || 8;
  }

  function getStopBitsLabel(val) {
    const opt = STOP_BITS_OPTIONS.find(o => o.value === val);
    return opt ? opt.label : val || '1';
  }

  function getParityLabel(val) {
    const opt = PARITY_OPTIONS.find(o => o.value === val);
    return opt ? opt.label : val || 'None';
  }

  function getFlowControlLabel(val) {
    const opt = FLOW_CONTROL_OPTIONS.find(o => o.value === val);
    return opt ? opt.label : val || 'None';
  }

  function buildTooltip(tab) {
    const cfg = tab.config || {};
    const lines = [];
    lines.push(`串口: ${tab.portName}`);
    lines.push(`波特率: ${cfg.baud_rate || '?'}`);
    lines.push(`数据位: ${getDataBitsLabel(cfg.data_bits)}`);
    lines.push(`停止位: ${getStopBitsLabel(cfg.stop_bits)}`);
    lines.push(`校验位: ${getParityLabel(cfg.parity)}`);
    lines.push(`流控: ${getFlowControlLabel(cfg.flow_control)}`);
    lines.push('');
    lines.push(`累计接收: ${formatFileSize(tab.rxBytes || 0)}`);
    lines.push(`累计发送: ${formatFileSize(tab.txBytes || 0)}`);
    if (tab.error) {
      lines.push('');
      lines.push(`状态: ${tab.error}`);
    }
    return lines.join('\n');
  }
</script>

<div class="tabbar">
  <div class="tabs-scroll">
    {#each tabs as tab (tab.id)}
      <div
        class="tab-item"
        class:active={tab.id === activeId}
        on:click={() => onSelect(tab.id)}
        title={buildTooltip(tab)}
      >
        <span
          class="tab-status"
          class:connected={tab.connected && !tab.error}
          class:error={tab.error && tab.error !== '连接已关闭'}
          class:closed={!tab.connected || tab.error === '连接已关闭'}
        ></span>
        <span class="tab-title">{tab.portName}@{tab.config?.baud_rate || '?'}</span>
        {#if tab.connected}
          <span class="tab-stats">
            ↓{formatFileSize(tab.rxBytes || 0).replace(' B','').replace(' ','')}
          </span>
        {/if}
        <button
          class="tab-close"
          on:click|stopPropagation={() => onClose(tab.id)}
          title="关闭"
        >×</button>
      </div>
    {/each}
  </div>
</div>

<style>
  .tabbar {
    height: 40px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: stretch;
    overflow-x: auto;
    flex-shrink: 0;
  }
  .tabs-scroll {
    display: flex;
    align-items: stretch;
    padding: 0 4px;
  }
  .tab-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    min-width: 140px;
    max-width: 280px;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
    transition: all 0.15s;
    white-space: nowrap;
  }
  .tab-item:hover {
    background: var(--bg-input);
    color: var(--text-primary);
  }
  .tab-item.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    border-bottom-color: var(--accent-blue);
  }
  .tab-status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-muted);
  }
  .tab-status.connected {
    background: var(--accent-green);
    box-shadow: 0 0 6px var(--accent-green);
  }
  .tab-status.closed {
    background: var(--text-muted);
  }
  .tab-status.error {
    background: var(--accent-red);
    box-shadow: 0 0 6px var(--accent-red);
    animation: pulse-error 1.5s ease-in-out infinite;
  }
  @keyframes pulse-error {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .tab-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .tab-stats {
    font-size: 11px;
    color: var(--accent-green);
    font-family: var(--font-mono);
  }
  .tab-close {
    width: 20px;
    height: 20px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 16px;
    font-weight: bold;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .tab-item:hover .tab-close {
    opacity: 1;
  }
  .tab-close:hover {
    background: var(--accent-red);
    color: #fff;
  }
</style>

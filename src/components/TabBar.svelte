<script>
  import { formatFileSize } from '../stores.js';

  export let tabs = [];
  export let activeId = null;
  export let onSelect;
  export let onClose;
</script>

<div class="tabbar">
  <div class="tabs-scroll">
    {#each tabs as tab (tab.id)}
      <div
        class="tab-item"
        class:active={tab.id === activeId}
        on:click={() => onSelect(tab.id)}
        title={tab.portName}
      >
        <span class="tab-status" class:connected={tab.connected}></span>
        <span class="tab-name">{tab.portName}</span>
        <span class="tab-baud">
          {tab.config?.baud_rate || '?'}
        </span>
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
    max-width: 240px;
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
    background: var(--text-muted);
    flex-shrink: 0;
  }
  .tab-status.connected {
    background: var(--accent-green);
    box-shadow: 0 0 6px var(--accent-green);
  }
  .tab-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tab-baud {
    color: var(--accent-cyan);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 1px 5px;
    background: var(--bg-input);
    border-radius: 3px;
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

<script>
  import { autoSendConfig, openTabs, activeTabId, uuidv4, hexToBytes } from '../stores.js';
  import { sendSerialData } from '../tauriApi.js';

  export let onClose;

  let timers = { timed: null, sequence: null };
  let sequenceRunning = false;

  $: activeTab = $openTabs.find(t => t.id === $activeTabId);
  $: canSend = activeTab?.connected;

  function getActivePortId() {
    return activeTab?.id;
  }

  async function sendCurrentPort(data, isHex) {
    const pid = getActivePortId();
    if (!pid) { alert('请先选择已连接的串口标签页'); return; }
    const bytes = isHex ? hexToBytes(data) : Array.from(data).map(c => c.charCodeAt(0) & 0xFF);
    if (bytes.length === 0) return;
    try {
      await sendSerialData(pid, bytes);
    } catch(e) {
      console.warn('send error', e);
    }
  }

  function toggleTimed() {
    $autoSendConfig = {
      ...$autoSendConfig,
      timed: { ...$autoSendConfig.timed, enabled: !$autoSendConfig.timed.enabled }
    };
    if ($autoSendConfig.timed.enabled) {
      startTimed();
    } else {
      stopTimed();
    }
  }

  function startTimed() {
    stopTimed();
    runTimedOnce();
    timers.timed = setInterval(runTimedOnce, Math.max(10, $autoSendConfig.timed.interval_ms || 500));
  }

  function runTimedOnce() {
    const cfg = $autoSendConfig.timed;
    if (!cfg.enabled || !cfg.data) return;
    sendCurrentPort(cfg.data, cfg.is_hex);
  }

  function stopTimed() {
    if (timers.timed) { clearInterval(timers.timed); timers.timed = null; }
  }

  function addSeqItem() {
    $autoSendConfig = {
      ...$autoSendConfig,
      sequence: {
        ...$autoSendConfig.sequence,
        items: [...$autoSendConfig.sequence.items, {
          id: uuidv4(),
          data: '',
          is_hex: true,
          delay_ms: 500,
        }]
      }
    };
  }

  function updateSeqItem(idx, patch) {
    $autoSendConfig = {
      ...$autoSendConfig,
      sequence: {
        ...$autoSendConfig.sequence,
        items: $autoSendConfig.sequence.items.map((it, i) =>
          i === idx ? { ...it, ...patch } : it
        )
      }
    };
  }

  function removeSeqItem(idx) {
    $autoSendConfig = {
      ...$autoSendConfig,
      sequence: {
        ...$autoSendConfig.sequence,
        items: $autoSendConfig.sequence.items.filter((_, i) => i !== idx)
      }
    };
  }

  function toggleSequence() {
    $autoSendConfig = {
      ...$autoSendConfig,
      sequence: { ...$autoSendConfig.sequence, enabled: !$autoSendConfig.sequence.enabled }
    };
    if ($autoSendConfig.sequence.enabled) {
      startSequence();
    } else {
      stopSequence();
    }
  }

  async function startSequence() {
    stopSequence();
    sequenceRunning = true;
    runSequenceLoop();
  }

  async function runSequenceLoop() {
    const items = $autoSendConfig.sequence.items;
    if (items.length === 0) return;
    let i = 0;
    while (sequenceRunning && $autoSendConfig.sequence.enabled) {
      if (i >= items.length) {
        if (!$autoSendConfig.sequence.loop_forever) break;
        i = 0;
      }
      const it = items[i];
      if (it.data) {
        sendCurrentPort(it.data, it.is_hex);
      }
      $autoSendConfig = {
        ...$autoSendConfig,
        sequence: { ...$autoSendConfig.sequence, current_index: i }
      };
      i++;
      const delay = Math.max(10, it.delay_ms || 500);
      await new Promise(r => setTimeout(r, delay));
    }
    sequenceRunning = false;
  }

  function stopSequence() {
    sequenceRunning = false;
  }

  function toggleTrigger() {
    $autoSendConfig = {
      ...$autoSendConfig,
      trigger: { ...$autoSendConfig.trigger, enabled: !$autoSendConfig.trigger.enabled }
    };
  }
</script>

<div class="modal-backdrop" on:click|self={onClose}>
  <div class="modal as-modal">
    <div class="modal-header">
      <h2>⏱️ 自动发送配置</h2>
      <button class="close-btn" on:click={onClose}>×</button>
    </div>
    <div class="modal-body as-body">
      {#if !canSend}
        <div class="warn-banner">
          ⚠ 当前没有已连接的串口标签页，发送功能将不会生效
        </div>
      {/if}

      <div class="as-section">
        <div class="as-sec-header">
          <label class="switch-big">
            <input type="checkbox" checked={$autoSendConfig.timed.enabled} on:change={toggleTimed} />
            <span class="as-title">⏰ 定时发送</span>
          </label>
        </div>
        <div class="as-sec-body" class:disabled={!$autoSendConfig.timed.enabled}>
          <div class="form-inline">
            <label>间隔 (ms):</label>
            <input
              type="number"
              bind:value={$autoSendConfig.timed.interval_ms}
              min="10"
              style="width:120px"
            />
            <span class="hint">最小10ms</span>
          </div>
          <div class="form-inline">
            <label>发送模式:</label>
            <div class="mode-switch-sm">
              <button
                class:active={!$autoSendConfig.timed.is_hex}
                on:click={() => $autoSendConfig.timed.is_hex = false}
              >ASCII</button>
              <button
                class:active={$autoSendConfig.timed.is_hex}
                on:click={() => $autoSendConfig.timed.is_hex = true}
              >HEX</button>
            </div>
          </div>
          <textarea
            class="monospace"
            rows="3"
            bind:value={$autoSendConfig.timed.data}
            placeholder={$autoSendConfig.timed.is_hex ? '如: AA 55 01 02' : '如: AT+VER?\\r\\n'}
          />
        </div>
      </div>

      <div class="as-section">
        <div class="as-sec-header">
          <label class="switch-big">
            <input type="checkbox" checked={$autoSendConfig.sequence.enabled} on:change={toggleSequence} />
            <span class="as-title">🔢 序列发送</span>
          </label>
          <div class="sec-right">
            <label class="check-sm">
              <input type="checkbox" bind:checked={$autoSendConfig.sequence.loop_forever} />
              <span>循环</span>
            </label>
            <button class="btn-sm" on:click={addSeqItem}>+ 添加帧</button>
          </div>
        </div>
        <div class="as-sec-body" class:disabled={!$autoSendConfig.sequence.enabled}>
          {#if $autoSendConfig.sequence.items.length === 0}
            <div class="empty-sm">点击"+ 添加帧"创建序列</div>
          {/if}
          <div class="seq-list">
            {#each $autoSendConfig.sequence.items as item, idx}
              <div class="seq-item" class:running={$autoSendConfig.sequence.current_index === idx && sequenceRunning}>
                <div class="seq-head">
                  <span class="seq-idx">#{idx + 1}</span>
                  <div class="seq-mode-sm">
                    <button
                      class:sm-active={!item.is_hex}
                      on:click={() => updateSeqItem(idx, { is_hex: false })}
                    >ASC</button>
                    <button
                      class:sm-active={item.is_hex}
                      on:click={() => updateSeqItem(idx, { is_hex: true })}
                    >HEX</button>
                  </div>
                  <label>延迟:</label>
                  <input
                    type="number"
                    value={item.delay_ms}
                    on:input={(e) => updateSeqItem(idx, { delay_ms: parseInt(e.target.value) || 0 })}
                    style="width:80px"
                  />
                  <span>ms</span>
                  <button class="seq-del" on:click={() => removeSeqItem(idx)}>×</button>
                </div>
                <textarea
                  class="monospace"
                  rows="2"
                  value={item.data}
                  on:input={(e) => updateSeqItem(idx, { data: e.target.value })}
                  placeholder={item.is_hex ? 'HEX数据' : 'ASCII文本'}
                />
              </div>
            {/each}
          </div>
        </div>
      </div>

      <div class="as-section">
        <div class="as-sec-header">
          <label class="switch-big">
            <input type="checkbox" checked={$autoSendConfig.trigger.enabled} on:change={toggleTrigger} />
            <span class="as-title">🎯 条件触发发送</span>
          </label>
        </div>
        <div class="as-sec-body" class:disabled={!$autoSendConfig.trigger.enabled}>
          <div class="form-inline">
            <label>匹配模式:</label>
            <select bind:value={$autoSendConfig.trigger.condition.match_type}>
              <option value="Contains">包含</option>
              <option value="StartsWith">开头匹配</option>
              <option value="ExactMatch">完全匹配</option>
            </select>
          </div>
          <div class="form-inline">
            <label>匹配字节(HEX):</label>
            <input
              class="monospace"
              type="text"
              style="flex:1"
              placeholder="如: AA 55"
            />
          </div>
          <div class="form-inline">
            <label>延迟回复:</label>
            <input type="number" bind:value={$autoSendConfig.trigger.delay_ms} min="0" style="width:100px" />
            <span>ms</span>
          </div>
          <div class="form-inline">
            <label>响应模式:</label>
            <div class="mode-switch-sm">
              <button
                class:active={!$autoSendConfig.trigger.is_hex}
                on:click={() => $autoSendConfig.trigger.is_hex = false}
              >ASCII</button>
              <button
                class:active={$autoSendConfig.trigger.is_hex}
                on:click={() => $autoSendConfig.trigger.is_hex = true}
              >HEX</button>
            </div>
          </div>
          <textarea
            class="monospace"
            rows="3"
            bind:value={$autoSendConfig.trigger.response_data}
            placeholder="匹配成功后自动发送的响应数据"
          />
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
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    width: 720px;
    max-width: 96vw;
    max-height: 92vh;
    display: flex; flex-direction: column;
    overflow: hidden;
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
  .modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
  .modal-footer {
    padding: 12px 20px;
    background: var(--bg-tertiary);
    border-top: 1px solid var(--border-color);
    display: flex; justify-content: flex-end;
  }
  .warn-banner {
    padding: 10px 14px;
    background: rgba(251, 191, 36, 0.15);
    border: 1px solid var(--accent-yellow);
    border-radius: 6px;
    color: var(--accent-yellow);
    margin-bottom: 14px;
    font-size: 13px;
  }
  .as-section {
    margin-bottom: 18px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    overflow: hidden;
  }
  .as-sec-header {
    padding: 10px 14px;
    background: var(--bg-tertiary);
    display: flex; justify-content: space-between; align-items: center;
  }
  .switch-big {
    display: flex; align-items: center; gap: 10px;
    cursor: pointer;
  }
  .as-title { font-weight: 600; font-size: 14px; }
  .sec-right { display: flex; align-items: center; gap: 12px; }
  .check-sm {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px;
  }
  .as-sec-body {
    padding: 14px;
    display: flex; flex-direction: column; gap: 10px;
    transition: opacity 0.2s;
  }
  .as-sec-body.disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  .form-inline {
    display: flex; align-items: center; gap: 10px;
    font-size: 13px;
  }
  .form-inline > label { min-width: 90px; color: var(--text-secondary); }
  .hint { color: var(--text-muted); font-size: 11px; }
  .mode-switch-sm {
    display: inline-flex;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    overflow: hidden;
  }
  .mode-switch-sm button {
    padding: 3px 10px;
    font-size: 11px;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--text-secondary);
  }
  .mode-switch-sm button.active,
  .mode-switch-sm button.sm-active {
    background: var(--accent-blue); color: #fff;
  }
  .texta, textarea { width: 100%; font-size: 12px; resize: vertical; }
  .empty-sm {
    padding: 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
    border: 1px dashed var(--border-color);
    border-radius: 6px;
  }
  .seq-list { display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; }
  .seq-item {
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 8px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .seq-item.running {
    border-color: var(--accent-green);
    box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.15);
  }
  .seq-head {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px;
  }
  .seq-idx {
    padding: 2px 8px;
    background: var(--accent-blue);
    border-radius: 10px;
    font-weight: 700;
    font-size: 10px;
    color: #fff;
  }
  .seq-mode-sm { display: inline-flex; border: 1px solid var(--border-color); border-radius: 3px; overflow: hidden; background: var(--bg-primary); }
  .seq-mode-sm button {
    padding: 1px 6px; font-size: 10px;
    background: transparent; border: none; color: var(--text-secondary);
  }
  .seq-mode-sm button.sm-active { background: var(--accent-cyan); color: #000; }
  .seq-del {
    width: 22px; height: 22px; padding: 0;
    border-radius: 50%;
    background: transparent; border: none;
    color: var(--accent-red); font-size: 16px;
    margin-left: auto;
  }
  .seq-del:hover { background: var(--accent-red); color: #fff; }
</style>

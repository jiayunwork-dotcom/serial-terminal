<script>
  import { onMount } from 'svelte';
  import { validateScript } from '../emulatorCore.js';

  export let scriptText = '';
  export let onApply;
  export let onClose;

  let textareaEl = null;
  let highlightEl = null;
  let errorMessage = '';
  let localText = scriptText;

  function handleInput(e) {
    localText = e.target.value;
    syncScroll();
    errorMessage = '';
  }

  function syncScroll() {
    if (textareaEl && highlightEl) {
      highlightEl.scrollTop = textareaEl.scrollTop;
      highlightEl.scrollLeft = textareaEl.scrollLeft;
    }
  }

  $: highlighted = highlightJson(localText);

  function highlightJson(json) {
    if (!json) return '';
    let escaped = json
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    escaped = escaped.replace(/("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)|([{}[\]])|(,)/g, (match, str, colon, kw, num, bracket, comma) => {
      if (str) {
        const cls = colon ? 'json-key' : 'json-string';
        return '<span class="' + cls + '">' + str + '</span>' + (colon || '');
      }
      if (kw) {
        let cls = 'json-boolean';
        if (kw === 'null') cls = 'json-null';
        return '<span class="' + cls + '">' + kw + '</span>';
      }
      if (num) {
        return '<span class="json-number">' + num + '</span>';
      }
      if (bracket) {
        return '<span class="json-bracket">' + bracket + '</span>';
      }
      if (comma) {
        return '<span class="json-comma">,</span>';
      }
      return match;
    });

    return escaped;
  }

  function handleTab(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textareaEl.selectionStart;
      const end = textareaEl.selectionEnd;
      const value = textareaEl.value;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      localText = newValue;
      setTimeout(() => {
        textareaEl.selectionStart = textareaEl.selectionEnd = start + 2;
      }, 0);
    }
  }

  function doFormat() {
    try {
      const obj = JSON.parse(localText);
      localText = JSON.stringify(obj, null, 2);
      errorMessage = '';
    } catch (e) {
      errorMessage = '格式化失败: ' + e.message;
    }
  }

  function doApply() {
    const result = validateScript(localText);
    if (!result.valid) {
      errorMessage = result.error;
      return;
    }
    errorMessage = '';
    if (onApply) {
      try {
        onApply(localText, result.parsed);
      } catch (e) {
        errorMessage = e.message;
      }
    }
  }

  function doCancel() {
    localText = scriptText;
    errorMessage = '';
    if (onClose) onClose();
  }

  $: if (textareaEl) {
    textareaEl.value = localText;
  }

  onMount(() => {
    localText = scriptText || '';
  });
</script>

<div class="modal-backdrop" on:click|self={doCancel}>
  <div class="modal se-modal">
    <div class="modal-header">
      <h2>📝 设备行为脚本编辑器</h2>
      <button class="close-btn" on:click={doCancel}>×</button>
    </div>
    <div class="modal-body">
      <div class="se-toolbar">
        <button class="btn-sm" on:click={doFormat}>🎨 格式化JSON</button>
        <div class="se-tip">
          💡 类JSON DSL语法：定义 rules 数组，每条规则包含 trigger、action、可选 delay_ms
        </div>
      </div>

      <div class="se-editor-wrap">
        <pre class="se-highlight" bind:this={highlightEl} aria-hidden="true"><code>{@html highlighted}</code></pre>
        <textarea
          class="se-textarea monospace"
          bind:this={textareaEl}
          bind:value={localText}
          on:input={handleInput}
          on:scroll={syncScroll}
          on:keydown={handleTab}
          spellcheck="false"
          placeholder="{`{\"rules\":[{\"id\":\"rule1\",\"trigger\":{\"type\":\"frame_match\",\"pattern\":[0x01,0x03]},\"action\":{\"type\":\"custom\",\"handler\":\"handlerName\"}}]}`}"
        ></textarea>
      </div>

      {#if errorMessage}
        <div class="se-error">
          ❌ {errorMessage}
        </div>
      {/if}

      <div class="se-actions">
        <button class="btn-sm" on:click={doCancel}>取消</button>
        <button class="btn-sm primary" on:click={doApply}>✅ 应用脚本 (热更新)</button>
      </div>

      <div class="se-help">
        <div class="help-title">📖 DSL 语法参考</div>
        <div class="help-grid">
          <div class="help-section">
            <div class="help-h">触发类型 (trigger.type)</div>
            <div class="help-item"><code>startup</code> - 仿真器启动时触发</div>
            <div class="help-item"><code>periodic</code> - 定时触发, 字段: interval_ms 或 interval_ms_ref</div>
            <div class="help-item"><code>frame_match</code> - 字节模式匹配, 字段: pattern, mask, min_length</div>
            <div class="help-item"><code>ascii_match</code> - ASCII前缀匹配, 字段: prefix</div>
            <div class="help-item"><code>ascii_exact</code> - ASCII完全匹配, 字段: text</div>
            <div class="help-item"><code>ascii_contains</code> - ASCII包含匹配, 字段: keyword</div>
          </div>
          <div class="help-section">
            <div class="help-h">动作类型 (action.type)</div>
            <div class="help-item"><code>fixed_response</code> - 发送固定字节, 字段: data(number[])</div>
            <div class="help-item"><code>template_response</code> - 模板响应, 支持 {'${expr}'} 表达式, 字段: data_template</div>
            <div class="help-item"><code>custom</code> - 自定义处理函数, 字段: handler(函数名)</div>
            <div class="help-item"><code>set_state</code> - 仅修改状态, 字段: state_key, state_value</div>
            <div class="help-item"><code>sequence</code> - 动作序列, 字段: steps([{'delay_ms'},{'data/handler'}...])</div>
            <div class="help-item"><code>delay_ms</code> - 任意动作根节点附加延迟发送</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
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
  .modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    width: 90%;
    max-width: 900px;
    max-height: 90vh;
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
  .modal-header h2 {
    font-size: 16px;
    color: var(--text-primary);
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
    border-color: var(--accent-red);
  }
  .modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: auto;
  }
  .se-modal {
    max-width: 920px;
    height: 90vh;
  }
  .se-modal .modal-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .se-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .btn-sm {
    padding: 5px 12px;
    font-size: 12px;
    border: 1px solid var(--border-color);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border-radius: 6px;
  }
  .btn-sm:hover {
    background: var(--accent-blue);
    border-color: var(--accent-blue);
  }
  .btn-sm.primary {
    background: var(--accent-green);
    border-color: var(--accent-green);
    color: #000;
    font-weight: 600;
  }
  .btn-sm.primary:hover {
    background: #22c55e;
    border-color: #22c55e;
  }
  .se-tip {
    font-size: 12px;
    color: var(--text-muted);
  }
  .se-editor-wrap {
    position: relative;
    flex: 1;
    min-height: 260px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    overflow: hidden;
  }
  .se-highlight {
    position: absolute;
    inset: 0;
    padding: 12px;
    margin: 0;
    pointer-events: none;
    overflow: auto;
    white-space: pre;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-primary);
    font-family: var(--font-mono);
    word-break: break-all;
  }
  .se-highlight code {
    background: transparent !important;
    padding: 0 !important;
    font-family: var(--font-mono);
  }
  .se-textarea {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 260px;
    padding: 12px;
    margin: 0;
    border: none;
    background: transparent;
    color: transparent;
    caret-color: var(--accent-cyan);
    resize: none;
    outline: none;
    z-index: 2;
    font-size: 13px;
    line-height: 1.6;
    overflow: auto;
    white-space: pre;
    tab-size: 2;
  }
  .se-textarea:focus {
    border-color: transparent;
  }
  :global(.json-key) { color: #fbbf24; }
  :global(.json-string) { color: #4ade80; }
  :global(.json-number) { color: #22d3ee; }
  :global(.json-boolean) { color: #a78bfa; }
  :global(.json-null) { color: #fb923c; }
  :global(.json-bracket) { color: #f472b6; font-weight: 600; }
  :global(.json-comma) { color: #94a3b8; }
  .se-error {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid var(--accent-red);
    color: var(--accent-red);
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 13px;
  }
  .se-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-shrink: 0;
  }
  .se-help {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 12px;
    flex-shrink: 0;
  }
  .help-title {
    font-size: 12px;
    color: var(--accent-cyan);
    margin-bottom: 8px;
    font-weight: 600;
  }
  .help-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .help-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .help-h {
    font-size: 11px;
    color: var(--accent-yellow);
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .help-item {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.6;
  }
  .help-item code {
    background: var(--bg-input);
    padding: 1px 6px;
    border-radius: 4px;
    color: var(--accent-blue);
    font-family: var(--font-mono);
    font-size: 11px;
    margin-right: 4px;
  }
  @media (max-width: 700px) {
    .help-grid { grid-template-columns: 1fr; }
    .modal { width: 98%; }
  }
</style>

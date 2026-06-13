<script>
  import { getContext } from 'svelte';
  import {
    serialPorts, refreshingPorts, quickCommands, protocolTemplates, uuidv4,
    DEFAULT_BAUD_RATES, DATA_BITS_OPTIONS, STOP_BITS_OPTIONS, PARITY_OPTIONS, FLOW_CONTROL_OPTIONS,
  } from '../stores.js';
  import { openSerialPort, saveQuickCommands } from '../tauriApi.js';

  export let selectedPort = '';
  export let baudRate = 115200;
  export let customBaud = '';
  export let useCustomBaud = false;
  export let dataBits = 'Eight';
  export let stopBits = 'One';
  export let parity = 'None';
  export let flowControl = 'None';
  export let timeout = 100;

  let showCommandEditor = false;
  let newCmdName = '';
  let newCmdGroup = '';
  let newCmdData = '';
  let newCmdIsHex = true;

  const handlePortOpened = getContext('handlePortOpened');

  async function openCurrentPort() {
    if (!selectedPort) {
      alert('请先选择串口');
      return;
    }
    const actualBaud = useCustomBaud ? parseInt(customBaud) : baudRate;
    if (!actualBaud || actualBaud < 300) {
      alert('请输入有效的波特率');
      return;
    }
    const config = {
      baud_rate: actualBaud,
      data_bits: dataBits,
      stop_bits: stopBits,
      parity,
      flow_control: flowControl,
      timeout_ms: timeout,
    };
    try {
      const portId = await openSerialPort(selectedPort, config);
      handlePortOpened(portId, selectedPort, config);
    } catch (e) {
      alert('打开串口失败: ' + (e.message || e));
    }
  }

  function addQuickCommand() {
    showCommandEditor = !showCommandEditor;
  }

  function saveNewCmd() {
    if (!newCmdName || !newCmdData) return;
    const cmd = {
      id: uuidv4(),
      name: newCmdName,
      group: newCmdGroup || '默认',
      data: newCmdData,
      is_hex: newCmdIsHex,
      shortcut: null,
    };
    $quickCommands = [...$quickCommands, cmd];
    saveQuickCommands($quickCommands);
    newCmdName = ''; newCmdData = ''; newCmdGroup = '';
    showCommandEditor = false;
  }

  function deleteCmd(id) {
    if (!confirm('删除该快捷命令?')) return;
    $quickCommands = $quickCommands.filter(c => c.id !== id);
    saveQuickCommands($quickCommands);
  }

  $: groupedCommands = (() => {
    const g = {};
    for (const c of $quickCommands) {
      if (!g[c.group]) g[c.group] = [];
      g[c.group].push(c);
    }
    return g;
  })();
</script>

<aside class="sidebar">
  <div class="side-section">
    <div class="side-title">
      <span>🔌 串口配置</span>
    </div>

    <div class="form-group">
      <label>串口号</label>
      <select bind:value={selectedPort}>
        <option value="">-- 选择串口 --</option>
        {#each $serialPorts as p}
          <option value={p.name}>
            {p.display_name}
            {#if p.manufacturer} ({p.manufacturer}){/if}
          </option>
        {/each}
      </select>
    </div>

    <div class="form-group">
      <label>波特率</label>
      {#if !useCustomBaud}
        <select bind:value={baudRate}>
          {#each DEFAULT_BAUD_RATES as r}
            <option value={r}>{r}</option>
          {/each}
        </select>
      {:else}
        <input type="number" bind:value={customBaud} placeholder="自定义波特率" />
      {/if}
      <label class="check-row">
        <input type="checkbox" bind:checked={useCustomBaud} />
        <span>自定义</span>
      </label>
    </div>

    <div class="form-row-two">
      <div class="form-group">
        <label>数据位</label>
        <select bind:value={dataBits}>
          {#each DATA_BITS_OPTIONS as d}
            <option value={d === 5 ? 'Five' : d === 6 ? 'Six' : d === 7 ? 'Seven' : 'Eight'}>{d}</option>
          {/each}
        </select>
      </div>
      <div class="form-group">
        <label>停止位</label>
        <select bind:value={stopBits}>
          {#each STOP_BITS_OPTIONS as s}
            <option value={s.value}>{s.label}</option>
          {/each}
        </select>
      </div>
    </div>

    <div class="form-group">
      <label>校验位</label>
      <select bind:value={parity}>
        {#each PARITY_OPTIONS as p}
          <option value={p.value}>{p.label}</option>
        {/each}
      </select>
    </div>

    <div class="form-group">
      <label>流控</label>
      <select bind:value={flowControl}>
        {#each FLOW_CONTROL_OPTIONS as f}
          <option value={f.value}>{f.label}</option>
        {/each}
      </select>
    </div>

    <div class="form-group">
      <label>超时 (ms)</label>
      <input type="number" bind:value={timeout} min="10" step="10" />
    </div>

    <button class="open-btn" on:click={openCurrentPort}>
      ⚡ 打开串口
    </button>
  </div>

  <div class="side-section expandable">
    <div class="side-title">
      <span>⚡ 快捷命令</span>
      <button class="mini-btn" on:click={addQuickCommand}>+</button>
    </div>

    {#if showCommandEditor}
      <div class="cmd-editor">
        <input bind:value={newCmdName} placeholder="名称" />
        <input bind:value={newCmdGroup} placeholder="分组 (可选)" />
        <textarea bind:value={newCmdData} rows="2" placeholder={newCmdIsHex ? 'HEX: AA 55 01 02' : 'ASCII文本'} />
        <label class="check-row">
          <input type="checkbox" bind:checked={newCmdIsHex} />
          <span>HEX格式</span>
        </label>
        <div class="editor-actions">
          <button class="btn-sm" on:click={() => showCommandEditor = false}>取消</button>
          <button class="btn-sm primary" on:click={saveNewCmd}>保存</button>
        </div>
      </div>
    {/if}

    <div class="cmd-groups">
      {#if Object.keys(groupedCommands).length === 0}
        <div class="empty-sb">暂无快捷命令，点击 + 添加</div>
      {/if}
      {#each Object.entries(groupedCommands) as [group, cmds]}
        <div class="cmd-group">
          <div class="cmd-group-title">{group}</div>
          <div class="cmd-buttons">
            {#each cmds as cmd}
              <div class="cmd-btn-wrap" title={cmd.is_hex ? 'HEX: ' + cmd.data : 'ASCII: ' + cmd.data}>
                <button class="cmd-btn" data-cmd-id={cmd.id}>
                  <span class="cmd-name">{cmd.name}</span>
                  <span class="cmd-tag">{cmd.is_hex ? 'HEX' : 'ASC'}</span>
                </button>
                <button class="cmd-del" on:click={() => deleteCmd(cmd.id)} title="删除">×</button>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
</aside>

<style>
  .sidebar {
    width: 280px;
    min-width: 260px;
    max-width: 340px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-color);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .side-section {
    padding: 12px;
    border-bottom: 1px solid var(--border-color);
  }
  .side-section.expandable {
    flex: 1;
    overflow-y: auto;
  }
  .side-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    font-weight: 600;
    color: var(--text-primary);
    font-size: 13px;
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
  .form-row-two {
    display: flex;
    gap: 8px;
  }
  .form-row-two .form-group {
    flex: 1;
  }
  .check-row {
    display: flex !important;
    align-items: center;
    gap: 6px;
    flex-direction: row !important;
    font-size: 12px !important;
    text-transform: none !important;
    letter-spacing: 0 !important;
    color: var(--text-primary) !important;
  }
  .check-row input {
    width: auto;
  }
  .open-btn {
    width: 100%;
    padding: 10px;
    background: linear-gradient(135deg, var(--accent-blue), #6366f1);
    border: none;
    color: #fff;
    font-weight: 600;
    border-radius: var(--radius-sm);
    margin-top: 6px;
    transition: all 0.2s;
  }
  .open-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(74, 158, 255, 0.4);
  }
  .mini-btn {
    width: 26px;
    height: 26px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: bold;
    border-radius: 50%;
    background: var(--accent-blue);
    border: none;
    color: #fff;
  }
  .mini-btn:hover {
    background: #3a8eef;
  }
  .cmd-editor {
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cmd-editor input, .cmd-editor textarea {
    width: 100%;
    font-size: 12px;
  }
  .editor-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .btn-sm {
    padding: 4px 12px;
    font-size: 12px;
  }
  .btn-sm.primary {
    background: var(--accent-green);
    color: #000;
    border-color: var(--accent-green);
  }
  .cmd-groups {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .empty-sb {
    padding: 20px;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
  }
  .cmd-group-title {
    font-size: 11px;
    color: var(--accent-cyan);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .cmd-buttons {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .cmd-btn-wrap {
    display: flex;
    gap: 4px;
  }
  .cmd-btn {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 7px 10px;
    font-size: 12px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    text-align: left;
    cursor: pointer;
  }
  .cmd-btn:hover {
    background: var(--accent-blue);
    border-color: var(--accent-blue);
    color: #fff;
  }
  .cmd-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cmd-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    color: var(--accent-cyan);
    font-weight: 600;
    flex-shrink: 0;
  }
  .cmd-btn:hover .cmd-tag {
    background: rgba(255,255,255,0.2);
    color: #fff;
  }
  .cmd-del {
    width: 24px;
    padding: 0;
    font-size: 14px;
    color: var(--accent-red);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .cmd-del:hover {
    background: var(--accent-red);
    color: #fff;
    border-color: var(--accent-red);
  }
</style>

<script>
  import { onMount } from 'svelte';
  import { CHECKSUM_ALGORITHM_OPTIONS, bytesToHex, hexToBytes } from '../stores.js';
  import { calcChecksum } from '../tauriApi.js';

  export let onClose;

  let hexInput = '01 03 00 00 00 0A';
  let selectedAlgo = 'CRC16Modbus';
  let result = null;
  let calcError = null;

  let crc8Poly = '07';
  let crc8Init = '00';
  let crc8RefIn = false;
  let crc8RefOut = false;
  let crc8XorOut = '00';

  let algoPresets = {
    'CRC16Modbus': '多项式 0x8005, 初值 0xFFFF, 输入/输出反转',
    'CRC16CCITT': '多项式 0x1021, 初值 0x0000, 不反转',
    'CRC32': '多项式 0x04C11DB7, 初值 0xFFFFFFFF, 反转',
    'LRC': '各字节求和取补码',
    'BCC': '所有字节异或',
    'Checksum8': '累加和取低字节',
  };

  async function calculate() {
    const bytes = hexToBytes(hexInput);
    if (bytes.length === 0) {
      calcError = '请输入有效的HEX数据';
      result = null;
      return;
    }
    calcError = null;

    let algorithm;
    if (selectedAlgo === 'CRC8') {
      algorithm = {
        CRC8: {
          polynomial: parseInt(crc8Poly, 16) || 0x07,
          initial_value: parseInt(crc8Init, 16) || 0,
          input_reflected: crc8RefIn,
          output_reflected: crc8RefOut,
          final_xor: parseInt(crc8XorOut, 16) || 0,
        }
      };
    } else if (selectedAlgo === 'CRC16Modbus') {
      algorithm = 'CRC16Modbus';
    } else if (selectedAlgo === 'CRC16CCITT') {
      algorithm = 'CRC16CCITT';
    } else if (selectedAlgo === 'CRC32') {
      algorithm = 'CRC32';
    } else if (selectedAlgo === 'LRC') {
      algorithm = 'LRC';
    } else if (selectedAlgo === 'BCC') {
      algorithm = 'BCC';
    } else {
      algorithm = 'Checksum8';
    }

    try {
      result = await calcChecksum(bytes, algorithm);
    } catch (e) {
      calcError = '计算失败: ' + e.message;
      result = null;
    }
  }

  $: {
    if (hexInput || selectedAlgo) {
      calculate();
    }
  }

  function copyText(text) {
    navigator.clipboard.writeText(text);
  }
</script>

<div class="modal-backdrop" on:click|self={onClose}>
  <div class="modal checksum-modal" on:keydown={(e) => e.key === 'Escape' && onClose()}>
    <div class="modal-header">
      <h2>🧮 校验计算器</h2>
      <button class="close-btn" on:click={onClose}>×</button>
    </div>
    <div class="modal-body">
      <div class="cs-section">
        <label>输入HEX字节 (空格分隔)</label>
        <textarea
          bind:value={hexInput}
          rows="3"
          class="monospace"
          placeholder="如: 01 03 00 00 00 0A"
        />
      </div>

      <div class="cs-section">
        <label>校验算法</label>
        <select bind:value={selectedAlgo}>
          {#each CHECKSUM_ALGORITHM_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
        <div class="preset-hint">{algoPresets[selectedAlgo] || ''}</div>
      </div>

      {#if selectedAlgo === 'CRC8'}
        <div class="crc8-config">
          <div class="form-row-3">
            <div>
              <label>多项式</label>
              <input bind:value={crc8Poly} placeholder="07" />
            </div>
            <div>
              <label>初始值</label>
              <input bind:value={crc8Init} placeholder="00" />
            </div>
            <div>
              <label>最终异或</label>
              <input bind:value={crc8XorOut} placeholder="00" />
            </div>
          </div>
          <div class="check-row-wrap">
            <label class="check-row">
              <input type="checkbox" bind:checked={crc8RefIn} />
              <span>输入反转</span>
            </label>
            <label class="check-row">
              <input type="checkbox" bind:checked={crc8RefOut} />
              <span>输出反转</span>
            </label>
          </div>
        </div>
      {/if}

      {#if calcError}
        <div class="calc-error">⚠ {calcError}</div>
      {/if}

      {#if result}
        <div class="result-section">
          <h3>计算结果</h3>
          <div class="result-grid">
            <div class="result-item">
              <span class="r-label">算法</span>
              <span class="r-value">{result.algorithm}</span>
            </div>
            <div class="result-item">
              <span class="r-label">HEX值</span>
              <span class="r-value monospace accent-copy" on:click={() => copyText(result.hex)}>
                {result.hex} 📋
              </span>
            </div>
            <div class="result-item">
              <span class="r-label">十进制</span>
              <span class="r-value monospace">{result.value}</span>
            </div>
            <div class="result-item">
              <span class="r-label">字节序列</span>
              <span class="r-value monospace accent-copy" on:click={() => copyText(bytesToHex(result.bytes))}>
                {bytesToHex(result.bytes)} 📋
              </span>
            </div>
          </div>
          <div class="result-tip">
            💡 提示: 点击HEX或字节序列可以复制到剪贴板
          </div>
        </div>
      {/if}
    </div>
    <div class="modal-footer">
      <button on:click={onClose}>关闭</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }
  .modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    width: 560px;
    max-width: 95vw;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  .checksum-modal:focus { outline: none; }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
  }
  .modal-header h2 {
    font-size: 18px;
    font-weight: 600;
  }
  .close-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: transparent;
    border: none;
    font-size: 24px;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .close-btn:hover {
    background: var(--accent-red);
    color: #fff;
  }
  .modal-body {
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .cs-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cs-section label {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 600;
  }
  .preset-hint {
    font-size: 11px;
    color: var(--accent-cyan);
    background: var(--bg-input);
    padding: 6px 10px;
    border-radius: 4px;
  }
  .crc8-config {
    background: var(--bg-input);
    padding: 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .form-row-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
  }
  .form-row-3 > div { display: flex; flex-direction: column; gap: 4px; }
  .form-row-3 label { font-size: 11px; }
  .check-row-wrap {
    display: flex;
    gap: 20px;
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .calc-error {
    padding: 10px 14px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid var(--accent-red);
    border-radius: 6px;
    color: var(--accent-red);
    font-size: 13px;
  }
  .result-section {
    background: var(--bg-input);
    padding: 16px;
    border-radius: 8px;
    border: 1px solid var(--accent-green);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .result-section h3 {
    color: var(--accent-green);
    font-size: 14px;
  }
  .result-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .result-item {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .r-label {
    min-width: 80px;
    color: var(--text-secondary);
    font-size: 12px;
  }
  .r-value {
    flex: 1;
    font-size: 13px;
    padding: 4px 10px;
    background: var(--bg-tertiary);
    border-radius: 4px;
  }
  .accent-copy {
    cursor: pointer;
    color: var(--accent-cyan);
    transition: color 0.15s;
  }
  .accent-copy:hover {
    color: var(--accent-green);
  }
  .result-tip {
    font-size: 11px;
    color: var(--text-muted);
    text-align: center;
    padding-top: 4px;
  }
  .modal-footer {
    padding: 12px 20px;
    background: var(--bg-tertiary);
    border-top: 1px solid var(--border-color);
    display: flex;
    justify-content: flex-end;
  }
</style>

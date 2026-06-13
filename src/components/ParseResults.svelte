<script>
  import { formatTimestamp, bytesToHex } from '../stores.js';
  import { showSaveDialog } from '../tauriApi.js';

  export let parseResults = [];
  export let protocol;

  let selectedFrameId = null;
  let filterValue = '';
  let exporting = false;

  $: sortedResults = [...parseResults].sort((a, b) => b.timestamp - a.timestamp);

  $: filteredResults = filterValue
    ? sortedResults.filter(f => {
        const search = filterValue.toLowerCase();
        return f.fields.some(fd =>
          fd.parsed_value.toLowerCase().includes(search) ||
          fd.name.toLowerCase().includes(search)
        ) || bytesToHex(f.raw_data).toLowerCase().includes(search);
      })
    : sortedResults;

  function selectFrame(id) {
    selectedFrameId = selectedFrameId === id ? null : id;
  }

  function copyRawHex(f) {
    navigator.clipboard.writeText(bytesToHex(f.raw_data));
  }

  function buildExportData() {
    return sortedResults.map(frame => ({
      timestamp: frame.timestamp,
      timestamp_str: new Date(frame.timestamp).toLocaleString(),
      frame_length: frame.frame_length,
      raw_hex: bytesToHex(frame.raw_data),
      raw_bytes: Array.from(frame.raw_data || []),
      checksum_valid: frame.checksum_valid,
      error_message: frame.error_message || null,
      protocol_name: protocol?.name || null,
      fields: frame.fields.map(f => ({
        name: f.name,
        field_type: f.field_type,
        offset: f.offset,
        length: f.length,
        raw_hex: bytesToHex(f.raw_bytes),
        raw_bytes: Array.from(f.raw_bytes || []),
        parsed_value: f.parsed_value,
      })),
    }));
  }

  async function doExportJson() {
    if (parseResults.length === 0) {
      alert('暂无解析数据可导出');
      return;
    }
    try {
      exporting = true;
      const exportData = {
        export_time: new Date().toISOString(),
        protocol: protocol?.name || null,
        total_frames: sortedResults.length,
        frames: buildExportData(),
      };

      const jsonStr = JSON.stringify(exportData, null, 2);

      let savePath = null;
      try {
        const defaultName = `protocol_frames_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const dlg = await showSaveDialog({
          defaultPath: defaultName,
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
        });
        if (dlg) {
          savePath = typeof dlg === 'string' ? dlg : (dlg.file || dlg.path || null);
        }
      } catch (e) {}

      if (savePath) {
        try {
          const { invoke } = window.__TAURI__ || {};
          if (invoke) {
            await invoke('write_text_file', { path: savePath, content: jsonStr });
          }
          alert('导出成功: ' + savePath);
        } catch (e) {
          exportToBrowserDownload(jsonStr);
        }
      } else {
        exportToBrowserDownload(jsonStr);
      }
    } catch (e) {
      console.error('导出失败', e);
      alert('导出失败: ' + (e.message || e));
    } finally {
      exporting = false;
    }
  }

  function exportToBrowserDownload(jsonStr) {
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `protocol_frames_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    alert('已开始下载JSON文件');
  }
</script>

<div class="parse-panel panel">
  <div class="panel-header">
    <span>📋 协议帧解析结果 ({parseResults.length})</span>
    <div class="panel-header-right">
      <button
        class="export-btn"
        on:click={doExportJson}
        disabled={exporting || parseResults.length === 0}
        title="导出所有解析帧为JSON文件"
      >
        {exporting ? '导出中...' : '📤 导出'}
      </button>
      <input
        class="filter-input"
        placeholder="🔍 搜索..."
        bind:value={filterValue}
      />
    </div>
  </div>
  <div class="panel-body parse-body">
    {#if parseResults.length === 0}
      <div class="no-frames">等待接收数据进行帧解析...</div>
    {:else}
      <div class="frames-scroll">
        {#each filteredResults as frame (frame.frame_id)}
          <div
            class="frame-card"
            class:selected={selectedFrameId === frame.frame_id}
            class:error={!frame.checksum_valid}
            on:click={() => selectFrame(frame.frame_id)}
          >
            <div class="frame-header">
              <span class="frame-time">{formatTimestamp(frame.timestamp)}</span>
              <span class="frame-len">{frame.frame_length}B</span>
              {#if !frame.checksum_valid}
                <span class="badge badge-error">CRC错误</span>
              {:else}
                <span class="badge badge-ok">OK</span>
              {/if}
              <button class="mini-copy" on:click|stopPropagation={() => copyRawHex(frame)} title="复制HEX">📋</button>
            </div>
            <div class="frame-visual">
              {#each frame.fields as field}
                <span
                  class="field-seg"
                  style="background:{field.color}"
                  title="{field.name}: {field.parsed_value} ({field.length}B)"
                >
                  <span class="field-seg-name">{field.name}</span>
                </span>
              {/each}
            </div>
            {#if selectedFrameId === frame.frame_id}
              <div class="frame-detail">
                <div class="detail-row raw-row">
                  <span class="detail-label">原始HEX:</span>
                  <span class="detail-val monospace">{bytesToHex(frame.raw_data)}</span>
                </div>
                <table class="fields-table">
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>类型</th>
                      <th>偏移</th>
                      <th>长度</th>
                      <th>原始值</th>
                      <th>解析值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each frame.fields as f}
                      <tr style="background:{f.color}">
                        <td><strong>{f.name}</strong></td>
                        <td>{f.field_type}</td>
                        <td>{f.offset}</td>
                        <td>{f.length}B</td>
                        <td class="monospace">{bytesToHex(f.raw_bytes)}</td>
                        <td class="monospace">{f.parsed_value}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
                {#if frame.error_message}
                  <div class="parse-error">⚠ {frame.error_message}</div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .parse-panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .panel-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .export-btn {
    padding: 4px 12px;
    font-size: 12px;
    background: var(--accent-green);
    color: #000;
    border-color: var(--accent-green);
    font-weight: 600;
  }
  .export-btn:hover:not(:disabled) {
    background: #22c55e;
    border-color: #22c55e;
  }
  .filter-input {
    font-size: 12px;
    padding: 4px 10px;
    width: 160px;
  }
  .parse-body {
    flex: 1;
    overflow: hidden;
    padding: 10px;
  }
  .frames-scroll {
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .no-frames {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }
  .frame-card {
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 10px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .frame-card:hover {
    border-color: var(--accent-blue);
  }
  .frame-card.selected {
    border-color: var(--accent-blue);
    box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.2);
  }
  .frame-card.error {
    border-color: var(--accent-red);
    background: rgba(239, 68, 68, 0.08);
  }
  .frame-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    font-size: 12px;
  }
  .frame-time {
    color: var(--text-muted);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }
  .frame-len {
    padding: 1px 8px;
    background: var(--bg-tertiary);
    border-radius: 10px;
    font-size: 11px;
    color: var(--accent-cyan);
    font-family: var(--font-mono);
  }
  .badge {
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
  }
  .badge-ok { background: var(--accent-green); color: #000; }
  .badge-error { background: var(--accent-red); color: #fff; }
  .mini-copy {
    margin-left: auto;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 12px;
  }
  .mini-copy:hover {
    background: var(--bg-tertiary);
    border-color: var(--border-color);
  }
  .frame-visual {
    display: flex;
    gap: 2px;
    flex-wrap: wrap;
    border-radius: 4px;
    overflow: hidden;
  }
  .field-seg {
    padding: 4px 8px;
    font-size: 11px;
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    min-height: 24px;
  }
  .field-seg-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .frame-detail {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--border-color);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .detail-row {
    display: flex;
    gap: 10px;
    font-size: 12px;
  }
  .detail-label {
    color: var(--text-secondary);
    min-width: 80px;
    flex-shrink: 0;
  }
  .detail-val {
    flex: 1;
    word-break: break-all;
    color: var(--accent-cyan);
    font-size: 11px;
  }
  .fields-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .fields-table th, .fields-table td {
    padding: 5px 8px;
    text-align: left;
    border: 1px solid var(--border-color);
  }
  .fields-table th {
    background: var(--bg-tertiary);
    font-size: 11px;
    color: var(--text-secondary);
  }
  .parse-error {
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid var(--accent-red);
    border-radius: 4px;
    color: var(--accent-red);
    font-size: 12px;
  }
</style>

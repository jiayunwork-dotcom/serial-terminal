<script>
  import { onMount, onDestroy, afterUpdate } from 'svelte';
  import {
    monitorFields, monitorData, monitorPaused, monitorAutoScale,
    protocolTemplates, openTabs, activeTabId, uuidv4
  } from '../stores.js';

  export let onClose;

  let chartEl = null;
  let chartCanvas = null;
  let chartInstance = null;
  let chartReady = false;

  const CHART_COLORS = ['#4a9eff', '#4ade80', '#fbbf24', '#a78bfa', '#fb923c', '#22d3ee'];
  const MAX_DATA_POINTS = 500;

  $: activeTab = $openTabs.find(t => t.id === $activeTabId);
  $: tabProtocolId = activeTab?.selectedProtocolId;
  $: tabProtocol = $protocolTemplates.find(p => p.id === tabProtocolId);
  $: numericFields = tabProtocol?.fields?.filter(f =>
    ['UInt8','UInt16BE','UInt16LE','UInt32BE','UInt32LE','Int8','Int16BE','Int16LE','Float32BE','Float32LE'].includes(f.field_type)
  ) || [];

  function addMonitorField(field) {
    if ($monitorFields.length >= 4) {
      alert('最多只能同时监控 4 个字段');
      return;
    }
    if ($monitorFields.some(f => f.field_name === field.name && f.protocol_id === tabProtocolId)) return;
    const idx = $monitorFields.length;
    $monitorFields = [...$monitorFields, {
      id: uuidv4(),
      field_name: field.name,
      protocol_id: tabProtocolId,
      color: CHART_COLORS[idx % CHART_COLORS.length],
      enabled: true,
    }];
  }

  function removeField(id) {
    $monitorFields = $monitorFields.filter(f => f.id !== id);
    const filteredData = $monitorData.filter(d =>
      $monitorFields.some(f => f.id === d.field_id)
    );
    $monitorData = filteredData;
  }

  function toggleField(id) {
    $monitorFields = $monitorFields.map(f =>
      f.id === id ? { ...f, enabled: !f.enabled } : f
    );
  }

  function clearData() {
    $monitorData = [];
  }

  function addMockData() {
    const now = Date.now();
    for (const f of $monitorFields) {
      const base = Math.random() * 50 + 20;
      $monitorData = [...$monitorData, { timestamp: now, value: base, field_id: f.id }];
    }
  }

  async function loadChart() {
    try {
      const ChartModule = await import('chart.js');
      const { Chart, registerables } = ChartModule;
      Chart.register(...registerables);

      try {
        const dateAdapter = await import('chartjs-adapter-date-fns');
        if (dateAdapter && Chart._adapters) {
          // auto registered
        }
      } catch(e) { console.warn('date adapter not available'); }

      initChart(Chart);
      chartReady = true;
    } catch(e) {
      console.warn('Chart.js not available', e);
    }
  }

  function initChart(Chart) {
    if (!chartCanvas) return;
    if (chartInstance) chartInstance.destroy();
    const ctx = chartCanvas.getContext('2d');
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: $monitorFields.map(f => ({
          label: f.field_name,
          data: [],
          borderColor: f.color,
          backgroundColor: f.color + '20',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: false,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          mode: 'nearest',
          intersect: false,
        },
        scales: {
          x: {
            type: 'linear',
            display: true,
            title: { display: true, text: '时间 (ms)', color: '#a0a0b0' },
            ticks: { color: '#a0a0b0', maxTicksLimit: 8 },
            grid: { color: '#2a3a5a' },
          },
          y: {
            display: true,
            title: { display: true, text: '数值', color: '#a0a0b0' },
            ticks: { color: '#a0a0b0' },
            grid: { color: '#2a3a5a' },
          },
        },
        plugins: {
          legend: {
            labels: { color: '#e8e8e8', font: { size: 12 } },
            onClick: (e, legendItem, legend) => {
              const idx = legendItem.datasetIndex;
              const f = $monitorFields[idx];
              if (f) toggleField(f.id);
            },
          },
          tooltip: {
            backgroundColor: '#16213e',
            titleColor: '#e8e8e8',
            bodyColor: '#a0a0b0',
            borderColor: '#2a3a5a',
            borderWidth: 1,
          },
        },
      },
    });
  }

  function updateChart() {
    if (!chartInstance) return;
    const baseTs = $monitorData.length > 0 ? $monitorData[0].timestamp : Date.now();

    chartInstance.data.datasets = $monitorFields.map((f, i) => {
      const points = $monitorData
        .filter(d => d.field_id === f.id)
        .slice(-MAX_DATA_POINTS)
        .map(d => ({ x: d.timestamp - baseTs, y: d.value }));
      const existing = chartInstance.data.datasets[i] || {};
      return {
        ...existing,
        label: f.field_name,
        data: points,
        borderColor: f.color,
        backgroundColor: f.color + '20',
        borderWidth: 2,
        hidden: !f.enabled,
      };
    });
    chartInstance.update('none');
  }

  $: {
    if (chartReady) updateChart();
  }

  $: {
    if (activeTab?.parseResults?.length > 0 && !$monitorPaused) {
      const results = activeTab.parseResults;
      const lastResult = results[results.length - 1];
      if (lastResult && lastResult.__monitorProcessed !== true) {
        const ts = lastResult.timestamp;
        const fields = lastResult.fields;
        const newPoints = [];
        for (const mf of $monitorFields) {
          const matched = fields.find(f => f.name === mf.field_name);
          if (matched) {
            const v = parseFloat(matched.parsed_value?.replace(/^0x/, '')) || 0;
            const dec = matched.field_type.startsWith('UInt') || matched.field_type.startsWith('Int')
              ? (matched.parsed_value.startsWith('0x')
                  ? parseInt(matched.parsed_value.slice(2), 16)
                  : parseInt(matched.parsed_value) || 0)
              : v;
            newPoints.push({ timestamp: ts, value: isNaN(dec) ? 0 : dec, field_id: mf.id });
          }
        }
        if (newPoints.length > 0) {
          $monitorData = [...$monitorData, ...newPoints];
        }
        lastResult.__monitorProcessed = true;
      }
    }
  }

  onMount(async () => {
    await loadChart();
  });

  onDestroy(() => {
    if (chartInstance) chartInstance.destroy();
  });
</script>

<div class="modal-backdrop" on:click|self={onClose}>
  <div class="modal mon-modal">
    <div class="modal-header">
      <h2>📈 实时数据监控</h2>
      <button class="close-btn" on:click={onClose}>×</button>
    </div>
    <div class="modal-body mon-body">
      <div class="mon-config-row">
        <div class="field-selector">
          <label>添加监控字段:</label>
          {#if numericFields.length === 0}
            <span class="hint-gray">当前标签页未选择含数值字段的协议</span>
          {:else}
            <div class="field-chips">
              {#each numericFields as f}
                {@const already = $monitorFields.some(m => m.field_name === f.name && m.protocol_id === tabProtocolId)}
                <button
                  class="chip-btn"
                  class:disabled={already || $monitorFields.length >= 4}
                  disabled={already || $monitorFields.length >= 4}
                  on:click={() => addMonitorField(f)}
                >
                  + {f.name} ({f.field_type})
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="mon-controls">
          <label class="check-row">
            <input type="checkbox" bind:checked={$monitorPaused} />
            <span>{$monitorPaused ? '▶ 继续' : '⏸ 暂停'}</span>
          </label>
          <label class="check-row">
            <input type="checkbox" bind:checked={$monitorAutoScale} />
            <span>自动缩放Y轴</span>
          </label>
          <button class="btn-sm" on:click={clearData}>清空数据</button>
          <button class="btn-sm" on:click={addMockData} title="开发测试用">模拟数据</button>
        </div>
      </div>

      <div class="mon-field-list">
        {#if $monitorFields.length === 0}
          <div class="mon-empty">请选择要监控的字段（最多4个）</div>
        {:else}
          {#each $monitorFields as f}
            <div class="mon-field-item" style="border-left: 4px solid {f.color}">
              <label class="check-row">
                <input type="checkbox" checked={f.enabled} on:change={() => toggleField(f.id)} />
                <span style="font-weight:600;color:{f.color}">{f.field_name}</span>
              </label>
              <span class="field-meta">{tabProtocol?.name || '未知协议'}</span>
              <button class="mini-btn-sm" on:click={() => removeField(f.id)}>✕</button>
            </div>
          {/each}
        {/if}
      </div>

      <div class="chart-container" bind:this={chartEl}>
        <canvas bind:this={chartCanvas}></canvas>
      </div>

      <div class="mon-stats">
        <span>📊 总数据点: {$monitorData.length}</span>
        <span>📐 显示上限: {MAX_DATA_POINTS}</span>
        {#if $monitorData.length > 0}
          <span>🕒 跨度: {
            Math.round(($monitorData[$monitorData.length - 1].timestamp - $monitorData[0].timestamp) / 1000)
          }s</span>
        {/if}
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
    width: 900px; max-width: 98vw; max-height: 92vh;
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
    padding: 16px 20px; overflow-y: auto; flex: 1;
    display: flex; flex-direction: column; gap: 14px;
  }
  .modal-footer {
    padding: 12px 20px;
    background: var(--bg-tertiary);
    border-top: 1px solid var(--border-color);
    display: flex; justify-content: flex-end;
  }
  .mon-config-row {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 20px; flex-wrap: wrap;
    padding: 12px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 8px;
  }
  .field-selector {
    display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 300px;
  }
  .field-selector label { font-size: 12px; color: var(--text-secondary); font-weight: 600; }
  .hint-gray { color: var(--text-muted); font-size: 12px; padding: 6px 0; }
  .field-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip-btn {
    padding: 4px 10px;
    font-size: 11px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 20px;
    transition: all 0.15s;
  }
  .chip-btn:hover:not(:disabled) {
    background: var(--accent-blue);
    border-color: var(--accent-blue);
    color: #fff;
  }
  .chip-btn.disabled, .chip-btn:disabled {
    opacity: 0.4; cursor: not-allowed;
  }
  .mon-controls { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
  .check-row { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .btn-sm { padding: 4px 10px; font-size: 12px; }
  .mon-field-list {
    display: flex; gap: 8px; flex-wrap: wrap;
  }
  .mon-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
    width: 100%;
    border: 1px dashed var(--border-color);
    border-radius: 8px;
  }
  .mon-field-item {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 10px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: 12px;
  }
  .field-meta {
    color: var(--text-muted);
    font-size: 11px;
    padding: 1px 6px;
    background: var(--bg-tertiary);
    border-radius: 3px;
  }
  .mini-btn-sm {
    width: 22px; height: 22px; padding: 0;
    border-radius: 50%;
    background: transparent; border: none;
    color: var(--accent-red); font-size: 12px;
  }
  .mini-btn-sm:hover { background: var(--accent-red); color: #fff; }
  .chart-container {
    flex: 1;
    min-height: 320px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 12px;
    position: relative;
  }
  .mon-stats {
    display: flex; gap: 20px;
    font-size: 12px;
    color: var(--text-secondary);
    padding: 8px 12px;
    background: var(--bg-input);
    border-radius: 6px;
    font-family: var(--font-mono);
  }
</style>

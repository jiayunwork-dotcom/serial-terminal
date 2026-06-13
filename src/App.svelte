<script>
  import { onMount, onDestroy, setContext } from 'svelte';
  import {
    serialPorts, refreshingPorts, openTabs, activeTabId, statusBarData,
    showChecksumTool, showAutoSend, showMonitor, showLogPanel, showProtocolEditor, sidebarOpen,
    quickCommands, protocolTemplates, uuidv4, formatTimestamp, DEFAULT_BAUD_RATES
  } from './stores.js';
  import {
    setTauriApis, tauriListen, listSerialPorts, openSerialPort, closeSerialPort, sendSerialData,
    loadQuickCommands, loadProtocolTemplates, getBuiltinProtocols
  } from './tauriApi.js';
  import TopBar from './components/TopBar.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import TabBar from './components/TabBar.svelte';
  import SerialTab from './components/SerialTab.svelte';
  import ChecksumTool from './components/ChecksumTool.svelte';
  import ProtocolEditor from './components/ProtocolEditor.svelte';
  import AutoSendPanel from './components/AutoSendPanel.svelte';
  import MonitorPanel from './components/MonitorPanel.svelte';
  import LogPanel from './components/LogPanel.svelte';

  let unsubs = [];
  let tauriAvailable = false;

  async function refreshPorts() {
    $refreshingPorts = true;
    try {
      const ports = await listSerialPorts();
      $serialPorts = ports;
    } finally {
      $refreshingPorts = false;
    }
  }

  function handlePortOpened(portId, portName, config) {
    const tab = {
      id: portId,
      portName: portName,
      config: config,
      connected: true,
      txBytes: 0,
      rxBytes: 0,
      error: null,
      terminalLines: [],
      displayMode: 'Mixed',
      filterMode: 'Off',
      filterValue: '',
      autoScroll: true,
      sendMode: 'Ascii',
      sendContent: '',
      sendHistory: [],
      parseEnabled: false,
      selectedProtocolId: null,
      parseResults: [],
      droppedFrames: 0,
      crcErrors: 0,
      buffer: [],
    };
    $openTabs = [...$openTabs, tab];
    $activeTabId = portId;
    updateStatusBar();
  }

  function handlePortClosed(portId) {
    $openTabs = $openTabs.map(t =>
      t.id === portId ? { ...t, connected: false, error: '连接已关闭' } : t
    );
    updateStatusBar();
  }

  function handleSerialData(evt) {
    const { portId, portName, direction, timestamp, data } = evt.payload || evt;
    const dirLabel = direction === 'Rx' || direction === 0 ? 'Rx' : 'Tx';
    const realPortId = portId || (evt.payload && evt.payload.port_id);

    $openTabs = $openTabs.map(tab => {
      if (tab.id !== realPortId) return tab;

      const newLine = {
        id: uuidv4(),
        timestamp,
        direction: dirLabel,
        portName,
        data: Array.isArray(data) ? data : Array.from(data),
        isFrameBoundary: false,
        parsedFrameId: null,
      };

      const updatedLines = [...tab.terminalLines, newLine];
      const maxLines = 100000;
      const trimmed = updatedLines.length > maxLines
        ? updatedLines.slice(updatedLines.length - maxLines)
        : updatedLines;

      let newTx = tab.txBytes;
      let newRx = tab.rxBytes;
      if (dirLabel === 'Tx') newTx += data.length;
      else newRx += data.length;

      return {
        ...tab,
        terminalLines: trimmed,
        txBytes: newTx,
        rxBytes: newRx,
      };
    });

    updateStatusBar();
  }

  function handlePortStatus(evt) {
    const s = evt.payload || evt;
    if (!s) return;
    const id = s.port_id || s.portId;
    $openTabs = $openTabs.map(tab =>
      tab.id === id ? {
        ...tab,
        connected: s.connected,
        txBytes: s.tx_bytes ?? s.txBytes,
        rxBytes: s.rx_bytes ?? s.rxBytes,
        error: s.error,
        config: s.config ?? tab.config,
      } : tab
    );
    updateStatusBar();
  }

  function handlePortError(evt) {
    const e = evt.payload || evt;
    const id = e.port_id || e.portId;
    $openTabs = $openTabs.map(tab =>
      tab.id === id ? { ...tab, error: e.message, connected: false } : tab
    );
    updateStatusBar();
  }

  function handlePortStatusChanged(evt) {
    const s = evt.payload || evt;
    const id = s.portId;
    $openTabs = $openTabs.map(tab =>
      tab.id === id ? {
        ...tab,
        connected: s.connected,
        txBytes: s.txBytes ?? tab.txBytes,
        rxBytes: s.rxBytes ?? tab.rxBytes,
        error: s.error ?? tab.error,
      } : tab
    );
    updateStatusBar();
  }

  function updateStatusBar() {
    let totalRx = 0, totalTx = 0, connectedCount = 0, currentPort = '';
    for (const t of $openTabs) {
      totalRx += t.rxBytes || 0;
      totalTx += t.txBytes || 0;
      if (t.connected) connectedCount++;
      if (t.id === $activeTabId) currentPort = t.portName;
    }
    $statusBarData = {
      ...$statusBarData,
      totalRx, totalTx, connectedCount, currentPort,
    };
  }

  function closeTab(tabId) {
    const tab = $openTabs.find(t => t.id === tabId);
    if (tab && tab.connected) {
      closeSerialPort(tabId);
    }
    $openTabs = $openTabs.filter(t => t.id !== tabId);
    if ($activeTabId === tabId) {
      $activeTabId = $openTabs.length > 0 ? $openTabs[$openTabs.length - 1].id : null;
    }
    updateStatusBar();
  }

  $: {
    if ($openTabs.length > 0 && $activeTabId === null) {
      $activeTabId = $openTabs[0].id;
    }
  }

  onMount(async () => {
    try {
      if (typeof window !== 'undefined' && window.__TAURI__) {
        const { invoke, listen, emit } = window.__TAURI__;
        let openD = null, saveD = null;
        try {
          const d = window.__TAURI__.dialog;
          if (d) { openD = d.open; saveD = d.save; }
        } catch(e) {}
        setTauriApis(invoke, listen, emit, openD, saveD);
        tauriAvailable = true;

        unsubs.push(tauriListen('serial-data', handleSerialData));
        unsubs.push(tauriListen('port-status', handlePortStatus));
        unsubs.push(tauriListen('port-error', handlePortError));
        unsubs.push(tauriListen('port-status-changed', handlePortStatusChanged));
      } else {
        console.log('Running in browser mode - Tauri APIs not available');
      }
    } catch (e) {
      console.warn('Tauri initialization:', e.message);
    }

    await refreshPorts();

    try {
      const qc = await loadQuickCommands();
      if (qc && qc.length > 0) $quickCommands = qc;
    } catch(e) {}

    try {
      let pt = await loadProtocolTemplates();
      if (!pt || pt.length === 0) {
        pt = await getBuiltinProtocols();
      }
      $protocolTemplates = pt || [];
    } catch(e) {
      $protocolTemplates = [];
    }
  });

  setContext('refreshPorts', refreshPorts);
  setContext('handlePortOpened', handlePortOpened);
  setContext('handlePortClosed', handlePortClosed);

  onDestroy(() => {
    for (const u of unsubs) {
      try { if (typeof u === 'function') u(); } catch(e) {}
    }
  });
</script>

<div id="app-container">
  <TopBar onRefreshPorts={refreshPorts} />

  <div class="main-layout">
    {#if $sidebarOpen}
      <Sidebar />
    {/if}

    <div class="content-area">
      <TabBar tabs={$openTabs} activeId={$activeTabId} onSelect={id => $activeTabId = id} onClose={closeTab} />

      <div class="tabs-content">
        {#if $openTabs.length === 0}
          <div class="empty-state">
            <div class="empty-icon">🔌</div>
            <h2>未打开串口</h2>
            <p>在左侧边栏选择串口并配置参数后点击"打开"建立连接</p>
            <div class="empty-tips">
              <div>💡 提示：支持同时打开多个串口，每个串口独立一个标签页</div>
              <div>💡 提示：内置协议帧解析、校验计算、数据监控等多种工具</div>
            </div>
          </div>
        {:else}
          {#each $openTabs as tab (tab.id)}
            {#if tab.id === $activeTabId}
              <SerialTab tab={tab} />
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  </div>

  <StatusBar />

  {#if $showChecksumTool}
    <ChecksumTool onClose={() => $showChecksumTool = false} />
  {/if}

  {#if $showProtocolEditor}
    <ProtocolEditor onClose={() => $showProtocolEditor = false} />
  {/if}

  {#if $showAutoSend}
    <AutoSendPanel onClose={() => $showAutoSend = false} />
  {/if}

  {#if $showMonitor}
    <MonitorPanel onClose={() => $showMonitor = false} />
  {/if}

  {#if $showLogPanel}
    <LogPanel onClose={() => $showLogPanel = false} />
  {/if}
</div>

<style>
  .main-layout {
    flex: 1;
    display: flex;
    overflow: hidden;
  }
  .content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-primary);
  }
  .tabs-content {
    flex: 1;
    overflow: hidden;
    position: relative;
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    color: var(--text-secondary);
  }
  .empty-icon {
    font-size: 72px;
    margin-bottom: 20px;
    opacity: 0.5;
  }
  .empty-state h2 {
    color: var(--text-primary);
    margin-bottom: 12px;
    font-size: 22px;
  }
  .empty-tips {
    margin-top: 32px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 13px;
  }
  .empty-tips > div {
    background: var(--bg-secondary);
    padding: 10px 16px;
    border-radius: var(--radius);
    border: 1px solid var(--border-color);
  }
</style>

<script>
  import {
    protocolTemplates, FIELD_TYPE_OPTIONS, DISPLAY_FORMAT_OPTIONS,
    uuidv4, hexToBytes, bytesToHex
  } from '../stores.js';
  import { saveProtocolTemplates } from '../tauriApi.js';

  export let onClose;

  let editingTemplate = null;
  let selectedTemplateId = null;
  let showNewTemplate = false;
  let newTemplateName = '';

  $: selectedTemplate = $protocolTemplates.find(t => t.id === selectedTemplateId);

  function startEdit(template) {
    editingTemplate = JSON.parse(JSON.stringify(template));
  }

  function startNew() {
    showNewTemplate = true;
  }

  function createTemplate() {
    if (!newTemplateName.trim()) return;
    const t = {
      id: uuidv4(),
      name: newTemplateName.trim(),
      description: '',
      fields: [],
      frame_delimiter: null,
      is_builtin: false,
    };
    $protocolTemplates = [...$protocolTemplates, t];
    saveProtocolTemplates($protocolTemplates);
    selectedTemplateId = t.id;
    startEdit(t);
    showNewTemplate = false;
    newTemplateName = '';
  }

  function addField() {
    if (!editingTemplate) return;
    const newField = {
      name: '新字段',
      field_type: 'UInt8',
      byte_length: 1,
      length_ref_field: null,
      display_format: 'Hexadecimal',
      fixed_value: null,
      description: '',
    };
    editingTemplate = {
      ...editingTemplate,
      fields: [...editingTemplate.fields, newField]
    };
  }

  function updateField(idx, patch) {
    editingTemplate = {
      ...editingTemplate,
      fields: editingTemplate.fields.map((f, i) =>
        i === idx ? { ...f, ...patch } : f
      )
    };
  }

  function removeField(idx) {
    if (!confirm('删除该字段？')) return;
    editingTemplate = {
      ...editingTemplate,
      fields: editingTemplate.fields.filter((_, i) => i !== idx)
    };
  }

  function moveField(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= editingTemplate.fields.length) return;
    const fields = [...editingTemplate.fields];
    [fields[idx], fields[newIdx]] = [fields[newIdx], fields[idx]];
    editingTemplate = { ...editingTemplate, fields };
  }

  function saveTemplate() {
    if (!editingTemplate) return;
    if (editingTemplate.is_builtin) {
      alert('内置协议模板不能修改，可创建自定义模板');
      return;
    }
    $protocolTemplates = $protocolTemplates.map(t =>
      t.id === editingTemplate.id ? { ...editingTemplate } : t
    );
    saveProtocolTemplates($protocolTemplates);
    alert('保存成功');
  }

  function deleteTemplate(id) {
    if (!confirm('确定删除该协议模板？')) return;
    $protocolTemplates = $protocolTemplates.filter(t => t.id !== id);
    saveProtocolTemplates($protocolTemplates);
    if (selectedTemplateId === id) {
      selectedTemplateId = null;
      editingTemplate = null;
    }
  }

  function handleFixedValueInput(idx, hexStr) {
    const bytes = hexToBytes(hexStr);
    updateField(idx, { fixed_value: hexStr.trim() ? bytes : null });
  }

  function getFixedValueDisplay(field) {
    return field.fixed_value ? bytesToHex(field.fixed_value) : '';
  }
</script>

<div class="modal-backdrop" on:click|self={onClose}>
  <div class="modal pe-modal">
    <div class="modal-header">
      <h2>📋 协议帧模板管理</h2>
      <button class="close-btn" on:click={onClose}>×</button>
    </div>
    <div class="modal-body pe-body">
      <div class="pe-left">
        <div class="pe-header">
          <span>协议列表</span>
          <button class="btn-add" on:click={startNew}>+ 新建</button>
        </div>
        {#if showNewTemplate}
          <div class="new-tpl-box">
            <input bind:value={newTemplateName} placeholder="输入模板名称" />
            <div class="actions">
              <button class="btn-sm" on:click={() => showNewTemplate = false}>取消</button>
              <button class="btn-sm primary" on:click={createTemplate}>创建</button>
            </div>
          </div>
        {/if}
        <div class="tpl-list">
          {#each $protocolTemplates as tpl}
            <div
              class="tpl-item"
              class:active={selectedTemplateId === tpl.id}
              on:click={() => { selectedTemplateId = tpl.id; startEdit(tpl); }}
            >
              <div class="tpl-name">
                {tpl.name}
                {#if tpl.is_builtin}<span class="tpl-tag builtin">内置</span>{/if}
              </div>
              <div class="tpl-sub">{tpl.fields?.length || 0} 个字段</div>
              {#if !tpl.is_builtin}
                <button class="tpl-del" on:click|stopPropagation={() => deleteTemplate(tpl.id)}>×</button>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <div class="pe-right">
        {#if !editingTemplate}
          <div class="pe-empty">
            <div style="font-size:48px;opacity:0.3;margin-bottom:16px;">📄</div>
            <p>从左侧选择协议模板进行编辑<br/>或点击"新建"创建自定义协议</p>
          </div>
        {:else}
          <div class="edit-header">
            <div>
              <h3>{editingTemplate.name}</h3>
              <div class="tpl-desc">{editingTemplate.description || '暂无描述'}</div>
            </div>
            <div class="edit-actions">
              <button class="btn-sm" disabled={editingTemplate.is_builtin} on:click={addField}>+ 字段</button>
              <button class="btn-sm primary" disabled={editingTemplate.is_builtin} on:click={saveTemplate}>保存</button>
            </div>
          </div>

          <div class="fields-table-wrap">
            <table class="fields-table">
              <thead>
                <tr>
                  <th style="width:30px">#</th>
                  <th>名称</th>
                  <th>类型</th>
                  <th>长度</th>
                  <th>引用字段</th>
                  <th>显示格式</th>
                  <th>固定值(HEX)</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {#each editingTemplate.fields as field, idx}
                  <tr>
                    <td class="idx-cell">
                      <div class="move-btns">
                        <button on:click={() => moveField(idx, -1)}>↑</button>
                        <span>{idx + 1}</span>
                        <button on:click={() => moveField(idx, 1)}>↓</button>
                      </div>
                    </td>
                    <td>
                      <input
                        value={field.name}
                        on:input={(e) => updateField(idx, { name: e.target.value })}
                        disabled={editingTemplate.is_builtin}
                      />
                    </td>
                    <td>
                      <select
                        value={field.field_type}
                        on:change={(e) => updateField(idx, { field_type: e.target.value })}
                        disabled={editingTemplate.is_builtin}
                      >
                        {#each FIELD_TYPE_OPTIONS as opt}
                          <option value={opt.value}>{opt.label}</option>
                        {/each}
                      </select>
                    </td>
                    <td style="width:90px">
                      <input
                        type="number"
                        value={field.byte_length ?? ''}
                        on:input={(e) => updateField(idx, { byte_length: e.target.value ? parseInt(e.target.value) : null })}
                        disabled={editingTemplate.is_builtin}
                        style="width:80px"
                      />
                    </td>
                    <td style="width:110px">
                      <select
                        value={field.length_ref_field || ''}
                        on:change={(e) => updateField(idx, { length_ref_field: e.target.value || null })}
                        disabled={editingTemplate.is_builtin}
                        style="width:100px"
                      >
                        <option value="">-- 无 --</option>
                        {#each editingTemplate.fields as other}
                          {#if other.field_type === 'Length'}
                            <option value={other.name}>{other.name}</option>
                          {/if}
                        {/each}
                      </select>
                    </td>
                    <td>
                      <select
                        value={field.display_format}
                        on:change={(e) => updateField(idx, { display_format: e.target.value })}
                        disabled={editingTemplate.is_builtin}
                      >
                        {#each DISPLAY_FORMAT_OPTIONS as opt}
                          <option value={opt.value}>{opt.label}</option>
                        {/each}
                      </select>
                    </td>
                    <td>
                      <input
                        class="monospace"
                        value={getFixedValueDisplay(field)}
                        on:input={(e) => handleFixedValueInput(idx, e.target.value)}
                        disabled={editingTemplate.is_builtin}
                        placeholder="如: AA 55"
                      />
                    </td>
                    <td style="width:50px">
                      <button
                        class="row-del"
                        disabled={editingTemplate.is_builtin}
                        on:click={() => removeField(idx)}
                      >✕</button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          <div class="frame-preview">
            <h4>帧结构预览</h4>
            <div class="preview-bar">
              {#each editingTemplate.fields as field, idx}
                {@const colors = ['#4a9eff','#4ade80','#fbbf24','#a78bfa','#fb923c','#22d3ee','#f472b6','#38bdf8','#facc15','#86efac','#c084fc','#f87171']}
                <div
                  class="preview-seg"
                  style="background:{colors[idx % colors.length]}40;border-color:{colors[idx % colors.length]}"
                  title="{field.name} ({field.byte_length || '动态'}B)"
                >
                  <div class="ps-name">{field.name}</div>
                  <div class="ps-len">{field.byte_length ? field.byte_length + 'B' : '动态'}</div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    width: 1200px;
    max-width: 98vw;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
  }
  .modal-header h2 { font-size: 18px; font-weight: 600; }
  .close-btn {
    width: 32px; height: 32px;
    border-radius: 50%;
    background: transparent; border: none;
    font-size: 24px;
    color: var(--text-secondary);
  }
  .close-btn:hover { background: var(--accent-red); color: #fff; }

  .pe-body {
    flex: 1;
    display: flex;
    overflow: hidden;
    padding: 0;
  }
  .pe-left {
    width: 260px;
    flex-shrink: 0;
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    padding: 14px;
    overflow: hidden;
  }
  .pe-right {
    flex: 1;
    padding: 18px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .pe-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    font-weight: 600;
    font-size: 13px;
  }
  .btn-add {
    padding: 4px 12px;
    font-size: 12px;
    background: var(--accent-blue);
    border: none;
    border-radius: 4px;
    color: #fff;
  }
  .new-tpl-box {
    background: var(--bg-input);
    padding: 10px;
    border-radius: 6px;
    border: 1px solid var(--accent-blue);
    margin-bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .actions { display: flex; gap: 6px; justify-content: flex-end; }
  .btn-sm { padding: 4px 10px; font-size: 12px; }
  .btn-sm.primary { background: var(--accent-green); color: #000; border-color: var(--accent-green); }
  .tpl-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    flex: 1;
  }
  .tpl-item {
    background: var(--bg-input);
    padding: 10px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    cursor: pointer;
    position: relative;
    transition: all 0.15s;
  }
  .tpl-item:hover { border-color: var(--accent-blue); }
  .tpl-item.active {
    border-color: var(--accent-blue);
    background: var(--bg-tertiary);
    box-shadow: 0 0 0 2px rgba(74,158,255,0.2);
  }
  .tpl-name {
    font-weight: 600;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tpl-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--accent-cyan);
    color: #000;
    font-weight: 700;
  }
  .tpl-tag.builtin { background: var(--accent-purple); }
  .tpl-sub {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
  }
  .tpl-del {
    position: absolute;
    right: 6px;
    top: 6px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: transparent;
    border: none;
    color: var(--accent-red);
    font-size: 16px;
    display: none;
  }
  .tpl-item:hover .tpl-del { display: block; }
  .tpl-del:hover { background: var(--accent-red); color: #fff; }

  .pe-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    text-align: center;
  }
  .edit-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border-color);
  }
  .edit-header h3 {
    font-size: 18px;
    margin-bottom: 4px;
  }
  .tpl-desc {
    font-size: 12px;
    color: var(--text-muted);
  }
  .edit-actions { display: flex; gap: 8px; }

  .fields-table-wrap {
    flex: 1;
    overflow-x: auto;
    border: 1px solid var(--border-color);
    border-radius: 8px;
  }
  .fields-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .fields-table th {
    position: sticky;
    top: 0;
    background: var(--bg-tertiary);
    padding: 10px 8px;
    text-align: left;
    font-size: 11px;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-color);
    white-space: nowrap;
  }
  .fields-table td {
    padding: 6px 6px;
    border-bottom: 1px solid var(--border-color);
    vertical-align: middle;
  }
  .fields-table input, .fields-table select {
    width: 100%;
    font-size: 12px;
    padding: 5px 8px;
  }
  .idx-cell .move-btns {
    display: flex;
    align-items: center;
    gap: 2px;
    justify-content: center;
  }
  .move-btns button {
    width: 20px;
    height: 20px;
    padding: 0;
    font-size: 10px;
    border-radius: 3px;
    background: var(--bg-input);
  }
  .move-btns span {
    width: 20px;
    text-align: center;
    font-size: 11px;
    color: var(--text-muted);
  }
  .row-del {
    width: 26px; height: 26px;
    padding: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--accent-red);
    border: 1px solid transparent;
    font-size: 14px;
  }
  .row-del:hover { background: var(--accent-red); color: #fff; }

  .frame-preview {
    background: var(--bg-input);
    padding: 14px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
  }
  .frame-preview h4 {
    margin-bottom: 10px;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .preview-bar {
    display: flex;
    gap: 3px;
    min-height: 60px;
  }
  .preview-seg {
    flex: 1;
    min-width: 60px;
    border: 2px solid;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4px;
    text-align: center;
  }
  .ps-name {
    font-size: 11px;
    font-weight: 600;
  }
  .ps-len {
    font-size: 10px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
</style>

// sidepanel.js - Main application logic
import { saveImage, getImage, deleteImage, getAllImages } from './db.js';
import { pushToCloud, pullFromCloud } from './github_sync.js';

// ========================
// State
// ========================
let state = {
  prompts: [],      // Array<{id, title, content, categoryId, hasImage, createdAt, updatedAt}>
  categories: [],   // Array<{id, name}>
  activeCategoryId: null, // null = 全部
  searchQuery: '',
  imageCache: {},   // { promptId: dataUrl }
  editingPromptId: null,  // null = new
  detailPromptId: null,
  pendingImageDataUrl: null, // image being added in the form
  githubToken: '',
  syncRepo: 'prompt-vault-data'
};

// ========================
// Storage Helpers
// ========================
async function loadFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['prompts', 'categories', 'githubToken', 'syncRepo'], (result) => {
      state.prompts = result.prompts || [];
      state.categories = result.categories || [
        { id: genId(), name: '通用' },
        { id: genId(), name: '写作' },
        { id: genId(), name: '编程' },
      ];
      state.githubToken = result.githubToken || '';
      state.syncRepo = result.syncRepo || 'prompt-vault-data';
      resolve();
    });
  });
}

async function saveToStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      prompts: state.prompts,
      categories: state.categories,
      githubToken: state.githubToken,
      syncRepo: state.syncRepo
    }, resolve);
  });
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ========================
// Toast
// ========================
let toastTimer = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, 2200);
}

// ========================
// Category Tabs Render
// ========================
function renderCategoryTabs() {
  const container = document.getElementById('category-tabs');
  const tabs = [
    { id: null, name: '全部' },
    ...state.categories,
  ];

  container.innerHTML = tabs.map(cat => `
    <button class="cat-tab ${state.activeCategoryId === cat.id ? 'active' : ''}" data-cat-id="${cat.id ?? ''}">
      ${escHtml(cat.name)}
    </button>
  `).join('');

  container.querySelectorAll('.cat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.catId;
      state.activeCategoryId = val === '' ? null : val;
      renderCategoryTabs();
      renderPromptList();
    });
  });
}

// ========================
// Prompt List Render
// ========================
async function renderPromptList() {
  const listEl = document.getElementById('prompt-list');
  const emptyEl = document.getElementById('empty-state');

  // Filter
  let filtered = state.prompts.filter(p => {
    if (state.activeCategoryId && p.categoryId !== state.activeCategoryId) return false;
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      return p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q);
    }
    return true;
  });

  // Sort: newest first
  filtered = filtered.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'flex';
    return;
  }
  emptyEl.style.display = 'none';

  // Render cards
  const fragment = document.createDocumentFragment();
  for (const prompt of filtered) {
    const cat = state.categories.find(c => c.id === prompt.categoryId);
    const imgData = prompt.hasImage ? (state.imageCache[prompt.id] || null) : null;

    const card = document.createElement('div');
    card.className = `prompt-card${prompt.hasImage ? ' has-image' : ''}`;
    card.dataset.id = prompt.id;

    const titleHl = highlight(escHtml(prompt.title), state.searchQuery);
    const contentHl = highlight(escHtml(truncate(prompt.content, 80)), state.searchQuery);

    card.innerHTML = `
      ${prompt.hasImage ? `
        <div class="card-left">
          ${cardInner(titleHl, contentHl, cat)}
        </div>
        <div class="card-thumbnail-wrap">
          <img class="card-thumbnail" src="" data-prompt-id="${prompt.id}" alt="screenshot" />
        </div>
      ` : `
        <div class="card-left">
          ${cardInner(titleHl, contentHl, cat)}
        </div>
      `}
    `;

    // Load thumbnail lazily
    if (prompt.hasImage && imgData) {
      const img = card.querySelector('.card-thumbnail');
      if (img) img.src = imgData;
    } else if (prompt.hasImage && !imgData) {
      // Load from IndexedDB
      getImage(prompt.id).then(data => {
        if (data) {
          state.imageCache[prompt.id] = data;
          const img = card.querySelector('.card-thumbnail');
          if (img) img.src = data;
        }
      });
    }

    // Copy button
    card.querySelector('.card-copy-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      copyPrompt(prompt.id, e.currentTarget);
    });

    // Edit button
    card.querySelector('.btn-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditPromptModal(prompt.id);
    });

    // Delete button
    card.querySelector('.btn-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deletePrompt(prompt.id);
    });

    // Click card → detail
    card.addEventListener('click', () => {
      openDetailModal(prompt.id);
    });

    fragment.appendChild(card);
  }

  listEl.innerHTML = '';
  listEl.appendChild(fragment);
}

function cardInner(titleHl, contentHl, cat) {
  return `
    <div class="card-header">
      <span class="card-title">${titleHl}</span>
      <div class="card-actions">
        <button class="card-action-btn btn-edit" title="编辑">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="card-action-btn danger btn-delete" title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
          </svg>
        </button>
      </div>
    </div>
    <p class="card-excerpt">${contentHl}</p>
    <div class="card-footer">
      ${cat ? `<span class="card-category-tag">${escHtml(cat.name)}</span>` : '<span></span>'}
      <button class="card-copy-btn" title="复制内容">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
        复制
      </button>
    </div>
  `;
}

// ========================
// Copy Prompt
// ========================
async function copyPrompt(id, btnEl) {
  const prompt = state.prompts.find(p => p.id === id);
  if (!prompt) return;

  try {
    await navigator.clipboard.writeText(prompt.content);
    if (btnEl) {
      const originalHTML = btnEl.innerHTML;
      btnEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;"><polyline points="20 6 9 17 4 12"/></svg> 已复制`;
      btnEl.classList.add('copied');
      setTimeout(() => {
        btnEl.innerHTML = originalHTML;
        btnEl.classList.remove('copied');
      }, 1800);
    }
    showToast('已复制到剪贴板 ✓');
  } catch (e) {
    showToast('复制失败，请检查权限', 'error');
  }
}

// ========================
// Delete Prompt
// ========================
async function deletePrompt(id) {
  if (!confirm('确定要删除这个 Prompt 吗？')) return;
  state.prompts = state.prompts.filter(p => p.id !== id);
  await deleteImage(id);
  delete state.imageCache[id];
  await saveToStorage();
  renderPromptList();
  showToast('已删除');
}

// ========================
// Prompt Modal (Add / Edit)
// ========================
function openAddPromptModal() {
  state.editingPromptId = null;
  state.pendingImageDataUrl = null;

  document.getElementById('modal-prompt-title').textContent = '新增 Prompt';
  document.getElementById('prompt-title').value = '';
  document.getElementById('prompt-content').value = '';
  document.getElementById('image-preview').style.display = 'none';
  document.getElementById('image-preview').src = '';
  document.getElementById('image-placeholder').style.display = 'flex';
  document.getElementById('btn-remove-image').style.display = 'none';

  populateCategorySelect();
  document.getElementById('modal-prompt').style.display = 'flex';
  requestAnimationFrame(() => {
    document.getElementById('prompt-title').focus();
  });
}

async function openEditPromptModal(id) {
  const prompt = state.prompts.find(p => p.id === id);
  if (!prompt) return;

  state.editingPromptId = id;
  state.pendingImageDataUrl = null;

  document.getElementById('modal-prompt-title').textContent = '编辑 Prompt';
  document.getElementById('prompt-title').value = prompt.title;
  document.getElementById('prompt-content').value = prompt.content;

  populateCategorySelect(prompt.categoryId);

  // Load existing image
  if (prompt.hasImage) {
    const imgData = state.imageCache[id] || await getImage(id);
    if (imgData) {
      state.imageCache[id] = imgData;
      state.pendingImageDataUrl = imgData;
      document.getElementById('image-preview').src = imgData;
      document.getElementById('image-preview').style.display = 'block';
      document.getElementById('image-placeholder').style.display = 'none';
      document.getElementById('btn-remove-image').style.display = 'flex';
    }
  } else {
    document.getElementById('image-preview').style.display = 'none';
    document.getElementById('image-preview').src = '';
    document.getElementById('image-placeholder').style.display = 'flex';
    document.getElementById('btn-remove-image').style.display = 'none';
  }

  document.getElementById('modal-prompt').style.display = 'flex';
}

function closePromptModal() {
  document.getElementById('modal-prompt').style.display = 'none';
  state.editingPromptId = null;
  state.pendingImageDataUrl = null;
}

function populateCategorySelect(selectedId = null) {
  const sel = document.getElementById('prompt-category');
  sel.innerHTML = `<option value="">— 无分类 —</option>` +
    state.categories.map(c =>
      `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escHtml(c.name)}</option>`
    ).join('');
}

async function savePromptFromForm() {
  const title = document.getElementById('prompt-title').value.trim();
  const content = document.getElementById('prompt-content').value.trim();
  const categoryId = document.getElementById('prompt-category').value || null;

  if (!title) {
    document.getElementById('prompt-title').focus();
    showToast('请输入标题', 'error');
    return;
  }
  if (!content) {
    document.getElementById('prompt-content').focus();
    showToast('请输入 Prompt 内容', 'error');
    return;
  }

  const now = Date.now();

  if (state.editingPromptId) {
    // Edit
    const idx = state.prompts.findIndex(p => p.id === state.editingPromptId);
    if (idx === -1) return;
    state.prompts[idx] = {
      ...state.prompts[idx],
      title,
      content,
      categoryId,
      hasImage: !!state.pendingImageDataUrl,
      updatedAt: now,
    };
    if (state.pendingImageDataUrl) {
      await saveImage(state.editingPromptId, state.pendingImageDataUrl);
      state.imageCache[state.editingPromptId] = state.pendingImageDataUrl;
    } else {
      await deleteImage(state.editingPromptId);
      delete state.imageCache[state.editingPromptId];
    }
    showToast('已保存 ✓');
  } else {
    // New
    const id = genId();
    state.prompts.push({
      id,
      title,
      content,
      categoryId,
      hasImage: !!state.pendingImageDataUrl,
      createdAt: now,
      updatedAt: now,
    });
    if (state.pendingImageDataUrl) {
      await saveImage(id, state.pendingImageDataUrl);
      state.imageCache[id] = state.pendingImageDataUrl;
    }
    showToast('已添加 ✓');
  }

  await saveToStorage();
  closePromptModal();
  renderCategoryTabs();
  renderPromptList();
}

// ========================
// Image Upload Handling
// ========================
function setupImageUpload() {
  const area = document.getElementById('image-upload-area');
  const fileInput = document.getElementById('image-file-input');
  const preview = document.getElementById('image-preview');
  const placeholder = document.getElementById('image-placeholder');
  const removeBtn = document.getElementById('btn-remove-image');

  area.addEventListener('click', (e) => {
    if (e.target === removeBtn || removeBtn.contains(e.target)) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) handleImageFile(file);
    fileInput.value = '';
  });

  // Drag and drop
  area.addEventListener('dragover', (e) => {
    e.preventDefault();
    area.classList.add('drag-over');
  });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleImageFile(file);
  });

  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.pendingImageDataUrl = null;
    preview.src = '';
    preview.style.display = 'none';
    placeholder.style.display = 'flex';
    removeBtn.style.display = 'none';
  });

  function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      state.pendingImageDataUrl = e.target.result;
      preview.src = e.target.result;
      preview.style.display = 'block';
      placeholder.style.display = 'none';
      removeBtn.style.display = 'flex';
    };
    reader.readAsDataURL(file);
  }
}

// ========================
// Category Manager
// ========================
function openCategoryModal() {
  renderCategoryList();
  document.getElementById('modal-categories').style.display = 'flex';
  document.getElementById('new-category-name').value = '';
  requestAnimationFrame(() => document.getElementById('new-category-name').focus());
}

function closeCategoryModal() {
  document.getElementById('modal-categories').style.display = 'none';
  renderCategoryTabs();
  renderPromptList();
}

function renderCategoryList() {
  const container = document.getElementById('category-list');
  if (state.categories.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;text-align:center;padding:16px;">暂无分类，请添加</p>';
    return;
  }

  container.innerHTML = state.categories.map(cat => {
    const count = state.prompts.filter(p => p.categoryId === cat.id).length;
    return `
      <div class="category-item" data-cat-id="${cat.id}">
        <div class="category-item-name">
          <span>${escHtml(cat.name)}</span>
          <span class="category-count">${count}</span>
        </div>
        <div class="category-item-actions">
          <button class="card-action-btn btn-delete-cat danger" data-id="${cat.id}" title="删除分类">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-delete-cat').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const cat = state.categories.find(c => c.id === id);
      const count = state.prompts.filter(p => p.categoryId === id).length;
      const msg = count > 0
        ? `删除分类"${cat.name}"后，该分类下 ${count} 个 Prompt 将变为无分类。确认删除？`
        : `确认删除分类"${cat.name}"？`;
      if (!confirm(msg)) return;
      state.categories = state.categories.filter(c => c.id !== id);
      state.prompts = state.prompts.map(p =>
        p.categoryId === id ? { ...p, categoryId: null } : p
      );
      if (state.activeCategoryId === id) state.activeCategoryId = null;
      await saveToStorage();
      renderCategoryList();
      showToast('分类已删除');
    });
  });
}

async function addCategory() {
  const nameEl = document.getElementById('new-category-name');
  const name = nameEl.value.trim();
  if (!name) { nameEl.focus(); return; }
  if (state.categories.some(c => c.name === name)) {
    showToast('分类名称已存在', 'error');
    return;
  }
  const id = genId();
  state.categories.push({ id, name });
  await saveToStorage();
  nameEl.value = '';
  renderCategoryList();
  showToast(`已添加分类"${name}"`);
}

// ========================
// Detail Modal
// ========================
async function openDetailModal(id) {
  const prompt = state.prompts.find(p => p.id === id);
  if (!prompt) return;
  state.detailPromptId = id;

  document.getElementById('detail-title').textContent = prompt.title;
  document.getElementById('detail-content').textContent = prompt.content;

  const cat = state.categories.find(c => c.id === prompt.categoryId);
  const metaEl = document.getElementById('detail-meta');
  metaEl.innerHTML = cat ? `<span class="cat-badge">${escHtml(cat.name)}</span>` : '';

  const imgWrap = document.getElementById('detail-image-wrap');
  const imgEl = document.getElementById('detail-image');
  if (prompt.hasImage) {
    const imgData = state.imageCache[id] || await getImage(id);
    if (imgData) {
      state.imageCache[id] = imgData;
      imgEl.src = imgData;
      imgWrap.style.display = 'block';
    } else {
      imgWrap.style.display = 'none';
    }
  } else {
    imgWrap.style.display = 'none';
    imgEl.src = '';
  }

  document.getElementById('modal-detail').style.display = 'flex';
}

function closeDetailModal() {
  document.getElementById('modal-detail').style.display = 'none';
  state.detailPromptId = null;
}

// ========================
// Search
// ========================
function setupSearch() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('btn-search-clear');

  input.addEventListener('input', () => {
    state.searchQuery = input.value;
    clearBtn.classList.toggle('visible', state.searchQuery.length > 0);
    renderPromptList();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    state.searchQuery = '';
    clearBtn.classList.remove('visible');
    renderPromptList();
    input.focus();
  });
}

// ========================
// Utility
// ========================
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function highlight(htmlStr, query) {
  if (!query) return htmlStr;
  const q = escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return htmlStr.replace(new RegExp(`(${q})`, 'gi'), '<mark class="highlight">$1</mark>');
}

// ========================
// Settings & Sync
// ========================
function openSettingsModal() {
  document.getElementById('setting-github-token').value = state.githubToken;
  document.getElementById('setting-repo-name').value = state.syncRepo;
  document.getElementById('modal-settings').style.display = 'flex';
}

function closeSettingsModal() {
  document.getElementById('modal-settings').style.display = 'none';
}

async function saveSettings() {
  const token = document.getElementById('setting-github-token').value.trim();
  const repo = document.getElementById('setting-repo-name').value.trim();
  
  if (token && !token.startsWith('ghp_') && !token.startsWith('github_')) {
    showToast('Token 格式可能不正确，必须为 Classic Token', 'error');
  }
  
  state.githubToken = token;
  state.syncRepo = repo || 'prompt-vault-data';
  await saveToStorage();
  closeSettingsModal();
  showToast('配置已保存');
}

async function performPush() {
  if (!state.githubToken) return showToast('未配置 GitHub Token', 'error');
  const btn = document.getElementById('btn-sync-push');
  btn.textContent = '上传中...';
  btn.disabled = true;
  try {
    await pushToCloud(state.githubToken, state.syncRepo, state.prompts, state.categories, state.imageCache);
    showToast('上传云端成功');
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    btn.textContent = '上传 (Push)';
    btn.disabled = false;
  }
}

async function performPull() {
  if (!state.githubToken) return showToast('未配置 GitHub Token', 'error');
  if (!confirm('拉取将覆盖本地修改，确定要继续吗？')) return;
  const btn = document.getElementById('btn-sync-pull');
  btn.textContent = '下载中...';
  btn.disabled = true;
  try {
    const cloudData = await pullFromCloud(state.githubToken, state.syncRepo);
    state.prompts = cloudData.prompts;
    state.categories = cloudData.categories;
    state.imageCache = cloudData.imageCache;
    
    // update local db images
    for (const [id, url] of Object.entries(cloudData.imageCache)) {
      await saveImage(id, url);
    }
    await saveToStorage();
    renderCategoryTabs();
    renderPromptList();
    showToast('云端数据拉取成功');
    closeSettingsModal();
  } catch(e) {
    showToast('拉取失败: ' + e.message, 'error');
  } finally {
    btn.textContent = '下载 (Pull)';
    btn.disabled = false;
  }
}

// ========================
// Event Bindings
// ========================
function bindEvents() {
  // Header add button
  document.getElementById('btn-add-prompt').addEventListener('click', openAddPromptModal);
  document.getElementById('btn-manage-categories').addEventListener('click', openCategoryModal);

  // Settings & Sync
  document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
  document.getElementById('btn-sync-cloud').addEventListener('click', openSettingsModal);
  document.getElementById('btn-close-modal-settings').addEventListener('click', closeSettingsModal);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-sync-push').addEventListener('click', performPush);
  document.getElementById('btn-sync-pull').addEventListener('click', performPull);

  // Prompt modal
  document.getElementById('btn-close-modal-prompt').addEventListener('click', closePromptModal);
  document.getElementById('btn-cancel-prompt').addEventListener('click', closePromptModal);
  document.getElementById('btn-save-prompt').addEventListener('click', savePromptFromForm);

  // Category modal
  document.getElementById('btn-close-modal-categories').addEventListener('click', closeCategoryModal);
  document.getElementById('btn-close-categories-done').addEventListener('click', closeCategoryModal);
  document.getElementById('btn-add-category').addEventListener('click', addCategory);
  document.getElementById('new-category-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCategory();
  });

  // Detail modal
  document.getElementById('btn-close-modal-detail').addEventListener('click', closeDetailModal);
  document.getElementById('btn-detail-copy').addEventListener('click', () => {
    copyPrompt(state.detailPromptId, document.getElementById('btn-detail-copy'));
  });
  document.getElementById('btn-detail-edit').addEventListener('click', () => {
    const idToEdit = state.detailPromptId; // capture before closeDetailModal nulls it
    closeDetailModal();
    openEditPromptModal(idToEdit);
  });

  // Close modals on overlay click
  ['modal-prompt', 'modal-categories', 'modal-detail', 'modal-settings'].forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        e.currentTarget.style.display = 'none';
      }
    });
  });

  // Keyboard ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ['modal-prompt', 'modal-categories', 'modal-detail', 'modal-settings'].forEach(id => {
        document.getElementById(id).style.display = 'none';
      });
    }
  });

  setupImageUpload();
  setupSearch();
}

// ========================
// Init
// ========================
async function init() {
  await loadFromStorage();

  // Pre-warm image cache for visible prompts
  const imageIds = state.prompts.filter(p => p.hasImage).map(p => p.id);
  if (imageIds.length > 0) {
    const all = await getAllImages();
    state.imageCache = all;
  }

  bindEvents();
  renderCategoryTabs();
  renderPromptList();
}

init().catch(console.error);

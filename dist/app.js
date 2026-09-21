const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
const fileInput = document.querySelector('#file-input');
const dropzone = document.querySelector('#dropzone');
const urlInput = document.querySelector('#media-url');
const analyzeButton = document.querySelector('#analyze-button');
const statusBox = document.querySelector('#status');
const result = document.querySelector('#result');
const restrictedResult = document.querySelector('#restricted-result');
const resetButton = document.querySelector('#reset-button');
const downloadButton = document.querySelector('#download-button');
const resultTitle = document.querySelector('#result-title');
const resultMeta = document.querySelector('#result-meta');
const resultNote = document.querySelector('#result-note');
const formatName = document.querySelector('#format-name');
const fileArt = document.querySelector('#file-art');
const youtubeLink = document.querySelector('#youtube-link');
const mediaExtensions = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
let currentObjectUrl = null;

function hideResults() {
  statusBox.hidden = true;
  statusBox.className = 'status-box';
  result.hidden = true;
  restrictedResult.hidden = true;
}

function showStatus(message, type = '') {
  hideResults();
  statusBox.textContent = message;
  statusBox.className = `status-box ${type}`.trim();
  statusBox.hidden = false;
}

function cleanFilename(value, fallback = 'media-file') {
  const name = decodeURIComponent(value || '').split('/').pop()?.split('?')[0] || fallback;
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').slice(0, 120) || fallback;
}

function extensionFrom(name) {
  const match = name.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match ? match[1] : '';
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Size from source';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function showDownload({ name, extension, href, size, local = false, proxied = false }) {
  hideResults();
  const ext = extension || 'FILE';
  fileArt.textContent = ext.toUpperCase().slice(0, 5);
  resultTitle.textContent = name;
  resultMeta.textContent = `${ext.toUpperCase()} · ${humanBytes(size)}`;
  formatName.textContent = `${ext.toUpperCase()} · Original`;
  downloadButton.href = href;
  downloadButton.download = name;
  downloadButton.target = local || proxied ? '' : '_blank';
  downloadButton.rel = local || proxied ? '' : 'noopener noreferrer';
  resultNote.textContent = local
    ? 'The file stays on your device. Drift creates a temporary local link for saving a copy.'
    : proxied
      ? 'The free local server will securely stream the original file to your browser. The link expires in 10 minutes.'
      : 'Your browser will request the original file directly. Some hosts may open it in a new tab instead.';
  result.hidden = false;
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function isYouTube(url) {
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be' || host === 'youtube-nocookie.com';
}

async function analyzeUrl() {
  let url;
  try {
    url = new URL(urlInput.value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
  } catch {
    showStatus('Enter a complete link beginning with http:// or https://.', 'error');
    urlInput.focus();
    return;
  }

  if (isYouTube(url)) {
    hideResults();
    youtubeLink.href = url.href;
    restrictedResult.hidden = false;
    restrictedResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  showStatus('Securely checking the media source…', 'loading');
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.href })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not inspect this link.');
    const ext = extensionFrom(data.filename) || data.contentType?.split('/')[1] || 'media';
    showDownload({ name: data.filename, extension: ext, href: data.downloadUrl, size: data.size, proxied: true });
  } catch (error) {
    showStatus(error.message || 'Could not inspect this link.', 'error');
  }
}

function handleFile(file) {
  if (!file) return;
  if (!(file.type.startsWith('video/') || file.type.startsWith('audio/'))) {
    showStatus('Choose a video or audio file.', 'error');
    return;
  }
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(file);
  const ext = extensionFrom(file.name) || file.type.split('/')[1]?.split(';')[0] || 'media';
  showDownload({ name: cleanFilename(file.name), extension: ext, href: currentObjectUrl, size: file.size, local: true });
}

tabs.forEach((tab) => tab.addEventListener('click', () => {
  tabs.forEach((item) => {
    const selected = item === tab;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-selected', String(selected));
  });
  panels.forEach((panel) => { panel.hidden = panel.id !== tab.getAttribute('aria-controls'); });
  hideResults();
}));
analyzeButton.addEventListener('click', analyzeUrl);
urlInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') analyzeUrl(); });
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
['dragenter', 'dragover'].forEach((name) => dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((name) => dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
}));
dropzone.addEventListener('drop', (event) => handleFile(event.dataTransfer.files[0]));
resetButton.addEventListener('click', () => {
  hideResults();
  urlInput.value = '';
  fileInput.value = '';
  urlInput.focus();
});
window.addEventListener('beforeunload', () => { if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl); });

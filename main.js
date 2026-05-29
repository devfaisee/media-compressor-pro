// main.js - Core application controller for Media Compressor Pro
// Manages file uploading, FFmpeg.wasm loaders, virtual filesystem writes, 
// real-time progress callbacks, and dual player grids.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// -------------------------------------------------------------
// DOM Selection
// -------------------------------------------------------------
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const fileDetails = document.getElementById('file-details');
const detailFilename = document.getElementById('detail-filename');
const detailSize = document.getElementById('detail-size');
const dimsRow = document.getElementById('dims-row');
const detailDims = document.getElementById('detail-dims');
const detailDuration = document.getElementById('detail-duration');

const progressCard = document.getElementById('progress-card');
const statusLabel = document.getElementById('status-label');
const statusPercentage = document.getElementById('status-percentage');
const progressBar = document.getElementById('progress-bar');
const progressSpeed = document.getElementById('progress-speed');

const transcribeBtn = document.getElementById('transcribe-btn');
const btnSpinner = document.getElementById('btn-spinner');
const btnIcon = document.getElementById('btn-icon');
const btnText = document.getElementById('btn-text');

const downloadBtn = document.getElementById('download-btn');
const clearEditorBtn = document.getElementById('clear-editor-btn');
const placeholderScreen = document.getElementById('placeholder-screen');
const editorStatus = document.getElementById('editor-status');

const playersGrid = document.getElementById('players-grid');
const originalPlayerWrapper = document.getElementById('original-player-wrapper');
const compressedPlayerWrapper = document.getElementById('compressed-player-wrapper');

const originalSizeBadge = document.getElementById('original-size-badge');
const compressedSizeBadge = document.getElementById('compressed-size-badge');
const originalMeta = document.getElementById('original-meta');
const compressedMeta = document.getElementById('compressed-meta');

const metaSavings = document.getElementById('meta-savings');

// -------------------------------------------------------------
// Application State
// -------------------------------------------------------------
let originalFile = null;
let originalFileUrl = null;
let compressedBlob = null;
let compressedFileUrl = null;

let ffmpeg = null;
let isLoaded = false;
let preset = 'balanced'; // Default preset
let mediaType = ''; // 'video' or 'audio'

// -------------------------------------------------------------
// Preset Card Event Listeners
// -------------------------------------------------------------
document.querySelectorAll('.preset-card').forEach(card => {
  card.addEventListener('click', (e) => {
    const activeCard = e.currentTarget;
    document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
    activeCard.classList.add('active');
    preset = activeCard.getAttribute('data-preset');
    console.log(`Preset selected: ${preset}`);
  });
});

// -------------------------------------------------------------
// File Selection & Drag-and-Drop Handlers
// -------------------------------------------------------------
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleLoadedFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleLoadedFile(e.target.files[0]);
  }
});

clearEditorBtn.addEventListener('click', () => {
  clearWorkspace();
});

function handleLoadedFile(file) {
  if (!file) return;
  
  // File size checks (40MB limit for browser WASM allocation stability)
  if (file.size > 40 * 1024 * 1024) {
    alert('File size exceeds the 40MB browser sandbox limit. Please supply a smaller media file.');
    return;
  }
  
  clearWorkspace();
  originalFile = file;
  
  detailFilename.textContent = file.name;
  detailSize.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  fileDetails.style.display = 'flex';
  
  // Detect media type
  if (file.type.startsWith('video')) {
    mediaType = 'video';
    dimsRow.style.display = 'flex';
    
    // Read video dimensions and duration using offscreen element
    originalFileUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      detailDims.textContent = `${video.videoWidth} x ${video.videoHeight}px`;
      detailDuration.textContent = `${video.duration.toFixed(1)}s`;
      originalMeta.textContent = `Video H.264 (${video.videoWidth}x${video.videoHeight})`;
      
      // Load into visual comparison grid panel
      const player = document.createElement('video');
      player.src = originalFileUrl;
      player.controls = true;
      originalPlayerWrapper.innerHTML = '';
      originalPlayerWrapper.appendChild(player);
      
      transcribeBtn.removeAttribute('disabled');
      btnText.textContent = 'Compress Video';
    };
    video.src = originalFileUrl;
  } 
  
  else if (file.type.startsWith('audio')) {
    mediaType = 'audio';
    dimsRow.style.display = 'none';
    
    // Read audio duration
    originalFileUrl = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      detailDuration.textContent = `${audio.duration.toFixed(1)}s`;
      originalMeta.textContent = 'Audio file (CBR/VBR)';
      
      // Load into visual comparison grid panel
      const player = document.createElement('audio');
      player.src = originalFileUrl;
      player.controls = true;
      originalPlayerWrapper.innerHTML = '';
      originalPlayerWrapper.appendChild(player);
      
      transcribeBtn.removeAttribute('disabled');
      btnText.textContent = 'Compress Audio';
    };
    audio.src = originalFileUrl;
  } 
  
  else {
    alert('Failed to parse file. Please supply a valid Video (MP4, WEBM) or Audio (MP3, WAV) file.');
    clearWorkspace();
  }
}

function clearWorkspace() {
  originalFile = null;
  compressedBlob = null;
  
  if (originalFileUrl) {
    URL.revokeObjectURL(originalFileUrl);
    originalFileUrl = null;
  }
  if (compressedFileUrl) {
    URL.revokeObjectURL(compressedFileUrl);
    compressedFileUrl = null;
  }
  
  originalPlayerWrapper.innerHTML = '';
  compressedPlayerWrapper.innerHTML = '';
  
  fileDetails.style.display = 'none';
  progressCard.style.display = 'none';
  playersGrid.style.display = 'none';
  placeholderScreen.style.display = 'flex';
  placeholderScreen.style.opacity = '1';
  
  transcribeBtn.setAttribute('disabled', 'true');
  btnText.textContent = 'Load Media & Compress';
  
  downloadBtn.setAttribute('disabled', 'true');
  clearEditorBtn.setAttribute('disabled', 'true');
  metaSavings.style.display = 'none';
  
  fileInput.value = '';
  editorStatus.textContent = 'Offline Sandbox Enabled';
}

// -------------------------------------------------------------
// WebAssembly FFmpeg Loading & Core Transcoder
// -------------------------------------------------------------
async function initializeFFmpeg() {
  if (isLoaded) return ffmpeg;
  
  ffmpeg = new FFmpeg();
  
  statusLabel.innerHTML = `<i class="fa-solid fa-cloud-arrow-down fa-bounce"></i> Fetching WebAssembly Core...`;
  progressSpeed.textContent = 'Downloading FFmpeg binaries (~31MB)...';
  
  // unpkg CDN base URL for single-thread / multi-thread core loading
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  
  // Use toBlobURL to bypass worker security policies by compiling a local Blob
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  
  isLoaded = true;
  console.log('FFmpeg WASM core successfully initialized.');
  return ffmpeg;
}

transcribeBtn.addEventListener('click', async () => {
  if (!originalFile) return;
  
  // Toggle loading triggers
  transcribeBtn.setAttribute('disabled', 'true');
  btnSpinner.style.display = 'inline-block';
  btnIcon.style.display = 'none';
  btnText.textContent = 'Initializing WASM...';
  
  progressCard.style.display = 'block';
  progressBar.style.width = '0%';
  statusPercentage.textContent = '0%';
  progressSpeed.textContent = 'Resolving local compiler...';
  
  try {
    // 1. Initialize core compiler
    const core = await initializeFFmpeg();
    
    statusLabel.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Writing virtual file...`;
    progressSpeed.textContent = 'Loading binary stream to memory FS...';
    
    // 2. Write file to virtual memory FS
    const inputName = `input_${Date.now()}`;
    const outputExtension = mediaType === 'video' ? 'mp4' : 'mp3';
    const outputName = `output_${Date.now()}.${outputExtension}`;
    
    await core.writeFile(inputName, await fetchFile(originalFile));
    
    // 3. Register progress callbacks
    core.on('progress', ({ progress }) => {
      // progress is a value from 0 to 1
      const percentage = Math.round(progress * 100);
      statusLabel.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Transcoding Media...`;
      statusPercentage.textContent = `${percentage}%`;
      progressBar.style.width = `${percentage}%`;
      progressSpeed.textContent = `Processing frames client-side (ultrafast)...`;
    });
    
    console.log('FFmpeg CLI command execution started.');
    btnText.textContent = 'Compressing...';
    
    // 4. Run FFmpeg CLI command arrays based on media properties
    if (mediaType === 'video') {
      // Presets CRF mapping
      const crf = preset === 'hq' ? '22' : (preset === 'balanced' ? '27' : '32');
      
      // -c:v libx264: H.264 video codec
      // -crf: Quality factor (larger values shrink size)
      // -preset ultrafast: Speeds up transcoding on CPU up to 5x!
      // -c:a aac: AAC audio compression
      await core.exec([
        '-i', inputName,
        '-c:v', 'libx264',
        '-crf', crf,
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        outputName
      ]);
    } 
    
    else if (mediaType === 'audio') {
      // Bitrate mapping
      const bitrate = preset === 'hq' ? '256k' : (preset === 'balanced' ? '128k' : '96k');
      
      await core.exec([
        '-i', inputName,
        '-c:a', 'libmp3lame',
        '-b:a', bitrate,
        outputName
      ]);
    }
    
    statusLabel.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Reading output...`;
    progressSpeed.textContent = 'Compiling compressed output blob...';
    
    // 5. Read output blob from virtual memory
    const transcodedData = await core.readFile(outputName);
    
    const mimeType = mediaType === 'video' ? 'video/mp4' : 'audio/mp3';
    compressedBlob = new Blob([transcodedData.buffer], { type: mimeType });
    
    // Calculate compression ratios
    const savedBytes = originalFile.size - compressedBlob.size;
    const ratio = ((savedBytes / originalFile.size) * 100).toFixed(0);
    
    metaSavings.style.display = 'inline-block';
    if (ratio > 0) {
      metaSavings.innerHTML = `Saved <strong style="color: var(--success);">${ratio}%</strong> of original file size!`;
    } else {
      metaSavings.innerHTML = `Overhead <strong style="color: var(--warning);">${-ratio}%</strong> (Quality preserves original size)`;
    }
    
    // 6. Delete files to prevent memory leak
    await core.deleteFile(inputName);
    await core.deleteFile(outputName);
    
    // 7. Load into comparison output players
    compressedFileUrl = URL.createObjectURL(compressedBlob);
    
    if (mediaType === 'video') {
      const player = document.createElement('video');
      player.src = compressedFileUrl;
      player.controls = true;
      compressedPlayerWrapper.innerHTML = '';
      compressedPlayerWrapper.appendChild(player);
      compressedMeta.textContent = 'Compressed H.264 MP4';
    } else {
      const player = document.createElement('audio');
      player.src = compressedFileUrl;
      player.controls = true;
      compressedPlayerWrapper.innerHTML = '';
      compressedPlayerWrapper.appendChild(player);
      compressedMeta.textContent = 'Compressed MP3';
    }
    
    // Update badges
    originalSizeBadge.textContent = `${(originalFile.size / 1024 / 1024).toFixed(2)} MB`;
    compressedSizeBadge.textContent = `${(compressedBlob.size / 1024 / 1024).toFixed(2)} MB`;
    
    // Reveal comparative visual studio
    placeholderScreen.style.opacity = '0';
    setTimeout(() => {
      placeholderScreen.style.display = 'none';
      playersGrid.style.display = 'grid';
    }, 300);
    
    downloadBtn.removeAttribute('disabled');
    clearEditorBtn.removeAttribute('disabled');
    
    editorStatus.textContent = 'Media compression successfully completed!';
    resetTranscribeButton();
    
  } catch (error) {
    console.error('Error during media compression:', error);
    resetTranscribeButton();
    alert(`Compression Failed: ${error.message || 'Ensure media has valid streams.'}`);
  }
});

function resetTranscribeButton() {
  transcribeBtn.removeAttribute('disabled');
  btnSpinner.style.display = 'none';
  btnIcon.style.display = 'inline-block';
  btnText.textContent = originalFile ? (mediaType === 'video' ? 'Compress Video' : 'Compress Audio') : 'Load Media & Compress';
  progressCard.style.display = 'none';
}

// -------------------------------------------------------------
// Compressed File Downloader Exporter
// -------------------------------------------------------------
downloadBtn.addEventListener('click', () => {
  if (!compressedBlob || !originalFile) return;
  
  const ext = mediaType === 'video' ? 'mp4' : 'mp3';
  const rawName = originalFile.name.split('.')[0] || 'compressed';
  
  const tempLink = document.createElement('a');
  tempLink.href = compressedFileUrl;
  tempLink.download = `${rawName}-compressed.${ext}`;
  
  document.body.appendChild(tempLink);
  tempLink.click();
  
  document.body.removeChild(tempLink);
  editorStatus.textContent = 'Compressed media file downloaded!';
});

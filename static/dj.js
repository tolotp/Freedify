// ========== DJ MODE, VISUALIZER, CONCERTS, ARTIST BIO ==========
import { state } from './state.js';
import { emit, on } from './event-bus.js';
import { showToast, escapeHtml } from './utils.js';
import { $, $$, audioPlayer, audioPlayer2 } from './dom.js';
import { showLoading, hideLoading } from './ui.js';
import { audio, getActivePlayer, initEqualizer } from './audio-engine.js';

// ========== DJ MODE ==========
const djModeBtn = $('#dj-mode-btn');
const djSetlistModal = $('#dj-setlist-modal');
const djModalClose = $('#dj-modal-close');
const djStyleSelect = $('#dj-style-select');
const djSetlistLoading = $('#dj-setlist-loading');
const djSetlistResults = $('#dj-setlist-results');
const djOrderedTracks = $('#dj-ordered-tracks');
const djGenerateBtn = $('#dj-generate-btn');
const djApplyBtn = $('#dj-apply-btn');

// Musical Key to Camelot Wheel conversion
function musicalKeyToCamelot(key) {
    if (!key) return null;

    // Normalize key: uppercase, handle sharps/flats
    const normalized = key.trim()
        .replace(/major/i, '')
        .replace(/minor/i, 'm')
        .replace(/♯/g, '#')
        .replace(/♭/g, 'b')
        .trim();

    // Mapping of musical keys to Camelot notation
    // Minor keys (A column)
    const minorKeys = {
        'Abm': '1A', 'G#m': '1A',
        'Ebm': '2A', 'D#m': '2A',
        'Bbm': '3A', 'A#m': '3A',
        'Fm': '4A',
        'Cm': '5A',
        'Gm': '6A',
        'Dm': '7A',
        'Am': '8A',
        'Em': '9A',
        'Bm': '10A',
        'F#m': '11A', 'Gbm': '11A',
        'Dbm': '12A', 'C#m': '12A'
    };

    // Major keys (B column)
    const majorKeys = {
        'B': '1B',
        'Gb': '2B', 'F#': '2B',
        'Db': '3B', 'C#': '3B',
        'Ab': '4B', 'G#': '4B',
        'Eb': '5B', 'D#': '5B',
        'Bb': '6B', 'A#': '6B',
        'F': '7B',
        'C': '8B',
        'G': '9B',
        'D': '10B',
        'A': '11B',
        'E': '12B'
    };

    // Check minor first, then major
    if (minorKeys[normalized]) return minorKeys[normalized];
    if (majorKeys[normalized]) return majorKeys[normalized];

    // Try case-insensitive match
    for (const [k, v] of Object.entries(minorKeys)) {
        if (k.toLowerCase() === normalized.toLowerCase()) return v;
    }
    for (const [k, v] of Object.entries(majorKeys)) {
        if (k.toLowerCase() === normalized.toLowerCase()) return v;
    }

    // If already in Camelot format, return as-is
    if (/^[1-9][0-2]?[AB]$/i.test(normalized)) {
        return normalized.toUpperCase();
    }

    return key; // Return original if no match
}

// DJ Mode state
state.djMode = localStorage.getItem('freedify_dj_mode') === 'true';
state.audioFeaturesCache = {}; // Cache audio features by track ID
state.lastSetlistResult = null;

// Initialize DJ mode on load
if (state.djMode) {
    document.body.classList.add('dj-mode-active');
}

// Toggle DJ mode
djModeBtn?.addEventListener('click', () => {
    state.djMode = !state.djMode;
    localStorage.setItem('freedify_dj_mode', state.djMode);
    document.body.classList.toggle('dj-mode-active', state.djMode);

    if (state.djMode) {
        showToast('🎧 DJ Mode activated');
        // Fetch audio features for current queue
        if (state.queue.length > 0) {
            fetchAudioFeaturesForQueue();
        }
    } else {
        showToast('DJ Mode deactivated');
    }
});

// Helper to render DJ Badge
function renderDJBadgeForTrack(track) {
    if (!state.djMode) return '';

    // For local tracks, use embedded audio_features directly (trust Serato)
    const isLocal = track.id?.startsWith('local_');
    const feat = isLocal ? track.audio_features : state.audioFeaturesCache[track.id];

    if (!feat) return '<div class="dj-badge-placeholder" data-id="' + track.id + '"></div>';

    const camelotClass = feat.camelot ? `camelot-${feat.camelot}` : '';
    return `
        <div class="dj-badge-container" style="display: flex;">
            <span class="dj-badge bpm-badge">${feat.bpm} BPM</span>
            <span class="dj-badge camelot-badge ${camelotClass}">${feat.camelot}</span>
        </div>
    `;
}

// Generic fetch features for any list of tracks
async function fetchAudioFeaturesForTracks(tracks) {
    if (!state.djMode || !tracks || tracks.length === 0) return;

    // Filter out already cached AND local files (trust local metadata)
    const tracksToFetch = tracks
        .filter(t => t.id && !t.id.startsWith('LINK:') && !t.id.startsWith('pod_') && !t.id.startsWith('local_'))
        .filter(t => !state.audioFeaturesCache[t.id])
        .map(t => ({
            id: t.id,
            isrc: t.isrc || null,
            name: t.name || null,
            artists: t.artists || null
        }));

    // De-duplicate by ID
    const uniqueTracks = [];
    const seenIds = new Set();
    tracksToFetch.forEach(t => {
        if (!seenIds.has(t.id)) {
            seenIds.add(t.id);
            uniqueTracks.push(t);
        }
    });

    if (uniqueTracks.length === 0) return;

    try {
        const response = await fetch('/api/audio-features/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: uniqueTracks })
        });

        if (response.ok) {
            const data = await response.json();
            data.features.forEach((feat, i) => {
                if (feat) {
                    state.audioFeaturesCache[uniqueTracks[i].id] = feat;
                }
            });
            // Trigger UI updates
            updateDJBadgesInUI();
            emit('updatePlayerUI');
        }
    } catch (err) {
        console.warn('Failed to fetch audio features:', err);
    }
}

// Update all badges in DOM
function updateDJBadgesInUI() {
    // Update placeholders
    $$('.dj-badge-placeholder').forEach(el => {
        const id = el.dataset.id;
        const feat = state.audioFeaturesCache[id];
        if (feat) {
            const camelotClass = feat.camelot ? `camelot-${feat.camelot}` : '';
            el.outerHTML = `
                <div class="dj-badge-container" style="display: flex;">
                    <span class="dj-badge bpm-badge">${feat.bpm} BPM</span>
                    <span class="dj-badge camelot-badge ${camelotClass}">${feat.camelot}</span>
                </div>
            `;
        }
    });

    // Update Player
    if (state.currentIndex >= 0 && state.queue[state.currentIndex]) {
        emit('updatePlayerUI');
    }
}

// Fetch audio features for tracks in queue
async function fetchAudioFeaturesForQueue() {
    await fetchAudioFeaturesForTracks(state.queue);
    addDJBadgesToQueue();
}

// Open DJ setlist modal
function openDJSetlistModal() {
    if (state.queue.length < 3) {
        showToast('Add at least 3 tracks to queue for setlist generation');
        return;
    }

    djSetlistModal?.classList.remove('hidden');
    djSetlistLoading?.classList.add('hidden');
    djSetlistResults?.classList.add('hidden');
    djApplyBtn?.classList.add('hidden');
    state.lastSetlistResult = null;
}

function closeDJSetlistModal() {
    djSetlistModal?.classList.add('hidden');
}

djModalClose?.addEventListener('click', closeDJSetlistModal);
djSetlistModal?.addEventListener('click', (e) => {
    if (e.target === djSetlistModal) closeDJSetlistModal();
});

// Generate setlist
djGenerateBtn?.addEventListener('click', async () => {
    // Ensure we have audio features
    await fetchAudioFeaturesForQueue();

    // Build tracks data - use embedded audio_features for local, cache for others
    const tracksData = state.queue.map(t => {
        const isLocal = t.id.startsWith('local_');
        const feat = isLocal ? t.audio_features : state.audioFeaturesCache[t.id];
        return {
            id: t.id,
            name: t.name,
            artists: t.artists,
            bpm: feat?.bpm || 0,
            camelot: feat?.camelot || '?',
            energy: feat?.energy || 0.5
        };
    });

    djSetlistLoading?.classList.remove('hidden');
    djSetlistResults?.classList.add('hidden');

    try {
        const response = await fetch('/api/dj/generate-setlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tracks: tracksData,
                style: djStyleSelect?.value || 'progressive'
            })
        });

        if (!response.ok) throw new Error('Generation failed');

        const result = await response.json();
        state.lastSetlistResult = result;

        // Render results
        renderSetlistResults(result, tracksData);

    } catch (err) {
        console.error('Setlist generation error:', err);
        showToast('Failed to generate setlist');
    } finally {
        djSetlistLoading?.classList.add('hidden');
    }
});

function renderSetlistResults(result, tracksData) {
    if (!djOrderedTracks) return;

    const trackMap = {};
    tracksData.forEach(t => trackMap[t.id] = t);
    state.queue.forEach(t => trackMap[t.id] = { ...trackMap[t.id], ...t });

    let html = '';
    result.ordered_ids.forEach((id, i) => {
        const track = trackMap[id];
        if (!track) return;

        // Use embedded audio_features for local tracks, cache for others
        const isLocal = id.startsWith('local_');
        const feat = isLocal ? (track.audio_features || {}) : (state.audioFeaturesCache[id] || {});
        const camelotClass = feat.camelot ? `camelot-${feat.camelot}` : '';

        html += `
            <div class="dj-track-item">
                <div class="dj-track-number">${i + 1}</div>
                <div class="dj-track-info">
                    <div class="dj-track-name">${escapeHtml(track.name)}</div>
                    <div class="dj-track-artist">${escapeHtml(track.artists)}</div>
                </div>
                <div class="dj-track-meta">
                    <span class="dj-badge bpm-badge">${feat.bpm || '?'} BPM</span>
                    <span class="dj-badge camelot-badge ${camelotClass}">${feat.camelot || '?'}</span>
                </div>
            </div>
        `;

        // Add transition tip if available
        if (i < result.suggestions?.length) {
            const sug = result.suggestions[i];
            const tipClass = sug.harmonic_match ? 'harmonic' : (sug.bpm_diff > 8 ? 'caution' : '');
            const technique = sug.technique ? `<span class="dj-technique-badge">${escapeHtml(sug.technique)}</span>` : '';
            const timing = sug.timing ? `<span class="dj-timing">${escapeHtml(sug.timing)}</span>` : '';
            const tipText = sug.tip ? escapeHtml(sug.tip) : '';

            html += `
                <div class="dj-transition ${tipClass}">
                    <div class="dj-transition-header">
                        💡 ${technique} ${timing}
                    </div>
                    <div class="dj-transition-tip">${tipText}</div>
                </div>
            `;
        }
    });

    djOrderedTracks.innerHTML = html;
    djSetlistResults?.classList.remove('hidden');
    djApplyBtn?.classList.remove('hidden');

    // Show method used
    const methodText = result.method === 'ai-gemini-2.0-flash' ? '✨ AI Generated' : '📊 Algorithm';
    showToast(`${methodText} setlist ready!`);
}

// Apply setlist to queue
djApplyBtn?.addEventListener('click', () => {
    if (!state.lastSetlistResult?.ordered_ids) return;

    const trackMap = {};
    state.queue.forEach(t => trackMap[t.id] = t);

    const newQueue = [];
    state.lastSetlistResult.ordered_ids.forEach(id => {
        if (trackMap[id]) newQueue.push(trackMap[id]);
    });

    // Add any tracks not in the result (shouldn't happen but safety)
    state.queue.forEach(t => {
        if (!newQueue.find(q => q.id === t.id)) {
            newQueue.push(t);
        }
    });

    state.queue = newQueue;
    state.currentIndex = 0;
    emit('updateQueueUI');

    closeDJSetlistModal();
    showToast('Queue reordered! Ready to mix 🎧');
});

// Add "Generate DJ Set" button to queue header
const queueHeader = $('.queue-header');
if (queueHeader) {
    const djBtn = document.createElement('button');
    djBtn.className = 'dj-generate-set-btn';
    djBtn.innerHTML = '✨ Generate Set';
    djBtn.addEventListener('click', openDJSetlistModal);
    queueHeader.querySelector('.queue-controls')?.prepend(djBtn);
}

// Modify renderQueueItem to show DJ badges (override/extend existing)
function updateQueueWithDJ() {
    if (state.djMode && state.queue.length > 0) {
        fetchAudioFeaturesForQueue().then(() => {
            addDJBadgesToQueue();
            // Also update player UI if needed
            if (state.currentIndex >= 0) {
                emit('updatePlayerUI');
            }
        });
    }
}

function addDJBadgesToQueue() {
    if (!state.djMode) return;

    const queueItems = $$('#queue-container .queue-item');
    queueItems.forEach((item, i) => {
        if (i >= state.queue.length) return;
        const track = state.queue[i];
        const feat = state.audioFeaturesCache[track.id];

        // Remove existing badges
        const existing = item.querySelector('.dj-badge-container');
        if (existing) existing.remove();

        if (feat) {
            const camelotClass = feat.camelot ? `camelot-${feat.camelot}` : '';
            const badgeContainer = document.createElement('div');
            badgeContainer.className = 'dj-badge-container';
            badgeContainer.innerHTML = `
                <span class="dj-badge bpm-badge">${feat.bpm} BPM</span>
                <span class="dj-badge camelot-badge ${camelotClass}">${feat.camelot}</span>
                <div class="energy-bar"><div class="energy-fill" style="width: ${feat.energy * 100}%"></div></div>
            `;
            item.querySelector('.queue-info')?.appendChild(badgeContainer);
        }
    });
}

// Escape key closes DJ modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !djSetlistModal?.classList.contains('hidden')) {
        closeDJSetlistModal();
    }
});

// Init DJ Mode (called from main)
function initDJMode() {
    // Listen for queue updates to add DJ badges
    on('updateQueueUI', () => {
        updateQueueWithDJ();
    });
}


// ========== AUDIO VISUALIZER ==========
const visualizerBtn = $('#fs-visualizer-btn');
const visualizerOverlay = $('#visualizer-overlay');
const visualizerCanvas = $('#visualizer-canvas');
const visualizerCanvasWebgl = $('#visualizer-canvas-webgl');
const visualizerClose = $('#visualizer-close');
const vizTrackName = $('#viz-track-name');
const vizTrackArtist = $('#viz-track-artist');
const vizModeBtns = document.querySelectorAll('.viz-mode-btn');

let visualizerActive = false;
let visualizerMode = 'bars';
let vizAnalyser = null;
let animationId = null;
let particles = [];

// Butterchurn (MilkDrop) variables
let butterchurnVisualizer = null;
let butterchurnPresets = [];
let butterchurnPresetNames = [];
let currentPresetIndex = 0;
let _butterchurnLoading = false;

function _loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function ensureButterchurnLoaded() {
    if (window.butterchurn) return;
    if (_butterchurnLoading) {
        // Wait for the other caller to finish loading
        while (_butterchurnLoading) await new Promise(r => setTimeout(r, 100));
        return;
    }
    _butterchurnLoading = true;
    try {
        await _loadScript('https://cdn.jsdelivr.net/npm/butterchurn@2.6.7/lib/butterchurn.min.js');
        await _loadScript('https://cdn.jsdelivr.net/npm/butterchurn-presets@2.4.7/lib/butterchurnPresets.min.js');
    } finally {
        _butterchurnLoading = false;
    }
}

function initButterchurn() {
    const bc = window.butterchurn?.default || window.butterchurn;
    if (butterchurnVisualizer || !bc) {
        if (!bc) console.error('Butterchurn library not loaded yet');
        return null;
    }

    try {
        const canvas = visualizerCanvasWebgl || visualizerCanvas; // Fallback if element missing
        butterchurnVisualizer = bc.createVisualizer(
            audio.audioContext,
            canvas,
            {
                width: canvas.width,
                height: canvas.height,
                pixelRatio: window.devicePixelRatio || 1,
                textureRatio: 1
            }
        );

        // Load presets
        let presets = window.butterchurnPresets?.default || window.butterchurnPresets;
        if (presets) {
            // Check if it's a module with getPresets
            if (typeof presets.getPresets === 'function') {
                presets = presets.getPresets();
            }

            butterchurnPresets = presets;
            butterchurnPresetNames = Object.keys(butterchurnPresets);

            // Load a random preset to start
            if (butterchurnPresetNames.length > 0) {
                currentPresetIndex = Math.floor(Math.random() * butterchurnPresetNames.length);
                loadButterchurnPreset(currentPresetIndex);
            }
        }

        // Connect to audio
        butterchurnVisualizer.connectAudio(vizAnalyser || audio.volumeBoostGain);

        return butterchurnVisualizer;
    } catch (e) {
        console.error('Failed to init Butterchurn:', e);
        return null;
    }
}

function loadButterchurnPreset(index) {
    if (!butterchurnVisualizer || butterchurnPresetNames.length === 0) return;

    // Ensure index is valid
    if (index < 0) index = butterchurnPresetNames.length - 1;
    if (index >= butterchurnPresetNames.length) index = 0;
    currentPresetIndex = index;

    const presetName = butterchurnPresetNames[index];
    const preset = butterchurnPresets[presetName];


    if (preset) {
        try {
            butterchurnVisualizer.loadPreset(preset, 1.0); // 1.0 = blend time
            showToast(`🎆 ${presetName}`);
        } catch (err) {
            console.error('Error loading preset:', err);
        }
    }
}

function nextButterchurnPreset() {
    loadButterchurnPreset(currentPresetIndex + 1);
}

function prevButterchurnPreset() {
    loadButterchurnPreset(currentPresetIndex - 1);
}

function randomButterchurnPreset() {
    currentPresetIndex = Math.floor(Math.random() * butterchurnPresetNames.length);
    loadButterchurnPreset(currentPresetIndex);
}

function initVisualizerAnalyser() {
    if (vizAnalyser) return;

    // We need to use the existing audioContext from the equalizer
    // First ensure EQ is initialized (which creates the audioContext)
    if (!audio.audioContext) {
        initEqualizer();
    }

    if (!audio.audioContext) {
        console.error('No audio context available for visualizer');
        return;
    }

    try {
        // Create analyser and connect it to the audio chain
        vizAnalyser = audio.audioContext.createAnalyser();
        vizAnalyser.fftSize = 256;
        vizAnalyser.smoothingTimeConstant = 0.8;

        // Connect the volumeBoostGain to the analyser, then analyser to destination
        // We need to disconnect volumeBoostGain from destination first
        // Actually, let's just connect analyser in parallel to monitor the output
        if (audio.volumeBoostGain) {
            audio.volumeBoostGain.connect(vizAnalyser);
        } else {
            // If no EQ chain, try direct connection (fallback)
            console.warn('No volumeBoostGain, visualizer may not work well');
        }

    } catch (e) {
        console.error('Failed to init visualizer analyser:', e);
    }
}

function drawBars(ctx, dataArray, width, height) {
    const barCount = 64;
    const barWidth = width / barCount - 2;
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#ec4899');
    gradient.addColorStop(0.5, '#f59e0b');
    gradient.addColorStop(1, '#10b981');

    for (let i = 0; i < barCount; i++) {
        const barHeight = (dataArray[i] / 255) * height * 0.8;
        const x = i * (barWidth + 2);

        ctx.fillStyle = gradient;
        ctx.fillRect(x, height - barHeight, barWidth, barHeight);

        // Mirror reflection
        ctx.globalAlpha = 0.3;
        ctx.fillRect(x, height, barWidth, barHeight * 0.3);
        ctx.globalAlpha = 1;
    }
}

function drawWave(ctx, dataArray, width, height) {
    ctx.beginPath();
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 3;

    const sliceWidth = width / dataArray.length;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 255;
        const y = v * height;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        x += sliceWidth;
    }

    ctx.stroke();

    // Draw mirrored wave
    ctx.beginPath();
    ctx.strokeStyle = '#f59e0b';
    ctx.globalAlpha = 0.5;
    x = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 255;
        const y = height - (v * height);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
}


function drawParticles(ctx, dataArray, width, height) {
    // Spawn new particles based on audio intensity
    const avgIntensity = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

    if (avgIntensity > 100 && particles.length < 200) {
        for (let i = 0; i < 3; i++) {
            particles.push({
                x: Math.random() * width,
                y: height + 10,
                vx: (Math.random() - 0.5) * 4,
                vy: -(Math.random() * 5 + 2),
                size: Math.random() * 6 + 2,
                color: `hsl(${Math.random() * 60 + 300}, 100%, 60%)`,
                life: 1
            });
        }
    }

    // Update and draw particles
    particles = particles.filter(p => p.life > 0);
    for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.02; // Gravity
        p.life -= 0.01;

        ctx.beginPath();
        const radius = Math.max(0, p.size * p.life);
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function renderVisualizer() {
    if (!visualizerActive || !vizAnalyser) return;

    const canvas = visualizerCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Get frequency data
    const bufferLength = vizAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    vizAnalyser.getByteFrequencyData(dataArray);

    // Clear canvas with fade effect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);

    // Draw based on mode
    switch (visualizerMode) {
        case 'milkdrop':
            // Butterchurn handles its own rendering
            if (butterchurnVisualizer) {
                butterchurnVisualizer.render();
            }
            break;
        case 'bars':
            drawBars(ctx, dataArray, width, height);
            break;
        case 'wave':
            drawWave(ctx, dataArray, width, height);
            break;

        case 'particles':
            drawParticles(ctx, dataArray, width, height);
            break;
    }

    animationId = requestAnimationFrame(renderVisualizer);
}

// Visualizer Idle State
let visualizerIdleTimer = null;
let vizInfoBriefTimer = null;
let visualizerListenersAttached = false;

function resetVisualizerIdleTimer() {
    if (!visualizerActive) return;

    // Remove idle class (show UI)
    visualizerOverlay.classList.remove('user-idle');

    // Clear existing timer
    if (visualizerIdleTimer) clearTimeout(visualizerIdleTimer);

    // Set new timer (10s)
    visualizerIdleTimer = setTimeout(() => {
        if (visualizerActive) {
            visualizerOverlay.classList.add('user-idle');
        }
    }, 10000);
}

function showVisualizerInfoBriefly() {
    if (!visualizerActive) return;

    // Ensure info is updated
    const track = state.queue[state.currentIndex];
    if (track) {
        vizTrackName.textContent = track.name || 'Unknown Track';
        vizTrackArtist.textContent = track.artists || '';
    }

    // Add temp-visible class
    const info = document.querySelector('.visualizer-track-info');
    if (info) {
        info.classList.add('temp-visible');

        if (vizInfoBriefTimer) clearTimeout(vizInfoBriefTimer);

        vizInfoBriefTimer = setTimeout(() => {
            info.classList.remove('temp-visible');
        }, 15000); // 15s
    }
}

function initVisualizerIdleState() {
    if (visualizerListenersAttached) return;

    const events = ['mousemove', 'mousedown', 'click', 'keydown', 'touchstart'];
    events.forEach(event => {
        document.addEventListener(event, resetVisualizerIdleTimer);
    });

    visualizerListenersAttached = true;
    resetVisualizerIdleTimer();
}

function openVisualizer() {
    const track = state.queue[state.currentIndex];
    if (!track) {
        showToast('Play a track first');
        return;
    }

    // Initialize visualizer analyser (uses existing audioContext from EQ)
    initVisualizerAnalyser();
    if (audio.audioContext?.state === 'suspended') {
        audio.audioContext.resume();
    }

    // Init idle state
    initVisualizerIdleState();
    visualizerOverlay.classList.remove('user-idle');

    // Update track info
    vizTrackName.textContent = track.name || 'Unknown Track';
    vizTrackArtist.textContent = track.artists || '';

    // Set canvas size
    visualizerCanvas.width = window.innerWidth;
    visualizerCanvas.height = window.innerHeight;
    if (visualizerCanvasWebgl) {
        visualizerCanvasWebgl.width = window.innerWidth;
        visualizerCanvasWebgl.height = window.innerHeight;
    }

    // Initial visibility
    if (visualizerMode === 'milkdrop') {
        ensureButterchurnLoaded().then(() => { if (!butterchurnVisualizer) initButterchurn(); });
        visualizerCanvasWebgl?.classList.remove('hidden');
        visualizerCanvas?.classList.add('hidden');
    } else {
        visualizerCanvasWebgl?.classList.add('hidden');
        visualizerCanvas?.classList.remove('hidden');
    }

    // Show overlay
    visualizerOverlay.classList.remove('hidden');
    visualizerActive = true;

    // Start rendering
    renderVisualizer();
}

function closeVisualizer() {
    visualizerActive = false;
    visualizerOverlay.classList.add('hidden');

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
}

// Button handlers
if (visualizerBtn) {
    visualizerBtn.addEventListener('click', openVisualizer);
}
// Also add to more menu visualizer button
const menuVisualizerBtn = $('#menu-visualizer-btn');
if (menuVisualizerBtn) {
    menuVisualizerBtn.addEventListener('click', openVisualizer);
}

if (visualizerClose) {
    visualizerClose.addEventListener('click', closeVisualizer);
}

// Close on ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && visualizerActive) {
        closeVisualizer();
    }

    // N for Next Preset (MilkDrop)
    if ((e.key === 'n' || e.key === 'N') && visualizerActive && visualizerMode === 'milkdrop') {
        nextButterchurnPreset();
    }

    // P for Prev Preset (MilkDrop)
    if ((e.key === 'p' || e.key === 'P') && visualizerActive && visualizerMode === 'milkdrop') {
        prevButterchurnPreset();
    }
});

// Mode switching
vizModeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Toggle preset button visibility
        const isMilkDrop = btn.dataset.mode === 'milkdrop';
        const nextPresetBtn = document.getElementById('viz-next-preset');
        const prevPresetBtn = document.getElementById('viz-prev-preset');

        if (nextPresetBtn) nextPresetBtn.style.display = isMilkDrop ? 'block' : 'none';
        if (prevPresetBtn) prevPresetBtn.style.display = isMilkDrop ? 'block' : 'none';

        // Handle normal mode switching
        if (!btn.id || (btn.id !== 'viz-next-preset' && btn.id !== 'viz-prev-preset')) {
            vizModeBtns.forEach(b => {
                if (b.id !== 'viz-next-preset' && b.id !== 'viz-prev-preset') b.classList.remove('active');
            });
            btn.classList.add('active');
            visualizerMode = btn.dataset.mode;
            particles = []; // Clear particles when switching modes

            // Init Butterchurn if needed (lazy-load scripts first)
            if (visualizerMode === 'milkdrop') {
                ensureButterchurnLoaded().then(() => { if (!butterchurnVisualizer) initButterchurn(); });
                // Toggle canvases
                if (visualizerCanvasWebgl) {
                    visualizerCanvasWebgl.classList.remove('hidden');
                    visualizerCanvas.classList.add('hidden');
                }
            } else {
                // Toggle canvases
                if (visualizerCanvasWebgl) {
                    visualizerCanvasWebgl.classList.add('hidden');
                    visualizerCanvas.classList.remove('hidden');
                }
            }
        }
    });
});

const vizNextPresetBtn = document.getElementById('viz-next-preset');
if (vizNextPresetBtn) {
    vizNextPresetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        nextButterchurnPreset();
    });
}
const vizPrevPresetBtn = document.getElementById('viz-prev-preset');
if (vizPrevPresetBtn) {
    vizPrevPresetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        prevButterchurnPreset();
    });
}

// Handle window resize
window.addEventListener('resize', () => {
    if (visualizerActive) {
        visualizerCanvas.width = window.innerWidth;
        visualizerCanvas.height = window.innerHeight;

        if (visualizerCanvasWebgl) {
            visualizerCanvasWebgl.width = window.innerWidth;
            visualizerCanvasWebgl.height = window.innerHeight;
        }

        if (butterchurnVisualizer) {
            butterchurnVisualizer.setRendererSize(window.innerWidth, window.innerHeight);
        }
    }
});

// Init Visualizer (called from main)
function initVisualizer() {
    // Visualizer is initialized on-demand when opened
}


// ========== CONCERT ALERTS ==========

const concertModal = $('#concert-modal');
const concertModalClose = $('#concert-modal-close');
const concertMenuBtn = $('#concert-search-menu-btn');
const concertResults = $('#concert-results');
const concertLoading = $('#concert-loading');
const concertEmpty = $('#concert-empty');
const concertArtistSearch = $('#concert-artist-search');
const concertSearchBtn = $('#concert-search-btn');
const concertTabs = $$('.concert-tab');
const concertRecentSection = $('#concert-recent-section');
const concertSearchSection = $('#concert-search-section');

// Concert State
const concertState = {
    currentTab: 'recent'
};

// Open Concert Modal (optionally with artist pre-filled from main search)
function openConcertModal(artistQuery = null) {
    concertModal?.classList.remove('hidden');

    // If artist query provided, switch to search tab and auto-search
    if (artistQuery && artistQuery.trim()) {
        concertState.currentTab = 'search';
        concertTabs.forEach(t => t.classList.remove('active'));
        concertTabs.forEach(t => { if (t.dataset.tab === 'search') t.classList.add('active'); });
        concertRecentSection?.classList.add('hidden');
        concertSearchSection?.classList.remove('hidden');

        if (concertArtistSearch) {
            concertArtistSearch.value = artistQuery.trim();
        }
        searchConcerts(artistQuery.trim());
    } else if (concertState.currentTab === 'recent') {
        // Load concerts for recent artists by default
        loadConcertsForRecentArtists();
    }
}

// Close Concert Modal
function closeConcertModal() {
    concertModal?.classList.add('hidden');
}

// Get unique artists from recent listen history
function getRecentArtists() {
    const artistSet = new Set();
    const artists = [];

    // Get from current queue
    state.queue.forEach(track => {
        if (track.artists && !artistSet.has(track.artists)) {
            artistSet.add(track.artists);
            artists.push(track.artists.split(',')[0].trim()); // Take first artist
        }
    });

    // Limit to 10 unique artists
    return artists.slice(0, 10);
}

// Load concerts for recent artists
async function loadConcertsForRecentArtists() {
    const artists = getRecentArtists();

    if (artists.length === 0) {
        concertResults.innerHTML = '';
        concertEmpty.classList.remove('hidden');
        concertEmpty.querySelector('p').textContent = 'Listen to some music first to see concert recommendations!';
        return;
    }

    concertLoading.classList.remove('hidden');
    concertEmpty.classList.add('hidden');
    concertResults.innerHTML = '';

    try {
        const response = await fetch(`/api/concerts/for-artists?artists=${encodeURIComponent(artists.join(','))}`);
        const data = await response.json();

        concertLoading.classList.add('hidden');

        if (data.events && data.events.length > 0) {
            renderConcertCards(data.events);
        } else {
            concertEmpty.classList.remove('hidden');
            concertEmpty.querySelector('p').textContent = 'No upcoming concerts found for your recent artists';
        }
    } catch (error) {
        console.error('Concert fetch error:', error);
        concertLoading.classList.add('hidden');
        concertEmpty.classList.remove('hidden');
        concertEmpty.querySelector('p').textContent = 'Failed to load concerts. Check API keys.';
    }
}

// Search concerts for a specific artist
async function searchConcerts(artist) {
    if (!artist.trim()) return;

    concertLoading.classList.remove('hidden');
    concertEmpty.classList.add('hidden');
    concertResults.innerHTML = '';

    try {
        const response = await fetch(`/api/concerts/search?artist=${encodeURIComponent(artist)}`);
        const data = await response.json();

        concertLoading.classList.add('hidden');

        if (data.events && data.events.length > 0) {
            renderConcertCards(data.events);
        } else {
            concertEmpty.classList.remove('hidden');
            concertEmpty.querySelector('p').textContent = `No upcoming concerts found for "${artist}"`;
        }
    } catch (error) {
        console.error('Concert search error:', error);
        concertLoading.classList.add('hidden');
        concertEmpty.classList.remove('hidden');
        concertEmpty.querySelector('p').textContent = 'Search failed. Check API keys.';
    }
}

// Render concert cards
function renderConcertCards(events) {
    concertResults.innerHTML = events.map(event => {
        const date = event.date ? new Date(event.date + 'T00:00:00').toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        }) : 'TBA';

        const time = event.time ? formatConcertTime(event.time) : '';
        const location = [event.city, event.state, event.country].filter(Boolean).join(', ');
        const priceRange = event.price_min && event.price_max
            ? `$${Math.round(event.price_min)} - $${Math.round(event.price_max)}`
            : event.price_min
                ? `From $${Math.round(event.price_min)}`
                : '';

        return `
            <div class="concert-card">
                ${event.image
                    ? `<img class="concert-card-image" src="${event.image}" alt="${event.artist}" onerror="this.outerHTML='<div class=\\'concert-card-image placeholder\\'>🎵</div>'">`
                    : '<div class="concert-card-image placeholder">🎵</div>'
                }
                <div class="concert-card-info">
                    <div class="concert-card-artist">
                        ${event.artist || event.name}
                        <span class="concert-source-badge">${event.source}</span>
                    </div>
                    <div class="concert-card-venue">📍 ${event.venue}${location ? `, ${location}` : ''}</div>
                    <div class="concert-card-date">📅 ${date}${time ? ` • ${time}` : ''}</div>
                    ${priceRange ? `<div class="concert-card-price">💰 ${priceRange}</div>` : ''}
                </div>
                <div class="concert-card-actions">
                    ${event.ticket_url
                        ? `<a href="${event.ticket_url}" target="_blank" rel="noopener" class="concert-ticket-btn">🎫 Tickets</a>`
                        : ''
                    }
                </div>
            </div>
        `;
    }).join('');
}

// Format time from HH:MM:SS to readable
function formatConcertTime(timeStr) {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
}

// Event Listeners
concertMenuBtn?.addEventListener('click', () => {
    // Get text from main search input if any
    const mainSearchInput = $('#search-input');
    const artistQuery = mainSearchInput?.value || '';
    openConcertModal(artistQuery);
    // Close the more menu
    $('#search-more-menu')?.classList.add('hidden');
});
concertModalClose?.addEventListener('click', closeConcertModal);
concertModal?.addEventListener('click', (e) => {
    if (e.target === concertModal) closeConcertModal();
});

// Tab switching
concertTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        concertState.currentTab = tabName;

        // Update active tab
        concertTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Show/hide sections
        if (tabName === 'recent') {
            concertRecentSection.classList.remove('hidden');
            concertSearchSection.classList.add('hidden');
            loadConcertsForRecentArtists();
        } else {
            concertRecentSection.classList.add('hidden');
            concertSearchSection.classList.remove('hidden');
            concertResults.innerHTML = '';
            concertEmpty.classList.add('hidden');
        }
    });
});

// Search button
concertSearchBtn?.addEventListener('click', () => {
    searchConcerts(concertArtistSearch?.value || '');
});

// Search on Enter
concertArtistSearch?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        searchConcerts(concertArtistSearch.value);
    }
});

// Init Concert Alerts (called from main)
function initConcertAlerts() {
    // Concert alerts are initialized via event listeners above
}


// ==================== ARTIST BIO MODAL ====================
const artistBioModal = $('#artist-bio-modal');
const artistBioClose = $('#artist-bio-close');
const artistBioOverlay = $('#artist-bio-overlay');
const artistBioImg = $('#artist-bio-img');
const artistBioName = $('#artist-bio-name');
const artistBioGenres = $('#artist-bio-genres');
const artistBioText = $('#artist-bio-text');
const artistBioSocials = $('#artist-bio-socials');
const artistSocialsSection = $('#artist-socials-section');

function closeArtistBio() {
    artistBioModal?.classList.add('hidden');
}

artistBioClose?.addEventListener('click', closeArtistBio);
artistBioOverlay?.addEventListener('click', closeArtistBio);

// Handle downward drag/swipe to close (simple implementation)
const artistBioContent = $('.artist-bio-content');
let bioStartY = 0;
artistBioContent?.addEventListener('touchstart', e => {
    bioStartY = e.touches[0].clientY;
}, {passive: true});
artistBioContent?.addEventListener('touchend', e => {
    const endY = e.changedTouches[0].clientY;
    if (endY - bioStartY > 100) { // Dragged down significantly
        closeArtistBio();
    }
});

async function showArtistBio(artistName) {
    if (!artistName || artistName === 'Unknown' || artistName === '-') return;

    // Show modal, set loading state
    artistBioModal?.classList.remove('hidden');
    if (artistBioName) artistBioName.textContent = artistName;
    if (artistBioImg) artistBioImg.src = '/static/icon.svg';
    if (artistBioGenres) artistBioGenres.innerHTML = '';
    if (artistBioText) {
        artistBioText.innerHTML = '';
        artistBioText.classList.add('loading-pulse');
    }
    if (artistBioSocials) artistBioSocials.innerHTML = '';
    artistSocialsSection?.classList.add('hidden');

    try {
        const res = await fetch(`/api/artist/${encodeURIComponent(artistName)}/bio`);
        if (!res.ok) throw new Error('Artist not found');
        const data = await res.json();

        artistBioText?.classList.remove('loading-pulse');

        if (data.image && artistBioImg) {
            artistBioImg.src = data.image;
        }

        if (data.genres && data.genres.length > 0 && artistBioGenres) {
            artistBioGenres.innerHTML = data.genres.map(g => `<span class="genre-pill">${escapeHtml(g)}</span>`).join('');
        }

        if (artistBioText) {
            if (data.bio) {
                artistBioText.innerHTML = data.bio;
            } else {
                artistBioText.innerHTML = '<em>No biography available.</em>';
            }
        }

        if (data.socials && data.socials.length > 0 && artistSocialsSection && artistBioSocials) {
            artistSocialsSection.classList.remove('hidden');
            artistBioSocials.innerHTML = data.socials.map(s => `
                <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="social-link">
                    <span class="social-icon">${s.icon}</span>
                    <span>${escapeHtml(s.label)}</span>
                </a>
            `).join('');
        }

    } catch (e) {
        console.error('Artist bio error:', e);
        artistBioText?.classList.remove('loading-pulse');
        if (artistBioText) {
            artistBioText.innerHTML = '<em>Could not load artist information.</em>';
        }
    }

    // Fetch similar artists
    const similarSection = $('#artist-similar-section');
    const similarList = $('#artist-bio-similar');
    if (similarSection && similarList) {
        similarSection.classList.add('hidden');
        similarList.innerHTML = '';

        try {
            const simRes = await fetch(`/api/lastfm/artist/${encodeURIComponent(artistName)}/similar`);
            if (simRes.ok) {
                const simData = await simRes.json();
                if (simData.artists && simData.artists.length > 0) {
                    similarSection.classList.remove('hidden');
                    similarList.innerHTML = simData.artists.map(a => {
                        const safeName = escapeHtml(a.name).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
                        return `
                        <div class="similar-artist-chip" onclick="showArtistBio(this.dataset.artist)" data-artist="${safeName}">
                            <span class="similar-artist-name">${escapeHtml(a.name)}</span>
                        </div>
                    `}).join('');
                }
            }
        } catch (e) {
            console.error('Similar artists error:', e);
        }
    }
}

// Keep window.showArtistBio for inline onclick handlers
window.showArtistBio = showArtistBio;

// Bind clicks to dynamically open artist bio (only from player bar)
document.addEventListener('click', (e) => {
    const target = e.target;
    if (
        target.id === 'player-artist' ||
        target.id === 'fs-artist'
    ) {
        e.preventDefault();
        e.stopPropagation();
        const artistName = target.textContent.trim();
        showArtistBio(artistName);
    }
});


// ========== EXPORTS ==========
export {
    initDJMode,
    fetchAudioFeaturesForTracks,
    renderDJBadgeForTrack,
    initVisualizer,
    initConcertAlerts,
    showArtistBio,
    visualizerActive,
    showVisualizerInfoBriefly
};

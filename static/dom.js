/**
 * Freedify DOM Module
 * Selector helpers, DOM element references, and iOS audio keepalive
 */

// ========== SELECTOR HELPERS ==========
export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => document.querySelectorAll(selector);

// ========== iOS AUDIO KEEPALIVE ==========
let iosAudioContext = null;
let iosKeepAliveStarted = false;

function startIOSAudioKeepAlive() {
    if (iosKeepAliveStarted) return;

    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;

        iosAudioContext = new AudioContext();

        const oscillator = iosAudioContext.createOscillator();
        const gainNode = iosAudioContext.createGain();

        gainNode.gain.value = 0;
        oscillator.frequency.value = 1;
        oscillator.type = 'sine';

        oscillator.connect(gainNode);
        gainNode.connect(iosAudioContext.destination);
        oscillator.start();

        iosKeepAliveStarted = true;

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && iosAudioContext?.state === 'suspended') {
                iosAudioContext.resume();
            }
        });
    } catch (e) {
    }
}

// Start keepalive on first user interaction (required by iOS)
document.addEventListener('click', () => startIOSAudioKeepAlive(), { once: true });
document.addEventListener('touchstart', () => startIOSAudioKeepAlive(), { once: true });

// ========== GLOBAL IMAGE ERROR HANDLER ==========
document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG' && e.target.src && !e.target.src.includes('placeholder.svg') && !e.target.dataset.errorHandled) {
        e.target.dataset.errorHandled = 'true';
        e.target.src = '/static/placeholder.svg';
    }
}, true);

// ========== DOM ELEMENT REFERENCES ==========
export const searchInput = $('#search-input');
export const searchClear = $('#search-clear');
export const typeBtns = $$('.type-btn');
export const resultsSection = $('#results-section');
export const resultsContainer = $('#results-container');
export const detailView = $('#detail-view');
export const detailInfo = $('#detail-info');
export const detailTracks = $('#detail-tracks');
export const backBtn = $('#back-btn');
export const queueAllBtn = $('#queue-all-btn');
export const shuffleBtn = $('#shuffle-btn');
export const queueSection = $('#queue-section');
export const queueContainer = $('#queue-container');
export const queueClose = $('#queue-close');
export const queueClear = $('#queue-clear');
export const queueCount = $('#queue-count');
export const queueSelectAll = $('#queue-select-all');
export const queueSavePlaylistBtn = $('#queue-save-playlist-btn');
export const queueBtn = $('#queue-btn');
export const fsToggleBtn = $('#fs-toggle-btn');
export const fullscreenPlayer = $('#fullscreen-player');
export const fsCloseBtn = $('#fs-close-btn');
export const fsArt = $('#fs-art');
export const fsTitle = $('#fs-title');
export const fsArtist = $('#fs-artist');
export const fsCurrentTime = $('#fs-current-time');
export const fsDuration = $('#fs-duration');
export const fsProgressBar = $('#fs-progress-bar');
export const fsPlayBtn = $('#fs-play-btn');
export const fsPrevBtn = $('#fs-prev-btn');
export const fsNextBtn = $('#fs-next-btn');
export const loadingOverlay = $('#loading-overlay');
export const loadingText = $('#loading-text');
export const errorMessage = $('#error-message');
export const errorText = $('#error-text');
export const errorRetry = $('#error-retry');
export const playerBar = $('#player-bar');
export const playerArt = $('#player-art');
export const playerTitle = $('#player-title');
export const playerArtist = $('#player-artist');
export const playerAlbum = $('#player-album');
export const playerYear = $('#player-year');
export const playBtn = $('#play-btn');
export const prevBtn = $('#prev-btn');
export const nextBtn = $('#next-btn');
export const shuffleQueueBtn = $('#shuffle-queue-btn');
export const repeatBtn = $('#repeat-btn');
export const progressBar = $('#progress-bar');
export const currentTime = $('#current-time');
export const duration = $('#duration');
export const audioPlayer = $('#audio-player');
export const audioPlayer2 = $('#audio-player-2');
export const miniPlayerBtn = $('#mini-player-btn');
export const volumeSlider = $('#volume-slider');
export const muteBtn = $('#mute-btn');
export const toastContainer = $('#toast-container');
export const shortcutsHelp = $('#shortcuts-help');
export const shortcutsClose = $('#shortcuts-close');
export const searchMoreBtn = $('#search-more-btn');
export const searchMoreMenu = $('#search-more-menu');

// ========== MUTABLE DOM STATE ==========
// These are exported as an object so mutations are shared across modules
export const domState = {
    pipWindow: null,
    searchTimeout: null,
};

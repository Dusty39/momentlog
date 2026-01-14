/**
 * story-mode.js
 * Handles the immersive playback of moments.
 */

class StoryMode {
    constructor(moments) {
        this.moments = moments;
        this.currentIndex = 0;
        this.isPlaying = false;
        this.timer = null;
        this.duration = 5000;
        this.audioElement = new Audio();

        // Remove existing overlay if any
        const existing = document.querySelector('.story-overlay');
        if (existing) existing.remove();

        // DOM Elements
        this.overlay = document.createElement('div');
        this.overlay.className = 'story-overlay hidden';
        this.overlay.innerHTML = `
            <button class="story-close-btn">&times;</button>
            <div class="story-progress-bar"><div class="progress-fill"></div></div>
            <div class="story-content"></div>
            <div class="story-controls">
                <button id="prevStory">←</button>
                <button id="toggleStory">❚❚</button>
                <button id="nextStory">→</button>
            </div>
        `;
        document.body.appendChild(this.overlay);

        // Listeners
        this.overlay.querySelector('.story-close-btn').onclick = () => this.stop();
        this.overlay.querySelector('#prevStory').onclick = () => this.prev();
        this.overlay.querySelector('#nextStory').onclick = () => this.next();
        this.overlay.querySelector('#toggleStory').onclick = () => this.togglePause();

        // Keyboard
        this.keyHandler = (e) => {
            if (!this.overlay.classList.contains('hidden')) {
                if (e.key === 'Escape') this.stop();
                if (e.key === 'ArrowRight') this.next();
                if (e.key === 'ArrowLeft') this.prev();
                if (e.key === ' ') this.togglePause();
            }
        };
        document.addEventListener('keydown', this.keyHandler);
    }

    start() {
        if (this.moments.length === 0) {
            alert("Bu filtrelere uygun anı bulunamadı.");
            return;
        }

        this.currentIndex = 0;
        this.overlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        this.showSlide(0);
    }

    stop() {
        this.isPlaying = false;
        clearTimeout(this.timer);
        this.audioElement.pause();
        this.overlay.classList.add('hidden');
        document.body.style.overflow = '';
        document.removeEventListener('keydown', this.keyHandler);
        this.overlay.remove(); // Clean up DOM
    }

    showSlide(index) {
        if (index < 0 || index >= this.moments.length) {
            this.stop();
            return;
        }

        this.currentIndex = index;
        const moment = this.moments[index];
        const contentContainer = this.overlay.querySelector('.story-content');

        this.audioElement.pause();
        this.audioElement.src = '';

        // Find best media
        let mediaContent = '';
        let hasAudio = false;
        let audioSrc = null;

        // Prioritize audio from this moment
        if (moment.media) {
            const audioItem = moment.media.find(m => m.type === 'audio');
            if (audioItem) {
                audioSrc = audioItem.data;
                hasAudio = true;
            }

            // Just show first image for story slide (simplicity vs collage)
            const imageItem = moment.media.find(m => m.type === 'image');
            if (imageItem) {
                mediaContent = `<div class="img-container"><img src="${imageItem.data}" class="story-img"></div>`;
            }
        }

        let spotifyHtml = '';
        if (moment.song && moment.song.id) {
            spotifyHtml = `
                <div class="spotify-embed" style="margin-top: 15px;">
                    <iframe src="https://open.spotify.com/embed/track/${moment.song.id}?autoplay=1" 
                        width="100%" height="80" frameBorder="0" allowtransparency="true" 
                        allow="encrypted-media; autoplay"></iframe>
                </div>`;
        }

        if (hasAudio) {
            this.audioElement.src = audioSrc;
            this.audioElement.play().catch(e => console.log('Auto-play blocked', e));
        }

        const dateStr = new Date(moment.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });

        contentContainer.innerHTML = `
            <div class="story-card">
                <div class="story-header">
                    <span class="story-date">${dateStr}</span>
                    ${moment.location ? `<span class="story-location">📍 ${moment.location.text}</span>` : ''}
                </div>
                <div class="story-body">
                    ${mediaContent}
                    ${spotifyHtml}
                    <p class="story-text">${moment.content}</p>
                    ${hasAudio ? '<div class="story-audio-indicator">🔊 Sesli Not</div>' : ''}
                </div>
            </div>
        `;

        this.isPlaying = true;
        this.resetTimer();
    }

    resetTimer() {
        clearTimeout(this.timer);
        this.overlay.querySelector('#toggleStory').textContent = '❚❚';

        let slideDuration = this.duration;

        this.audioElement.onloadedmetadata = () => {
            if (this.audioElement.duration && isFinite(this.audioElement.duration)) {
                slideDuration = (this.audioElement.duration * 1000) + 1000;
                this.runTimer(slideDuration);
            }
        };

        if (!this.audioElement.src || this.audioElement.readyState >= 1) {
            this.runTimer(slideDuration);
        }
    }

    runTimer(ms) {
        const bar = this.overlay.querySelector('.progress-fill');
        bar.style.transition = 'none';
        bar.style.width = '0%';

        // Force reflow
        bar.offsetHeight;

        bar.style.transition = `width ${ms}ms linear`;
        bar.style.width = '100%';

        this.timer = setTimeout(() => {
            this.next();
        }, ms);
    }

    next() {
        this.showSlide(this.currentIndex + 1);
    }

    prev() {
        if (this.currentIndex > 0) this.showSlide(this.currentIndex - 1);
    }

    togglePause() {
        if (this.isPlaying) {
            this.isPlaying = false;
            clearTimeout(this.timer);
            this.audioElement.pause();
            this.overlay.querySelector('.progress-fill').style.transition = 'none';
            this.overlay.querySelector('#toggleStory').textContent = '▶';
        } else {
            this.isPlaying = true;
            this.audioElement.play();
            // Resume approximation: restart slide
            this.showSlide(this.currentIndex);
        }
    }
}
window.StoryMode = StoryMode;

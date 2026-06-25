(function () {
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg)(\?.*)?$/i;
  const VIDEO_EXT = /\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?$/i;
  let viewer;
  let stage;
  let content;
  let closeButton;
  let previousOverflow = '';
  let lastFocused = null;

  function mediaTypeFromSource(src, explicitType) {
    const type = String(explicitType || '').toLowerCase();
    if (type.startsWith('image')) return 'image';
    if (type.startsWith('video')) return 'video';
    if (/^data:image\//i.test(src)) return 'image';
    if (/^data:video\//i.test(src)) return 'video';
    if (IMAGE_EXT.test(src)) return 'image';
    if (VIDEO_EXT.test(src)) return 'video';
    return '';
  }

  function createViewer() {
    if (viewer) return;

    viewer = document.createElement('div');
    viewer.className = 'cc-media-viewer';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', 'Media viewer');
    viewer.innerHTML = `
      <button class="cc-media-viewer__close" type="button" aria-label="Close media viewer">&times;</button>
      <div class="cc-media-viewer__stage" data-media-viewer-backdrop>
        <div class="cc-media-viewer__content"></div>
      </div>
    `;
    document.body.appendChild(viewer);

    closeButton = viewer.querySelector('.cc-media-viewer__close');
    stage = viewer.querySelector('.cc-media-viewer__stage');
    content = viewer.querySelector('.cc-media-viewer__content');

    closeButton.addEventListener('click', close);
    stage.addEventListener('click', (event) => {
      if (event.target === stage) close();
    });
  }

  function lockBody() {
    previousOverflow = document.body.style.overflow;
    document.body.classList.add('cc-media-viewer-open');
    document.body.style.overflow = 'hidden';
  }

  function unlockBody() {
    document.body.classList.remove('cc-media-viewer-open');
    document.body.style.overflow = previousOverflow;
  }

  function updateScrollableState(media) {
    if (!stage || !media) return;
    const height = media.naturalHeight || media.videoHeight || media.offsetHeight || 0;
    const width = media.naturalWidth || media.videoWidth || media.offsetWidth || 0;
    const viewportRatio = window.innerWidth / Math.max(window.innerHeight, 1);
    const mediaRatio = width / Math.max(height, 1);
    stage.classList.toggle('is-scrollable', height > window.innerHeight && mediaRatio < viewportRatio);
  }

  function open(options) {
    const src = String(options?.src || '').trim();
    if (!src) return;

    const type = mediaTypeFromSource(src, options?.type);
    if (!type) {
      window.open(src, '_blank', 'noopener,noreferrer');
      return;
    }

    createViewer();
    lastFocused = document.activeElement;
    content.innerHTML = '';
    stage.classList.remove('is-scrollable');

    const media = document.createElement(type === 'video' ? 'video' : 'img');
    media.className = `cc-media-viewer__media cc-media-viewer__media--${type}`;
    media.src = src;
    if (type === 'video') {
      media.controls = true;
      media.autoplay = false;
      media.playsInline = true;
      media.preload = 'metadata';
    } else {
      media.alt = options?.alt || 'Attachment';
      media.decoding = 'async';
    }

    media.addEventListener(type === 'video' ? 'loadedmetadata' : 'load', () => updateScrollableState(media), { once: true });
    media.addEventListener('click', (event) => event.stopPropagation());
    content.appendChild(media);

    lockBody();
    viewer.classList.add('is-open');
    viewer.removeAttribute('hidden');
    closeButton.focus({ preventScroll: true });
  }

  function close() {
    if (!viewer || !viewer.classList.contains('is-open')) return;
    viewer.classList.remove('is-open');
    content.innerHTML = '';
    stage.classList.remove('is-scrollable');
    unlockBody();
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus({ preventScroll: true });
    }
  }

  function mediaSourceFromElement(element) {
    if (!element) return null;
    const src = element.dataset.mediaSrc || element.currentSrc || element.src || element.href || '';
    const type = element.dataset.mediaType || element.type || '';
    const alt = element.dataset.mediaAlt || element.alt || element.textContent || 'Attachment';
    return { src, type, alt };
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-media-src], .cc-media-viewer-trigger, .ticket-thumb');
    if (!target) return;

    const media = mediaSourceFromElement(target);
    const type = mediaTypeFromSource(media?.src || '', media?.type || '');
    if (!media?.src || !type) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    open(media);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !viewer?.classList.contains('is-open')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }, true);

  window.addEventListener('resize', () => {
    const media = content?.querySelector('.cc-media-viewer__media');
    if (media) updateScrollableState(media);
  });

  window.CloudCrowdMediaViewer = {
    open,
    close,
    mediaTypeFromSource
  };
})();

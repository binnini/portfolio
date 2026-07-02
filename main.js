const toggle = document.querySelector('.nav-toggle');
const links = document.querySelector('.nav-links');

toggle?.addEventListener('click', () => {
  const expanded = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!expanded));
  links?.classList.toggle('is-open');
});

document.querySelectorAll('.nav-links a').forEach((link) => {
  link.addEventListener('click', () => {
    links?.classList.remove('is-open');
    toggle?.setAttribute('aria-expanded', 'false');
  });
});

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

const lightbox = document.querySelector('.lightbox');
const lightboxImage = document.querySelector('.lightbox img');
const closeButton = document.querySelector('.lightbox-close');
const placeholderImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
let lastFocusedElement = null;

function openLightbox(src, alt) {
  if (!src || !lightbox || !lightboxImage || !closeButton) return;
  lastFocusedElement = document.activeElement;
  lightboxImage.src = src;
  lightboxImage.alt = alt || '확대 이미지';
  lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
  closeButton.focus();
}

document.querySelectorAll('.thumb-row button, .photo-strip button, .case-gallery button').forEach((button) => {
  button.addEventListener('click', () => {
    const image = button.querySelector('img');
    const src = button.dataset?.src || image?.getAttribute('src');
    const alt = image?.getAttribute('alt') || '확대 이미지';
    openLightbox(src, alt);
  });
});

function closeLightbox() {
  if (!lightbox || !lightboxImage) return;
  lightbox.hidden = true;
  lightboxImage.src = placeholderImage;
  document.body.style.overflow = '';
  if (lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus();
  }
  lastFocusedElement = null;
}

closeButton?.addEventListener('click', closeLightbox);
lightbox?.addEventListener('click', (event) => {
  if (event.target === lightbox) closeLightbox();
});
document.addEventListener('keydown', (event) => {
  if (!lightbox || lightbox.hidden) return;
  if (event.key === 'Escape') closeLightbox();
  if (event.key === 'Tab' && closeButton) {
    event.preventDefault();
    closeButton.focus();
  }
});

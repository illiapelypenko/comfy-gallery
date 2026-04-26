let images = [];
let currentIndex = 0;

const openBtn = document.getElementById('open-btn');
const folderPath = document.getElementById('folder-path');
const countEl = document.getElementById('count');
const grid = document.getElementById('grid');
const gridContainer = document.getElementById('grid-container');
const empty = document.getElementById('empty');
const lightbox = document.getElementById('lightbox');
const lbImg = document.getElementById('lb-img');
const lbCaption = document.getElementById('lb-caption');
const lbClose = document.getElementById('lb-close');
const lbPrev = document.getElementById('lb-prev');
const lbNext = document.getElementById('lb-next');

openBtn.addEventListener('click', async () => {
  const folder = await window.api.openFolder();
  if (!folder) return;
  folderPath.textContent = folder;
  images = await window.api.readFolder(folder);
  renderGrid();
});

function renderGrid() {
  grid.innerHTML = '';
  if (images.length === 0) {
    gridContainer.style.display = 'none';
    empty.style.display = 'flex';
    countEl.textContent = '';
    return;
  }
  countEl.textContent = `${images.length} image${images.length !== 1 ? 's' : ''}`;
  empty.style.display = 'none';
  gridContainer.style.display = 'block';

  images.forEach((img, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const el = document.createElement('img');
    el.src = `file://${img.filePath.replace(/\\/g, '/')}`;
    el.alt = img.name;
    el.loading = 'lazy';
    thumb.appendChild(el);
    thumb.addEventListener('click', () => openLightbox(i));
    grid.appendChild(thumb);
  });
}

function openLightbox(index) {
  currentIndex = index;
  updateLightbox();
  lightbox.classList.add('open');
}

function updateLightbox() {
  const img = images[currentIndex];
  lbImg.src = `file://${img.filePath.replace(/\\/g, '/')}`;
  lbCaption.textContent = `${img.name}  (${currentIndex + 1} / ${images.length})`;
}

function closeLightbox() {
  lightbox.classList.remove('open');
  lbImg.src = '';
}

lbClose.addEventListener('click', closeLightbox);
lbPrev.addEventListener('click', () => { currentIndex = (currentIndex - 1 + images.length) % images.length; updateLightbox(); });
lbNext.addEventListener('click', () => { currentIndex = (currentIndex + 1) % images.length; updateLightbox(); });

document.addEventListener('keydown', (e) => {
  if (!lightbox.classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') { currentIndex = (currentIndex - 1 + images.length) % images.length; updateLightbox(); }
  if (e.key === 'ArrowRight') { currentIndex = (currentIndex + 1) % images.length; updateLightbox(); }
});

lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});

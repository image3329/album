// ==========================================================================
// Memory Album — Client Application Logic (Ultra Modern UI Controller)
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();

  const isLoginPage = document.getElementById('loginForm') !== null;
  const isAppPage = document.getElementById('albumGrid') !== null || document.getElementById('userBadge') !== null;

  if (isLoginPage) {
    initLoginPage();
  } else if (isAppPage) {
    initAppPage();
  }
});

// ==========================================================================
// Theme Management
// ==========================================================================
function initThemeToggle() {
  const currentTheme = window.MemoryAlbumAuth?.getStoredTheme() || 'dark';
  applyTheme(currentTheme);

  const toggleBtns = document.querySelectorAll('.theme-toggle-btn');
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const active = document.documentElement.getAttribute('data-theme') || 'dark';
      const nextTheme = active === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
      if (window.MemoryAlbumAuth) {
        window.MemoryAlbumAuth.setStoredTheme(nextTheme);
      }
    });
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icons = document.querySelectorAll('#themeIcon');
  icons.forEach(icon => {
    icon.textContent = theme === 'dark' ? '☀️' : '🌙';
  });
}

// ==========================================================================
// Toast Notification Utility
// ==========================================================================
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: '✅',
    error: '❌',
    info: '✨',
    warning: '⚠️'
  };

  toast.innerHTML = `
    <span class="toast-icon">${iconMap[type] || '✨'}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px) scale(0.95)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// ==========================================================================
// Modern Confirmation Modal
// ==========================================================================
function customConfirm(title, message) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmModalTitle');
    const msgEl = document.getElementById('confirmModalMsg');
    const confirmBtn = document.getElementById('confirmModalBtn');
    const cancelBtn = document.getElementById('cancelConfirmModal');

    if (!modal) {
      resolve(window.confirm(message));
      return;
    }

    titleEl.textContent = title || 'Are you sure?';
    msgEl.textContent = message || 'This action cannot be undone.';
    modal.hidden = false;

    function cleanup(result) {
      modal.hidden = true;
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }

    function onConfirm() { cleanup(true); }
    function onCancel() { cleanup(false); }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ==========================================================================
// AUTHENTICATION: Restricted Member Login
// ==========================================================================
async function initLoginPage() {
  const loginForm = document.getElementById('loginForm');
  const loginSubmit = document.getElementById('loginSubmit');
  const loginError = document.getElementById('loginError');
  const toggleLoginPass = document.getElementById('toggleLoginPassword');
  const loginPassInput = document.getElementById('loginPassword');

  // Password visibility toggle
  if (toggleLoginPass && loginPassInput) {
    toggleLoginPass.addEventListener('click', () => {
      const isPass = loginPassInput.type === 'password';
      loginPassInput.type = isPass ? 'text' : 'password';
      toggleLoginPass.textContent = isPass ? '🙈' : '👁️';
    });
  }

  // Clear errors on input
  const emailInput = document.getElementById('loginEmail');
  [emailInput, loginPassInput].forEach(inp => {
    if (inp) inp.addEventListener('input', () => {
      if (loginError) {
        loginError.hidden = true;
        loginError.textContent = '';
      }
    });
  });

  // If already authenticated, redirect straight to app.html
  try {
    const existingUser = await window.MemoryAlbumAuth.getMe();
    if (existingUser) {
      window.location.href = 'app.html';
      return;
    }
  } catch {
    // Stay on login
  }

  // Handle Login submission
  if (loginForm) {
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      const email = (emailInput ? emailInput.value : '').trim();
      const password = loginPassInput ? loginPassInput.value : '';

      if (!email || !password) {
        if (loginError) {
          loginError.textContent = 'Please enter both your member email and password.';
          loginError.hidden = false;
        }
        return;
      }

      try {
        if (loginError) loginError.hidden = true;
        loginSubmit.disabled = true;
        loginSubmit.textContent = 'Verifying member access...';

        await window.MemoryAlbumAuth.loginUser({ email, password });
        showToast('Welcome to your private album collection!', 'success');
        window.location.href = 'app.html';
      } catch (err) {
        if (loginError) {
          loginError.textContent = err.message || 'Login failed. Please verify your credentials.';
          loginError.hidden = false;
        }
      } finally {
        loginSubmit.disabled = false;
        loginSubmit.textContent = 'Sign In to Collection';
      }
    });
  }
}

// ==========================================================================
// MAIN APP WORKSPACE CONTROLLER (app.html)
// ==========================================================================
let currentView = 'albums'; // 'albums' | 'photos' | 'favorites' | 'album-detail'
let currentAlbumDetailId = null;
let currentAlbumDetailData = null;
let currentTagFilter = null;
let currentSearchQuery = '';
let currentSortOrder = 'newest';
let userAlbumsCache = [];
let allPhotosCache = [];

// Lightbox state
let lightboxPhotos = [];
let currentLightboxIndex = 0;
let currentZoomLevel = 1;

async function initAppPage() {
  await checkAuthAndInit();
}

async function checkAuthAndInit() {
  try {
    const userData = await window.MemoryAlbumAuth.getMe();
    if (!userData) {
      window.location.href = 'index.html';
      return;
    }

    const username = userData.username || 'User';
    const email = userData.email || '';

    const badge = document.getElementById('userBadge');
    if (badge) badge.textContent = username;

    const avatar = document.getElementById('userAvatar');
    if (avatar) avatar.textContent = username.charAt(0).toUpperCase();

    const dropdownName = document.getElementById('dropdownUserName');
    if (dropdownName) dropdownName.textContent = username;

    const dropdownEmail = document.getElementById('dropdownUserEmail');
    if (dropdownEmail) dropdownEmail.textContent = email;

    setupHeaderInteractions();
    setupNavigationTabs();
    setupFiltersAndSort();
    setupModals();
    setupLightbox();

    await loadDashboard();
  } catch (error) {
    console.error('Auth verification error:', error);
    window.location.href = 'index.html';
  }
}

// User Menu & Header Dropdowns
function setupHeaderInteractions() {
  const userMenuBtn = document.getElementById('userBadgeBtn');
  const userDropdown = document.getElementById('userDropdown');
  const logoutBtn = document.getElementById('logoutBtn');
  const brandHomeBtn = document.getElementById('brandHomeBtn');
  const addAlbumBtn = document.getElementById('addAlbumBtn');
  const menuUploadPhotosBtn = document.getElementById('menuUploadPhotosBtn');
  const menuFavoritesBtn = document.getElementById('menuFavoritesBtn');

  if (userMenuBtn && userDropdown) {
    userMenuBtn.addEventListener('click', e => {
      e.stopPropagation();
      userDropdown.hidden = !userDropdown.hidden;
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#userMenuWrapper')) {
        userDropdown.hidden = true;
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await window.MemoryAlbumAuth.logoutUser();
      window.location.href = 'index.html';
    });
  }

  if (brandHomeBtn) {
    brandHomeBtn.addEventListener('click', e => {
      e.preventDefault();
      switchView('albums');
    });
  }

  if (addAlbumBtn) {
    addAlbumBtn.addEventListener('click', () => openAlbumModal());
  }

  if (menuUploadPhotosBtn) {
    menuUploadPhotosBtn.addEventListener('click', () => {
      userDropdown.hidden = true;
      openPhotoModal();
    });
  }

  if (menuFavoritesBtn) {
    menuFavoritesBtn.addEventListener('click', () => {
      userDropdown.hidden = true;
      switchView('favorites');
    });
  }

  // Breadcrumb back button
  const backToAlbumsBtn = document.getElementById('backToAlbumsBtn');
  if (backToAlbumsBtn) {
    backToAlbumsBtn.addEventListener('click', () => switchView('albums'));
  }
}

// Navigation Tabs ('Albums' / 'All Photos' / 'Favorites')
function setupNavigationTabs() {
  const tabAlbums = document.getElementById('tabViewAlbums');
  const tabPhotos = document.getElementById('tabViewAllPhotos');
  const tabFavs = document.getElementById('tabViewFavorites');

  if (tabAlbums) tabAlbums.addEventListener('click', () => switchView('albums'));
  if (tabPhotos) tabPhotos.addEventListener('click', () => switchView('photos'));
  if (tabFavs) tabFavs.addEventListener('click', () => switchView('favorites'));
}

function switchView(viewName) {
  currentView = viewName;
  currentAlbumDetailId = null;

  const tabAlbums = document.getElementById('tabViewAlbums');
  const tabPhotos = document.getElementById('tabViewAllPhotos');
  const tabFavs = document.getElementById('tabViewFavorites');

  [tabAlbums, tabPhotos, tabFavs].forEach(t => {
    if (t) t.classList.remove('active');
  });

  const albumsSection = document.getElementById('albumsSection');
  const albumDetailSection = document.getElementById('albumDetailSection');
  const gallerySection = document.getElementById('gallerySection');

  if (viewName === 'albums') {
    if (tabAlbums) tabAlbums.classList.add('active');
    if (albumsSection) albumsSection.hidden = false;
    if (albumDetailSection) albumDetailSection.hidden = true;
    if (gallerySection) gallerySection.hidden = true;
  } else if (viewName === 'photos') {
    if (tabPhotos) tabPhotos.classList.add('active');
    if (albumsSection) albumsSection.hidden = true;
    if (albumDetailSection) albumDetailSection.hidden = true;
    if (gallerySection) {
      gallerySection.hidden = false;
      const heading = document.getElementById('galleryHeading');
      if (heading) heading.textContent = 'All Photos';
    }
  } else if (viewName === 'favorites') {
    if (tabFavs) tabFavs.classList.add('active');
    if (albumsSection) albumsSection.hidden = true;
    if (albumDetailSection) albumDetailSection.hidden = true;
    if (gallerySection) {
      gallerySection.hidden = false;
      const heading = document.getElementById('galleryHeading');
      if (heading) heading.textContent = 'Starred Favorites';
    }
  }

  loadDashboard();
}

// Search, Filters & Sort
function setupFiltersAndSort() {
  const searchInput = document.getElementById('searchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const categoryFilters = document.getElementById('categoryFilters');
  const sortSelect = document.getElementById('sortSelect');

  let debounceTimer;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = searchInput.value.trim();
      if (searchClearBtn) {
        searchClearBtn.classList.toggle('visible', query.length > 0);
      }
      debounceTimer = setTimeout(() => {
        currentSearchQuery = query;
        loadDashboard();
      }, 200);
    });
  }

  if (searchClearBtn && searchInput) {
    searchClearBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchClearBtn.classList.remove('visible');
      currentSearchQuery = '';
      loadDashboard();
    });
  }

  if (categoryFilters) {
    categoryFilters.addEventListener('click', e => {
      const btn = e.target.closest('.chip-btn');
      if (!btn) return;

      categoryFilters.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      loadDashboard();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      currentSortOrder = sortSelect.value;
      loadDashboard();
    });
  }
}

// ==========================================================================
// Dashboard Data Loading
// ==========================================================================
async function loadDashboard() {
  try {
    const activeFilterBtn = document.querySelector('#categoryFilters .chip-btn.active');
    const activeCategory = activeFilterBtn ? activeFilterBtn.dataset.filter : 'all';

    // Parallel fetch: stats, tags, albums, and search/photos
    const [statsRes, tagsRes, albumsRes, searchRes] = await Promise.all([
      window.MemoryAlbumAuth.apiFetch('/api/stats'),
      window.MemoryAlbumAuth.apiFetch('/api/tags'),
      window.MemoryAlbumAuth.apiFetch(`/api/albums?category=${encodeURIComponent(activeCategory)}&search=${encodeURIComponent(currentSearchQuery)}&sort=${currentSortOrder}`),
      window.MemoryAlbumAuth.apiFetch(`/api/search?q=${encodeURIComponent(currentSearchQuery)}&category=${encodeURIComponent(activeCategory)}&tag=${encodeURIComponent(currentTagFilter || '')}&sort=${currentSortOrder}`)
    ]);

    if (!statsRes.ok || !albumsRes.ok || !searchRes.ok) {
      throw new Error('Could not retrieve dashboard data');
    }

    const [stats, tagsData, albumsData, searchData] = await Promise.all([
      statsRes.json(),
      tagsRes.ok ? tagsRes.json() : { tags: [] },
      albumsRes.json(),
      searchRes.json()
    ]);

    userAlbumsCache = albumsData.albums || [];
    allPhotosCache = searchData.photos || [];

    updateStatsBar(stats);
    renderTagCloud(tagsData.tags || []);

    // Render based on current active view
    if (currentView === 'albums') {
      renderAlbums(userAlbumsCache);
    } else if (currentView === 'photos') {
      renderGallery(allPhotosCache);
    } else if (currentView === 'favorites') {
      const favsRes = await window.MemoryAlbumAuth.apiFetch('/api/favorites');
      if (favsRes.ok) {
        const favsData = await favsRes.json();
        renderGallery(favsData.photos || []);
      }
    } else if (currentView === 'album-detail' && currentAlbumDetailId) {
      await loadAlbumDetail(currentAlbumDetailId);
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
    showToast('Failed to sync dashboard data', 'error');
  }
}

function updateStatsBar(stats) {
  const totalPhotosEl = document.getElementById('totalPhotos');
  const totalAlbumsEl = document.getElementById('totalAlbums');
  const totalPlacesEl = document.getElementById('totalPlaces');
  const totalFavoritesEl = document.getElementById('totalFavorites');

  const badgeAlbumsCount = document.getElementById('badgeAlbumsCount');
  const badgePhotosCount = document.getElementById('badgePhotosCount');
  const badgeFavsCount = document.getElementById('badgeFavsCount');

  if (totalPhotosEl) totalPhotosEl.textContent = stats.totalPhotos || 0;
  if (totalAlbumsEl) totalAlbumsEl.textContent = stats.totalAlbums || 0;
  if (totalPlacesEl) totalPlacesEl.textContent = stats.placesCount || 0;
  if (totalFavoritesEl) totalFavoritesEl.textContent = stats.totalFavorites || 0;

  if (badgeAlbumsCount) badgeAlbumsCount.textContent = stats.totalAlbums || 0;
  if (badgePhotosCount) badgePhotosCount.textContent = stats.totalPhotos || 0;
  if (badgeFavsCount) badgeFavsCount.textContent = stats.totalFavorites || 0;
}

function renderTagCloud(tags) {
  const bar = document.getElementById('tagCloudBar');
  if (!bar) return;

  if (tags.length === 0) {
    bar.innerHTML = '';
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  let html = `
    <button type="button" class="tag-cloud-chip ${!currentTagFilter ? 'active' : ''}" data-tag="">
      <span>🏷️</span> All Tags
    </button>
  `;

  tags.slice(0, 12).forEach(({ tag, count }) => {
    const isActive = currentTagFilter === tag;
    html += `
      <button type="button" class="tag-cloud-chip ${isActive ? 'active' : ''}" data-tag="${escapeHtml(tag)}">
        #${escapeHtml(tag)} <span style="opacity: 0.6; font-size: 0.75rem;">(${count})</span>
      </button>
    `;
  });

  bar.innerHTML = html;

  bar.querySelectorAll('.tag-cloud-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const selected = chip.dataset.tag || null;
      currentTagFilter = selected;
      loadDashboard();
    });
  });
}

// ==========================================================================
// RENDER: Albums View (Bento Grid)
// ==========================================================================
function renderAlbums(albums) {
  const grid = document.getElementById('albumGrid');
  const albumCountEl = document.getElementById('albumCount');
  if (!grid) return;

  if (albumCountEl) {
    albumCountEl.textContent = `${albums.length} ${albums.length === 1 ? 'collection' : 'collections'}`;
  }

  if (albums.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-icon-glow">📁</div>
        <h3>No Albums Found</h3>
        <p>Create your very first album to curate memories with photos, categories, and tags.</p>
        <button type="button" class="btn-primary" onclick="window.openAlbumModal()">+ Create New Album</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = albums.map(album => {
    const coverUrl = album.cover ? window.MemoryAlbumAuth.resolveMediaUrl(album.cover) : '';
    const categoryIcon = album.category === 'place' ? '🌍' : (album.category === 'person' ? '👤' : '✨');

    const coverVisual = coverUrl
      ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(album.title)}" class="album-main-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'album-cover-placeholder\\'><span>${categoryIcon}</span></div>';" />`
      : `<div class="album-cover-placeholder"><span>${categoryIcon}</span></div>`;

    return `
      <article class="album-card-bento album-card" data-id="${album.id}" onclick="window.openAlbumDetail('${album.id}')">
        <div class="album-stack-visual">
          <div class="album-badges-overlay">
            <span class="category-pill">${categoryIcon} ${escapeHtml(album.category)}</span>
            <span class="photo-count-pill">📷 ${album.photosCount || 0}</span>
          </div>
          ${coverVisual}
        </div>
        <div class="album-body-content">
          <h3 class="album-card-title">${escapeHtml(album.title)}</h3>
          <p class="album-card-desc">${escapeHtml(album.description || 'No description added.')}</p>
          <div class="album-card-actions">
            <button type="button" class="btn-card-add btn-add-photo" onclick="event.stopPropagation(); window.openPhotoModal('${album.id}')">+ Photo</button>
            <button type="button" class="btn-card-edit btn-edit-album" onclick="event.stopPropagation(); window.openAlbumModal('${album.id}')">Edit</button>
            <button type="button" class="btn-card-delete btn-delete-album" onclick="event.stopPropagation(); window.deleteAlbum('${album.id}')">Delete</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// ==========================================================================
// RENDER: Dedicated Album Detail View (Deep Dive)
// ==========================================================================
async function openAlbumDetail(albumId) {
  currentView = 'album-detail';
  currentAlbumDetailId = albumId;

  document.getElementById('albumsSection').hidden = true;
  document.getElementById('gallerySection').hidden = true;
  document.getElementById('albumDetailSection').hidden = false;

  window.scrollTo({ top: 0, behavior: 'smooth' });
  await loadAlbumDetail(albumId);
}

async function loadAlbumDetail(albumId) {
  try {
    const res = await window.MemoryAlbumAuth.apiFetch(`/api/albums/${albumId}`);
    if (!res.ok) throw new Error('Album not found');
    const data = await res.json();
    currentAlbumDetailData = data.album;
    const album = data.album;

    // Header & Banner
    const breadcrumbTitle = document.getElementById('breadcrumbAlbumTitle');
    const titleEl = document.getElementById('detailAlbumTitle');
    const descEl = document.getElementById('detailAlbumDesc');
    const categoryEl = document.getElementById('detailAlbumCategory');
    const metaEl = document.getElementById('detailAlbumMeta');
    const heroBg = document.getElementById('albumHeroBg');
    const photosCountEl = document.getElementById('detailPhotosCount');

    if (breadcrumbTitle) breadcrumbTitle.textContent = album.title;
    if (titleEl) titleEl.textContent = album.title;
    if (descEl) descEl.textContent = album.description || 'No description provided for this collection.';
    if (categoryEl) {
      const icon = album.category === 'place' ? '🌍' : (album.category === 'person' ? '👤' : '✨');
      categoryEl.textContent = `${icon} ${album.category}`;
    }
    if (metaEl) metaEl.textContent = `${(album.photos || []).length} photos • Created ${new Date(album.createdAt).toLocaleDateString()}`;
    if (photosCountEl) photosCountEl.textContent = `${(album.photos || []).length} photos`;

    if (heroBg && album.cover) {
      heroBg.style.backgroundImage = `url('${window.MemoryAlbumAuth.resolveMediaUrl(album.cover)}')`;
    } else if (heroBg) {
      heroBg.style.backgroundImage = 'none';
    }

    // Bind action buttons
    const uploadBtn = document.getElementById('detailUploadPhotosBtn');
    const editBtn = document.getElementById('detailEditAlbumBtn');
    const deleteBtn = document.getElementById('detailDeleteAlbumBtn');

    if (uploadBtn) {
      uploadBtn.onclick = () => openPhotoModal(album.id);
    }
    if (editBtn) {
      editBtn.onclick = () => openAlbumModal(album.id);
    }
    if (deleteBtn) {
      deleteBtn.onclick = () => deleteAlbum(album.id);
    }

    // Render photos in album grid
    renderAlbumPhotosGrid(album.photos || [], album.id, album.title);
  } catch (err) {
    console.error('Error loading album details:', err);
    showToast('Failed to load album details', 'error');
    switchView('albums');
  }
}

function renderAlbumPhotosGrid(photos, albumId, albumTitle) {
  const grid = document.getElementById('albumPhotosGrid');
  if (!grid) return;

  if (photos.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-icon-glow">📷</div>
        <h3>This Album is Empty</h3>
        <p>Start adding breathtaking photos and moments to this collection!</p>
        <button type="button" class="btn-primary" onclick="window.openPhotoModal('${albumId}')">+ Add Photos Now</button>
      </div>
    `;
    return;
  }

  // Set lightbox photo pool for this album
  lightboxPhotos = photos.map(p => ({ ...p, albumId, albumTitle }));

  grid.innerHTML = photos.map((photo, index) => {
    const photoUrl = window.MemoryAlbumAuth.resolveMediaUrl(photo.url);
    const isFav = Boolean(photo.isFavorite);

    return `
      <article class="photo-card-premium photo-card" data-id="${photo.id}" onclick="window.openLightboxIndex(${index})">
        <img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(photo.title)}" class="photo-card-img" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22400%22%20height%3D%22300%22%20viewBox%3D%220%200%20400%20300%22%3E%3Crect%20fill%3D%22%231e293b%22%20width%3D%22400%22%20height%3D%22300%22%2F%3E%3Ctext%20fill%3D%22%2394a3b8%22%20font-family%3D%22sans-serif%22%20font-size%3D%2218%22%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%3E%F0%9F%93%B7%20Photo%3C%2Ftext%3E%3C%2Fsvg%3E';" />
        <div class="photo-overlay">
          <div class="photo-overlay-top">
            <button type="button" class="photo-fav-btn ${isFav ? 'favorited' : ''}" onclick="event.stopPropagation(); window.togglePhotoFavorite('${albumId}', '${photo.id}')" title="Favorite">
              ${isFav ? '❤️' : '🤍'}
            </button>
          </div>
          <div class="photo-overlay-bottom">
            <div class="photo-overlay-title photo-caption">${escapeHtml(photo.title)}</div>
            <div class="photo-overlay-meta">
              <span>${new Date(photo.createdAt).toLocaleDateString()}</span>
              ${photo.tags && photo.tags.length ? `<span>• #${escapeHtml(photo.tags[0])}</span>` : ''}
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// ==========================================================================
// RENDER: Gallery Photos (All Photos / Search Results / Favorites)
// ==========================================================================
function renderGallery(photos) {
  const grid = document.getElementById('galleryGrid');
  const countEl = document.getElementById('galleryCount');
  if (!grid) return;

  if (countEl) {
    countEl.textContent = `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`;
  }

  if (photos.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-icon-glow">🔍</div>
        <h3>No Photos Found</h3>
        <p>No photos match your current filter or search criteria.</p>
        <button type="button" class="btn-secondary" onclick="window.openPhotoModal()">+ Upload a Photo</button>
      </div>
    `;
    return;
  }

  // Set lightbox photo pool for gallery
  lightboxPhotos = photos;

  grid.innerHTML = photos.map((photo, index) => {
    const photoUrl = window.MemoryAlbumAuth.resolveMediaUrl(photo.url);
    const isFav = Boolean(photo.isFavorite);

    return `
      <article class="photo-card-premium photo-card" data-id="${photo.id}" onclick="window.openLightboxIndex(${index})">
        <img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(photo.title)}" class="photo-card-img" data-id="${photo.id}" data-album-id="${photo.albumId}" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22400%22%20height%3D%22300%22%20viewBox%3D%220%200%20400%20300%22%3E%3Crect%20fill%3D%22%231e293b%22%20width%3D%22400%22%20height%3D%22300%22%2F%3E%3Ctext%20fill%3D%22%2394a3b8%22%20font-family%3D%22sans-serif%22%20font-size%3D%2218%22%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%3E%F0%9F%93%B7%20Photo%3C%2Ftext%3E%3C%2Fsvg%3E';" />
        <div class="photo-overlay">
          <div class="photo-overlay-top">
            <button type="button" class="photo-fav-btn ${isFav ? 'favorited' : ''}" onclick="event.stopPropagation(); window.togglePhotoFavorite('${photo.albumId}', '${photo.id}')" title="Favorite">
              ${isFav ? '❤️' : '🤍'}
            </button>
          </div>
          <div class="photo-overlay-bottom">
            <div class="photo-overlay-title photo-caption">${escapeHtml(photo.title)}</div>
            <div class="photo-overlay-meta">
              <span>${escapeHtml(photo.albumTitle || 'Album')}</span>
              <span>• ${new Date(photo.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// ==========================================================================
// FAVORITE TOGGLE HANDLER
// ==========================================================================
async function togglePhotoFavorite(albumId, photoId) {
  if (!albumId || !photoId) return;

  try {
    const albumRes = await window.MemoryAlbumAuth.apiFetch(`/api/albums/${albumId}`);
    if (!albumRes.ok) throw new Error('Album not found');
    const albumData = await albumRes.json();
    const photo = (albumData.album.photos || []).find(p => p.id === photoId);
    if (!photo) return;

    const newFavStatus = !photo.isFavorite;

    const updateRes = await window.MemoryAlbumAuth.apiFetch(`/api/albums/${albumId}/photos/${photoId}`, {
      method: 'PUT',
      body: JSON.stringify({ isFavorite: newFavStatus })
    });

    if (!updateRes.ok) throw new Error('Failed to update favorite status');

    showToast(newFavStatus ? 'Added to favorites! 💖' : 'Removed from favorites', 'info');

    // Update lightbox view if currently open on this photo
    const currentPhoto = lightboxPhotos[currentLightboxIndex];
    if (currentPhoto && currentPhoto.id === photoId) {
      currentPhoto.isFavorite = newFavStatus;
      updateLightboxContent();
    }

    await loadDashboard();
  } catch (err) {
    console.error('Error favoriting photo:', err);
    showToast('Could not update favorite', 'error');
  }
}

// ==========================================================================
// ALBUM MODAL (Create & Edit)
// ==========================================================================
async function openAlbumModal(albumId = null) {
  const modal = document.getElementById('albumModal');
  const title = document.getElementById('albumModalTitle');
  const form = document.getElementById('albumForm');
  const albumIdInput = document.getElementById('albumId');
  const albumTitle = document.getElementById('albumTitle');
  const albumDesc = document.getElementById('albumDescription');

  if (!modal || !form) return;

  form.reset();
  albumIdInput.value = albumId || '';
  title.textContent = albumId ? 'Edit Album' : 'Create Album';

  if (albumId) {
    try {
      const res = await window.MemoryAlbumAuth.apiFetch(`/api/albums/${albumId}`);
      if (!res.ok) throw new Error('Failed to load album');
      const data = await res.json();
      if (data.album) {
        albumTitle.value = data.album.title || '';
        albumDesc.value = data.album.description || '';
        const radio = document.querySelector(`input[name="category"][value="${data.album.category}"]`);
        if (radio) radio.checked = true;
      }
    } catch {
      showToast('Could not load album info', 'error');
      return;
    }
  }

  modal.hidden = false;
  albumTitle.focus();
}

async function saveAlbum() {
  const albumId = document.getElementById('albumId').value;
  const title = document.getElementById('albumTitle').value.trim();
  const description = document.getElementById('albumDescription').value.trim();
  const categoryRadio = document.querySelector('input[name="category"]:checked');
  const category = categoryRadio ? categoryRadio.value : 'place';

  if (!title) {
    showToast('Please enter an album title', 'warning');
    return;
  }

  try {
    const method = albumId ? 'PUT' : 'POST';
    const url = albumId ? `/api/albums/${albumId}` : '/api/albums';

    const res = await window.MemoryAlbumAuth.apiFetch(url, {
      method,
      body: JSON.stringify({ title, description, category })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to save album');
    }

    document.getElementById('albumModal').hidden = true;
    showToast(albumId ? 'Album updated!' : 'Album created successfully! 🎉', 'success');

    await loadDashboard();
    if (currentView === 'album-detail' && currentAlbumDetailId === albumId) {
      await loadAlbumDetail(albumId);
    }
  } catch (err) {
    console.error('Error saving album:', err);
    showToast(err.message || 'Failed to save album', 'error');
  }
}

async function deleteAlbum(albumId) {
  const confirmed = await customConfirm(
    'Delete Album?',
    'This will permanently delete this album and all photos inside it.'
  );
  if (!confirmed) return;

  try {
    const res = await window.MemoryAlbumAuth.apiFetch(`/api/albums/${albumId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete album');

    showToast('Album deleted.', 'info');
    if (currentView === 'album-detail') {
      switchView('albums');
    } else {
      await loadDashboard();
    }
  } catch (err) {
    console.error('Error deleting album:', err);
    showToast('Failed to delete album', 'error');
  }
}

// ==========================================================================
// PHOTO UPLOAD MODAL (Drag & Drop & Batch)
// ==========================================================================
let batchFilesToUpload = [];

async function openPhotoModal(targetAlbumId = null) {
  const modal = document.getElementById('photoModal');
  const albumSelect = document.getElementById('photoAlbumSelect');
  const albumSelectGroup = document.getElementById('albumSelectGroup');
  const photoAlbumIdInput = document.getElementById('photoAlbumId');

  if (!modal) return;

  resetPhotoForm();

  // If albums cache is empty, eagerly fetch from API before giving up
  if (!userAlbumsCache || userAlbumsCache.length === 0) {
    try {
      const res = await window.MemoryAlbumAuth.apiFetch('/api/albums');
      if (res.ok) {
        const data = await res.json();
        userAlbumsCache = data.albums || [];
      }
    } catch (e) {
      console.warn('Could not fetch albums for modal:', e);
    }
  }

  // Populate album select options
  if (albumSelect) {
    if (userAlbumsCache.length === 0) {
      showToast('Please create an album first before uploading photos.', 'warning');
      openAlbumModal();
      return;
    }

    albumSelect.innerHTML = userAlbumsCache.map(a =>
      `<option value="${a.id}">${escapeHtml(a.title)} (${escapeHtml(a.category)})</option>`
    ).join('');

    // Ensure the select element actually reflects targetAlbumId or first album
    if (targetAlbumId && userAlbumsCache.some(a => a.id === targetAlbumId)) {
      albumSelect.value = targetAlbumId;
    } else if (userAlbumsCache[0]) {
      albumSelect.value = userAlbumsCache[0].id;
    }

    albumSelect.onchange = () => {
      if (photoAlbumIdInput) photoAlbumIdInput.value = albumSelect.value;
    };
  }

  const selectedAlbum = (albumSelect && albumSelect.value) ? albumSelect.value : (targetAlbumId || (userAlbumsCache[0] ? userAlbumsCache[0].id : ''));
  if (photoAlbumIdInput) photoAlbumIdInput.value = selectedAlbum;

  modal.hidden = false;
}

function resetPhotoForm() {
  const form = document.getElementById('photoForm');
  if (form) form.reset();

  batchFilesToUpload = [];

  const previewGrid = document.getElementById('batchPreviewGrid');
  if (previewGrid) { previewGrid.innerHTML = ''; previewGrid.hidden = true; }

  const singlePreview = document.getElementById('imagePreview');
  if (singlePreview) singlePreview.hidden = true;

  const fileInput = document.getElementById('photoFile');
  if (fileInput) fileInput.value = '';

  const progressWrapper = document.getElementById('uploadProgressWrapper');
  if (progressWrapper) progressWrapper.hidden = true;

  const uploadBtn = document.getElementById('uploadPhotoBtn');
  if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = 'Upload Photo'; }
}

function handleFileSelection(files) {
  if (!files || files.length === 0) return;

  const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (validFiles.length === 0) {
    showToast('Please select valid image files (PNG, JPG, WebP)', 'warning');
    return;
  }

  batchFilesToUpload = validFiles;

  // Single preview fallback
  if (validFiles.length === 1) {
    const reader = new FileReader();
    reader.onload = e => {
      const singlePreview = document.getElementById('imagePreview');
      const previewImg = document.getElementById('previewImg');
      if (singlePreview && previewImg) {
        previewImg.src = e.target.result;
        singlePreview.hidden = false;
      }
    };
    reader.readAsDataURL(validFiles[0]);

    // Pre-fill title if empty
    const titleInput = document.getElementById('photoTitle');
    if (titleInput && !titleInput.value) {
      const nameWithoutExt = validFiles[0].name.replace(/\.[^/.]+$/, '');
      titleInput.value = nameWithoutExt.charAt(0).toUpperCase() + nameWithoutExt.slice(1);
    }
  } else {
    // Multi preview grid
    renderBatchPreviewGrid();
  }
}

function renderBatchPreviewGrid() {
  const previewGrid = document.getElementById('batchPreviewGrid');
  if (!previewGrid) return;

  if (batchFilesToUpload.length === 0) {
    previewGrid.hidden = true;
    previewGrid.innerHTML = '';
    return;
  }

  previewGrid.hidden = false;
  previewGrid.innerHTML = '';

  batchFilesToUpload.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const item = document.createElement('div');
      item.className = 'batch-item';
      item.innerHTML = `
        <img src="${e.target.result}" alt="Preview" />
        <button type="button" class="batch-item-remove" title="Remove">&times;</button>
      `;
      previewGrid.appendChild(item);

      item.querySelector('.batch-item-remove').addEventListener('click', () => {
        const currentPos = batchFilesToUpload.indexOf(file);
        if (currentPos !== -1) {
          batchFilesToUpload.splice(currentPos, 1);
        }
        item.remove();
        if (batchFilesToUpload.length === 0) {
          previewGrid.hidden = true;
        }
      });
    };
    reader.readAsDataURL(file);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = err => reject(err);
    reader.readAsDataURL(file);
  });
}

async function uploadPhotos() {
  const albumSelect = document.getElementById('photoAlbumSelect');
  const albumIdInput = document.getElementById('photoAlbumId');
  const albumId = albumSelect ? albumSelect.value : (albumIdInput ? albumIdInput.value : '');
  const title = (document.getElementById('photoTitle').value || 'Untitled').trim();
  const tagsInput = document.getElementById('photoTags').value;
  const uploadBtn = document.getElementById('uploadPhotoBtn');
  const progressWrapper = document.getElementById('uploadProgressWrapper');
  const progressFill = document.getElementById('uploadProgressFill');
  const progressText = document.getElementById('uploadProgressText');

  if (!albumId) {
    showToast('Please select a target album', 'warning');
    return;
  }

  if (batchFilesToUpload.length === 0) {
    showToast('Please select at least one image file', 'warning');
    return;
  }

  const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
  const hasFirebaseStorage = Boolean(
    window.FirebaseConfig &&
    typeof window.FirebaseConfig.hasStorage === 'function' &&
    window.FirebaseConfig.hasStorage()
  );

  try {
    if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = 'Uploading...'; }
    if (progressWrapper) progressWrapper.hidden = false;
    if (progressFill) progressFill.style.width = '15%';
    if (progressText) progressText.textContent = 'Preparing upload...';

    if (batchFilesToUpload.length === 1) {
      // Single upload
      const file = batchFilesToUpload[0];
      let photoPayload = { title, tags };

      if (hasFirebaseStorage) {
        try {
          if (progressText) progressText.textContent = 'Uploading to Cloud Storage...';
          const uploadRes = await window.FirebaseConfig.uploadFileToStorage(file, albumId, percent => {
            const displayPercent = Math.round(percent * 0.85);
            if (progressFill) progressFill.style.width = `${displayPercent}%`;
            if (progressText) progressText.textContent = `Cloud Upload ${displayPercent}%`;
          }, 6000);
          photoPayload.imageUrl = uploadRes.url;
          photoPayload.url = uploadRes.url;
          photoPayload.filename = uploadRes.filename;
          photoPayload.sizeBytes = uploadRes.sizeBytes;
        } catch (storageErr) {
          console.warn('Firebase Storage upload note, falling back to local server storage:', storageErr.message);
          if (progressText) progressText.textContent = 'Saving directly to server...';
          const base64 = await fileToBase64(file);
          photoPayload.imageBase64 = base64;
        }
      } else {
        if (progressFill) progressFill.style.width = '50%';
        if (progressText) progressText.textContent = 'Encoding image...';
        const base64 = await fileToBase64(file);
        photoPayload.imageBase64 = base64;
      }

      if (progressFill) progressFill.style.width = '90%';
      if (progressText) progressText.textContent = 'Saving photo to album...';

      const res = await window.MemoryAlbumAuth.apiFetch(`/api/albums/${albumId}/photos`, {
        method: 'POST',
        body: JSON.stringify(photoPayload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
    } else {
      // Batch upload
      const photosPayload = [];
      const totalFiles = batchFilesToUpload.length;

      for (let i = 0; i < totalFiles; i++) {
        const file = batchFilesToUpload[i];
        const itemTitle = `${title} (${i + 1})`;
        const itemPayload = { title: itemTitle, tags };

        const basePercent = Math.round((i / totalFiles) * 85);
        if (progressFill) progressFill.style.width = `${basePercent}%`;
        if (progressText) progressText.textContent = `Processing ${i + 1}/${totalFiles}...`;

        if (hasFirebaseStorage) {
          try {
            const uploadRes = await window.FirebaseConfig.uploadFileToStorage(file, albumId, percent => {
              const fileContribution = Math.round((percent / 100) * (85 / totalFiles));
              const currentTotal = basePercent + fileContribution;
              if (progressFill) progressFill.style.width = `${currentTotal}%`;
              if (progressText) progressText.textContent = `${i + 1}/${totalFiles} (${currentTotal}%)`;
            }, 6000);
            itemPayload.imageUrl = uploadRes.url;
            itemPayload.url = uploadRes.url;
            itemPayload.filename = uploadRes.filename;
            itemPayload.sizeBytes = uploadRes.sizeBytes;
          } catch (storageErr) {
            console.warn(`Cloud upload note for file ${file.name}, using local fallback:`, storageErr.message);
            const base64 = await fileToBase64(file);
            itemPayload.imageBase64 = base64;
          }
        } else {
          const base64 = await fileToBase64(file);
          itemPayload.imageBase64 = base64;
        }

        photosPayload.push(itemPayload);
      }

      if (progressFill) progressFill.style.width = '92%';
      if (progressText) progressText.textContent = 'Saving photos to album...';

      const res = await window.MemoryAlbumAuth.apiFetch(`/api/albums/${albumId}/photos/batch`, {
        method: 'POST',
        body: JSON.stringify({ photos: photosPayload })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Batch upload failed');
      }
    }

    if (progressFill) progressFill.style.width = '100%';
    if (progressText) progressText.textContent = 'Done!';

    showToast('Photos uploaded successfully! 📸', 'success');
    document.getElementById('photoModal').hidden = true;
    resetPhotoForm();

    await loadDashboard();
    if (currentView === 'album-detail' && currentAlbumDetailId === albumId) {
      await loadAlbumDetail(albumId);
    }
  } catch (err) {
    console.error('Error uploading photos:', err);
    let msg = err.message || 'Upload failed';
    if (err.code === 'storage/unauthorized' || msg.includes('unauthorized') || msg.includes('permission-denied')) {
      msg = 'Firebase Storage permission denied. Please check your storage rules in the Firebase Console.';
    }
    showToast(msg, 'error', 5000);
  } finally {
    if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = 'Upload Photo'; }
    if (progressWrapper) progressWrapper.hidden = true;
  }
}

// ==========================================================================
// ULTRA LIGHTBOX CONTROLLER (Full-bleed viewer, Zoom, Keyboard Navigation)
// ==========================================================================
function setupLightbox() {
  const modal = document.getElementById('viewModal');
  const closeBtn = document.getElementById('closeViewModal');
  const prevBtn = document.getElementById('lightboxPrevBtn');
  const nextBtn = document.getElementById('lightboxNextBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomResetBtn = document.getElementById('zoomResetBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const favBtn = document.getElementById('favoritePhotoBtn');
  const downloadBtn = document.getElementById('downloadPhotoBtn');
  const toggleDetailsBtn = document.getElementById('toggleDetailsBtn');
  const closeDrawerBtn = document.getElementById('closeDrawerBtn');
  const deleteBtn = document.getElementById('deletePhotoBtn');
  const editMetaBtn = document.getElementById('editPhotoMetaBtn');

  if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
  if (prevBtn) prevBtn.addEventListener('click', prevLightboxPhoto);
  if (nextBtn) nextBtn.addEventListener('click', nextLightboxPhoto);

  if (zoomInBtn) zoomInBtn.addEventListener('click', () => setZoom(currentZoomLevel + 0.5));
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => setZoom(currentZoomLevel - 0.5));
  if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => setZoom(1));

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        modal.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });
  }

  if (favBtn) {
    favBtn.addEventListener('click', async () => {
      const photo = lightboxPhotos[currentLightboxIndex];
      if (photo) {
        await togglePhotoFavorite(photo.albumId, photo.id);
      }
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      const photo = lightboxPhotos[currentLightboxIndex];
      if (!photo) return;
      const a = document.createElement('a');
      a.href = window.MemoryAlbumAuth.resolveMediaUrl(photo.url);
      a.download = `${photo.title || 'photo'}.png`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  if (toggleDetailsBtn) {
    toggleDetailsBtn.addEventListener('click', () => {
      const drawer = document.getElementById('viewerDetailsDrawer');
      if (drawer) drawer.hidden = !drawer.hidden;
    });
  }

  if (closeDrawerBtn) {
    closeDrawerBtn.addEventListener('click', () => {
      const drawer = document.getElementById('viewerDetailsDrawer');
      if (drawer) drawer.hidden = true;
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', deleteCurrentLightboxPhoto);
  }

  if (editMetaBtn) {
    editMetaBtn.addEventListener('click', openEditPhotoModal);
  }

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (!modal || modal.hidden) return;
    if (e.key === 'ArrowRight') nextLightboxPhoto();
    else if (e.key === 'ArrowLeft') prevLightboxPhoto();
    else if (e.key === 'Escape') closeLightbox();
    else if (e.key.toLowerCase() === 'f') fullscreenBtn?.click();
  });
}

function openLightboxIndex(index) {
  if (index < 0 || index >= lightboxPhotos.length) return;
  currentLightboxIndex = index;
  setZoom(1);

  const modal = document.getElementById('viewModal');
  if (modal) modal.hidden = false;

  updateLightboxContent();
}

function openViewModal(photoId, albumId) {
  const index = lightboxPhotos.findIndex(p => p.id === photoId);
  if (index !== -1) {
    openLightboxIndex(index);
  } else {
    // If not currently in lightbox array, fetch photo directly
    window.MemoryAlbumAuth.apiFetch(`/api/albums/${albumId}`).then(res => res.json()).then(data => {
      const p = (data.album.photos || []).find(x => x.id === photoId);
      if (p) {
        lightboxPhotos = [{ ...p, albumId, albumTitle: data.album.title }];
        openLightboxIndex(0);
      }
    }).catch(() => showToast('Failed to open photo', 'error'));
  }
}

function updateLightboxContent() {
  const photo = lightboxPhotos[currentLightboxIndex];
  if (!photo) return;

  const viewerImg = document.getElementById('viewerImage');
  const viewerTitle = document.getElementById('viewerTitle');
  const viewerAlbum = document.getElementById('viewerAlbum');
  const viewerDate = document.getElementById('viewerDate');
  const tagsContainer = document.getElementById('viewerTags');
  const favIcon = document.getElementById('favIcon');
  const favText = document.getElementById('favText');

  // Details drawer elements
  const drawerTitle = document.getElementById('drawerTitle');
  const drawerAlbum = document.getElementById('drawerAlbum');
  const drawerDate = document.getElementById('drawerDate');
  const drawerDim = document.getElementById('drawerDimensions');
  const drawerTags = document.getElementById('drawerTags');

  const photoUrl = window.MemoryAlbumAuth.resolveMediaUrl(photo.url);

  if (viewerImg) {
    viewerImg.onerror = () => {
      viewerImg.src = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22800%22%20height%3D%22600%22%20viewBox%3D%220%200%20800%20600%22%3E%3Crect%20fill%3D%22%231e293b%22%20width%3D%22800%22%20height%3D%22600%22%2F%3E%3Ctext%20fill%3D%22%2394a3b8%22%20font-family%3D%22sans-serif%22%20font-size%3D%2224%22%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%3E%F0%9F%93%B7%20Photo%20Unavailable%3C%2Ftext%3E%3C%2Fsvg%3E';
    };
    viewerImg.src = photoUrl;
  }
  if (viewerTitle) viewerTitle.textContent = photo.title || 'Untitled';
  if (viewerAlbum) viewerAlbum.textContent = photo.albumTitle || 'Album';
  if (viewerDate) viewerDate.textContent = new Date(photo.createdAt).toLocaleDateString();

  if (favIcon) favIcon.textContent = photo.isFavorite ? '❤️' : '🤍';
  if (favText) favText.textContent = photo.isFavorite ? 'Favorited' : 'Favorite';

  if (tagsContainer) {
    tagsContainer.innerHTML = (photo.tags || []).map(t =>
      `<span class="lightbox-tag-pill">#${escapeHtml(t)}</span>`
    ).join('');
  }

  if (drawerTitle) drawerTitle.textContent = photo.title || 'Untitled';
  if (drawerAlbum) drawerAlbum.textContent = photo.albumTitle || 'Album';
  if (drawerDate) drawerDate.textContent = new Date(photo.createdAt).toLocaleString();
  if (drawerDim) {
    const sizeKb = photo.sizeBytes ? `${Math.round(photo.sizeBytes / 1024)} KB` : 'Standard image';
    drawerDim.textContent = sizeKb;
  }
  if (drawerTags) {
    drawerTags.innerHTML = (photo.tags || []).map(t =>
      `<span class="lightbox-tag-pill">#${escapeHtml(t)}</span>`
    ).join('');
  }
}

function nextLightboxPhoto() {
  if (currentLightboxIndex < lightboxPhotos.length - 1) {
    currentLightboxIndex++;
    setZoom(1);
    updateLightboxContent();
  } else {
    // Loop around
    currentLightboxIndex = 0;
    setZoom(1);
    updateLightboxContent();
  }
}

function prevLightboxPhoto() {
  if (currentLightboxIndex > 0) {
    currentLightboxIndex--;
    setZoom(1);
    updateLightboxContent();
  } else {
    // Loop around
    currentLightboxIndex = lightboxPhotos.length - 1;
    setZoom(1);
    updateLightboxContent();
  }
}

function setZoom(level) {
  const clamped = Math.max(0.5, Math.min(3, level));
  currentZoomLevel = clamped;

  const wrapper = document.getElementById('lightboxImgWrapper');
  const resetBtn = document.getElementById('zoomResetBtn');

  if (wrapper) wrapper.style.transform = `scale(${clamped})`;
  if (resetBtn) resetBtn.textContent = `${Math.round(clamped * 100)}%`;
}

function closeLightbox() {
  const modal = document.getElementById('viewModal');
  if (modal) modal.hidden = true;
  setZoom(1);
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}

async function deleteCurrentLightboxPhoto() {
  const photo = lightboxPhotos[currentLightboxIndex];
  if (!photo) return;

  const confirmed = await customConfirm('Delete Photo?', 'Are you sure you want to permanently delete this photo?');
  if (!confirmed) return;

  try {
    const res = await window.MemoryAlbumAuth.apiFetch(`/api/albums/${photo.albumId}/photos/${photo.id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete photo');

    showToast('Photo deleted', 'info');
    lightboxPhotos.splice(currentLightboxIndex, 1);

    if (lightboxPhotos.length === 0) {
      closeLightbox();
    } else {
      if (currentLightboxIndex >= lightboxPhotos.length) {
        currentLightboxIndex = lightboxPhotos.length - 1;
      }
      updateLightboxContent();
    }

    await loadDashboard();
  } catch (err) {
    console.error('Error deleting photo:', err);
    showToast('Could not delete photo', 'error');
  }
}

// ==========================================================================
// EDIT PHOTO METADATA MODAL
// ==========================================================================
function openEditPhotoModal() {
  const photo = lightboxPhotos[currentLightboxIndex];
  if (!photo) return;

  const modal = document.getElementById('editPhotoModal');
  const albumIdInput = document.getElementById('editPhotoAlbumId');
  const photoIdInput = document.getElementById('editPhotoId');
  const titleInput = document.getElementById('editPhotoTitle');
  const tagsInput = document.getElementById('editPhotoTags');

  if (!modal) return;

  albumIdInput.value = photo.albumId;
  photoIdInput.value = photo.id;
  titleInput.value = photo.title || '';
  tagsInput.value = (photo.tags || []).join(', ');

  modal.hidden = false;
}

// ==========================================================================
// MODAL GENERAL SETUP
// ==========================================================================
function setupModals() {
  // Album modal
  const albumModal = document.getElementById('albumModal');
  const closeAlbumModal = document.getElementById('closeAlbumModal');
  const cancelAlbum = document.getElementById('cancelAlbum');
  const albumForm = document.getElementById('albumForm');

  if (closeAlbumModal) closeAlbumModal.addEventListener('click', () => albumModal.hidden = true);
  if (cancelAlbum) cancelAlbum.addEventListener('click', () => albumModal.hidden = true);
  if (albumForm) {
    albumForm.addEventListener('submit', async e => {
      e.preventDefault();
      await saveAlbum();
    });
  }

  // Photo modal
  const photoModal = document.getElementById('photoModal');
  const closePhotoModal = document.getElementById('closePhotoModal');
  const cancelPhoto = document.getElementById('cancelPhoto');
  const photoForm = document.getElementById('photoForm');
  const dropZone = document.getElementById('dropZone');
  const photoFile = document.getElementById('photoFile');
  const browseBtn = document.getElementById('browseBtn');
  const removeImage = document.getElementById('removeImage');

  [closePhotoModal, cancelPhoto].forEach(el => {
    if (el) el.addEventListener('click', () => {
      photoModal.hidden = true;
      resetPhotoForm();
    });
  });

  if (browseBtn && photoFile) browseBtn.addEventListener('click', () => photoFile.click());

  if (photoFile) {
    photoFile.addEventListener('change', e => {
      if (e.target.files) handleFileSelection(e.target.files);
    });
  }

  if (dropZone) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, e => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, () => dropZone.classList.add('dragover'));
    });

    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, () => dropZone.classList.remove('dragover'));
    });

    dropZone.addEventListener('drop', e => {
      if (e.dataTransfer.files) handleFileSelection(e.dataTransfer.files);
    });
  }

  if (removeImage) {
    removeImage.addEventListener('click', () => {
      const singlePreview = document.getElementById('imagePreview');
      if (singlePreview) singlePreview.hidden = true;
      batchFilesToUpload = [];
      if (photoFile) photoFile.value = '';
    });
  }

  if (photoForm) {
    photoForm.addEventListener('submit', async e => {
      e.preventDefault();
      await uploadPhotos();
    });
  }

  // Edit Photo Form
  const editPhotoModal = document.getElementById('editPhotoModal');
  const closeEditPhoto = document.getElementById('closeEditPhotoModal');
  const cancelEditPhoto = document.getElementById('cancelEditPhoto');
  const editPhotoForm = document.getElementById('editPhotoForm');

  if (closeEditPhoto) closeEditPhoto.addEventListener('click', () => editPhotoModal.hidden = true);
  if (cancelEditPhoto) cancelEditPhoto.addEventListener('click', () => editPhotoModal.hidden = true);

  if (editPhotoForm) {
    editPhotoForm.addEventListener('submit', async e => {
      e.preventDefault();
      const albumId = document.getElementById('editPhotoAlbumId').value;
      const photoId = document.getElementById('editPhotoId').value;
      const title = document.getElementById('editPhotoTitle').value.trim();
      const tags = document.getElementById('editPhotoTags').value.split(',').map(t => t.trim()).filter(Boolean);

      try {
        const res = await window.MemoryAlbumAuth.apiFetch(`/api/albums/${albumId}/photos/${photoId}`, {
          method: 'PUT',
          body: JSON.stringify({ title, tags })
        });
        if (!res.ok) throw new Error('Failed to update photo');

        const photo = lightboxPhotos[currentLightboxIndex];
        if (photo && photo.id === photoId) {
          photo.title = title;
          photo.tags = tags;
          updateLightboxContent();
        }

        editPhotoModal.hidden = true;
        showToast('Photo details updated!', 'success');
        await loadDashboard();
      } catch (err) {
        showToast('Could not save photo changes', 'error');
      }
    });
  }

  // Close modals on backdrop click
  [albumModal, photoModal, editPhotoModal].forEach(modal => {
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.hidden = true;
      });
    }
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      [albumModal, photoModal, editPhotoModal].forEach(modal => {
        if (modal && !modal.hidden) modal.hidden = true;
      });
    }
  });
}

// Utility
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// ==========================================================================
// GLOBAL BINDINGS
// ==========================================================================
window.openAlbumModal = openAlbumModal;
window.deleteAlbum = deleteAlbum;
window.openPhotoModal = openPhotoModal;
window.openAlbumDetail = openAlbumDetail;
window.openLightboxIndex = openLightboxIndex;
window.openViewModal = openViewModal;
window.togglePhotoFavorite = togglePhotoFavorite;
window.showToast = showToast;
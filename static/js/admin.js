document.addEventListener('DOMContentLoaded', function () {
  var dirty = false;
  var unsavedEl = document.getElementById('unsaved-indicator');
  var savedEl = document.getElementById('saved-indicator');
  var savedTimeout = null;

  function markDirty() {
    dirty = true;
    unsavedEl.style.display = 'inline-block';
    savedEl.style.display = 'none';
  }

  function markSaved() {
    dirty = false;
    unsavedEl.style.display = 'none';
    savedEl.style.display = 'inline-block';
    clearTimeout(savedTimeout);
    savedTimeout = setTimeout(function () {
      savedEl.style.display = 'none';
    }, 2500);
  }

  // ---- Logout ----
  var logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      fetch('/lpapp/login/api/logout', { method: 'POST' }).then(function () {
        window.location.href = '/lpapp/login';
      });
    });
  }

  // ---- Tabs ----
  var tabs = document.querySelectorAll('.tab');
  var panels = document.querySelectorAll('.panel');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('active'); });
      panels.forEach(function (p) { p.classList.remove('active'); });
      tab.classList.add('active');
      document.querySelector('.panel[data-panel="' + tab.dataset.tab + '"]').classList.add('active');
    });
  });

  // ---- Text fields ----
  ['f-name', 'f-role', 'f-tagline', 'f-about', 'f-email', 'f-phone', 'f-whatsapp'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', markDirty);
  });

  // ---- Gradient picker ----
  var gradientGrid = document.getElementById('gradient-grid');
  var preview = document.getElementById('theme-preview');
  var selectedTheme = gradientGrid.querySelector('.gradient-swatch.selected').dataset.theme;

  gradientGrid.addEventListener('click', function (e) {
    var btn = e.target.closest('.gradient-swatch');
    if (!btn) return;
    gradientGrid.querySelectorAll('.gradient-swatch').forEach(function (s) { s.classList.remove('selected'); });
    btn.classList.add('selected');
    selectedTheme = btn.dataset.theme;
    preview.style.background = btn.style.background;
    markDirty();
  });

  // ---- Photo layout picker ----
  var layoutGrid = document.getElementById('layout-grid');
  var selectedLayout = layoutGrid.querySelector('.layout-option.selected').dataset.layout;

  layoutGrid.addEventListener('click', function (e) {
    var btn = e.target.closest('.layout-option');
    if (!btn) return;
    layoutGrid.querySelectorAll('.layout-option').forEach(function (o) { o.classList.remove('selected'); });
    btn.classList.add('selected');
    selectedLayout = btn.dataset.layout;
    markDirty();
  });

  // ---- Copy link ----
  var copyBtn = document.getElementById('copy-link-btn');
  var publicUrl = document.getElementById('public-url').textContent.trim();
  copyBtn.addEventListener('click', function () {
    navigator.clipboard.writeText(publicUrl).then(function () {
      var original = copyBtn.textContent;
      copyBtn.textContent = 'הועתק';
      setTimeout(function () { copyBtn.textContent = original; }, 1800);
    });
  });

  // ---- Image upload / remove ----
  function uploadImage(field, file, onDone) {
    var data = new FormData();
    data.append('field', field);
    data.append('file', file);
    fetch('/lpapp/admin/api/upload', { method: 'POST', body: data })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) onDone(res.url);
      });
  }

  function removeImage(url, tileEl) {
    fetch('/lpapp/admin/api/remove-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) tileEl.remove();
      });
  }

  // Avatar
  var avatarTile = document.getElementById('avatar-tile');
  var avatarBtn = document.getElementById('avatar-upload-btn');
  var avatarFile = document.getElementById('avatar-file');

  avatarBtn.addEventListener('click', function () { avatarFile.click(); });
  avatarFile.addEventListener('change', function () {
    if (!avatarFile.files.length) return;
    uploadImage('photo', avatarFile.files[0], function (url) {
      avatarTile.innerHTML =
        '<img src="' + url + '" alt="">' +
        '<button class="tile-remove" type="button" data-url="' + url + '" aria-label="הסרת תמונה">&times;</button>';
    });
    avatarFile.value = '';
  });

  avatarTile.addEventListener('click', function (e) {
    var btn = e.target.closest('.tile-remove');
    if (!btn) return;
    removeImage(btn.dataset.url, avatarTile);
    avatarTile.innerHTML = '<span class="avatar-placeholder">&#128100;</span>';
  });

  // Gallery
  var galleryGrid = document.getElementById('gallery-grid');
  var galleryAddTile = document.getElementById('gallery-add-tile');
  var galleryFile = document.getElementById('gallery-file');

  galleryAddTile.addEventListener('click', function () { galleryFile.click(); });
  galleryFile.addEventListener('change', function () {
    if (!galleryFile.files.length) return;
    uploadImage('gallery', galleryFile.files[0], function (url) {
      var tile = document.createElement('div');
      tile.className = 'gallery-tile';
      tile.innerHTML =
        '<img src="' + url + '" alt="">' +
        '<button class="tile-remove" type="button" data-url="' + url + '" aria-label="הסרת תמונה">&times;</button>';
      galleryGrid.insertBefore(tile, galleryAddTile);
    });
    galleryFile.value = '';
  });

  galleryGrid.addEventListener('click', function (e) {
    var btn = e.target.closest('.tile-remove');
    if (!btn) return;
    var tile = btn.closest('.gallery-tile');
    removeImage(btn.dataset.url, tile);
  });

  // ---- Save ----
  document.getElementById('save-btn').addEventListener('click', function () {
    var payload = {
      name: document.getElementById('f-name').value,
      role: document.getElementById('f-role').value,
      tagline: document.getElementById('f-tagline').value,
      about: document.getElementById('f-about').value,
      theme: selectedTheme,
      photo_layout: selectedLayout,
      contact: {
        email: document.getElementById('f-email').value,
        phone: document.getElementById('f-phone').value,
        whatsapp: document.getElementById('f-whatsapp').value
      }
    };

    fetch('/lpapp/admin/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          markSaved();
          document.getElementById('preview-name').textContent = res.site.name;
          document.getElementById('preview-role').textContent = res.site.role;
        }
      });
  });
});

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
  function setTileLoading(tileEl, loading) {
    if (loading) {
      tileEl.classList.add('is-loading');
      if (!tileEl.querySelector('.upload-spinner')) {
        var spinner = document.createElement('span');
        spinner.className = 'upload-spinner';
        tileEl.appendChild(spinner);
      }
    } else {
      tileEl.classList.remove('is-loading');
      var existing = tileEl.querySelector('.upload-spinner');
      if (existing) existing.remove();
    }
  }

  function uploadImage(field, file, tileEl, onDone) {
    setTileLoading(tileEl, true);
    var data = new FormData();
    data.append('field', field);
    data.append('file', file, 'upload.jpg');
    fetch('/lpapp/admin/api/upload', { method: 'POST', body: data })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        setTileLoading(tileEl, false);
        if (res.ok) onDone(res.url);
      })
      .catch(function () {
        setTileLoading(tileEl, false);
      });
  }

  // ---- Crop modal ----
  // target: { field, getTileEl(): element, onDone(url, tileEl) }
  // getTileEl is called only once cropping is confirmed, so a gallery tile is
  // never added to the DOM at all if the user cancels.
  var cropOverlay = document.getElementById('crop-overlay');
  var cropImageEl = document.getElementById('crop-image');
  var cropConfirmBtn = document.getElementById('crop-confirm-btn');
  var cropCancelBtn = document.getElementById('crop-cancel-btn');
  var cropper = null;
  var pendingCropTarget = null;

  function openCropModal(file, target) {
    pendingCropTarget = target;
    var reader = new FileReader();
    reader.onload = function (e) {
      cropOverlay.classList.add('active');
      cropImageEl.onload = function () {
        // small delay so the now-visible overlay has real layout before
        // Cropper measures it — otherwise it initializes against a 0x0 box
        setTimeout(function () {
          if (cropper) cropper.destroy();
          cropper = new Cropper(cropImageEl, {
            aspectRatio: 1,
            viewMode: 1,
            autoCropArea: 1,
            background: false
          });
        });
      };
      cropImageEl.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function closeCropModal() {
    cropOverlay.classList.remove('active');
    if (cropper) { cropper.destroy(); cropper = null; }
    cropImageEl.src = '';
    pendingCropTarget = null;
  }

  cropCancelBtn.addEventListener('click', closeCropModal);

  cropConfirmBtn.addEventListener('click', function () {
    if (!cropper || !pendingCropTarget) return;
    var target = pendingCropTarget;
    var canvas = cropper.getCroppedCanvas({ width: 800, height: 800 });
    closeCropModal();
    canvas.toBlob(function (blob) {
      var tileEl = target.getTileEl();
      uploadImage(target.field, blob, tileEl, function (url) { target.onDone(url, tileEl); });
    }, 'image/jpeg', 0.9);
  });

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
    openCropModal(avatarFile.files[0], {
      field: 'photo',
      getTileEl: function () { return avatarTile; },
      onDone: function (url) {
        avatarTile.innerHTML =
          '<img src="' + url + '" alt="">' +
          '<button class="tile-remove" type="button" data-url="' + url + '" aria-label="הסרת תמונה">&times;</button>';
      }
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
    var file = galleryFile.files[0];
    galleryFile.value = '';
    openCropModal(file, {
      field: 'gallery',
      getTileEl: function () {
        var tile = document.createElement('div');
        tile.className = 'gallery-tile';
        galleryGrid.insertBefore(tile, galleryAddTile);
        return tile;
      },
      onDone: function (url, tileEl) {
        tileEl.innerHTML =
          '<img src="' + url + '" alt="">' +
          '<button class="tile-remove" type="button" data-url="' + url + '" aria-label="הסרת תמונה">&times;</button>';
      }
    });
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

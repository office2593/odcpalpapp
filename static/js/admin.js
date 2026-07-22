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
  ['f-name', 'f-role', 'f-tagline', 'f-email', 'f-phone', 'f-whatsapp'].forEach(function (id) {
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

  // ---- QR code ----
  var qrOverlay = document.getElementById('qr-overlay');
  var qrCodeBox = document.getElementById('qr-code-box');
  var qrCodeUrlEl = document.getElementById('qr-code-url');

  qrCodeUrlEl.textContent = publicUrl.replace(/^https?:\/\//, '');
  new QRCode(qrCodeBox, {
    text: publicUrl,
    width: 180,
    height: 180,
    colorDark: '#1c1c1e',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });

  document.getElementById('show-qr-btn').addEventListener('click', function () {
    qrOverlay.classList.add('active');
  });
  document.getElementById('qr-close-btn').addEventListener('click', function () {
    qrOverlay.classList.remove('active');
  });
  document.getElementById('qr-download-btn').addEventListener('click', function () {
    var canvas = qrCodeBox.querySelector('canvas');
    var img = qrCodeBox.querySelector('img');
    var dataUrl = canvas ? canvas.toDataURL('image/png') : (img ? img.src : null);
    if (!dataUrl) return;
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'qr-code.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
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

  // ---- Content blocks ----
  var TYPE_META = {};
  document.querySelectorAll('#type-picker .type-card').forEach(function (card) {
    TYPE_META[card.dataset.type] = {
      icon: card.querySelector('.block-icon').innerHTML,
      label: card.querySelector('.t-label').textContent
    };
  });

  var DEFAULT_BLOCK_DATA = {
    text: { title: '', body: '' },
    gallery: { title: '', images: [] },
    testimonials: { title: '', items: [] },
    faq: { title: '', items: [] },
    video: { title: '', url: '' },
    social: { title: '', links: [] },
    map: { title: '', address: '' },
    cta: { label: '', url: '' },
    image: { image: null },
    custom: { html: '' }
  };

  function makeId() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'b' + Date.now() + Math.random().toString(16).slice(2);
  }

  function isBlockIncomplete(type, data) {
    if (type === 'text') return !(data.body || '').trim();
    if (type === 'gallery') return !(data.images && data.images.length);
    if (type === 'testimonials') return !(data.items || []).some(function (it) { return (it.quote || '').trim(); });
    if (type === 'faq') return !(data.items || []).some(function (it) { return (it.q || '').trim() && (it.a || '').trim(); });
    if (type === 'video') return !(data.url || '').trim();
    if (type === 'social') return !(data.links || []).some(function (it) { return (it.url || '').trim(); });
    if (type === 'map') return !(data.address || '').trim();
    if (type === 'cta') return !((data.label || '').trim() && (data.url || '').trim());
    if (type === 'image') return !data.image;
    if (type === 'custom') return !(data.html || '').trim();
    return false;
  }

  function blockDisplayName(type, data) {
    if (type === 'cta') return (data.label || '').trim() || '(אין טקסט לכפתור עדיין)';
    if (type === 'image') return 'תמונה / באנר';
    if (type === 'custom') return 'הטמעה מותאמת';
    return (data.title || '').trim() || '(אין כותרת עדיין)';
  }

  function makeSubitemRow(fieldsHtml) {
    var row = document.createElement('div');
    row.className = 'subitem-row';
    row.innerHTML =
      '<div class="subitem-fields">' + fieldsHtml + '</div>' +
      '<button class="subitem-remove" type="button" title="הסרה">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="7" x2="19" y2="7"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M7 7l1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"/></svg>' +
      '</button>';
    row.querySelector('.subitem-remove').addEventListener('click', function () {
      row.remove();
      markDirty();
    });
    row.querySelectorAll('input, textarea').forEach(function (el) { el.addEventListener('input', markDirty); });
    return row;
  }

  function buildBlockBody(bodyEl, type, data, blockEl) {
    if (type === 'text') {
      bodyEl.innerHTML =
        '<label>כותרת המקטע (לא חובה)</label><input class="bf-title" type="text" value="' + escAttr(data.title) + '">' +
        '<label>תוכן</label><textarea class="bf-body" rows="4" placeholder="כתבי כאן את תוכן המקטע...">' + escHtml(data.body) + '</textarea>';
    } else if (type === 'gallery') {
      bodyEl.innerHTML =
        '<label>כותרת המקטע (לא חובה)</label><input class="bf-title" type="text" value="' + escAttr(data.title) + '">' +
        '<div class="gallery-grid bf-gallery-grid" style="margin-top:12px;"></div>' +
        '<input type="file" class="bf-gallery-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>';
      var grid = bodyEl.querySelector('.bf-gallery-grid');
      (data.images || []).forEach(function (url) { grid.appendChild(makeGalleryTile(url)); });
      var addTile = document.createElement('div');
      addTile.className = 'gallery-tile add-tile';
      addTile.innerHTML = '<span>+</span><span class="hint">הוספת תמונה</span>';
      grid.appendChild(addTile);
      var fileInput = bodyEl.querySelector('.bf-gallery-file');
      addTile.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        if (!fileInput.files.length) return;
        var tile = makeGalleryTile(null);
        grid.insertBefore(tile, addTile);
        setTileLoading(tile, true);
        uploadImage('block_image', fileInput.files[0], tile, function (url) {
          tile.dataset.url = url;
          tile.innerHTML = '<img src="' + url + '" alt="">' +
            '<button class="tile-remove" type="button" aria-label="הסרת תמונה">&times;</button>';
          markDirty();
        });
        fileInput.value = '';
      });
      grid.addEventListener('click', function (e) {
        var btn = e.target.closest('.tile-remove');
        if (!btn) return;
        btn.closest('.gallery-tile').remove();
        markDirty();
      });
    } else if (type === 'testimonials') {
      bodyEl.innerHTML =
        '<label>כותרת המקטע (לא חובה)</label><input class="bf-title" type="text" value="' + escAttr(data.title) + '">' +
        '<div class="subitem-list bf-items"></div>' +
        '<button class="subitem-add-btn" type="button">+ הוספת המלצה</button>';
      var list = bodyEl.querySelector('.bf-items');
      (data.items && data.items.length ? data.items : []).forEach(function (it) { list.appendChild(makeTestimonialRow(it)); });
      bodyEl.querySelector('.subitem-add-btn').addEventListener('click', function () {
        list.appendChild(makeTestimonialRow({ name: '', quote: '' }));
        markDirty();
      });
    } else if (type === 'faq') {
      bodyEl.innerHTML =
        '<label>כותרת המקטע (לא חובה)</label><input class="bf-title" type="text" value="' + escAttr(data.title) + '">' +
        '<div class="subitem-list bf-items"></div>' +
        '<button class="subitem-add-btn" type="button">+ הוספת שאלה</button>';
      var flist = bodyEl.querySelector('.bf-items');
      (data.items && data.items.length ? data.items : []).forEach(function (it) { flist.appendChild(makeFaqRow(it)); });
      bodyEl.querySelector('.subitem-add-btn').addEventListener('click', function () {
        flist.appendChild(makeFaqRow({ q: '', a: '' }));
        markDirty();
      });
    } else if (type === 'video') {
      bodyEl.innerHTML =
        '<label>כותרת המקטע (לא חובה)</label><input class="bf-title" type="text" value="' + escAttr(data.title) + '">' +
        '<label>קישור לוידאו</label><input class="bf-url" type="text" placeholder="קישור מ-YouTube או Vimeo" value="' + escAttr(data.url) + '">';
    } else if (type === 'social') {
      bodyEl.innerHTML =
        '<label>כותרת המקטע (לא חובה)</label><input class="bf-title" type="text" value="' + escAttr(data.title) + '">' +
        '<div class="subitem-list bf-items"></div>' +
        '<button class="subitem-add-btn" type="button">+ הוספת קישור</button>';
      var slist = bodyEl.querySelector('.bf-items');
      (data.links && data.links.length ? data.links : []).forEach(function (it) { slist.appendChild(makeSocialRow(it)); });
      bodyEl.querySelector('.subitem-add-btn').addEventListener('click', function () {
        slist.appendChild(makeSocialRow({ label: '', url: '' }));
        markDirty();
      });
    } else if (type === 'map') {
      bodyEl.innerHTML =
        '<label>כותרת המקטע (לא חובה)</label><input class="bf-title" type="text" value="' + escAttr(data.title) + '">' +
        '<label>כתובת</label><input class="bf-address" type="text" placeholder="לדוגמה: רוטשילד 1, תל אביב" value="' + escAttr(data.address) + '">';
    } else if (type === 'cta') {
      bodyEl.innerHTML =
        '<label>טקסט הכפתור</label><input class="bf-label" type="text" placeholder="לדוגמה: קביעת פגישה" value="' + escAttr(data.label) + '">' +
        '<label>קישור</label><input class="bf-url" type="text" placeholder="כתובת אינטרנט או wa.me/..." value="' + escAttr(data.url) + '">';
    } else if (type === 'image') {
      bodyEl.innerHTML =
        '<div class="block-image-preview bf-image-preview"></div>' +
        '<input type="file" class="bf-image-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>';
      var preview = bodyEl.querySelector('.bf-image-preview');
      renderImagePreview(preview, data.image);
      var imgFile = bodyEl.querySelector('.bf-image-file');
      preview.addEventListener('click', function () { imgFile.click(); });
      imgFile.addEventListener('change', function () {
        if (!imgFile.files.length) return;
        setTileLoading(preview, true);
        uploadImage('block_image', imgFile.files[0], preview, function (url) {
          preview.dataset.url = url;
          renderImagePreview(preview, url);
          markDirty();
        });
        imgFile.value = '';
      });
    } else if (type === 'custom') {
      bodyEl.innerHTML =
        '<div class="hint warning">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.3" r="0.6" fill="currentColor"/></svg>' +
          '<span>מקטע זה מריץ את הקוד כפי שהוא בעמוד שלך. יש להשתמש רק בקוד ממקור מהימן.</span>' +
        '</div>' +
        '<label>קוד HTML</label><textarea class="bf-html" rows="5" placeholder="&lt;iframe ...&gt;">' + escHtml(data.html) + '</textarea>';
    }

    bodyEl.querySelectorAll('.bf-title, .bf-body, .bf-url, .bf-address, .bf-label, .bf-html').forEach(function (el) {
      el.addEventListener('input', markDirty);
    });
    var titleEl = bodyEl.querySelector('.bf-title') || bodyEl.querySelector('.bf-label');
    if (titleEl) {
      titleEl.addEventListener('input', function () {
        blockEl.querySelector('.block-name').textContent = blockDisplayName(type, { title: titleEl.value, label: titleEl.value });
      });
    }
  }

  function renderImagePreview(el, url) {
    el.dataset.url = url || '';
    if (url) {
      el.innerHTML = '<img src="' + url + '" alt="">';
    } else {
      el.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    }
  }

  function makeGalleryTile(url) {
    var tile = document.createElement('div');
    tile.className = 'gallery-tile';
    if (url) {
      tile.dataset.url = url;
      tile.innerHTML = '<img src="' + url + '" alt="">' +
        '<button class="tile-remove" type="button" aria-label="הסרת תמונה">&times;</button>';
    }
    return tile;
  }

  function makeTestimonialRow(it) {
    var row = makeSubitemRow(
      '<input class="si-name" type="text" placeholder="שם" value="' + escAttr(it.name) + '">' +
      '<input class="si-quote" type="text" placeholder="ציטוט" value="' + escAttr(it.quote) + '">'
    );
    return row;
  }

  function makeFaqRow(it) {
    return makeSubitemRow(
      '<input class="si-q" type="text" placeholder="שאלה" value="' + escAttr(it.q) + '">' +
      '<textarea class="si-a" rows="2" placeholder="תשובה">' + escHtml(it.a) + '</textarea>'
    );
  }

  function makeSocialRow(it) {
    return makeSubitemRow(
      '<input class="si-label" type="text" placeholder="שם הרשת (לדוגמה: אינסטגרם)" value="' + escAttr(it.label) + '">' +
      '<input class="si-url" type="text" placeholder="קישור" value="' + escAttr(it.url) + '">'
    );
  }

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function createBlockElement(type, data, open) {
    var meta = TYPE_META[type];
    var el = document.createElement('div');
    el.className = 'block-item' + (open ? ' open' : '');
    el.dataset.type = type;
    el.dataset.id = data.id || makeId();
    if (isBlockIncomplete(type, data)) el.classList.add('incomplete');

    var head = document.createElement('div');
    head.className = 'block-head';
    head.innerHTML =
      '<span class="drag-handle"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>' +
      '<span class="block-icon">' + meta.icon + '</span>' +
      '<span class="block-titles"><span class="block-type">' + meta.label + '</span><span class="block-name">' + blockDisplayName(type, data) + '</span></span>' +
      (isBlockIncomplete(type, data) ? '<span class="warn-flash">לא יוצג בדף</span>' : '') +
      '<button class="block-delete" type="button" title="מחיקת מקטע"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="7" x2="19" y2="7"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M7 7l1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"/></svg></button>' +
      '<span class="block-chevron"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>';

    var body = document.createElement('div');
    body.className = 'block-body';
    buildBlockBody(body, type, data, el);

    el.appendChild(head);
    el.appendChild(body);
    el.draggable = true;

    head.addEventListener('click', function (e) {
      if (e.target.closest('.block-delete')) return;
      el.classList.toggle('open');
    });
    head.querySelector('.block-delete').addEventListener('click', function () {
      el.remove();
      markDirty();
    });

    return el;
  }

  var blockList = document.getElementById('block-list');
  var blocksDataEl = document.getElementById('blocks-data');
  var initialBlocks = blocksDataEl ? (JSON.parse(blocksDataEl.textContent || '[]') || []) : [];
  initialBlocks.forEach(function (b) { blockList.appendChild(createBlockElement(b.type, b, false)); });

  var addBlockBtn = document.getElementById('add-block-btn');
  var typePicker = document.getElementById('type-picker');
  addBlockBtn.addEventListener('click', function () {
    typePicker.classList.toggle('open');
  });
  typePicker.addEventListener('click', function (e) {
    var card = e.target.closest('.type-card');
    if (!card) return;
    var type = card.dataset.type;
    var el = createBlockElement(type, Object.assign({}, DEFAULT_BLOCK_DATA[type]), true);
    blockList.appendChild(el);
    typePicker.classList.remove('open');
    markDirty();
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // drag & drop reordering
  var draggedBlock = null;
  blockList.addEventListener('dragstart', function (e) {
    var item = e.target.closest('.block-item');
    if (!item) return;
    draggedBlock = item;
    item.classList.add('dragging');
  });
  blockList.addEventListener('dragend', function () {
    if (draggedBlock) draggedBlock.classList.remove('dragging');
    draggedBlock = null;
    markDirty();
  });
  blockList.addEventListener('dragover', function (e) {
    e.preventDefault();
    var over = e.target.closest('.block-item');
    if (!over || over === draggedBlock || !draggedBlock) return;
    var rect = over.getBoundingClientRect();
    var before = (e.clientY - rect.top) < rect.height / 2;
    blockList.insertBefore(draggedBlock, before ? over : over.nextSibling);
  });

  function serializeBlocks() {
    return Array.prototype.map.call(blockList.querySelectorAll('.block-item'), function (el) {
      var type = el.dataset.type;
      var block = { id: el.dataset.id, type: type };
      var q = function (sel) { return el.querySelector(sel); };
      var val = function (sel) { var f = q(sel); return f ? f.value : ''; };

      if (type === 'text') {
        block.title = val('.bf-title'); block.body = val('.bf-body');
      } else if (type === 'gallery') {
        block.title = val('.bf-title');
        block.images = Array.prototype.map.call(el.querySelectorAll('.bf-gallery-grid .gallery-tile:not(.add-tile)'), function (t) { return t.dataset.url; }).filter(Boolean);
      } else if (type === 'testimonials') {
        block.title = val('.bf-title');
        block.items = Array.prototype.map.call(el.querySelectorAll('.bf-items .subitem-row'), function (row) {
          return { name: row.querySelector('.si-name').value, quote: row.querySelector('.si-quote').value };
        });
      } else if (type === 'faq') {
        block.title = val('.bf-title');
        block.items = Array.prototype.map.call(el.querySelectorAll('.bf-items .subitem-row'), function (row) {
          return { q: row.querySelector('.si-q').value, a: row.querySelector('.si-a').value };
        });
      } else if (type === 'video') {
        block.title = val('.bf-title'); block.url = val('.bf-url');
      } else if (type === 'social') {
        block.title = val('.bf-title');
        block.links = Array.prototype.map.call(el.querySelectorAll('.bf-items .subitem-row'), function (row) {
          return { label: row.querySelector('.si-label').value, url: row.querySelector('.si-url').value };
        });
      } else if (type === 'map') {
        block.title = val('.bf-title'); block.address = val('.bf-address');
      } else if (type === 'cta') {
        block.label = val('.bf-label'); block.url = val('.bf-url');
      } else if (type === 'image') {
        var preview = q('.bf-image-preview');
        block.image = preview ? (preview.dataset.url || null) : null;
      } else if (type === 'custom') {
        block.html = val('.bf-html');
      }
      return block;
    });
  }

  // ---- AI content generation ----
  var AI_QUESTIONS = [
    { key: 'field', label: 'מה תחום העיסוק שלך?', placeholder: 'לדוגמה: ליווי וייעוץ עסקי לעצמאים', type: 'text' },
    { key: 'years', label: 'כמה זמן אתה עוסק בתחום?', placeholder: 'לדוגמה: 12 שנה', type: 'text' },
    { key: 'location', label: 'איפה העסק ממוקם, או באילו אזורים אתה נותן שירות?', placeholder: 'לדוגמה: תל אביב והמרכז', type: 'text' },
    { key: 'unique', label: 'מה מייחד אותך מול מתחרים בתחום?', placeholder: 'לדוגמה: ליווי אישי צמוד, לא רק ייעוץ חד פעמי', type: 'text' },
    { key: 'audience', label: 'מי קהל היעד שלך / מי הלקוחות הטיפוסיים שלך?', placeholder: 'לדוגמה: עצמאים ובעלי עסקים קטנים בתחילת הדרך', type: 'text' },
    { key: 'services', label: 'אילו שירותים או מוצרים עיקריים אתה מציע?', placeholder: 'לדוגמה: ליווי הקמת עסק, תמחור, שיווק בסיסי', type: 'text' },
    { key: 'faq_source', label: 'מה השאלות שהכי הרבה שואלים אותך לפני שמתחילים לעבוד איתך?', placeholder: 'לדוגמה: כמה זמן לוקח לראות תוצאות?', type: 'textarea' },
    { key: 'tone', label: 'באיזה טון תרצה שהטקסט יישמע?', type: 'select', options: [
      { value: 'formal', label: 'רשמי' },
      { value: 'warm', label: 'חם ואישי' },
      { value: 'energetic', label: 'אנרגטי ומלא מוטיבציה' }
    ] }
  ];

  var AI_ERROR_MESSAGES = {
    not_configured: 'יצירת תוכן AI לא מוגדרת עדיין במערכת.',
    request_failed: 'לא הצלחנו להתחבר לשירות ה-AI. נסה/י שוב.',
    openai_error: 'שירות ה-AI החזיר שגיאה. נסה/י שוב בעוד רגע.',
    parse_failed: 'התקבלה תשובה לא תקינה מה-AI. נסה/י שוב.'
  };

  var aiOverlay = document.getElementById('ai-overlay');
  var aiStepContainer = document.getElementById('ai-step-container');
  var aiAnswers = {};
  var aiStepIndex = 0;
  var aiResult = null;

  document.getElementById('ai-generate-btn').addEventListener('click', function () {
    aiAnswers = {};
    aiStepIndex = 0;
    aiResult = null;
    renderAiQuestion();
    aiOverlay.classList.add('active');
  });

  function closeAiModal() {
    aiOverlay.classList.remove('active');
  }

  function aiModalHeader(title) {
    return '<p class="ai-modal-title">' +
      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#9333ea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/></svg>' +
      title +
      '</p>';
  }

  function renderAiQuestion() {
    var q = AI_QUESTIONS[aiStepIndex];
    var isFirst = aiStepIndex === 0;
    var isLast = aiStepIndex === AI_QUESTIONS.length - 1;
    var existing = aiAnswers[q.key] || '';
    var fieldHtml;

    if (q.type === 'select') {
      fieldHtml = '<select id="ai-input">' + q.options.map(function (o) {
        return '<option value="' + o.value + '"' + (o.value === existing ? ' selected' : '') + '>' + o.label + '</option>';
      }).join('') + '</select>';
    } else if (q.type === 'textarea') {
      fieldHtml = '<textarea id="ai-input" rows="3" placeholder="' + (q.placeholder || '') + '">' + escHtml(existing) + '</textarea>';
    } else {
      fieldHtml = '<input id="ai-input" type="text" placeholder="' + (q.placeholder || '') + '" value="' + escAttr(existing) + '">';
    }

    aiStepContainer.innerHTML =
      aiModalHeader('ספרי לי קצת על העסק') +
      '<p class="ai-modal-sub">תשובות קצרות מספיקות — ה-AI ינסח בשבילך טקסט מוכן ל"אודות" ול"שאלות נפוצות".</p>' +
      '<p class="ai-progress">שאלה ' + (aiStepIndex + 1) + ' מתוך ' + AI_QUESTIONS.length + '</p>' +
      '<div class="ai-field"><label>' + q.label + '</label>' + fieldHtml + '</div>' +
      '<div class="ai-actions">' +
        '<button class="btn btn-light" id="ai-back-btn" type="button">' + (isFirst ? 'ביטול' : 'הקודם') + '</button>' +
        '<button class="btn btn-primary" id="ai-next-btn" type="button">' + (isLast ? 'יצירת תוכן' : 'המשך') + '</button>' +
      '</div>';

    document.getElementById('ai-back-btn').addEventListener('click', function () {
      if (isFirst) { closeAiModal(); return; }
      aiAnswers[q.key] = document.getElementById('ai-input').value;
      aiStepIndex--;
      renderAiQuestion();
    });
    document.getElementById('ai-next-btn').addEventListener('click', function () {
      aiAnswers[q.key] = document.getElementById('ai-input').value;
      if (isLast) {
        submitAiQuestionnaire();
      } else {
        aiStepIndex++;
        renderAiQuestion();
      }
    });
  }

  function renderAiLoading() {
    aiStepContainer.innerHTML =
      '<div class="ai-loading">' +
        '<div class="ai-loading-spinner"></div>' +
        '<p>יוצר תוכן... זה יכול לקחת כמה שניות</p>' +
      '</div>';
  }

  function renderAiError(errorCode) {
    aiStepContainer.innerHTML =
      '<div class="ai-error">' + (AI_ERROR_MESSAGES[errorCode] || 'משהו השתבש, נסה/י שוב.') + '</div>' +
      '<div class="ai-actions">' +
        '<button class="btn btn-light" id="ai-error-close-btn" type="button">סגירה</button>' +
        '<button class="btn btn-primary" id="ai-error-retry-btn" type="button">ניסיון חוזר</button>' +
      '</div>';
    document.getElementById('ai-error-close-btn').addEventListener('click', closeAiModal);
    document.getElementById('ai-error-retry-btn').addEventListener('click', submitAiQuestionnaire);
  }

  function submitAiQuestionnaire() {
    renderAiLoading();
    fetch('/lpapp/admin/api/generate-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: aiAnswers })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) {
          renderAiError(res.error);
          return;
        }
        aiResult = { about: res.about, faq: res.faq };
        renderAiReview();
      })
      .catch(function () {
        renderAiError('request_failed');
      });
  }

  function renderAiReview() {
    var faqRowsHtml = aiResult.faq.map(function (it) {
      return '<div class="subitem-row">' +
        '<div class="subitem-fields">' +
          '<input class="ai-review-q" type="text" value="' + escAttr(it.q) + '">' +
          '<input class="ai-review-a" type="text" value="' + escAttr(it.a) + '">' +
        '</div>' +
        '<button class="subitem-remove" type="button" title="הסרה"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="7" x2="19" y2="7"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M7 7l1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"/></svg></button>' +
      '</div>';
    }).join('');

    aiStepContainer.innerHTML =
      aiModalHeader('הנה מה שיצרתי') +
      '<p class="ai-modal-sub">אפשר לערוך כל דבר לפני שמוסיפים לדף.</p>' +
      '<div class="ai-review-block">' +
        '<p class="ai-review-label">טקסט אודות</p>' +
        '<textarea id="ai-review-about" rows="4">' + escHtml(aiResult.about) + '</textarea>' +
      '</div>' +
      '<div class="ai-review-block">' +
        '<p class="ai-review-label">שאלות נפוצות</p>' +
        '<div class="ai-faq-review" id="ai-faq-review">' + (faqRowsHtml || '<p class="hint">לא נוצרו שאלות.</p>') + '</div>' +
      '</div>' +
      '<div class="ai-actions">' +
        '<button class="btn btn-light" id="ai-review-cancel-btn" type="button">ביטול</button>' +
        '<button class="btn btn-primary" id="ai-review-add-btn" type="button">הוספה לדף</button>' +
      '</div>';

    var faqReviewEl = document.getElementById('ai-faq-review');
    faqReviewEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.subitem-remove');
      if (!btn) return;
      btn.closest('.subitem-row').remove();
    });

    document.getElementById('ai-review-cancel-btn').addEventListener('click', closeAiModal);
    document.getElementById('ai-review-add-btn').addEventListener('click', function () {
      var aboutText = document.getElementById('ai-review-about').value.trim();
      var faqItems = Array.prototype.map.call(faqReviewEl.querySelectorAll('.subitem-row'), function (row) {
        return { q: row.querySelector('.ai-review-q').value, a: row.querySelector('.ai-review-a').value };
      }).filter(function (it) { return it.q.trim() || it.a.trim(); });

      if (aboutText) {
        blockList.appendChild(createBlockElement('text', { title: 'קצת עליי', body: aboutText }, false));
      }
      if (faqItems.length) {
        blockList.appendChild(createBlockElement('faq', { title: 'שאלות נפוצות', items: faqItems }, false));
      }
      markDirty();
      closeAiModal();
    });
  }

  // ---- Save ----
  document.getElementById('save-btn').addEventListener('click', function () {
    var payload = {
      name: document.getElementById('f-name').value,
      role: document.getElementById('f-role').value,
      tagline: document.getElementById('f-tagline').value,
      theme: selectedTheme,
      photo_layout: selectedLayout,
      contact: {
        email: document.getElementById('f-email').value,
        phone: document.getElementById('f-phone').value,
        whatsapp: document.getElementById('f-whatsapp').value
      },
      blocks: serializeBlocks()
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

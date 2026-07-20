document.addEventListener('DOMContentLoaded', function () {
  var list = document.getElementById('invites-list');
  var emailInput = document.getElementById('invite-email');
  var createBtn = document.getElementById('create-invite-btn');

  function copyCode(code, btn) {
    navigator.clipboard.writeText(code).then(function () {
      var original = btn.textContent;
      btn.textContent = 'הועתק';
      setTimeout(function () { btn.textContent = original; }, 1800);
    });
  }

  function rowHtml(code, inv, emailSent) {
    var deliveryNote = emailSent
      ? '<p class="hint" style="color:var(--success-text);">נשלח במייל</p>'
      : '<p class="hint" style="color:var(--warning-text);">שליחת המייל נכשלה — יש להעתיק ולשלוח ידנית</p>';
    return (
      '<div class="invite-row" data-code="' + code + '">' +
        '<div>' +
          '<p class="invite-email">' + inv.email + '</p>' +
          '<p class="hint">' + inv.created_at + '</p>' +
          deliveryNote +
        '</div>' +
        '<code class="invite-code">' + code + '</code>' +
        '<span class="status-badge status-pending">ממתין</span>' +
        '<button class="btn btn-light copy-code-btn" type="button" data-code="' + code + '">העתקת קוד</button>' +
      '</div>'
    );
  }

  createBtn.addEventListener('click', function () {
    var email = emailInput.value.trim();
    if (!email) return;

    createBtn.disabled = true;
    createBtn.textContent = 'שולח...';

    fetch('/lpapp/admin/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) return;
        var emptyMsg = list.querySelector('.hint');
        if (emptyMsg && list.children.length === 1) emptyMsg.remove();
        list.insertAdjacentHTML('afterbegin', rowHtml(res.code, res.invite, res.email_sent));
        emailInput.value = '';
      })
      .finally(function () {
        createBtn.disabled = false;
        createBtn.textContent = 'שליחת הזמנה';
      });
  });

  list.addEventListener('click', function (e) {
    var btn = e.target.closest('.copy-code-btn');
    if (!btn) return;
    copyCode(btn.dataset.code, btn);
  });
});

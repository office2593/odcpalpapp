document.addEventListener('DOMContentLoaded', function () {
  firebase.initializeApp(firebaseConfig);
  var auth = firebase.auth();
  // TEMPORARY while we're debugging reCAPTCHA Enterprise domain config —
  // lets Firebase test phone numbers work without a real reCAPTCHA/SMS check.
  // MUST be removed before real users sign up with real phone numbers.
  auth.settings.appVerificationDisabledForTesting = true;

  var email = null;
  var code = null;
  var confirmationResult = null;

  function showStep(name) {
    document.querySelectorAll('.step').forEach(function (s) { s.classList.remove('active'); });
    document.querySelector('.step[data-step="' + name + '"]').classList.add('active');
  }

  function showError(id, message) {
    var el = document.getElementById(id);
    el.textContent = message;
    el.style.display = 'block';
  }

  function hideError(id) {
    document.getElementById(id).style.display = 'none';
  }

  var ERROR_MESSAGES = {
    invalid_code: 'קוד ההזמנה לא נמצא.',
    already_redeemed: 'הקוד הזה כבר נוצל.',
    expired_code: 'קוד ההזמנה פג תוקף.',
    email_mismatch: 'הקוד הזה שייך לכתובת מייל אחרת.',
    invalid_token: 'ההתחברות פגה, נסה/י שוב.',
    phone_not_verified: 'אימות הטלפון לא הושלם, נסה/י שוב.',
    already_has_site: 'לחשבון הזה כבר יש דף נחיתה.'
  };

  // Prefill the invite code if the user arrived via the emailed link (?code=...)
  var codeFromUrl = new URLSearchParams(window.location.search).get('code');
  if (codeFromUrl) {
    document.getElementById('code-input').value = codeFromUrl.toUpperCase();
  }

  function errorText(res) {
    return ERROR_MESSAGES[res.error] || 'משהו השתבש, נסה/י שוב.';
  }

  // ---- Step 1: Google sign-in ----
  document.getElementById('google-btn').addEventListener('click', function () {
    hideError('google-error');
    var provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
      .then(function (result) {
        return result.user.getIdToken();
      })
      .then(function (idToken) {
        return fetch('/lpapp/signup/api/session-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: idToken })
        }).then(function (r) { return r.json(); });
      })
      .then(function (res) {
        if (!res.ok) {
          showError('google-error', errorText(res));
          return;
        }
        if (res.status === 'existing') {
          window.location.href = '/lpapp/admin';
          return;
        }
        email = res.email;
        showStep('code');
      })
      .catch(function (err) {
        showError('google-error', 'ההתחברות עם Google נכשלה: ' + err.message);
      });
  });

  // ---- Step 2: invite code ----
  document.getElementById('code-btn').addEventListener('click', function () {
    hideError('code-error');
    var value = document.getElementById('code-input').value.trim().toUpperCase();
    if (!value) return;

    fetch('/lpapp/signup/api/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, code: value })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) {
          showError('code-error', errorText(res));
          return;
        }
        code = value;
        showStep('phone');
      });
  });

  // ---- Step 3: phone verification ----
  function getRecaptcha() {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', { size: 'invisible' });
    }
    return window.recaptchaVerifier;
  }

  document.getElementById('send-otp-btn').addEventListener('click', function () {
    hideError('phone-error');
    var btn = document.getElementById('send-otp-btn');

    try {
      var raw = document.getElementById('phone-input').value.trim().replace(/\D/g, '');
      if (!raw) {
        showError('phone-error', 'נא להזין מספר טלפון.');
        return;
      }
      if (!auth.currentUser) {
        showError('phone-error', 'החיבור פג. נא לרענן את הדף ולהתחבר מחדש עם Google.');
        return;
      }

      var local = raw.replace(/^0/, '');
      var phoneNumber = '+972' + local;

      btn.disabled = true;
      btn.textContent = 'שולח...';

      auth.currentUser.linkWithPhoneNumber(phoneNumber, getRecaptcha())
        .then(function (result) {
          confirmationResult = result;
          document.getElementById('phone-entry').style.display = 'none';
          document.getElementById('otp-entry').style.display = 'block';
          document.querySelector('.otp-row input').focus();
        })
        .catch(function (err) {
          console.error('linkWithPhoneNumber failed:', err);
          showError('phone-error', 'שליחת הקוד נכשלה (' + err.code + '): ' + err.message);
          if (window.recaptchaVerifier) {
            window.recaptchaVerifier.clear();
            window.recaptchaVerifier = null;
          }
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = 'שליחת קוד';
        });
    } catch (err) {
      console.error('send-otp click handler threw:', err);
      showError('phone-error', 'שגיאה: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'שליחת קוד';
    }
  });

  // Auto-advance focus between the 6 OTP boxes
  var otpInputs = Array.prototype.slice.call(document.querySelectorAll('.otp-row input'));
  otpInputs.forEach(function (input, i) {
    input.addEventListener('input', function () {
      if (input.value && i < otpInputs.length - 1) otpInputs[i + 1].focus();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !input.value && i > 0) otpInputs[i - 1].focus();
    });
  });

  document.getElementById('confirm-otp-btn').addEventListener('click', function () {
    hideError('phone-error');
    var otp = otpInputs.map(function (i) { return i.value; }).join('');
    if (otp.length !== 6) {
      showError('phone-error', 'הזן/י את כל 6 הספרות.');
      return;
    }

    confirmationResult.confirm(otp)
      .then(function (result) {
        return result.user.getIdToken(true);
      })
      .then(function (idToken) {
        return fetch('/lpapp/signup/api/complete-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: idToken, code: code })
        }).then(function (r) { return r.json(); });
      })
      .then(function (res) {
        if (!res.ok) {
          showError('phone-error', errorText(res));
          return;
        }
        window.location.href = '/lpapp/admin';
      })
      .catch(function (err) {
        showError('phone-error', 'קוד האימות שגוי: ' + err.message);
      });
  });
});

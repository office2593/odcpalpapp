import json
import logging
import os
import random
import re
import secrets
import shutil
import smtplib
import uuid
from datetime import datetime, timedelta
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import firebase_admin
from firebase_admin import auth as fb_auth
from firebase_admin import credentials
from flask import Flask, abort, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Railway (and most hosts) only allow one persistent Volume per service, so both
# the JSON data store and uploaded images live under one shared directory that
# the volume mounts to. Locally (no PERSISTENT_DIR set) everything just stays
# where it always was.
PERSISTENT_DIR = os.environ.get("PERSISTENT_DIR")
if PERSISTENT_DIR:
    DATA_DIR = os.path.join(PERSISTENT_DIR, "data")
    UPLOAD_DIR = os.path.join(PERSISTENT_DIR, "uploads")
else:
    DATA_DIR = os.path.join(BASE_DIR, "data")
    UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")

SEED_DATA_DIR = os.path.join(BASE_DIR, "data")  # the copy that ships in the git repo
DATA_FILE = os.path.join(DATA_DIR, "sites.json")
INVITES_FILE = os.path.join(DATA_DIR, "invites.json")
ADMINS_FILE = os.path.join(DATA_DIR, "admins.json")
SECRET_KEY_FILE = os.path.join(BASE_DIR, "secret_key.txt")
SERVICE_ACCOUNT_FILE = os.path.join(BASE_DIR, "serviceAccountKey.json")
EMAIL_CONFIG_FILE = os.path.join(BASE_DIR, "email_config.json")
BANNER_FILE = os.path.join(BASE_DIR, "static", "img", "banner.png")
OWNER_NAME = "אורן דולב - רואה חשבון"
EMAIL_WIDTH = 480
BANNER_HEIGHT = 116  # fixed aspect ratio for the banner scaled to EMAIL_WIDTH, computed from the source file (1020x247)
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I, avoids confusion
INVITE_EXPIRY_DAYS = 7

# Public demo site kept around for local development / showing the template.
DEMO_SLUG = "orit-cohen"

GRADIENTS = {
    "sunset": {"label": "שקיעה", "colors": ["#ff6b6b", "#ffd93d"]},
    "ocean": {"label": "אוקיינוס", "colors": ["#4facfe", "#00f2fe"]},
    "spring": {"label": "אביב", "colors": ["#43e97b", "#38f9d7"]},
    "flamingo": {"label": "פלמינגו", "colors": ["#fa709a", "#fee140"]},
    "dreamy": {"label": "סגול חלומי", "colors": ["#a18cd1", "#fbc2eb"]},
    "midnight": {"label": "לילה", "colors": ["#667eea", "#764ba2"]},
}

PHOTO_LAYOUTS = {"center", "split", "cover"}


def _bootstrap_persistent_storage():
    """On first boot against a fresh volume, DATA_DIR is empty — seed it from the
    copy that ships in the git repo so the site/invite/admin records aren't lost."""
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    if os.path.abspath(DATA_DIR) == os.path.abspath(SEED_DATA_DIR):
        return  # no PERSISTENT_DIR set — data dir IS the seed dir, nothing to copy
    for filename in ("sites.json", "invites.json", "admins.json"):
        dest = os.path.join(DATA_DIR, filename)
        if not os.path.isfile(dest):
            shutil.copy(os.path.join(SEED_DATA_DIR, filename), dest)


_bootstrap_persistent_storage()


def _load_service_account():
    """On Railway (or any host with an ephemeral filesystem) the key is passed as
    an env var containing the whole JSON; locally it's just the downloaded file."""
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if raw:
        return credentials.Certificate(json.loads(raw))
    return credentials.Certificate(SERVICE_ACCOUNT_FILE)


if not firebase_admin._apps:
    firebase_admin.initialize_app(_load_service_account())

app = Flask(__name__)

# Behind the WordPress proxy, static assets (css/js/images) load straight from
# Railway instead of through odcpa.co.il — sidesteps the host's own edge/server
# cache serving a stale 404 for anything under /lpapp/ that looks like a static
# file, and it's simply less to proxy per page load either way.
STATIC_BASE_URL = os.environ.get("STATIC_BASE_URL", "").rstrip("/")


@app.context_processor
def inject_asset_url():
    def asset_url(filename):
        path = url_for("static", filename=filename)
        return f"{STATIC_BASE_URL}{path}" if STATIC_BASE_URL else path
    return {"asset_url": asset_url}

if os.environ.get("SECRET_KEY"):
    app.secret_key = os.environ["SECRET_KEY"]
elif os.path.isfile(SECRET_KEY_FILE):
    with open(SECRET_KEY_FILE, "r", encoding="utf-8") as f:
        app.secret_key = f.read().strip()
else:
    app.secret_key = secrets.token_hex(32)
    with open(SECRET_KEY_FILE, "w", encoding="utf-8") as f:
        f.write(app.secret_key)


def load_sites():
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_sites(sites):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(sites, f, ensure_ascii=False, indent=2)


def get_site_or_404(slug):
    sites = load_sites()
    site = sites.get(slug)
    if site is None:
        abort(404)
    return site


def find_slug_by_uid(sites, uid):
    for slug, site in sites.items():
        if site.get("owner_uid") == uid:
            return slug
    return None


def generate_slug(email, existing_slugs):
    base = re.sub(r"[^a-z0-9]+", "-", email.split("@")[0].lower()).strip("-") or "user"
    slug = base
    i = 2
    while slug in existing_slugs:
        slug = f"{base}-{i}"
        i += 1
    return slug


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def load_invites():
    with open(INVITES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_invites(invites):
    with open(INVITES_FILE, "w", encoding="utf-8") as f:
        json.dump(invites, f, ensure_ascii=False, indent=2)


def generate_invite_code(invites):
    while True:
        code = "".join(random.choices(CODE_ALPHABET, k=4)) + "-" + "".join(random.choices(CODE_ALPHABET, k=4))
        if code not in invites:
            return code


def is_invite_expired(invite):
    created = datetime.strptime(invite["created_at"], "%d.%m.%Y %H:%M")
    return datetime.now() - created > timedelta(days=INVITE_EXPIRY_DAYS)


def load_email_config():
    if os.environ.get("SMTP_PASSWORD"):
        return {
            "smtp_host": os.environ.get("SMTP_HOST", "smtp.gmail.com"),
            "smtp_port": int(os.environ.get("SMTP_PORT", "587")),
            "smtp_user": os.environ["SMTP_USER"],
            "smtp_password": os.environ["SMTP_PASSWORD"],
            "from_name": os.environ.get("EMAIL_FROM_NAME", OWNER_NAME),
        }
    if not os.path.isfile(EMAIL_CONFIG_FILE):
        return None
    with open(EMAIL_CONFIG_FILE, "r", encoding="utf-8") as f:
        config = json.load(f)
    if not config.get("smtp_password") or config["smtp_password"] == "PASTE_APP_PASSWORD_HERE":
        return None
    return config


def send_invite_email(to_email, code, base_url):
    config = load_email_config()
    if config is None:
        return False

    join_url = f"{base_url}/lpapp/login?code={code}"
    # Table-based layout with explicit image width/height attributes and a solid-color
    # fallback behind the gradient: Outlook's desktop renderer (Word engine) ignores
    # CSS max-width/margin:auto on <img> and doesn't understand linear-gradient(),
    # so both need an explicit, attribute-based fallback to render correctly there.
    html = f"""
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="font-family:Arial,'Segoe UI',Tahoma,sans-serif;direction:rtl;">
      <tr>
        <td align="center">
          <table role="presentation" width="{EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:{EMAIL_WIDTH}px;max-width:100%;direction:rtl;">
            <tr>
              <td>
                <img src="cid:banner" alt="{OWNER_NAME}" width="{EMAIL_WIDTH}" height="{BANNER_HEIGHT}"
                     style="display:block;width:100%;max-width:{EMAIL_WIDTH}px;height:auto;border-radius:10px 10px 0 0;">
              </td>
            </tr>
            <tr>
              <td style="border:1px solid #e5e7eb;border-top:0;padding:20px;color:#1f2937;" dir="rtl">
                <p style="margin:0 0 12px;font-size:16px;text-align:justify;">שלום,</p>
                <p style="margin:0;line-height:1.8;font-size:16px;text-align:justify;">
                  הוזמנת על ידי <b>{OWNER_NAME}</b> להקמת דף נחיתה בעיצוב אישי.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" bgcolor="#6b5fc4" style="background-color:#6b5fc4;background-image:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:20px;">
                <p style="font-size:10px;color:rgba(255,255,255,0.8);margin:0 0 4px;">קוד ההזמנה שלך</p>
                <p style="font-size:18px;font-weight:bold;font-family:monospace;color:#ffffff;margin:0 0 14px;letter-spacing:1px;">{code}</p>
                <a href="{join_url}" style="display:inline-block;background:#ffffff;color:#5b4fc4;text-decoration:none;font-weight:bold;padding:10px 26px;border-radius:999px;font-size:14px;">הצטרפות עכשיו</a>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:14px 0;">
                <p style="font-size:11px;color:#999;margin:0;">הקישור בתוקף ל-{INVITE_EXPIRY_DAYS} ימים.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    """

    msg = MIMEMultipart("related")
    msg["Subject"] = "הוזמנת להצטרף ולבנות דף נחיתה משלך"
    msg["From"] = f"{config['from_name']} <{config['smtp_user']}>"
    msg["To"] = to_email

    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(html, "html", "utf-8"))
    msg.attach(alt)

    if os.path.isfile(BANNER_FILE):
        with open(BANNER_FILE, "rb") as f:
            banner_img = MIMEImage(f.read())
        banner_img.add_header("Content-ID", "<banner>")
        banner_img.add_header("Content-Disposition", "inline", filename="banner.png")
        msg.attach(banner_img)

    try:
        with smtplib.SMTP(config["smtp_host"], config["smtp_port"]) as server:
            server.starttls()
            server.login(config["smtp_user"], config["smtp_password"])
            server.send_message(msg)
        return True
    except Exception:
        app.logger.exception("send_invite_email failed")
        return False


def load_admins():
    with open(ADMINS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def is_admin(uid):
    return uid in load_admins().get("admin_uids", [])


def current_site_or_401():
    """Returns (slug, site) for the logged-in user, or aborts 401."""
    uid = session.get("uid")
    if not uid:
        abort(401)
    sites = load_sites()
    slug = find_slug_by_uid(sites, uid)
    if not slug:
        abort(401)
    return slug, sites


def get_base_url():
    """Behind the WordPress proxy, request.host_url is Railway's own hostname —
    use the query params the plugin adds so links point at odcpa.co.il instead.
    (Not a header: the host's security layer strips custom X- headers on
    outbound PHP requests, but a query string always survives untouched.)"""
    host = request.args.get("_lpapp_host")
    if not host:
        return request.host_url.rstrip("/")
    proto = request.args.get("_lpapp_proto", "https")
    return f"{proto}://{host}"


@app.route("/lpapp/_debug")
def _debug():
    return jsonify({
        "full_path": request.full_path,
        "args": dict(request.args),
        "headers": dict(request.headers),
        "host_url": request.host_url,
    })


@app.route("/")
def index():
    return f'<a href="/lpapp/{DEMO_SLUG}">public demo page</a> · <a href="/lpapp/login">login</a> · <a href="/lpapp/admin">admin panel</a>'


@app.route("/lpapp/uploads/<slug>/<filename>")
def uploaded_file(slug, filename):
    # Served from UPLOAD_DIR explicitly (not Flask's default /static handler) since
    # UPLOAD_DIR may point outside the static/ folder — at the mounted Volume path.
    return send_from_directory(os.path.join(UPLOAD_DIR, slug), filename)


@app.route("/lpapp/login")
def login():
    return render_template("login.html")


@app.route("/lpapp/signup/api/session-login", methods=["POST"])
def signup_session_login():
    """Called right after Google sign-in. Tells the client whether this is a
    returning user (log them in) or a new one (needs the invite-code + phone steps)."""
    payload = request.get_json(force=True, silent=True) or {}
    id_token = payload.get("idToken")
    try:
        decoded = fb_auth.verify_id_token(id_token)
    except Exception:
        app.logger.exception("verify_id_token failed")
        return jsonify({"ok": False, "error": "invalid_token"}), 401

    uid = decoded["uid"]
    sites = load_sites()
    slug = find_slug_by_uid(sites, uid)
    if slug:
        session["uid"] = uid
        return jsonify({"ok": True, "status": "existing", "slug": slug})

    return jsonify({"ok": True, "status": "new", "email": decoded.get("email", "")})


@app.route("/lpapp/signup/api/complete-signup", methods=["POST"])
def signup_complete():
    """Called after Google login + invite code + phone verification all succeeded
    on the client. Re-checks everything server-side before creating the site."""
    payload = request.get_json(force=True, silent=True) or {}
    id_token = payload.get("idToken")
    code = (payload.get("code") or "").strip().upper()

    try:
        decoded = fb_auth.verify_id_token(id_token)
    except Exception:
        app.logger.exception("verify_id_token failed")
        return jsonify({"ok": False, "error": "invalid_token"}), 401

    uid = decoded["uid"]
    email = (decoded.get("email") or "").strip().lower()
    phone = decoded.get("phone_number")

    if not email:
        return jsonify({"ok": False, "error": "no_email"}), 400
    if not phone:
        return jsonify({"ok": False, "error": "phone_not_verified"}), 400

    invites = load_invites()
    invite = invites.get(code)
    if invite is None:
        return jsonify({"ok": False, "error": "invalid_code"}), 404
    if invite["status"] == "redeemed":
        return jsonify({"ok": False, "error": "already_redeemed"}), 409
    if is_invite_expired(invite):
        return jsonify({"ok": False, "error": "expired_code"}), 410
    if invite["email"].strip().lower() != email:
        return jsonify({"ok": False, "error": "email_mismatch"}), 403

    sites = load_sites()
    if find_slug_by_uid(sites, uid):
        return jsonify({"ok": False, "error": "already_has_site"}), 409

    slug = generate_slug(email, set(sites.keys()))
    sites[slug] = {
        "slug": slug,
        "owner_uid": uid,
        "name": decoded.get("name") or email.split("@")[0],
        "role": "",
        "tagline": "",
        "about": "",
        "photo": decoded.get("picture"),
        "gallery": [],
        "contact": {"email": email, "phone": phone, "whatsapp": phone.lstrip("+")},
        "theme": "midnight",
        "photo_layout": "split",
    }
    save_sites(sites)

    invite["status"] = "redeemed"
    invite["redeemed_by"] = uid
    invite["redeemed_at"] = datetime.now().strftime("%d.%m.%Y %H:%M")
    invites[code] = invite
    save_invites(invites)

    session["uid"] = uid
    return jsonify({"ok": True, "slug": slug})


@app.route("/lpapp/login/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/lpapp/admin")
def admin():
    uid = session.get("uid")
    if not uid:
        return redirect("/lpapp/login")
    sites = load_sites()
    slug = find_slug_by_uid(sites, uid)
    if not slug:
        return redirect("/lpapp/login")
    site = sites[slug]
    return render_template(
        "admin.html",
        site=site,
        gradients=GRADIENTS,
        public_url=get_base_url() + f"/lpapp/{site['slug']}",
        show_invitations_link=is_admin(uid),
    )


@app.route("/lpapp/admin/api/save", methods=["POST"])
def admin_save():
    slug, sites = current_site_or_401()
    site = sites[slug]
    payload = request.get_json(force=True, silent=True) or {}

    site["name"] = (payload.get("name") or site["name"]).strip()
    site["role"] = (payload.get("role") or site["role"]).strip()
    site["tagline"] = (payload.get("tagline") or site["tagline"]).strip()
    site["about"] = (payload.get("about") or site["about"]).strip()

    theme = payload.get("theme")
    if theme in GRADIENTS:
        site["theme"] = theme

    photo_layout = payload.get("photo_layout")
    if photo_layout in PHOTO_LAYOUTS:
        site["photo_layout"] = photo_layout

    contact = payload.get("contact") or {}
    site["contact"]["email"] = (contact.get("email") or site["contact"]["email"]).strip()
    site["contact"]["phone"] = (contact.get("phone") or site["contact"]["phone"]).strip()
    site["contact"]["whatsapp"] = (contact.get("whatsapp") or site["contact"]["whatsapp"]).strip()

    sites[slug] = site
    save_sites(sites)
    return jsonify({"ok": True, "site": site})


@app.route("/lpapp/admin/api/upload", methods=["POST"])
def admin_upload():
    slug, sites = current_site_or_401()

    field = request.form.get("field")
    if field not in ("photo", "gallery"):
        return jsonify({"ok": False, "error": "invalid field"}), 400

    file = request.files.get("file")
    if not file or file.filename == "" or not allowed_file(file.filename):
        return jsonify({"ok": False, "error": "invalid file"}), 400

    ext = secure_filename(file.filename).rsplit(".", 1)[1].lower()
    filename = f"{uuid.uuid4().hex}.{ext}"

    site_upload_dir = os.path.join(UPLOAD_DIR, slug)
    os.makedirs(site_upload_dir, exist_ok=True)
    file.save(os.path.join(site_upload_dir, filename))

    url = f"{STATIC_BASE_URL}/lpapp/uploads/{slug}/{filename}"

    site = sites[slug]
    if field == "photo":
        site["photo"] = url
    else:
        site["gallery"].append(url)
    save_sites(sites)

    return jsonify({"ok": True, "url": url, "site": site})


@app.route("/lpapp/admin/api/remove-image", methods=["POST"])
def admin_remove_image():
    slug, sites = current_site_or_401()
    payload = request.get_json(force=True, silent=True) or {}
    url = payload.get("url")

    site = sites[slug]
    if site.get("photo") == url:
        site["photo"] = None
    elif url in site.get("gallery", []):
        site["gallery"].remove(url)
    else:
        return jsonify({"ok": False, "error": "not found"}), 404

    save_sites(sites)

    marker = "/lpapp/uploads/"
    relative = url.split(marker, 1)[1] if marker in url else None
    if relative:
        file_path = os.path.join(UPLOAD_DIR, relative.replace("/", os.sep))
        if os.path.isfile(file_path):
            os.remove(file_path)

    return jsonify({"ok": True, "site": site})


@app.route("/lpapp/admin/invitations")
def invitations():
    uid = session.get("uid")
    if not uid or not is_admin(uid):
        return redirect("/lpapp/admin")
    invites = load_invites()
    ordered = dict(sorted(invites.items(), key=lambda kv: kv[1]["created_at"], reverse=True))
    return render_template("invitations.html", invites=ordered)


@app.route("/lpapp/admin/api/invite", methods=["POST"])
def admin_create_invite():
    uid = session.get("uid")
    if not uid or not is_admin(uid):
        abort(403)

    payload = request.get_json(force=True, silent=True) or {}
    email = (payload.get("email") or "").strip()
    if not email:
        return jsonify({"ok": False, "error": "email required"}), 400

    invites = load_invites()
    code = generate_invite_code(invites)
    invite = {
        "email": email,
        "status": "pending",
        "created_at": datetime.now().strftime("%d.%m.%Y %H:%M"),
        "redeemed_by": None,
        "redeemed_at": None,
    }
    invites[code] = invite
    save_invites(invites)

    email_sent = send_invite_email(email, code, get_base_url())
    return jsonify({"ok": True, "code": code, "invite": invite, "email_sent": email_sent})


@app.route("/lpapp/signup/api/verify-code", methods=["POST"])
def signup_verify_code():
    """Read-only check: is this code valid and unredeemed for this email?"""
    payload = request.get_json(force=True, silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    code = (payload.get("code") or "").strip().upper()

    invites = load_invites()
    invite = invites.get(code)

    if invite is None:
        return jsonify({"ok": False, "error": "invalid_code"}), 404
    if invite["status"] == "redeemed":
        return jsonify({"ok": False, "error": "already_redeemed"}), 409
    if is_invite_expired(invite):
        return jsonify({"ok": False, "error": "expired_code"}), 410
    if invite["email"].strip().lower() != email:
        return jsonify({"ok": False, "error": "email_mismatch"}), 403

    return jsonify({"ok": True})


@app.route("/lpapp/<slug>")
def landing(slug):
    site = get_site_or_404(slug)
    gradient = GRADIENTS[site["theme"]]
    return render_template("landing.html", site=site, gradient=gradient)


if __name__ == "__main__":
    app.run(port=4300, debug=True)

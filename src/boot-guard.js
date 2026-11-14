// Runs before the game bundle. Its only job is to make failures visible:
// any uncaught error paints a readable card instead of a black screen.
(function () {
  var shown = false;
  function card(title, detail, code) {
    if (shown) return;
    shown = true;
    try {
      window.__bootError = { title: title, detail: detail, code: code };
      var loading = document.getElementById('loading');
      if (loading) loading.style.display = 'none';
      var el = document.getElementById('boot-error');
      if (!el) {
        el = document.createElement('div');
        el.id = 'boot-error';
        el.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;'
          + 'align-items:center;justify-content:center;padding:min(6vw,40px);box-sizing:border-box;'
          + 'background:radial-gradient(120% 120% at 50% 0%,#152844,#070a11 62%,#03050a);'
          + 'color:#e8ecf5;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;'
          + 'overflow:auto;-webkit-user-select:text;user-select:text;text-align:left');
        document.body.appendChild(el);
      }
      el.innerHTML = '<div style="max-width:620px;width:100%">'
        + '<div style="font-size:13px;letter-spacing:.34em;color:#ffc247;font-weight:700;margin-bottom:14px">LOS SANTOS</div>'
        + '<div style="font-size:20px;font-weight:700;line-height:1.3;margin-bottom:10px"></div>'
        + '<div style="font-size:14px;line-height:1.6;opacity:.82;white-space:pre-wrap"></div>'
        + '<div style="margin-top:16px;padding:11px 13px;border-radius:8px;background:#0006;'
        + 'border:1px solid #ffffff1f;font-family:ui-monospace,monospace;font-size:11px;'
        + 'line-height:1.5;color:#9fb0c8;white-space:pre-wrap;word-break:break-word"></div>'
        + '<button style="margin-top:20px;padding:11px 20px;border-radius:9px;border:0;cursor:pointer;'
        + 'font:inherit;font-size:13px;font-weight:700;letter-spacing:.14em;'
        + 'background:linear-gradient(135deg,#ffc247,#ff7a45);color:#10131a">TRY AGAIN</button>'
        + '</div>';
      var kids = el.firstChild.children;
      kids[1].textContent = title;
      kids[2].textContent = detail;
      kids[3].textContent = code ? String(code).slice(0, 900) : '';
      if (!code) kids[3].style.display = 'none';
      kids[4].addEventListener('click', function () { location.reload(); });
    } catch (e) {
      document.body && (document.body.style.color = '#fff');
    }
  }

  function humanize(raw) {
    var low = String(raw || '').toLowerCase();
    if (low.indexOf('webgl') >= 0 || low.indexOf('context') >= 0) {
      return ['This device could not start 3D graphics',
        'Los Santos needs WebGL 2. Close other apps and reopen, or turn off battery saver for this app.'];
    }
    if (low.indexOf('out of memory') >= 0 || low.indexOf('allocation failed') >= 0) {
      return ['Ran out of memory while loading the city',
        'Close other apps to free RAM, then reopen Los Santos.'];
    }
    if (low.indexOf('failed to fetch') >= 0 || low.indexOf('load failed') >= 0) {
      return ['A game file could not be loaded',
        'The bundled assets are missing or unreadable. Reinstall the app.'];
    }
    return ['Los Santos could not start',
      'Try reopening the app. If it keeps happening, update Android System WebView and Chrome.'];
  }

  window.__bootCard = card;

  window.addEventListener('error', function (e) {
    // ignore failures from unrelated extensions / passive resource 404s
    var msg = e.message || '';
    if (!msg && !e.error) return;
    var pair = humanize(msg || e.error);
    card(pair[0], pair[1], e.error ? (e.error.stack || msg) : msg);
  });

  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    var pair = humanize(reason);
    card(pair[0], pair[1], reason && (reason.stack || reason.message || String(reason)));
  });

  // If the bundle never even runs (bad script MIME, unsupported syntax, a
  // blocked classic-vs-module load), nothing above fires. Watch for it.
  setTimeout(function () {
    if (shown || window.__game || window.__bootStarted) return;
    var script = document.querySelector('script[src]');
    card('The game did not start',
      'The game script did not run at all. This usually means the installed '
      + 'Android System WebView is too old. Update "Android System WebView" and '
      + '"Chrome" from the Play Store, then reopen Los Santos.',
      script ? 'script src="' + script.getAttribute('src') + '" never executed' : 'no script tag found');
  }, 12000);
})();

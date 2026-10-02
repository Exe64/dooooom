'use strict';
/*
 * Update check, once at startup.
 * - Desktop app (Tauri): the updater plugin reads latest.json from the latest
 *   GitHub Release, verifies the update's signature against the public key built
 *   into the app, downloads and installs it, then the game relaunches.
 * - Web version (zip): compares GAME_VERSION with the latest release and points to it.
 * The offer is a banner at the bottom of the menus: it never interrupts a level.
 */
const Update = (() => {
  const REPO = 'Exe64/dukenutanix';
  const PAGE = `https://github.com/${REPO}/releases/latest`;
  const LINK = `github.com/${REPO}/releases`;
  const el = () => document.getElementById('update');
  function banner(html) {
    const b = el();
    if (!b) return;
    b.innerHTML = html;
    b.hidden = false;
  }
  // a > b for "x.y.z" versions
  function newer(a, b) {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  }

  async function desktop(T) {
    const up = await T.updater.check();
    if (!up) return;
    banner(`<b>Version ${up.version}</b> is available. <button data-up="install">UPDATE NOW</button><button data-up="later">LATER</button>`);
    el().onclick = async (e) => {
      const act = e.target.dataset && e.target.dataset.up;
      if (act === 'later') { el().hidden = true; return; }
      if (act !== 'install') return;
      el().onclick = null;
      let total = 0, got = 0;
      banner('Downloading the update...');
      try {
        await up.downloadAndInstall((ev) => {
          if (ev.event === 'Started') total = ev.data.contentLength || 0;
          else if (ev.event === 'Progress') {
            got += ev.data.chunkLength;
            if (total) banner(`Downloading the update... ${Math.floor(got / total * 100)}%`);
          } else if (ev.event === 'Finished') banner('Installing the update...');
        });
        banner('Update installed: restarting...');
        await T.process.relaunch();
      } catch (err) {
        banner(`The update failed (${String(err).slice(0, 80)}). Download it from <b>${LINK}</b>`);
      }
    };
  }

  async function web() {
    if (!/^\d+\.\d+\.\d+$/.test(GAME_VERSION)) return;    // running from the source: nothing to compare
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const tag = String((await r.json()).tag_name || '').replace(/^v/, '');
    if (/^\d+\.\d+\.\d+$/.test(tag) && newer(tag, GAME_VERSION)) {
      banner(`<b>Version ${tag}</b> is available (you have ${GAME_VERSION}). <a href="${PAGE}" target="_blank" rel="noopener">DOWNLOAD</a><button data-up="later">LATER</button>`);
      el().onclick = (e) => { if (e.target.dataset && e.target.dataset.up === 'later') el().hidden = true; };
    }
  }

  // Never blocks or breaks the game: offline, rate limited or no release yet just means no banner.
  function check() {
    const T = window.__TAURI__;
    (T && T.updater ? desktop(T) : web()).catch(() => {});
  }

  return { check };
})();

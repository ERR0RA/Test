document.addEventListener('DOMContentLoaded', () => {
  const keyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('save');
  const status = document.getElementById('status');
  const toggleBtn = document.getElementById('toggleKey');
  const modelSelect = document.getElementById('model');
  const keybindInput = document.getElementById('keybind');
  const saveSettings = document.getElementById('savesettings');
  const settingsStatus = document.getElementById('settings-status');
  const loadingTextInput = document.getElementById('loading-text');
  const errorTextInput = document.getElementById('error-text');
  const explainStyleSelect = document.getElementById('explain-style');

  const blockedWords = [
    'fuck','shit','ass','bitch','damn','crap','dick','cock','pussy','cunt',
    'bastard','slut','whore','wank','twat','bollocks','piss','arse','tit',
    'fag','nigger','nigga','retard','spastic','spaz',
    'epstein','diddy','pdiddy','puff daddy',
    'trump','biden','obama','clinton','bush','putin','xi jinping','xi','jinping',
    'hitler','stalin','mussolini','mao','kim jong','jong un',
    'sunak','starmer','macron','zelensky','netanyahu','bolsonaro'
  ];

  function containsBadWords(text) {
    var lower = text.toLowerCase();
    for (var i = 0; i < blockedWords.length; i++) {
      var word = blockedWords[i];
      var regex = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (regex.test(lower)) return true;
    }
    return false;
  }

  // Map deprecated/removed model values to current equivalents so existing users
  // don't see an empty dropdown after we slim down the option list.
  const modelMigrations = {
    'gemini-1.5-flash': 'gemini-flash-latest',
    'gemini-2.0-flash': 'gemini-flash-latest',
    'gemini-2.0-flash-lite': 'gemini-flash-lite-latest',
    'gemini-2.5-flash-lite': 'gemini-flash-lite-latest'
  };

  chrome.storage.local.get(['sparxApiKey','sparxModel','sparxKeybind','sparxDevInfo','sparxDevUnlocked','sparxLoadingText','sparxErrorText','sparxExplainStyle'], (data) => {
    if (data.sparxApiKey) { keyInput.value = data.sparxApiKey; status.textContent = 'Key saved!'; }
    if (data.sparxModel) {
      let m = data.sparxModel;
      if (modelMigrations[m]) {
        m = modelMigrations[m];
        chrome.storage.local.set({ sparxModel: m });
      }
      modelSelect.value = m;
    }
    keybindInput.value = data.sparxKeybind || 'Shift+S';
    loadingTextInput.value = data.sparxLoadingText || '';
    errorTextInput.value = data.sparxErrorText || '';
    if (data.sparxExplainStyle) explainStyleSelect.value = data.sparxExplainStyle;

    if (data.sparxDevUnlocked) {
      document.getElementById('dev-locked').style.display = 'none';
      document.getElementById('dev-unlocked').style.display = 'block';
      // Auto-show the dev tab button if previously unlocked
      showDevTab();
    }

    if (data.sparxDevInfo) {
      document.getElementById('dev-model-used').textContent = data.sparxDevInfo.model || '—';
      document.getElementById('dev-image-detected').textContent = data.sparxDevInfo.hasImage ? 'Yes' : 'No';
      document.getElementById('dev-bookwork').textContent = data.sparxDevInfo.code || '—';
    }
  });

  toggleBtn.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  saveBtn.addEventListener('click', () => {
    const key = keyInput.value.trim();
    if (!key) { status.style.color='#f47'; status.textContent='Please enter a key'; return; }
    chrome.storage.local.set({ sparxApiKey: key, sparxModel: modelSelect.value }, () => {
      status.style.color='#4caf7a'; status.textContent='Saved! Refresh Sparx.';
    });
  });

  modelSelect.addEventListener('change', () => {
    chrome.storage.local.set({ sparxModel: modelSelect.value });
  });

  keybindInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    var parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    var key = e.key;
    if (!['Control','Alt','Shift','Meta'].includes(key)) parts.push(key.toUpperCase());
    if (parts.length) keybindInput.value = parts.join('+');
  });

  saveSettings.addEventListener('click', () => {
    var loadText = loadingTextInput.value.trim();
    var errText = errorTextInput.value.trim();
    if ((loadText && containsBadWords(loadText)) || (errText && containsBadWords(errText))) {
      settingsStatus.style.color = '#f47';
      settingsStatus.textContent = 'Contains blocked words!';
      setTimeout(() => { settingsStatus.textContent = ''; settingsStatus.style.color = '#4caf7a'; }, 3000);
      return;
    }
    chrome.storage.local.set({
      sparxKeybind: keybindInput.value,
      sparxLoadingText: loadText || '',
      sparxErrorText: errText || '',
      sparxExplainStyle: explainStyleSelect.value
    }, () => {
      settingsStatus.style.color = '#4caf7a';
      settingsStatus.textContent = 'Saved! Refresh Sparx to apply.';
      setTimeout(() => settingsStatus.textContent = '', 3000);
    });
  });

  function showDevTab() {
    var devTab = document.querySelector('[data-tab="dev"]');
    if (!devTab) {
      var tab = document.createElement('button');
      tab.className = 'tab'; tab.dataset.tab = 'dev'; tab.textContent = '🛠';
      document.getElementById('tab-bar').appendChild(tab);
      tab.addEventListener('click', () => switchTab('dev'));
    }
  }

  function loadDiagnostic() {
    chrome.storage.local.get(['sparxDiagnostic','sparxDevInfo'], (d) => {
      if (d.sparxDevInfo) {
        document.getElementById('dev-model-used').textContent = d.sparxDevInfo.model || '—';
        var imgText = d.sparxDevInfo.hasImage ? 'Yes' : 'No';
        var mi = d.sparxDevInfo.mediaInfo;
        if (mi) {
          var parts = [];
          if (mi.svgs) parts.push('SVG:' + mi.svgs.length);
          if (mi.canvases) parts.push('Canvas:' + mi.canvases.length);
          if (mi.images) parts.push('Img:' + mi.images.length);
          if (parts.length) imgText += ' (' + parts.join(', ') + ')';
        }
        document.getElementById('dev-image-detected').textContent = imgText;
        document.getElementById('dev-bookwork').textContent = d.sparxDevInfo.code || '—';
      }
      var diagEl = document.getElementById('dev-diag');
      if (!diagEl) return;
      if (!d.sparxDiagnostic) { diagEl.textContent = 'No data yet'; return; }
      var info = d.sparxDiagnostic;
      var txt = '⏱ ' + (info.time || '?') + '  •  ' + (info.result || '?') + '\n';
      txt += 'isCardQuestion: ' + info.isCardQuestion + '\n';
      txt += 'ansClean: "' + (info.ansClean || '') + '"\n';
      txt += 'inputBoxCount: ' + info.inputBoxCount + '\n';
      txt += 'Cards: ' + info.cards;
      if (info.cardTexts && info.cardTexts.length) txt += ' → [' + info.cardTexts.map(t => '"'+t+'"').join(', ') + ']';
      txt += '\nSlots: ' + (info.slots !== undefined ? info.slots : '?');
      if (info.slotTexts && info.slotTexts.length) txt += ' → [' + info.slotTexts.map(t => '"'+t+'"').join(', ') + ']';
      txt += '\nOptions: ' + (info.options !== undefined ? info.options : '?');
      if (info.optTexts && info.optTexts.length) txt += ' → [' + info.optTexts.map(t => '"'+t+'"').join(', ') + ']';
      txt += '\nNum inputs: ' + (info.numInputs !== undefined ? info.numInputs : '?');
      if (info.tokens) txt += '\nTokens: [' + info.tokens.map(t => '"'+t+'"').join(', ') + ']';
      if (info.allTokens) txt += '\nAll tokens: ' + info.allTokens;
      if (info.branch) txt += '\nBranch: ' + info.branch;
      if (info.matched) txt += '\nMatched: "' + info.matched + '"';
      if (info.token) txt += '\nToken: "' + info.token + '"';
      if (info.slotIdx !== undefined) txt += '  slotIdx: ' + info.slotIdx;
      if (info.tokensLeft !== undefined) txt += '  left: ' + info.tokensLeft;
      if (info.cardTexts) txt += '\nCard texts: [' + info.cardTexts.map(t => '"'+t+'"').join(', ') + ']';
      if (info.firstCardHTML) txt += '\n1st card: ' + info.firstCardHTML;
      if (info.nearby) txt += '\nNearby: ' + info.nearby.join(' | ');
      if (info.allClasses) txt += '\nAll classes: ' + info.allClasses;
      if (info.moduleClasses) txt += '\nModule classes: ' + info.moduleClasses;
      if (info.plainClasses) txt += '\nPlain classes: ' + info.plainClasses;
      if (info.iframes !== undefined) txt += '\nIframes: ' + info.iframes;
      if (info.roleButtons !== undefined) txt += '\nRole buttons/options: ' + info.roleButtons;
      if (info.dataAttrs !== undefined) txt += '\nData attrs: ' + info.dataAttrs;
      if (info.slotParentHTML) txt += '\nSlot parent: ' + info.slotParentHTML;
      if (info.tileInfo) txt += '\nTile element: ' + info.tileInfo;
      if (info.iframeInfo) txt += '\nIframe info: ' + info.iframeInfo;
      if (info.activeSlotHTML) txt += '\nActive slot: ' + info.activeSlotHTML;
      if (info.domTree) txt += '\nDOM tree: ' + info.domTree;
      if (info.bottomBar) txt += '\nBottomBar: ' + info.bottomBar;
      if (info.strategy) txt += '\nStrategy: ' + info.strategy;
      if (info.slotTextAfter) txt += '\nSlot text after: "' + info.slotTextAfter + '"';
      if (info.emptySlots !== undefined) txt += '\nEmpty slots: ' + info.emptySlots;
      if (info.nonEmptySlots !== undefined) txt += '\nNon-empty slots: ' + info.nonEmptySlots;
      if (info.optionTiles !== undefined) txt += '\nOption tiles: ' + info.optionTiles;
      if (info.optionTileTexts && info.optionTileTexts.length) txt += ' → [' + info.optionTileTexts.map(t => '"'+t+'"').join(', ') + ']';
      if (info.tileTexts && info.tileTexts.length) txt += '\nTile texts: [' + info.tileTexts.map(t => '"'+t+'"').join(', ') + ']';
      if (info.choiceTexts && info.choiceTexts.length) txt += '\nChoices: [' + info.choiceTexts.map(t => '"'+t+'"').join(', ') + ']';
      if (info.activeElement) txt += '\nActive element: ' + info.activeElement;
      if (info.ansRaw) txt += '\nansRaw: "' + info.ansRaw + '"';
      if (info.picked) txt += '\nPicked: #' + info.picked + ' → "' + (info.pickedText || '') + '"';
      if (info.mediaInfo) {
        txt += '\n── MEDIA INFO ──';
        var m = info.mediaInfo;
        if (m.svgs && m.svgs.length) {
          txt += '\nSVGs (>50px): ' + m.svgs.length;
          m.svgs.forEach((s, i) => {
            txt += '\n  SVG[' + i + ']: ' + s.width + 'x' + s.height;
            if (s.viewBox) txt += ' viewBox="' + s.viewBox + '"';
            txt += '\n    lines:' + s.lines + ' paths:' + s.paths + ' circles:' + s.circles + ' rects:' + s.rects;
            if (s.texts && s.texts.length) txt += '\n    texts: [' + s.texts.map(t => '"'+t+'"').join(', ') + ']';
            if (s.points && s.points.length) txt += '\n    points: ' + s.points.join(', ');
          });
        }
        if (m.canvases && m.canvases.length) {
          txt += '\nCanvas elements: ' + m.canvases.length;
          m.canvases.forEach((c, i) => {
            txt += '\n  Canvas[' + i + ']: ' + c.width + 'x' + c.height;
            if (c.className) txt += ' class="' + c.className + '"';
          });
        }
        if (m.images && m.images.length) {
          txt += '\nImages (>50px): ' + m.images.length;
          m.images.forEach((img, i) => {
            txt += '\n  Img[' + i + ']: ' + img.width + 'x' + img.height;
            if (img.className) txt += ' class="' + img.className + '"';
            if (img.alt) txt += ' alt="' + img.alt + '"';
            txt += '\n    src: ' + img.src;
          });
        }
        if (!m.svgs && !m.canvases && !m.images) txt += '\nNo large media found (only small icons)';
      }
      if (info.question) txt += '\nQ: ' + info.question;
      diagEl.textContent = txt;
    });
  }

  // Logo click counter for dev mode
  var logoClicks = 0; var logoTimer = null;
  document.getElementById('logo-click').addEventListener('click', () => {
    logoClicks++;
    clearTimeout(logoTimer);
    logoTimer = setTimeout(() => logoClicks = 0, 2000);
    if (logoClicks >= 5) {
      logoClicks = 0;
      showDevTab();
      switchTab('dev');
    }
  });

  // Dev unlock (password is hashed so it's not visible in source)
  async function hashPassword(pw) {
    var data = new TextEncoder().encode(pw);
    var buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  document.getElementById('dev-unlock').addEventListener('click', async () => {
    var pw = document.getElementById('dev-password').value;
    var hash = await hashPassword(pw);
    if (hash === 'ca55dae2ae8f2c1866c39652b6f911068804ea9907b41ae5c733e597dc97c1c9') {
      document.getElementById('dev-locked').style.display = 'none';
      document.getElementById('dev-unlocked').style.display = 'block';
      chrome.storage.local.set({ sparxDevUnlocked: true });
      loadDiagnostic();
    } else {
      document.getElementById('dev-error').textContent = 'Wrong password.';
    }
  });

  // Dev refresh button
  document.getElementById('dev-refresh').addEventListener('click', () => {
    loadDiagnostic();
  });

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    var tab = document.querySelector('[data-tab="'+name+'"]');
    var panel = document.getElementById('tab-'+name);
    if (tab) tab.classList.add('active');
    if (panel) panel.classList.add('active');
    if (name === 'dev') loadDiagnostic();
  }

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Help panel toggle
  var helpToggle = document.getElementById('help-toggle');
  var helpPanel = document.getElementById('help-panel');
  var helpBack = document.getElementById('help-back');
  if (helpToggle && helpPanel) {
    helpToggle.addEventListener('click', () => {
      helpPanel.classList.add('visible');
      helpToggle.style.display = 'none';
    });
  }
  if (helpBack && helpPanel) {
    helpBack.addEventListener('click', () => {
      helpPanel.classList.remove('visible');
      helpToggle.style.display = '';
    });
  }
});
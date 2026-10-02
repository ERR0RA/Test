(function() {
  if (document.getElementById('sparx-solver-box')) return;

  var box = document.createElement('div'); box.id = 'sparx-solver-box';
  var inner = document.createElement('div'); inner.id = 'sparx-inner';
  inner.innerHTML = '<div class="sparx-header"><span class="sparx-header-title">Sparx Neon</span></div><div class="sparx-section"><div class="sparx-label">Detected Question</div><div class="sparx-question-text" id="sparx-q-display">Click Scan to read the question...</div></div><button class="sparx-rescan" id="sparx-scan-btn">Scan page for question</button><button class="sparx-solve-btn" id="sparx-solve-btn">Solve with AI</button><button class="sparx-autofill-btn" id="sparx-autofill-btn">Auto-fill</button><div class="sparx-answer" id="sparx-answer-box"><div class="sparx-label">Answer</div><div class="sparx-answer-text" id="sparx-answer-text"></div></div><button class="sparx-hist-toggle" id="sparx-hist-toggle">Show history</button><button class="sparx-hist-clear" id="sparx-hist-clear" style="display:none;">Clear history</button><div id="sparx-history"></div>';
  box.appendChild(inner);

  var toggleBtn = document.createElement('button'); toggleBtn.id = 'sparx-solver-btn'; toggleBtn.textContent = 'S'; toggleBtn.title = 'Sparx Neon';

  document.body.appendChild(box);
  document.body.appendChild(toggleBtn);

  var currentQuestion=''; var currentCode='?'; var currentImageB64=null; var currentGraphB64=null; var hasRealImage=false; var currentAnswer=''; var currentFullAnswer=''; var currentTranscript=''; var history=[]; var lastUrl=location.href;
  var sparxKeybind='Shift+S'; var autoFilling=false; var inputBoxCount=0; var isCardQuestion=false; var slotCount=0; var hasClickableCards=false; var cardChoices=[]; var tileChoices=[]; var selectOptions=[];
  var loadingText='Thinking...'; var errorText='Error'; var explainStyle='normal'; var lastErrorTime=0;

  chrome.storage.local.get(['sparxKeybind','sparxHistory','sparxLoadingText','sparxErrorText','sparxExplainStyle'], function(data) {
    if (data.sparxKeybind) sparxKeybind = data.sparxKeybind;
    if (data.sparxHistory) { history = data.sparxHistory; renderHist(); }
    if (data.sparxLoadingText) loadingText = data.sparxLoadingText;
    if (data.sparxErrorText) errorText = data.sparxErrorText;
    if (data.sparxExplainStyle) explainStyle = data.sparxExplainStyle;
  });

  function saveHistory() { chrome.storage.local.set({ sparxHistory: history }); }

  function getSparxProduct() {
    var h = location.hostname.toLowerCase();
    if (h.indexOf('reader') !== -1) return 'reader';
    if (h.indexOf('science') !== -1) return 'science';
    return 'maths';
  }

  function getProductName() {
    var p = getSparxProduct();
    if (p === 'reader') return 'Sparx Reader';
    if (p === 'science') return 'Sparx Science';
    return 'Sparx Maths';
  }

  function getTutorName() {
    var p = getSparxProduct();
    if (p === 'reader') return 'reading comprehension tutor';
    if (p === 'science') return 'science tutor';
    return 'maths tutor';
  }

  function findQuestionWrapper() {
    var selectors = [
      '[class*=QuestionWrapper]',
      '[class*=_QuestionWrapper]',
      '[class*=_QuestionContent]',
      '[class*=_Question_]',
      '[data-testid*=question]',
      '[aria-label*=question]',
      'article',
      'main'
    ];
    for (var s = 0; s < selectors.length; s++) {
      var nodes = Array.from(document.querySelectorAll(selectors[s])).filter(function(el) {
        if (!el || el.closest('#sparx-solver-box')) return false;
        var rect = el.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 40) return false;
        var text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 8) return false;
        if (/log in|username|password|select your school/i.test(text) && text.length < 500) return false;
        return true;
      });
      if (nodes.length) {
        nodes.sort(function(a, b) {
          var at = (a.innerText || '').length, bt = (b.innerText || '').length;
          return Math.abs(at - 700) - Math.abs(bt - 700);
        });
        return nodes[0];
      }
    }
    return null;
  }

  function renderMarkdown(text, el) {
    try {
      el.innerHTML = marked.parse(text);
      if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(el, {
          delimiters: [
            {left:'$$', right:'$$', display:true},
            {left:'$', right:'$', display:false},
            {left:'\\(', right:'\\)', display:false},
            {left:'\\[', right:'\\]', display:true}
          ],
          throwOnError: false
        });
      }
    } catch(e) { el.textContent = text; }
  }

  function stripLatex(s) {
    return s
      .replace(/\$\$([^$]*)\$\$/g, '$1')
      .replace(/\$([^$]*)\$/g, '$1')
      .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2')
      // \text{kg} → kg (keep the contents, drop the wrapper command)
      .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^}]*)\}/g, '$1')
      // \quad / \, / \; / \! → spaces (LaTeX spacing commands)
      .replace(/\\(?:quad|qquad|,|;|:|!|\s)/g, ' ')
      .replace(/\\left|\\right|\\cdot|\\times/g, '')
      .replace(/\*\*/g, '')
      .replace(/\\/g, '')
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Parse multi-part answers like "a) 5", "b) 3" from AI response
  function parsePartAnswers(full) {
    var lines = full.trim().split('\n').filter(function(l){return l.trim();});
    var parts = [];
    for (var i=0; i<lines.length; i++) {
      var l = stripLatex(lines[i].trim());
      // Match "a) 5", "(a) 5", "a. 5", "a: 5" — but NOT math like "c = 5" or "x + 2"
      var m = l.match(/^\(?([a-z])\)?[\.\):\s]\s*(.+)$/i);
      // Skip if letter is a common math variable followed by = or operator (not a part label)
      if (m && /^[=≈<>²³√+\-*×÷^]/.test(m[2].trim())) { m = null; }
      if (m && m[2].trim().length > 0 && m[2].trim().length < 40) {
        parts.push({ label: m[1].toLowerCase(), answer: m[2].trim() });
      }
    }
    return parts;
  }

  // Save each part as a separate history entry
  function savePartAnswers(fullText) {
    var parts = parsePartAnswers(fullText);
    if (parts.length <= 1) return; // not multi-part, handled normally
    for (var p=0; p<parts.length; p++) {
      var partCode = currentCode + ' ' + parts[p].label + ')';
      var found = false;
      for (var i=0; i<history.length; i++) {
        if (history[i].code === partCode) { history[i].ans = parts[p].answer; found=true; break; }
      }
      if (!found) {
        history.unshift({code: partCode, ans: parts[p].answer, full: fullText, part: parts[p].label});
        if (history.length > 40) history.pop();
      }
    }
  }

  function extractShortAnswer(full) {
    var lines = full.trim().split('\n').filter(function(l){return l.trim();});

    if (inputBoxCount > 1) {
      // For multi-box: look for a pipe-separated line first
      for (var i=lines.length-1; i>=0; i--) {
        var l = stripLatex(lines[i].trim());
        if (l.indexOf('|') !== -1) return l;
      }
      // Standard form detection: "3.5 × 10^4" → "3.5 | 4"
      if (inputBoxCount === 2) {
        var sfClean = stripLatex(full).replace(/\s+/g,' ');
        var sfm = sfClean.match(/(-?\d+(?:\.\d+)?)\s*[×x\*]?\s*(?:times)?\s*10\s*\^?\s*\{?\s*(-?\d+)\s*\}?/i);
        if (sfm) return sfm[1] + ' | ' + sfm[2];
      }
      // No pipe line found — collect numeric answers from lines like "a) 5", "b) 3"
      var vals = [];
      for (var i=0; i<lines.length; i++) {
        var l = stripLatex(lines[i].trim());
        var m = l.match(/^[a-z]\)\s*(.+)$/i);
        if (m) {
          var v = m[1].trim();
          if (v.length > 0 && v.length < 30) vals.push(v);
        }
      }
      if (vals.length >= inputBoxCount) return vals.join(' | ');
      // Last resort: extract all numbers
      var nums = full.match(/-?\d+(\.\d+)?/g);
      if (nums && nums.length >= inputBoxCount) return nums.slice(-inputBoxCount).join(' | ');
    }

    // Check for multi-part answers. If the AI labelled its working as a) b) c)
    // (often it does even for single-input questions, because the prompt mentions
    // multi-part formatting), the LAST part is almost always the final answer —
    // earlier parts are intermediate working (e.g. the hypotenuse before the
    // perimeter is computed). True multi-input questions take the
    // inputBoxCount > 1 branch above, so by the time we get here we know Sparx
    // is expecting one value, not several.
    var parts = parsePartAnswers(full);
    if (parts.length > 1) {
      return parts[parts.length - 1].answer;
    }

    // Single answer: prefer the last line that looks like a clean answer (short, mostly numeric)
    // First pass: look for a very short answer-like line from the end
    for (var i=lines.length-1; i>=0; i--) {
      var l = stripLatex(lines[i].trim());
      if (l.length > 0 && l.length < 20 && /\d/.test(l)) return l;
    }
    // Second pass: any short line from the end
    for (var i=lines.length-1; i>=0; i--) {
      var l = stripLatex(lines[i].trim());
      if (l.length > 0 && l.length < 40) return l;
    }
    return stripLatex(lines[lines.length-1].trim()).substring(0,40);
  }

  function getSavedAnswer(code) {
    for (var i=0; i<history.length; i++) {
      if (history[i].code === code) return history[i].ans;
    }
    return null;
  }

  // Extract clean question text from the wrapper
  function extractCleanQuestion(wrapper) {
    // Clone so we can mutate without touching the live page.
    var clone = wrapper.cloneNode(true);
    // Remove the hidden MathML twin that KaTeX inserts alongside the visible math.
    // innerText can leak it on some browsers/layouts, producing duplicate content
    // (e.g. "2.9 kg" appearing once readable and once mashed as "2.9kg").
    clone.querySelectorAll('.katex-mathml').forEach(function(m) { m.remove(); });
    // Skip our own panel if it somehow ended up cloned.
    clone.querySelectorAll('#sparx-solver-box').forEach(function(b) { b.remove(); });

    var text = clone.innerText.trim().replace(/\s+/g, ' ');
    // Strip drag-and-drop accessibility sentences (match up to next period)
    text = text.replace(/To pick up a draggable item[^.]*\./gi, '');
    text = text.replace(/While dragging[^.]*\./gi, '');
    text = text.replace(/Press space (?:bar )?to (?:pick up|drop|move)[^.]*\./gi, '');
    text = text.replace(/\bSubmit\b/g, '').replace(/\bWatch video\b/gi, '');
    text = text.replace(/\s+/g, ' ').trim();

    // Fallback: if innerText didn't yield any math (some layouts hide the visible
    // KaTeX HTML and only the MathML annotation is readable), fall back to the
    // LaTeX source. Only kicks in when there's no math-looking content already.
    var hasMath = /[\d=+\-×÷*\/√^]/.test(text);
    if (!hasMath) {
      wrapper.querySelectorAll('.katex-mathml annotation').forEach(function(ann) {
        var m = stripLatex(ann.textContent).trim();
        if (m && text.indexOf(m) === -1) text += ' ' + m;
      });
    }

    // Grab alt text from images (equations can be images) — only if not already in text
    wrapper.querySelectorAll('img').forEach(function(img) {
      if (img.closest('#sparx-solver-box')) return;
      var alt = (img.alt || img.getAttribute('aria-label') || '').trim();
      if (alt && text.indexOf(alt) === -1) text += ' ' + alt;
    });
    return text.substring(0, 600);
  }

  // Readable version of option text — for showing to the AI in prompts
  function getOptionTextReadable(el) {
    // 1. KaTeX annotation → light cleanup (keep structure readable)
    var ann = el.querySelector('.katex-mathml annotation');
    if (ann && ann.textContent.trim()) {
      return stripLatex(ann.textContent).trim();
    }
    // 2. aria-label / data attributes
    var aria = el.getAttribute('aria-label') || el.getAttribute('data-value') || '';
    if (aria.trim()) return aria.trim();
    // 3. Visible text (remove hidden MathML duplicates)
    var clone = el.cloneNode(true);
    clone.querySelectorAll('.katex-mathml').forEach(function(m) { m.remove(); });
    var vis = clone.textContent.trim();
    if (vis) return vis;
    return el.innerText.trim().split('\n')[0].trim();
  }

  // Stripped version — for fuzzy matching (lowercase, no spaces)
  function getOptionText(el) {
    return getOptionTextReadable(el).normalize('NFKC').toLowerCase().replace(/\s+/g,'');
  }

  function sparxClick(el) {
    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var shared = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
    // PointerEvents first (React 17+ listens on these)
    el.dispatchEvent(new PointerEvent('pointerdown', shared));
    el.dispatchEvent(new PointerEvent('pointerup', shared));
    // Then classic MouseEvents
    el.dispatchEvent(new MouseEvent('mousedown', shared));
    el.dispatchEvent(new MouseEvent('mouseup', shared));
    el.dispatchEvent(new MouseEvent('click', shared));
  }

  function typeIntoInput(input, value, callback) {
    sparxClick(input);
    input.focus();
    var chars = value.toString().split('');
    var delay = 0;
    chars.forEach(function(char, i) {
      setTimeout(function() {
        var keyCode = char === '-' ? 189 : char === '.' ? 190 : char.charCodeAt(0);
        ['keydown','keypress','keyup'].forEach(function(ev) {
          input.dispatchEvent(new KeyboardEvent(ev, {
            key: char,
            code: 'Digit'+char,
            keyCode: keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true
          }));
        });
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, value.toString().substring(0, i+1));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, delay);
      delay += 60;
    });
    setTimeout(function() { if (callback) callback(); }, delay + 100);
  }

  // Split answer into parts for multi-box questions
  // First tries pipe-separated format (from AI prompt), then falls back to number extraction
  function splitAnswerParts(answer) {
    var clean = stripLatex(answer);
    // Try pipe-separated format first (e.g. "5 | 3 | 7" or "3 | 5" for fraction)
    if (clean.indexOf('|') !== -1) {
      var pipeParts = clean.split('|').map(function(p){ return p.trim(); }).filter(function(p){ return p.length > 0; });
      if (pipeParts.length > 1) return pipeParts;
    }
    // Try comma-separated format (e.g. "5, 3, 7")
    if (clean.indexOf(',') !== -1) {
      var commaParts = clean.split(',').map(function(p){ return p.trim(); }).filter(function(p){ return p.length > 0; });
      if (commaParts.length > 1) return commaParts;
    }
    if (inputBoxCount === 2) {
      // Standard form detection: "2 × 10^5", "2 x 10^5", "2 10^5" (× stripped), "2 times 10^5"
      var sfMatch = clean.match(/^(-?\d+(?:\.\d+)?)\s*[×x\*]?\s*(?:times)?\s*10\s*\^?\s*\{?\s*(-?\d+)\s*\}?$/i);
      if (sfMatch) return [sfMatch[1], sfMatch[2]];
      // Fraction detection: a/b or a÷b → [numerator, denominator]
      var fracMatch = clean.match(/^(-?\d+(?:\.\d+)?)\s*[\/÷]\s*(-?\d+(?:\.\d+)?)$/);
      if (fracMatch) return [fracMatch[1], fracMatch[2]];
    }
    // Fallback: extract all numbers (including negatives/decimals)
    var parts = [];
    var matches = clean.match(/-?\d+(\.\d+)?/g);
    if (matches) parts = matches;
    return parts;
  }

  function startAutoFill() {
    if (isTimesTablePage()) return;
    if (autoFilling) { stopAutoFill(); return; }
    autoFilling = true;
    lastManualInput = ''; // Clear so stale manual values don't interfere
    var btn = document.getElementById('sparx-autofill-btn');
    btn.textContent = 'Stop';
    btn.style.background = '#c0392b';
    runAutoFillCycle();
  }

  function runAutoFillCycle() {
    if (!autoFilling) return;

    // If on results/feedback page (blue continue button visible), click through it
    var blueBtn = document.querySelector('[class*=_ButtonBlue_]');
    if (blueBtn) {
      sparxClick(blueBtn);
      setTimeout(function() { if (autoFilling) runAutoFillCycle(); }, 1500);
      return;
    }

    // If on summary/completion page, try to click through it
    if (isSummaryPage()) {
      var doneBtn = document.querySelector('[class*=_ButtonPrimary_]') ||
                    document.querySelector('button[class*=_Button_]');
      if (doneBtn) sparxClick(doneBtn);
      setTimeout(function() { if (autoFilling) runAutoFillCycle(); }, 1500);
      return;
    }

    // 1. Read everything fresh from the DOM
    var codeEl = document.querySelector('[class*=_Selected_]');
    currentCode = codeEl ? codeEl.innerText.trim() : '?';
    var exact = findQuestionWrapper();
    if (exact && !exact.closest('#sparx-solver-box')) {
      currentQuestion = extractCleanQuestion(exact);
      lastQuestionText = currentQuestion.substring(0, 200);
      lastDetectedCode = currentCode;
      hasRealImage = hasQuestionMedia(exact);
    } else {
      setTimeout(function() { if (autoFilling) runAutoFillCycle(); }, 1000);
      return;
    }

    // Clear old answer/image data
    currentAnswer = '';
    currentFullAnswer = '';
    currentImageB64 = null;
    currentGraphB64 = null;
    currentTranscript = '';
    inputBoxCount = 0;
    cardChoices = [];
    tileChoices = [];

    // Update panel display (full text, collapsible)
    var d = document.getElementById('sparx-q-display');
    if (d) {
      var qText = currentQuestion + (hasRealImage ? ' [image]' : '');
      d.textContent = qText;
      d.classList.add('has-text');
      d.classList.remove('expanded');
      if (qText.length < 100) d.classList.add('short-text');
      else d.classList.remove('short-text');
    }

    // 2. Click "Answer" to reveal input boxes
    var answerBtn = Array.from(document.querySelectorAll('[class*=_ButtonPrimary_]')).find(function(b) {
      return b.innerText.trim() === 'Answer';
    });
    function detectQuestionType() {
      inputBoxCount = getNumericInputs().length;
      var slotEls = Array.from(document.querySelectorAll('[class*=_InlineSlot],[class*=_CardSlot],[class*=_Slot_]')).filter(function(el) {
        if (el.closest('#sparx-solver-box')) return false;
        var cls = typeof el.className === 'string' ? el.className : '';
        if (cls.indexOf('Wrapper') !== -1 || cls.indexOf('Outline') !== -1 || cls.indexOf('Focus') !== -1) return false;
        return true;
      });
      slotCount = slotEls.length;
      hasClickableCards = !!document.querySelector('[class*=_CardContentClickable]:not(#sparx-solver-box [class*=_CardContentClickable])');
      isCardQuestion = !inputBoxCount && !!(
        hasClickableCards ||
        document.querySelector('[class*=_CardContent]') ||
        slotEls.length ||
        document.querySelector('[class*=_Option_]')
      );
    }
    function gatherSelectOptions() {
      selectOptions = [];
      document.querySelectorAll('[class*=_AnswerContent] select, [class*=_Answer_] select, [class*=_QuestionWrapper] select').forEach(function(sel) {
        if (sel.closest('#sparx-solver-box')) return;
        var opts = [];
        for (var i = 0; i < sel.options.length; i++) {
          var t = sel.options[i].textContent.trim();
          if (t && t !== '' && t !== '--') opts.push(t);
        }
        if (opts.length) selectOptions.push(opts);
      });
    }
    function gatherCardChoices() {
      cardChoices = [];
      if (!hasClickableCards) return;
      var els = Array.from(document.querySelectorAll('[class*=_CardContentClickable]')).filter(function(el) {
        return !el.closest('#sparx-solver-box');
      });
      els.forEach(function(el, i) {
        cardChoices.push({ el: el, text: getOptionText(el), readable: getOptionTextReadable(el), index: i });
      });
    }
    // For slot-fill questions: collect available drag-tile values so the AI prompt
    // can list them. The fill phase already uses findOptionTiles() to match clicks;
    // this just makes the AI aware of what values are picking from in the first place.
    function gatherTileChoices() {
      tileChoices = [];
      if (!slotCount) return;
      var tiles = findOptionTiles();
      if (!tiles || !tiles.length) return;
      // De-dupe by readable text so duplicate strategy hits don't bloat the prompt
      var seenText = {};
      tiles.forEach(function(el) {
        var readable = getOptionTextReadable(el);
        if (!readable) return;
        if (seenText[readable]) return;
        seenText[readable] = true;
        tileChoices.push({ el: el, text: getOptionText(el), readable: readable });
      });
    }

    if (answerBtn) {
      sparxClick(answerBtn);
      setTimeout(function() {
        if (!autoFilling) return;
        detectQuestionType();
        gatherCardChoices();
        gatherTileChoices();
        gatherSelectOptions();
        captureAndSolve(exact);
      }, 800);
    } else {
      detectQuestionType();
      gatherCardChoices();
      gatherTileChoices();
      gatherSelectOptions();
      captureAndSolve(exact);
    }
  }

  // Find a real content image inside the question area (not tiny icons)
  function findQuestionImage(container) {
    // Priority 1: Sparx's own _Image_ class
    var img = container.querySelector('img[class*=_Image_]');
    if (img) return img;
    // Priority 2: any <img> that is large enough to be a real content image (not a tiny icon)
    var allImgs = container.querySelectorAll('img');
    for (var i = 0; i < allImgs.length; i++) {
      var el = allImgs[i];
      if (el.closest('#sparx-solver-box')) continue;
      // Check natural size or rendered size — skip tiny icons (< 40px either dimension)
      var w = el.naturalWidth || el.width || el.offsetWidth || 0;
      var h = el.naturalHeight || el.height || el.offsetHeight || 0;
      if (w > 40 && h > 40) return el;
      // Also accept if src looks like a real image (not a data URI icon)
      if (el.src && el.src.indexOf('data:image/svg') === -1 && (w > 20 || h > 20)) return el;
    }
    return null;
  }

  function hasQuestionMedia(container) {
    if (findQuestionImage(container)) return true;
    // Check for canvas or video (not tiny icon SVGs)
    if (container.querySelector('canvas, video')) return true;
    // Only count SVGs that are large enough to be a real graph (not icons)
    var svgs = container.querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) {
      var w = svgs[i].clientWidth || parseInt(svgs[i].getAttribute('width')) || 0;
      var h = svgs[i].clientHeight || parseInt(svgs[i].getAttribute('height')) || 0;
      if (w > 80 && h > 80) return true;
    }
    return false;
  }

  function trimCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var data = ctx.getImageData(0, 0, w, h).data;
    var top = h, left = w, right = 0, bottom = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        // Check if pixel is not white (allow near-white threshold)
        if (data[i] < 245 || data[i+1] < 245 || data[i+2] < 245) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    if (right <= left || bottom <= top) return canvas; // all white, return as-is
    // Add small padding
    var pad = 10;
    top = Math.max(0, top - pad);
    left = Math.max(0, left - pad);
    right = Math.min(w - 1, right + pad);
    bottom = Math.min(h - 1, bottom + pad);
    var trimmed = document.createElement('canvas');
    trimmed.width = right - left + 1;
    trimmed.height = bottom - top + 1;
    trimmed.getContext('2d').drawImage(canvas, left, top, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
    return trimmed;
  }

  function captureAndSolve(exact) {
    if (!autoFilling) return;

    function doSolveAutofill() {
      solveForAutofill(function(answer) {
        if (!autoFilling) return;
        currentAnswer = answer;
        tryFill();
      });
    }

    if (hasRealImage) {
      // Fetch the actual image directly first (more reliable than html2canvas)
      var graphImg = findQuestionImage(exact);
      if (graphImg && graphImg.src) {
        fetchImageAsB64(graphImg.src, function(b64) {
          if (!autoFilling) return;
          if (b64) { currentImageB64 = b64; currentGraphB64 = b64; }
          fetchTranscript(function(transcript) { currentTranscript = transcript; });
          doSolveAutofill();
        });
      } else {
        // No direct image found, try html2canvas as fallback
        html2canvas(exact, {backgroundColor:'#ffffff', scale:2, useCORS:true, logging:false})
        .then(function(canvas) {
          if (!autoFilling) return;
          var trimmed = trimCanvas(canvas);
          currentImageB64 = trimmed.toDataURL('image/png').split(',')[1];
          doSolveAutofill();
        })
        .catch(function() {
          if (!autoFilling) return;
          doSolveAutofill();
        });
      }
    } else {
      // Always capture a lightweight screenshot so AI can see shapes, diagrams, sequences etc.
      html2canvas(exact, {backgroundColor:'#ffffff', scale:1, useCORS:true, logging:false})
      .then(function(canvas) {
        if (!autoFilling) return;
        var trimmed = trimCanvas(canvas);
        currentImageB64 = trimmed.toDataURL('image/png').split(',')[1];
        doSolveAutofill();
      })
      .catch(function() {
        if (!autoFilling) return;
        currentImageB64 = null;
        doSolveAutofill();
      });
    }
  }

  function stopAutoFill() {
    autoFilling = false;
    lastManualInput = ''; // Clear so auto-fill answers aren't saved as manual later
    var btn = document.getElementById('sparx-autofill-btn');
    if (btn) { btn.textContent = 'Auto-fill'; btn.style.background = ''; btn.disabled = false; }
  }

  // Normalize a math string for fuzzy comparison: strip parens/braces, sort characters
  function mathNorm(s) {
    return s.replace(/[(){}\[\]]/g,'').replace(/\s+/g,'');
  }
  // Extract just the "math characters" (letters, digits, operators) sorted for unordered comparison
  function mathSorted(s) {
    return s.replace(/[(){}\[\]\s]/g,'').split('').sort().join('');
  }

  function matchCards(cards, ansClean) {
    var best=null; var bestScore=-1;
    var ansNums = ansClean.replace(/[^0-9.\-\/]/g,'');
    var ansNorm = mathNorm(ansClean);
    var ansSorted = mathSorted(ansClean);
    cards.forEach(function(card) {
      var t = getOptionText(card);
      var tNums = t.replace(/[^0-9.\-\/]/g,'');
      var tNorm = mathNorm(t);
      var tSorted = mathSorted(t);
      var score = 0;
      // Exact match
      if (t===ansClean) score=100;
      // Match ignoring parens/braces
      else if (tNorm.length>0 && tNorm===ansNorm) score=90;
      // Substring match
      else if (t.length>0 && (ansClean.indexOf(t)!==-1||t.indexOf(ansClean)!==-1)) score=50;
      // Substring match ignoring parens
      else if (tNorm.length>1 && (ansNorm.indexOf(tNorm)!==-1||tNorm.indexOf(ansNorm)!==-1)) score=45;
      // Same characters in any order (catches equivalent math rearrangements)
      else if (tSorted.length>1 && tSorted===ansSorted) score=35;
      // Numeric-only match
      else if (ansNums.length>0 && tNums.length>0 && ansNums===tNums) score=30;
      if (score>bestScore) { bestScore=score; best=card; }
    });
    return bestScore>0 ? best : null;
  }

  function getNumericInputs() {
    var containers = document.querySelectorAll('[class*=_TextFieldNumeric_]');
    var inputs = [];
    var seen = new Set();
    containers.forEach(function(c) {
      var inp = c.tagName === 'INPUT' ? c : c.querySelector('input');
      if (inp && !seen.has(inp)) { inputs.push(inp); seen.add(inp); }
    });
    // Look for fraction inputs (numerator/denominator boxes)
    document.querySelectorAll('[class*=_Fraction] input, [class*=_FractionInput] input, [class*=_Numerator] input, [class*=_Denominator] input').forEach(function(inp) {
      if (!inp.closest('#sparx-solver-box') && !seen.has(inp)) { inputs.push(inp); seen.add(inp); }
    });
    // Fallback: try broader selector if nothing found
    if (!inputs.length) {
      document.querySelectorAll('[class*=_TextField_]').forEach(function(c) {
        var inp = c.tagName === 'INPUT' ? c : c.querySelector('input');
        if (inp && !seen.has(inp)) { inputs.push(inp); seen.add(inp); }
      });
    }
    // Broadest fallback: any input in the answer area
    if (!inputs.length) {
      document.querySelectorAll('[class*=_AnswerContent] input, [class*=_Answer_] input').forEach(function(inp) {
        if (!inp.closest('#sparx-solver-box') && inp.type !== 'hidden' && !seen.has(inp)) { inputs.push(inp); seen.add(inp); }
      });
    }
    // Also find select dropdowns in the answer area (e.g. exponent picker for standard form)
    document.querySelectorAll('[class*=_AnswerContent] select, [class*=_Answer_] select, [class*=_QuestionWrapper] select').forEach(function(sel) {
      if (!sel.closest('#sparx-solver-box') && !seen.has(sel)) { inputs.push(sel); seen.add(sel); }
    });
    return inputs;
  }

  function fillInput(el, value, callback) {
    if (el.tagName === 'SELECT') {
      // For select dropdowns: find matching option and set it
      var opts = el.options;
      var val = value.toString().trim();
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === val || opts[i].textContent.trim() === val) {
          el.selectedIndex = i;
          var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          nativeSetter.call(el, opts[i].value);
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          break;
        }
      }
      if (callback) setTimeout(callback, 100);
    } else {
      typeIntoInput(el, value, callback);
    }
  }

  // Tokenize an equation answer into individual symbols for slot filling
  // "m=q×r" → ["m","=","q","×","r"], "m=qr" → ["m","=","q","r"]
  function tokenizeAnswer(ans) {
    var tokens = [];
    var current = '';
    var ops = '=+-×÷*/()^';
    for (var i = 0; i < ans.length; i++) {
      var ch = ans[i];
      if (ch === ' ') {
        if (current) { tokens.push(current); current = ''; }
        continue;
      }
      if (ops.indexOf(ch) !== -1) {
        if (current) { tokens.push(current); current = ''; }
        tokens.push(ch);
      } else if ('0123456789.'.indexOf(ch) !== -1) {
        // Group consecutive digits
        if (current && '0123456789.'.indexOf(current[0]) === -1) {
          tokens.push(current); current = '';
        }
        current += ch;
      } else {
        // Letters: each letter is its own token (variables are single-char)
        if (current) { tokens.push(current); current = ''; }
        tokens.push(ch);
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  // Activate a slot with focus + pointer + mouse events (React needs pointer events)
  function sparxActivateSlot(el) {
    el.focus();
    ['pointerdown','pointerup'].forEach(function(ev) {
      el.dispatchEvent(new PointerEvent(ev, { bubbles: true, cancelable: true, view: window, pointerId: 1 }));
    });
    ['mousedown','mouseup','click'].forEach(function(ev) {
      el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }));
    });
  }

  // Tell whether a slot is "empty" (no card placed yet). Sparx has two slot
  // patterns:
  //   Old style: slot has a child marked `_CardContentEmpty` (placeholder).
  //   New style: slot is a literal empty div `<div class="_Slot_…"></div>`
  //              with no children, e.g. the "drag letters into positions"
  //              question type. We detect that by an empty children list and
  //              no text content.
  function isSlotEmpty(slot) {
    if (!slot) return false;
    if (slot.querySelector('[class*=_CardContentEmpty]')) return true;
    if (slot.children.length === 0 && !slot.textContent.trim()) return true;
    return false;
  }

  // Tell whether a slot is the new-style one (truly empty div, no placeholder
  // child). Sparx's new question type wants you to click the card FIRST and
  // then the destination slot — opposite to the old slot-first / card-second
  // pattern. We check this so fillSlotsSequentially picks the right order.
  function isNewStyleEmptySlot(slot) {
    return !!slot && !slot.querySelector('[class*=_CardContentEmpty]') &&
      slot.children.length === 0 && !slot.textContent.trim();
  }

  // Find tile cards — searches BottomBar, answer area, and traverses DOM near slots
  function findTileCards(slots, slotIdx) {
    // Only exclude cards inside the actual answer slots we're trying to fill
    var slotEls = slots && slots.length ? slots : Array.from(document.querySelectorAll('[class*=_InlineSlot],[class*=_CardSlot],[class*=_Slot_]'));

    function isSlotElement(el) {
      if (el.closest('#sparx-solver-box')) return true;
      for (var s = 0; s < slotEls.length; s++) {
        if (el === slotEls[s] || slotEls[s].contains(el)) return true;
      }
      return false;
    }

    // Strategy 1: CardContentClickable / CardContent (exclude slots)
    var cards = Array.from(document.querySelectorAll('[class*=_CardContentClickable],[class*=_CardContent_]')).filter(function(el) {
      return !isSlotElement(el);
    });
    if (cards.length) return { cards: cards, strategy: 'CardContent' };

    // Strategy 2: Search inside BottomBar (Sparx shows tiles at bottom)
    var bottomBar = document.querySelector('[class*=_BottomBar]');
    if (bottomBar && !bottomBar.closest('#sparx-solver-box')) {
      // Find all small elements with short text inside BottomBar (exclude nav buttons)
      cards = Array.from(bottomBar.querySelectorAll('*')).filter(function(el) {
        if (el.closest('#sparx-solver-box')) return false;
        // Exclude navigation buttons (Back, Answer, Submit, etc.)
        if (el.tagName === 'BUTTON') return false;
        if (el.closest('button')) return false;
        var elCls = typeof el.className === 'string' ? el.className : '';
        if (elCls.indexOf('Button') !== -1) return false;
        var t = el.textContent.trim();
        if (!t || t.length > 10) return false;
        if (el.children.length > 3) return false;
        var r = el.getBoundingClientRect();
        return r.width > 10 && r.height > 10 && r.width < 150 && r.height < 150;
      });
      if (cards.length) return { cards: cards, strategy: 'BottomBar' };
    }

    // Strategy 3: Walk UP from slot to find sibling containers with tiles
    var walkEl = slots[slotIdx];
    for (var up = 0; up < 6 && walkEl && walkEl.parentElement; up++) {
      walkEl = walkEl.parentElement;
      if (walkEl === document.body) break;
      for (var ci = 0; ci < walkEl.children.length; ci++) {
        var sibling = walkEl.children[ci];
        if (sibling.querySelector('[class*=_InlineSlot],[class*=_CardSlot]')) continue;
        if (sibling.closest('#sparx-solver-box')) continue;
        var found = Array.from(sibling.querySelectorAll('*')).filter(function(el) {
          if (el.closest('#sparx-solver-box')) return false;
          var t = el.textContent.trim();
          if (!t || t.length > 10) return false;
          if (el.children.length > 3) return false;
          // Exclude navigation buttons (Back, Answer, Submit, etc.)
          var elCls = typeof el.className === 'string' ? el.className : '';
          if (elCls.indexOf('Button') !== -1) return false;
          if (el.tagName === 'BUTTON') return false;
          if (el.closest('button')) return false;
          if (el.closest('[class*=_BottomBar]')) return false;
          var r = el.getBoundingClientRect();
          return r.width > 10 && r.height > 10 && r.width < 150 && r.height < 150;
        });
        if (found.length >= 5) {
          return { cards: found, strategy: 'sibling-L' + up + '-C' + ci };
        }
      }
    }

    // Strategy 4: Broader CSS selectors
    var broader = [
      '[class*=_KeypadButton]', '[class*=_PickerItem]', '[class*=_DraggableItem]',
      '[class*=_SelectableCard]', '[class*=_Symbol_]', '[class*=_Token_]',
      '[class*=_Available]', '[class*=_Clickable_]'
    ];
    for (var b = 0; b < broader.length; b++) {
      cards = Array.from(document.querySelectorAll(broader[b])).filter(function(el) {
        return !isSlotElement(el);
      });
      if (cards.length) return { cards: cards, strategy: 'broader-' + broader[b] };
    }

    return null;
  }

  // Flag to prevent our synthetic keyboard events from triggering the solver keybind
  var isSyntheticKey = false;

  // Dispatch keyboard events for a single key to the active element only
  function dispatchKey(key, token) {
    // Build proper code for the key
    var code = 'Key' + key.toUpperCase();
    if ('0123456789'.indexOf(key) !== -1) code = 'Digit' + key;
    else if (key === '+') code = 'Equal';
    else if (key === '-') code = 'Minus';
    else if (key === '=') code = 'Equal';
    else if (key === '/') code = 'Slash';
    else if (key === '*') code = 'Digit8';
    else if (key === '(') code = 'Digit9';
    else if (key === ')') code = 'Digit0';
    else if (key === '.') code = 'Period';
    else if (key === '^') code = 'Digit6';

    var kc = key.charCodeAt(0);
    var opts = { key: key, code: code, keyCode: kc, which: kc, bubbles: true, cancelable: true, composed: true };

    isSyntheticKey = true;

    // Dispatch ONLY to the active element (events bubble up to document naturally)
    var target = document.activeElement && document.activeElement !== document.body
      ? document.activeElement : document.body;

    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keypress', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));

    // Also try InputEvent
    try {
      target.dispatchEvent(new InputEvent('beforeinput', {
        data: token, inputType: 'insertText',
        bubbles: true, cancelable: true, composed: true
      }));
      target.dispatchEvent(new InputEvent('input', {
        data: token, inputType: 'insertText',
        bubbles: true, cancelable: true, composed: true
      }));
    } catch(e) {}

    isSyntheticKey = false;
  }

  // Type a token character into an active slot via keyboard events
  function typeTokenIntoSlot(slot, token, callback) {
    // Map special tokens to keyboard keys
    var key = token;
    if (token === '×') key = '*';
    if (token === '÷') key = '/';
    if (token === '−') key = '-';

    // Record state before typing
    var allSlots = Array.from(document.querySelectorAll('[class*=_InlineSlot],[class*=_CardSlot]')).filter(function(el) {
      return !el.closest('#sparx-solver-box');
    });
    var beforeTexts = allSlots.map(function(s) { return s.textContent.trim(); });

    // Dispatch keyboard events
    dispatchKey(key, token);

    // Check after delay if ANY slot content changed
    setTimeout(function() {
      var afterTexts = allSlots.map(function(s) { return s.textContent.trim(); });
      var anyChanged = false;
      for (var i = 0; i < allSlots.length; i++) {
        if (afterTexts[i] !== beforeTexts[i] && afterTexts[i] !== '-') {
          anyChanged = true;
          break;
        }
      }
      var noLongerEmpty = !isSlotEmpty(slot);
      callback(anyChanged || noLongerEmpty);
    }, 500);
  }

  // Type all tokens sequentially via keyboard, letting the app manage slot focus
  function typeAllTokens(slots, tokens, tokenIdx) {
    if (!autoFilling) return;
    if (tokenIdx >= tokens.length) {
      // All tokens typed — wait a moment then submit
      saveDiag({ result: 'ALL TOKENS TYPED', allTokens: tokens.join(','), totalTyped: tokens.length, slots: slots.length, strategy: 'keyboard-seq' });
      setTimeout(clickSubmit, 800);
      return;
    }

    var token = tokens[tokenIdx];
    typeTokenIntoSlot(slots[0], token, function(success) {
      if (tokenIdx === 0 && !success) {
        // First token failed — keyboard input doesn't work for this question type
        // Stop immediately to avoid dispatching many useless events
        saveDiag({
          result: 'KEYBOARD NOT SUPPORTED',
          token: token,
          allTokens: tokens.join(','),
          slots: slots.length,
          activeElement: document.activeElement ? document.activeElement.className.substring(0, 80) : 'none',
          activeSlotHTML: slots[0] ? slots[0].outerHTML.substring(0, 400) : 'none'
        });
        stopAutoFill();
        return;
      }

      saveDiag({
        result: success ? 'KEY TYPED' : 'KEY TYPED (unconfirmed)',
        tokenIdx: tokenIdx,
        token: token,
        tokensLeft: tokens.length - tokenIdx - 1,
        allTokens: tokens.join(','),
        strategy: 'keyboard-seq',
        activeElement: document.activeElement ? document.activeElement.className.substring(0, 80) : 'none'
      });
      setTimeout(function() {
        typeAllTokens(slots, tokens, tokenIdx + 1);
      }, 200);
    });
  }

  // Fill empty slots with complete values (pipe-separated from AI)
  // Each value is a full expression like "y" or "2q" that goes into one slot
  function fillSlotsWithValues(emptySlots, values, idx) {
    if (!autoFilling) return;
    if (idx >= values.length || idx >= emptySlots.length) {
      setTimeout(clickSubmit, 600);
      return;
    }

    // Click the slot to activate it (sparxClick includes coordinates for React)
    sparxClick(emptySlots[idx]);
    emptySlots[idx].focus();

    setTimeout(function() {
      if (!autoFilling) return;

      var value = values[idx];
      // Search for a tile card matching this value
      var result = findTileCards(emptySlots, idx);
      var optTiles = findOptionTiles();
      var allChoices = (result ? result.cards : []).concat(optTiles);

      // Try to match the value against available tiles/options
      var matched = null;
      var choiceTexts = [];
      allChoices.forEach(function(card) {
        var t = getOptionText(card);
        choiceTexts.push(t);
        if (t === value) matched = card;
        else if (value.indexOf(t) !== -1 || t.indexOf(value) !== -1) {
          if (!matched) matched = card;
        }
      });

      if (matched) {
        sparxClick(matched);
        saveDiag({ result: 'SLOT VALUE FILL', slotIdx: idx, value: value, matched: getOptionText(matched), valuesLeft: values.length - idx - 1, choiceTexts: choiceTexts });
        setTimeout(function() {
          fillSlotsWithValues(emptySlots, values, idx + 1);
        }, 500);
      } else {
        // No tile match — try keyboard typing for this value
        var tokens = tokenizeAnswer(value);
        saveDiag({ result: 'SLOT VALUE → TYPING', slotIdx: idx, value: value, tokens: tokens, choiceTexts: choiceTexts });
        typeAllTokens(emptySlots, tokens, 0);
      }
    }, 1500);
  }

  // Fill equation builder slots one at a time
  function fillSlotsSequentially(origSlots, tokens, slotIdx, tokenIdx) {
    if (!autoFilling) return;
    if (tokenIdx >= tokens.length) {
      setTimeout(clickSubmit, 600);
      return;
    }

    // Re-query empty slots in case DOM changed after previous card placement.
    // isSlotEmpty handles both old-style (_CardContentEmpty marker) and the
    // new-style "empty div" question type.
    var freshSlots = Array.from(document.querySelectorAll('[class*=_InlineSlot],[class*=_CardSlot],[class*=_Slot_]')).filter(function(s) {
      if (s.closest('#sparx-solver-box')) return false;
      return isSlotEmpty(s);
    });

    // Use fresh empty slot if available, otherwise fall back to original reference
    var targetSlot = freshSlots[0] || origSlots[slotIdx];
    if (!targetSlot || slotIdx >= origSlots.length) {
      setTimeout(clickSubmit, 600);
      return;
    }

    // Click order depends on slot style:
    //   Old style (_CardContentEmpty marker): click the slot first to activate
    //     it, then click the card to fill it.
    //   New style (empty <div>): click the card first to select it, then click
    //     the destination slot — opposite order. Otherwise nothing happens.
    var newStyle = isNewStyleEmptySlot(targetSlot);

    if (!newStyle) {
      sparxClick(targetSlot);
      targetSlot.focus();
    }

    setTimeout(function() {
      if (!autoFilling) return;

      // Use all current empty slots for the isSlotElement filter
      var allSlotEls = Array.from(document.querySelectorAll('[class*=_InlineSlot],[class*=_CardSlot],[class*=_Slot_]'));
      var result = findTileCards(allSlotEls, 0);
      var token = tokens[tokenIdx];

      if (result && result.cards.length) {
        // Found tile cards — try to match and click
        var cards = result.cards;
        var matched = null;
        var cardTextsDebug = [];

        cards.forEach(function(card) {
          var t = getOptionText(card);
          cardTextsDebug.push(t);
          if (matched) return; // already found
          if (t === token) matched = card;
          else if (mathNorm(t) === mathNorm(token)) matched = card;
          else if (token === '/' && (t === '÷' || t === 'divide')) matched = card;
          else if (token === '÷' && (t === '/' || t === 'divide')) matched = card;
          else if (token === '*' && (t === '×' || t === 'multiply')) matched = card;
          else if (token === '×' && (t === '*' || t === 'multiply')) matched = card;
          // Fuzzy: strip spaces/parens and compare
          else if (t.length > 1 && token.length > 1 && t.replace(/\s/g,'') === token.replace(/\s/g,'')) matched = card;
          // Sorted character comparison for reordered math expressions
          else if (t.length > 1 && token.length > 1 && mathSorted(t) === mathSorted(token)) matched = card;
        });

        if (matched) {
          sparxClick(matched);
          // New-style: now click the destination slot to drop the selected card.
          if (newStyle) {
            setTimeout(function() {
              if (!autoFilling) return;
              sparxClick(targetSlot);
            }, 200);
          }
          saveDiag({ result: 'SLOT FILL', slotIdx: slotIdx, token: token, matched: getOptionText(matched), tokensLeft: tokens.length - tokenIdx - 1, allTokens: tokens.join(','), cardTexts: cardTextsDebug, strategy: result.strategy + (newStyle ? '-newStyle' : '') });
          setTimeout(function() {
            fillSlotsSequentially(origSlots, tokens, slotIdx + 1, tokenIdx + 1);
          }, newStyle ? 700 : 500);
        } else {
          // No matching tile card — fall back to keyboard typing for ALL remaining tokens
          saveDiag({ result: 'NO TILE MATCH → KEYBOARD', slotIdx: slotIdx, token: token, cardTexts: cardTextsDebug, allTokens: tokens.join(','), cards: cards.length, strategy: result.strategy });
          typeAllTokens(origSlots, tokens, tokenIdx);
        }
      } else {
        // No tile cards found at all — use keyboard typing for ALL remaining tokens
        saveDiag({ result: 'NO TILES → KEYBOARD', slotIdx: slotIdx, token: token, allTokens: tokens.join(','), strategy: 'no-tiles' });
        typeAllTokens(origSlots, tokens, tokenIdx);
      }
    }, newStyle ? 200 : 1500);
  }

  // Extract info about all media inside the question area
  function extractMediaInfo() {
    var exact = findQuestionWrapper();
    if (!exact) return null;
    var info = {};

    // SVGs (filter out tiny icons < 50px)
    var svgs = Array.from(exact.querySelectorAll('svg')).filter(function(s) {
      var w = s.clientWidth || parseInt(s.getAttribute('width')) || 0;
      var h = s.clientHeight || parseInt(s.getAttribute('height')) || 0;
      return w > 50 && h > 50;
    });
    if (svgs.length) {
      info.svgs = [];
      svgs.forEach(function(svg, si) {
        var svgData = { index: si, width: svg.clientWidth || svg.getAttribute('width'), height: svg.clientHeight || svg.getAttribute('height') };
        var texts = [];
        svg.querySelectorAll('text, tspan').forEach(function(t) {
          var txt = t.textContent.trim();
          if (txt && texts.indexOf(txt) === -1) texts.push(txt);
        });
        svgData.texts = texts;
        svgData.lines = svg.querySelectorAll('line').length;
        svgData.paths = svg.querySelectorAll('path').length;
        svgData.circles = svg.querySelectorAll('circle').length;
        svgData.rects = svg.querySelectorAll('rect').length;
        var points = [];
        svg.querySelectorAll('circle').forEach(function(c) {
          var cx = c.getAttribute('cx'), cy = c.getAttribute('cy');
          if (cx && cy) points.push('(' + cx + ',' + cy + ')');
        });
        if (points.length && points.length <= 20) svgData.points = points;
        svgData.viewBox = svg.getAttribute('viewBox') || '';
        info.svgs.push(svgData);
      });
    }

    // Canvas elements
    var canvases = exact.querySelectorAll('canvas');
    if (canvases.length) {
      info.canvases = [];
      canvases.forEach(function(c, i) {
        info.canvases.push({ index: i, width: c.width, height: c.height, className: (c.className || '').substring(0, 60) });
      });
    }

    // Images (filter out tiny icons)
    var imgs = Array.from(exact.querySelectorAll('img')).filter(function(img) {
      if (img.closest('#sparx-solver-box')) return false;
      var w = img.naturalWidth || img.width || img.offsetWidth || 0;
      var h = img.naturalHeight || img.height || img.offsetHeight || 0;
      return w > 50 && h > 50;
    });
    if (imgs.length) {
      info.images = [];
      imgs.forEach(function(img, i) {
        var src = img.src || '';
        // Truncate data URIs, show file URLs
        if (src.indexOf('data:') === 0) src = src.substring(0, 30) + '...';
        else if (src.length > 80) src = src.substring(0, 80) + '...';
        info.images.push({
          index: i,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          src: src,
          className: (img.className || '').substring(0, 60),
          alt: (img.alt || '').substring(0, 60)
        });
      });
    }

    return (info.svgs || info.canvases || info.images) ? info : null;
  }

  function saveDiag(obj) {
    obj.time = new Date().toLocaleTimeString();
    obj.isCardQuestion = isCardQuestion;
    obj.inputBoxCount = inputBoxCount;
    obj.question = currentQuestion.substring(0,120);
    // Attach media info if present
    var mediaInfo = extractMediaInfo();
    if (mediaInfo) obj.mediaInfo = mediaInfo;
    chrome.storage.local.set({ sparxDiagnostic: obj });
  }

  // Broadly search for clickable option tiles (the expression cards shown in card-selection questions)
  // These may not have _CardContentClickable but ARE visible tiles with math content
  function findOptionTiles() {
    var seen = new Set();
    var tiles = [];

    // Helper: is this element an empty slot or inside one?
    function isEmptySlotArea(el) {
      var slot = el.closest('[class*=_InlineSlot],[class*=_CardSlot],[class*=_Slot_]');
      if (slot && isSlotEmpty(slot)) return true;
      if (typeof el.className === 'string' && el.className.indexOf('Empty') !== -1) return true;
      return false;
    }

    // Strategy A: _CardContent_ elements that aren't empty and aren't inside empty slots
    Array.from(document.querySelectorAll('[class*=_CardContent]')).forEach(function(el) {
      if (el.closest('#sparx-solver-box')) return;
      if (isEmptySlotArea(el)) return;
      if (el.textContent.trim().length < 1) return;
      if (!seen.has(el)) { seen.add(el); tiles.push(el); }
    });

    // Strategy B: _Tile_ elements that aren't empty slots
    Array.from(document.querySelectorAll('[class*=_Tile]')).forEach(function(el) {
      if (el.closest('#sparx-solver-box')) return;
      if (isEmptySlotArea(el)) return;
      if (el.querySelector('[class*=_CardContentEmpty]')) return;
      if (el.textContent.trim().length < 1) return;
      if (!seen.has(el)) { seen.add(el); tiles.push(el); }
    });

    // Strategy C: KaTeX math NOT inside a slot element (option tiles ARE inside QuestionWrapper)
    Array.from(document.querySelectorAll('.katex')).forEach(function(katex) {
      if (katex.closest('#sparx-solver-box')) return;
      // Skip KaTeX inside a slot element (that's the equation display, not an option)
      if (katex.closest('[class*=_InlineSlot],[class*=_CardSlot]')) return;
      // Walk up to find a tile-sized clickable parent
      var el = katex;
      for (var up = 0; up < 6 && el.parentElement; up++) {
        el = el.parentElement;
        if (el.closest('#sparx-solver-box')) break;
        if (el.tagName === 'BODY') break;
        // Skip if this IS a slot
        var elCls = typeof el.className === 'string' ? el.className : '';
        if (elCls.indexOf('InlineSlot') !== -1 || elCls.indexOf('CardSlot') !== -1) break;
        var r = el.getBoundingClientRect();
        if (r.width > 50 && r.width < 500 && r.height > 30 && r.height < 250) {
          if (!seen.has(el)) { seen.add(el); tiles.push(el); }
          break;
        }
      }
    });

    // Strategy D: Elements with tabindex/data-ref that look like clickable tiles
    Array.from(document.querySelectorAll('[tabindex][class*=_Tile],[tabindex][class*=_Card],[data-ref]:not([class*=_CardContentEmpty])'))
    .forEach(function(el) {
      if (el.closest('#sparx-solver-box')) return;
      if (isEmptySlotArea(el)) return;
      if (el.querySelector('[class*=_CardContentEmpty]')) return;
      if (el.textContent.trim().length < 1) return;
      var r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 25 || r.width > 500 || r.height > 250) return;
      if (!seen.has(el)) { seen.add(el); tiles.push(el); }
    });

    // Deduplicate: prefer outermost (remove children when parent is already in list)
    var deduped = tiles.filter(function(t) {
      for (var i = 0; i < tiles.length; i++) {
        if (tiles[i] !== t && tiles[i].contains(t)) return false;
      }
      return true;
    });

    return deduped;
  }

  // Fill any numeric inputs with remaining part answers (for multi-part questions)
  function fillRemainingInputs(callback) {
    var numInputs = getNumericInputs();
    if (!numInputs.length) { callback(); return; }

    // Try multiple strategies to find values for remaining inputs
    var values = [];

    // Strategy 1: pipe-separated answer parts (e.g. "Enlargement | 8")
    var short = currentAnswer || '';
    if (short.indexOf('|') !== -1) {
      var pipeParts = short.split('|').map(function(p) { return p.trim(); }).filter(function(p) { return p; });
      // Skip non-numeric parts (card labels like "Enlargement"), keep numeric ones
      pipeParts.forEach(function(p) {
        if (/\d/.test(p)) values.push(p);
      });
    }

    // Strategy 2: extract numbers from the short answer
    if (!values.length) {
      var nums = stripLatex(short).match(/-?\d+(\.\d+)?/g);
      if (nums) values = nums;
    }

    // Strategy 3: scan full AI response for last short numeric line
    if (!values.length && currentFullAnswer) {
      var lines = currentFullAnswer.trim().split('\n').filter(function(l){return l.trim();});
      for (var i=lines.length-1; i>=0; i--) {
        var l = stripLatex(lines[i].trim());
        if (l.match(/^[a-z]\)/)) continue;
        var numMatch = l.match(/-?\d+(\.\d+)?/);
        if (numMatch) { values.push(numMatch[0]); break; }
      }
    }

    if (!values.length) { callback(); return; }

    var idx = 0;
    function fillNext() {
      if (idx >= numInputs.length || idx >= values.length) { callback(); return; }
      var val = values[idx].replace(/[^0-9.\-\/]/g,'');
      if (!val) { idx++; fillNext(); return; }
      fillInput(numInputs[idx], val, function() { idx++; fillNext(); });
    }
    fillNext();
  }

  function tryFill() {
    if (!autoFilling) return;

    // Don't submit if answer is empty or looks like an API error
    if (!currentAnswer || currentAnswer.length < 1 || currentAnswer.indexOf('"type":"error"') !== -1) {
      lastErrorTime=Date.now();
      saveDiag({ result: 'NO ANSWER', ansClean: currentAnswer || '(empty)' });
      stopAutoFill();
      var at = document.getElementById('sparx-answer-text');
      if (at) at.textContent = errorText + ': No valid answer received';
      return;
    }

    var ansClean = stripLatex(currentAnswer).normalize('NFKC').toLowerCase().replace(/\s+/g,'');

    // ── CARD CHOICES: match AI answer against card options ──
    if (cardChoices.length > 0) {
      var choiceTexts = cardChoices.map(function(c) { return c.readable; });
      var liveCards = Array.from(document.querySelectorAll('[class*=_CardContentClickable]')).filter(function(el) {
        return !el.closest('#sparx-solver-box');
      });

      // Strategy 1: pure number → choice index
      var trimmed = currentAnswer.trim();
      if (/^\d+$/.test(trimmed)) {
        var choiceIdx = parseInt(trimmed, 10) - 1;
        if (choiceIdx >= 0 && choiceIdx < cardChoices.length) {
          var target = liveCards[choiceIdx] || cardChoices[choiceIdx].el;
          saveDiag({ result: 'CARD PICK', ansRaw: trimmed, picked: choiceIdx + 1, pickedText: cardChoices[choiceIdx].readable, choices: choiceTexts });
          sparxClick(target);
          setTimeout(function() { fillRemainingInputs(function() { setTimeout(clickSubmit, 300); }); }, 300);
          return;
        }
      }

      // Strategy 2: fuzzy match short answer against card texts
      var best = matchCards(liveCards, ansClean);

      // Strategy 3: fuzzy match using FULL AI response (catches correct answer in working)
      if (!best && currentFullAnswer) {
        var fullClean = stripLatex(currentFullAnswer).normalize('NFKC').toLowerCase().replace(/\s+/g,'');
        // Score each card by how well it matches anywhere in the full response
        var bestScore = -1;
        cardChoices.forEach(function(c, i) {
          var ct = c.text;
          var cr = c.readable.toLowerCase().replace(/\s+/g,'');
          if (ct.length > 1 && fullClean.indexOf(ct) !== -1) {
            // Count occurrences — the correct answer is usually mentioned more
            var count = fullClean.split(ct).length - 1;
            var score = count * 10 + ct.length;
            if (score > bestScore) { bestScore = score; best = liveCards[i] || c.el; }
          } else if (cr.length > 2 && fullClean.indexOf(cr) !== -1) {
            var count2 = fullClean.split(cr).length - 1;
            var score2 = count2 * 8 + cr.length;
            if (score2 > bestScore) { bestScore = score2; best = liveCards[i] || c.el; }
          }
        });
      }

      if (best) {
        saveDiag({ result: 'CARD MATCH', ansClean: ansClean, matched: getOptionText(best), choices: choiceTexts });
        sparxClick(best);
        setTimeout(function() { fillRemainingInputs(function() { setTimeout(clickSubmit, 300); }); }, 300);
        return;
      }

      // Card matching failed — but there may be number inputs or slots to fill too
      // Don't stop, fall through to try other filling methods
      saveDiag({ result: 'CARD NO MATCH → FALLTHROUGH', ansRaw: currentAnswer.substring(0, 80), ansClean: ansClean, choices: choiceTexts });
    }

    // ── Non-card questions: gather elements ──
    var cards = Array.from(document.querySelectorAll('[class*=_CardContentClickable]')).filter(function(el) {
      return !el.closest('#sparx-solver-box');
    });
    var slots = Array.from(document.querySelectorAll('[class*=_InlineSlot],[class*=_CardSlot],[class*=_Slot_]')).filter(function(el) {
      if (el.closest('#sparx-solver-box')) return false;
      var cls = typeof el.className === 'string' ? el.className : '';
      if (cls.indexOf('Wrapper') !== -1 || cls.indexOf('Outline') !== -1 || cls.indexOf('Focus') !== -1) return false;
      return true;
    });
    var options = Array.from(document.querySelectorAll('[class*=_Option_]')).filter(function(el) {
      return !el.closest('#sparx-solver-box');
    });
    var numInputs = getNumericInputs();
    var imageOptions = Array.from(document.querySelectorAll('[class*=_Option_]')).filter(function(o) { return o.querySelector('img'); });

    var cardTexts = []; cards.forEach(function(c){ cardTexts.push(getOptionText(c)); });
    var optTexts = []; options.forEach(function(o){ optTexts.push(getOptionText(o)); });
    var slotTexts = []; slots.forEach(function(s){ slotTexts.push(s.innerText.trim().normalize('NFKC').substring(0,30)); });

    // Base diagnostic data shared by all branches
    var baseDiag = {
      ansRaw: currentAnswer.substring(0, 80),
      ansClean: ansClean,
      cards: cards.length, cardTexts: cardTexts,
      slots: slots.length, slotTexts: slotTexts,
      options: options.length, optTexts: optTexts,
      numInputs: numInputs.length,
      imageOpts: imageOptions.length
    };

    // 1. Check for clickable cards (shouldn't reach here if cardChoices worked, but fallback)
    if (cards.length) {
      var best = matchCards(cards, ansClean);
      if (best) {
        baseDiag.result = 'CARD MATCH'; baseDiag.matched = getOptionText(best);
        saveDiag(baseDiag);
        sparxClick(best); setTimeout(function() { fillRemainingInputs(function() { setTimeout(clickSubmit, 300); }); }, 300); return;
      }
    }

    // 2. Slots — equation builder or single-slot card pick
    if (slots.length) {
      var emptySlots = slots.filter(isSlotEmpty);
      var nonEmptySlots = slots.filter(function(s) { return !isSlotEmpty(s); });

      baseDiag.emptySlots = emptySlots.length;
      baseDiag.nonEmptySlots = nonEmptySlots.length;

      if (slots.length > 1 && emptySlots.length > 1) {
        // If answer has pipe separator (e.g. "11 | 3n"), split by pipe for slot values
        var rawAns = stripLatex(currentAnswer).trim();
        var tokens;
        if (rawAns.indexOf('|') !== -1) {
          tokens = rawAns.split('|').map(function(p) { return p.trim().toLowerCase().replace(/\s+/g,''); }).filter(function(p) { return p; });
        } else {
          tokens = tokenizeAnswer(ansClean);
        }
        baseDiag.result = 'MULTI-SLOT'; baseDiag.tokens = tokens; baseDiag.branch = tokens.length + ' tokens → ' + emptySlots.length + ' empty slots';
        saveDiag(baseDiag);
        fillSlotsSequentially(emptySlots, tokens, 0, 0);
        return;
      }

      // Single empty slot — click it, then try to match from revealed cards
      if (emptySlots.length >= 1) {
        baseDiag.result = 'SLOT CLICK';
        saveDiag(baseDiag);
        sparxClick(emptySlots[0]);
        setTimeout(function() {
          if (!autoFilling) return;
          var newCards = Array.from(document.querySelectorAll('[class*=_CardContentClickable]')).filter(function(el) {
            if (el.closest('#sparx-solver-box')) return false;
            // Exclude cards already placed inside slots
            for (var si = 0; si < slots.length; si++) {
              if (slots[si].contains(el)) return false;
            }
            return true;
          });
          // Try text matching first
          var best2 = matchCards(newCards, ansClean);
          if (best2) {
            saveDiag({ result: 'SLOT→CARD MATCH', ansClean: ansClean, matched: getOptionText(best2), choices: newCards.length });
            sparxClick(best2); setTimeout(function() { fillRemainingInputs(function() { setTimeout(clickSubmit, 300); }); }, 300);
            return;
          }
          // No text match — ask AI to pick from the revealed options
          if (newCards.length >= 2) {
            var revealedChoices = newCards.map(function(c, i) {
              return { el: c, readable: getOptionTextReadable(c), index: i };
            });
            var optList = revealedChoices.map(function(c, i) { return (i + 1) + ') ' + c.readable; }).join('\n');
            var pickPrompt = 'Question: ' + currentQuestion + '\n\nWhich of these options is the correct answer?\n' + optList + '\n\nReply with ONLY the number. Nothing else.';
            var ct = revealedChoices.map(function(c) { return c.readable; });
            saveDiag({ result: 'SLOT→AI PICK', ansClean: ansClean, choices: ct });
            chrome.storage.local.get(['sparxApiKey','sparxModel'], function(data) {
              if (!data.sparxApiKey || !autoFilling) { stopAutoFill(); return; }
              var model = data.sparxModel || 'groq';
              callAIPick(data.sparxApiKey, model, pickPrompt, function(resp) {
                if (!autoFilling) return;
                var numMatch = resp.match(/(\d+)/);
                var idx = numMatch ? parseInt(numMatch[1], 10) - 1 : -1;
                if (idx >= 0 && idx < newCards.length) {
                  saveDiag({ result: 'SLOT→AI PICKED', picked: idx + 1, pickedText: revealedChoices[idx].readable, choices: ct });
                  sparxClick(newCards[idx]); setTimeout(function() { fillRemainingInputs(function() { setTimeout(clickSubmit, 300); }); }, 300);
                } else {
                  saveDiag({ result: 'SLOT→AI PICK FAIL', aiResp: resp.substring(0, 40), choices: ct });
                  stopAutoFill();
                }
              }, function() { stopAutoFill(); });
            });
          } else {
            var ct = newCards.slice(0, 12).map(function(c) { return getOptionText(c); });
            saveDiag({ result: 'SLOT→NO MATCH', ansClean: ansClean, choices: newCards.length, choiceTexts: ct });
            stopAutoFill();
          }
        }, 800);
        return;
      }
    }

    // 3. Text/image multiple choice options
    if (options.length) {
      var textOpts = options.filter(function(o) { return !o.querySelector('img'); });
      if (textOpts.length) {
        var best = matchCards(textOpts, ansClean);
        if (best) {
          baseDiag.result = 'OPTION MATCH'; baseDiag.matched = getOptionText(best);
          saveDiag(baseDiag);
          sparxClick(best); setTimeout(clickSubmit, 400); return;
        }
      }
    }

    // 4. Number inputs
    if (numInputs.length) {
      var parts = splitAnswerParts(currentAnswer);
      baseDiag.result = 'NUM INPUT'; baseDiag.parts = parts; baseDiag.branch = 'typing into ' + numInputs.length + ' input(s)';
      saveDiag(baseDiag);
      if (numInputs.length === 1 || parts.length <= 1) {
        var val;
        if (parts.length) {
          val = parts[parts.length - 1];
        } else {
          // Extract just the last number, not all digits concatenated
          var nums = stripLatex(currentAnswer).match(/-?\d+(\.\d+)?/g);
          val = nums ? nums[nums.length - 1] : '';
        }
        fillInput(numInputs[0], val, function() {
          setTimeout(clickSubmit, 400);
        });
      } else {
        var idx = 0;
        function fillNext() {
          if (!autoFilling || idx >= numInputs.length) { setTimeout(clickSubmit, 400); return; }
          var val = parts[idx] !== undefined ? parts[idx] : '';
          if (val) {
            var inp = numInputs[idx];
            sparxClick(inp);
            inp.focus();
            if (inp.hasAttribute('readonly')) inp.removeAttribute('readonly');
            setTimeout(function() {
              fillInput(inp, val, function() {
                idx++;
                setTimeout(fillNext, 400);
              });
            }, 300);
          } else {
            idx++;
            setTimeout(fillNext, 200);
          }
        }
        fillNext();
      }
      return;
    }

    // 5. Image multiple choice
    if (imageOptions.length) {
      baseDiag.result = 'IMAGE OPTS'; baseDiag.branch = 'asking AI to pick from ' + imageOptions.length + ' image options';
      saveDiag(baseDiag);
      chrome.storage.local.get(['sparxApiKey'], function(data) {
        if (!data.sparxApiKey) { stopAutoFill(); return; }
        html2canvas(document.body, {backgroundColor:'#ffffff',scale:1.5,useCORS:true,logging:false})
        .then(function(canvas) {
          if (!autoFilling) return;
          var b64 = canvas.toDataURL('image/png').split(',')[1];
          fetch('https://api.anthropic.com/v1/messages',{
            method:'POST',
            headers:{'Content-Type':'application/json','x-api-key':data.sparxApiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
            body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:64,messages:[{role:'user',content:[
              {type:'image',source:{type:'base64',media_type:'image/png',data:b64}},
              {type:'text',text:'This is a Sparx Maths multiple choice question. The correct answer is: '+currentAnswer+'\n\nThere are '+imageOptions.length+' options. Reply with ONLY a number 1-'+imageOptions.length+' indicating which option (left to right, top to bottom) matches the correct answer.'}
            ]}]})
          })
          .then(function(r){return r.json();})
          .then(function(d) {
            if (!autoFilling) return;
            var idx = parseInt((d.content&&d.content[0]&&d.content[0].text||'').trim()) - 1;
            if (!isNaN(idx) && idx>=0 && idx<imageOptions.length) {
              sparxClick(imageOptions[idx]);
              setTimeout(clickSubmit, 400);
            } else { stopAutoFill(); }
          })
          .catch(function(){ stopAutoFill(); });
        });
      });
      return;
    }

    // Nothing found at all
    baseDiag.result = 'NOTHING FOUND';
    saveDiag(baseDiag);
    stopAutoFill();
  }

  function clickSubmit() {
    if (!autoFilling) return;
    var submitBtn = Array.from(document.querySelectorAll('[class*=_ButtonPrimary_]')).find(function(b) {
      return b.innerText.trim() !== 'Answer';
    });
    if (submitBtn) sparxClick(submitBtn);

    // Wait for result, then click continue and move to next question
    setTimeout(function() {
      if (!autoFilling) return;
      var continueBtn = document.querySelector('[class*=_ButtonBlue_]');
      if (continueBtn) sparxClick(continueBtn);

      // Wait for next question to load, then run next cycle
      waitForNextQuestion(lastQuestionText, 0);
    }, 1500);
  }

  function waitForNextQuestion(oldText, attempts) {
    if (!autoFilling) return;
    if (attempts > 20) { stopAutoFill(); return; } // give up after ~10s
    if (isSummaryPage()) { stopAutoFill(); return; }

    // Check if a bookwork check appeared
    var chip = document.querySelector('[class*=_Bookwork_]');
    if (chip) {
      // Let the bookwork handler deal with it, then retry
      setTimeout(function() { waitForNextQuestion(oldText, attempts + 1); }, 500);
      return;
    }

    // If continue button is still visible, we're on the results/feedback page — not a new question
    var blueBtn = document.querySelector('[class*=_ButtonBlue_]');
    if (blueBtn) {
      sparxClick(blueBtn); // click continue again in case it didn't register
      setTimeout(function() { waitForNextQuestion(oldText, attempts + 1); }, 500);
      return;
    }

    // Check if question text has changed
    var exact = findQuestionWrapper();
    var newText = (exact && !exact.closest('#sparx-solver-box')) ? exact.innerText.trim().substring(0,200) : '';
    if (newText && newText !== oldText) {
      // New question loaded — start next cycle.
      // Stagger Gemini-free-tier models to stay under per-minute rate limits.
      chrome.storage.local.get(['sparxModel'], function(data) {
        var m = data.sparxModel || 'groq';
        var delay = m.indexOf('gemini') === 0 ? 2500 : 500;
        setTimeout(runAutoFillCycle, delay);
      });
    } else {
      // Still waiting — retry
      setTimeout(function() { waitForNextQuestion(oldText, attempts + 1); }, 500);
    }
  }

  // Quick hardcoded answers for known patterns (skip AI call)
  function quickAnswer() {
    var q = currentQuestion.toLowerCase();
    // "I ___ written" → have
    if (/\bi\b.*\b(written|done|been|gone|seen|taken|eaten|given|chosen|spoken|broken|forgotten|driven|risen)\b/.test(q) && /select|choose|pick|option|click/i.test(q)) {
      return 'have';
    }
    return null;
  }

  function buildPrompt(isImage, answerOnly) {
    var transcriptNote = currentTranscript ? '\n\nHere is a transcript from the video explanation for this topic (first 400 words):\n'+currentTranscript : '';
    var productName = getProductName();
    var product = getSparxProduct();
    var tutorName = getTutorName();
    var multiBoxNote = '';
    if (inputBoxCount > 1) {
      multiBoxNote = '\n\nIMPORTANT: This question has ' + inputBoxCount + ' separate input boxes. Write ONLY the ' + inputBoxCount + ' values separated by | (pipe). For standard form (e.g. 2 × 10^5), give coefficient | power (e.g. 2 | 5). For fractions, give numerator | denominator. For example if there are 3 boxes: 5 | 12 | 7';
      if (selectOptions.length) {
        selectOptions.forEach(function(opts, i) {
          multiBoxNote += '\nDropdown ' + (i + 1) + ' options: ' + opts.join(', ');
        });
        multiBoxNote += '\nYour answer for each dropdown MUST be one of its available options exactly.';
      }
    }

    if (answerOnly) {
      // Full reasoning like the solve button, but answer on the last line
      var workNote = 'Think through this step by step. Show your full working, then on the very LAST line write ONLY the final answer with no extra words or punctuation.';
      var partNote = 'If the question has multiple parts (a, b, c...), answer EACH part on its own line like:\na) answer\nb) answer';
      var ansInst;
      if (inputBoxCount > 1) {
        ansInst = workNote + ' Always fully simplify each answer. Write fractions as a/b (e.g. 3/5, NOT 3÷5). If the question asks for a fraction with separate numerator and denominator boxes, give them as numerator | denominator (e.g. 3 | 5 for three fifths). On the very last line write ONLY the ' + inputBoxCount + ' answers separated by | (pipe). No words on that line.';
      } else if (cardChoices.length > 0) {
        var optList = cardChoices.map(function(c, i) { return (i + 1) + ') ' + c.readable; }).join('\n');
        ansInst = 'This is a multiple choice question. The available options are:\n' + optList + '\n\n' + workNote + ' On the very last line reply with ONLY the number of the correct option (e.g. 1, 2, 3...).';
      } else if (slotCount > 1 && tileChoices.length > 0) {
        // Slot-fill question (e.g. coordinate pair, fraction, or value-into-slot).
        // The student picks `slotCount` tiles from a fixed list and drops them into the slots in order.
        // The AI MUST pick from the provided tile values — anything else can't be matched.
        var tileList = tileChoices.map(function(t) { return '"' + t.readable + '"'; }).join(', ');
        ansInst = workNote + ' This is a slot-fill question with ' + slotCount + ' empty slots in order. You must pick exactly ' + slotCount + ' value(s) from this fixed list of available tiles: ' + tileList + '. Use only the EXACT text shown — do not simplify, restate, or substitute equivalent forms (e.g. if "4/5" is in the list, output "4/5", not "0.8"). On the very last line write ONLY the ' + slotCount + ' chosen tile values separated by | (pipe) in the order they fill the slots. No words, no parentheses, no commas — just the values.';
      } else if (isCardQuestion && slotCount > 1) {
        ansInst = workNote + ' This is an equation builder with ' + slotCount + ' slots to fill. Always fully simplify. If the answer is a fraction, write it as numerator | denominator on the last line (e.g. 11 | 3n). Otherwise write the equation with explicit operators (use × for multiply). For example: m = q × r. On the very last line write ONLY the answer.';
      } else if (isCardQuestion) {
        ansInst = workNote + ' This is a multiple choice / click-to-select question. Write fractions as a/b (e.g. 11/3n, NOT 11÷3n). On the very last line write ONLY the exact text of the correct answer.';
      } else {
        ansInst = workNote + ' PLEASE always fully simplify fractions and equations. Collect like terms, reduce fractions, and solve for the variable completely (e.g. write y = 5, NOT y + 11 + 2y = 26; write 3/4, NOT 6/8). Always write fractions as a/b using a slash (NOT ÷). Keep fractions as fractions — do NOT convert to decimals unless asked. For y-intercept questions give ONLY the number (e.g. -9, NOT (0,-9)). For gradient/slope questions give ONLY the number (e.g. 8, NOT 8x). On the very last line write ONLY the final simplified answer. ' + partNote;
      }
      if (!inputBoxCount && !cardChoices.length && !slotCount && product === 'reader') {
        ansInst = workNote + ' This is a reading comprehension task. Use only evidence from the text shown in the question or screenshot. If there are answer options, choose the best option exactly as written. On the very last line write ONLY the final answer. ' + partNote;
      } else if (!inputBoxCount && !cardChoices.length && !slotCount && product === 'science') {
        ansInst = workNote + ' This is a science question. Use GCSE-level science reasoning, include units where needed, and choose the best option exactly as written if options are shown. On the very last line write ONLY the final answer. ' + partNote;
      }
      if (isImage) {
        return 'Solve this '+productName+' question. Look at the screenshot image carefully because important text, options, diagrams, equations, or passages may only be visible in the image.'+(currentGraphB64?' A separate high-res image is also attached.':'')+' Extracted text (may be incomplete): '+currentQuestion+transcriptNote+multiBoxNote+'\n\n'+ansInst;
      }
      return 'Solve this '+productName+' question. '+ansInst+transcriptNote+multiBoxNote+'\n\nQuestion: '+currentQuestion;
    }

    // Full mode: explanation + answer (used by Solve button)
    var styleNote = '';
    if (explainStyle === 'british') styleNote = ' Write your explanation in British slang (innit, bruv, mate, proper, etc.).';
    else if (explainStyle === 'pirate') styleNote = ' Write your explanation in pirate speak (arrr, ye, matey, plunder, etc.).';
    else if (explainStyle === 'shakespeare') styleNote = ' Write your explanation in Shakespearean English (thee, thou, hath, doth, forsooth, etc.).';
    var answerInstruction = inputBoxCount > 1
      ? 'On the very last line write ONLY the ' + inputBoxCount + ' answers separated by | (pipe character), with no extra words.'
      : 'If the question has multiple parts, answer each part on its own line using the format a) answer, b) answer, etc. Otherwise, on the very last line write only the final answer with no extra words or punctuation.';
    if (isImage) {
      return 'You are a '+tutorName+'. This is a screenshot of a '+productName+' question. Look at the screenshot carefully because important text, options, diagrams, equations, or passages may only be visible in the image.'+(currentGraphB64?' A separate high-res image is also attached.':'')+' Extracted text (may be incomplete): '+currentQuestion+transcriptNote+multiBoxNote+'\n\nGive a brief explanation using markdown and LaTeX math where useful (use $...$ for inline math).'+styleNote+' '+answerInstruction;
    }
    return 'You are a '+tutorName+'. Give a brief explanation using markdown and LaTeX math where useful (use $...$ for inline math).'+styleNote+' '+answerInstruction+transcriptNote+multiBoxNote+'\n\nQuestion: '+currentQuestion;
  }

  // Lightweight AI call with a custom prompt (for picking from revealed options)
  function callAIPick(key, model, prompt, onAnswer, onError) {
    if (model==='anthropic' || model==='claude-haiku') {
      var pickModel = model==='claude-haiku' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
      fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:pickModel,max_tokens:32,messages:[{role:'user',content:prompt}]})})
      .then(function(r){return r.json();}).then(function(d){
        if(d.type==='error'||d.error){onError(new Error((d.error&&d.error.message)||'error'));return;}
        onAnswer((d.content&&d.content[0]&&d.content[0].text)||'');
      }).catch(onError);
    } else if (model==='groq') {
      fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify({model:'openai/gpt-oss-120b',max_tokens:32,messages:[{role:'user',content:prompt}]})})
      .then(function(r){return r.json();}).then(function(d){
        if(d.error){onError(new Error(d.error.message));return;}
        onAnswer((d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content)||'');
      }).catch(onError);
    } else {
      fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})})
      .then(function(r){return r.json();}).then(function(d){
        if(d.error){onError(new Error(d.error.message));return;}
        onAnswer((d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts&&d.candidates[0].content.parts[0]&&d.candidates[0].content.parts[0].text)||'');
      }).catch(onError);
    }
  }

  function callAI(key, model, onAnswer, onError, answerOnly) {
    var isImage = !!currentImageB64;
    var tokens = answerOnly ? 512 : 512;

    if (model==='anthropic' || model==='claude-haiku') {
      var claudeModel = model==='claude-haiku' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
      var mc;
      if (isImage) {
        mc = [{type:'image',source:{type:'base64',media_type:'image/png',data:currentImageB64}}];
        if (currentGraphB64) mc.push({type:'image',source:{type:'base64',media_type:'image/png',data:currentGraphB64}});
        mc.push({type:'text',text:buildPrompt(true, answerOnly)});
      } else {
        mc = [{type:'text',text:buildPrompt(false, answerOnly)}];
      }
      fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:claudeModel,max_tokens:tokens,messages:[{role:'user',content:mc}]})})
      .then(function(r){return r.json();}).then(function(d){
        if(d.type==='error'||d.error){var msg=(d.error&&d.error.message)||'Unknown Anthropic error';onError(new Error(msg));return;}
        onAnswer((d.content&&d.content[0]&&d.content[0].text)||JSON.stringify(d),claudeModel);
      })
      .catch(onError);

    } else if (model==='groq') {
      var sysMsg = answerOnly
        ? 'Solve this '+getProductName()+' question. Reply with ONLY the final answer. For maths, fully simplify fractions/equations. For reader tasks, use only the given text. For science, include units when needed. No explanation.'
        : 'You are a '+getTutorName()+'. Give a brief explanation using markdown and LaTeX math where useful. On the very last line write only the final answer with no extra words or punctuation.';
      fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify({model:'openai/gpt-oss-120b',max_tokens:tokens,messages:[{role:'system',content:sysMsg},{role:'user',content:buildPrompt(false, answerOnly)}]})})
      .then(function(r){return r.json();}).then(function(d){
        if(d.error){onError(new Error(d.error.message)); return;}
        onAnswer((d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content)||'Could not get answer.','groq-gpt-oss-120b');
      }).catch(onError);

    } else {
      var gp;
      if (isImage) {
        gp = [{inline_data:{mime_type:'image/png',data:currentImageB64}}];
        if (currentGraphB64) gp.push({inline_data:{mime_type:'image/png',data:currentGraphB64}});
        gp.push({text:buildPrompt(true, answerOnly)});
      } else {
        gp = [{text:buildPrompt(false, answerOnly)}];
      }
      var geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+key;
      var geminiBody = JSON.stringify({contents:[{parts:gp}]});
      function geminiRequest(retryCount) {
        fetch(geminiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:geminiBody})
        .then(function(r){return r.json();}).then(function(d){
          if(d.error) {
            if(d.error.code===429 && retryCount < 2) {
              // Auto-retry after delay (rate limit may be per-minute)
              setTimeout(function(){ geminiRequest(retryCount + 1); }, 5000);
              return;
            }
            var realMsg = d.error.message || 'Unknown error';
            var msg = realMsg;
            if(d.error.code===429) msg = 'Rate limit hit. Try Flash-Lite or Groq for higher limits. (Google: ' + realMsg + ')';
            else if(d.error.code===403) msg = 'Access denied. Key may be invalid or restricted — try a fresh key at aistudio.google.com/apikey. (Google: ' + realMsg + ')';
            else if(d.error.code===404) msg = 'Model not found — it may have been deprecated. Pick a different Gemini model in the popup. (Google: ' + realMsg + ')';
            else if(d.error.code===400) msg = 'Bad request: ' + realMsg;
            onError(new Error(msg)); return;
          }
          var text = d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts&&d.candidates[0].content.parts[0]&&d.candidates[0].content.parts[0].text;
          if(!text && d.candidates&&d.candidates[0]&&d.candidates[0].finishReason==='SAFETY') { onError(new Error('Blocked by safety filter. Try rephrasing.')); return; }
          onAnswer(text||'Could not get answer.',model);
        }).catch(onError);
      }
      geminiRequest(0);
    }
  }

  function solveForAutofill(callback) {
    var at = document.getElementById('sparx-answer-text');
    var ab = document.getElementById('sparx-answer-box');
    ab.classList.add('visible');
    at.className='sparx-answer-text loading';
    at.textContent=loadingText;

    // Check for hardcoded quick answers first
    var quick = quickAnswer();
    if (quick) {
      at.className='sparx-answer-text';
      at.textContent = quick;
      currentFullAnswer = quick;
      callback(quick);
      return;
    }

    chrome.storage.local.get(['sparxApiKey','sparxModel'], function(data) {
      if (!data.sparxApiKey) { stopAutoFill(); return; }
      var model=data.sparxModel||'groq';
      if (currentImageB64&&model==='groq') { stopAutoFill(); at.textContent='Switch to Anthropic or Gemini for image questions.'; return; }

      callAI(data.sparxApiKey, model, function(a, modelUsed) {
        at.className='sparx-answer-text';
        renderMarkdown(a, at);
        currentFullAnswer = a;
        var short = extractShortAnswer(a);
        // Save main answer under current bookwork code (always move to front)
        for(var i=history.length-1;i>=0;i--){if(history[i].code===currentCode)history.splice(i,1);}
        history.unshift({code:currentCode,ans:short,full:a});
        if(history.length>40)history.pop();
        // Save each part as separate history entries (a), b), etc.)
        savePartAnswers(a);
        saveHistory(); renderHist(); saveDevInfo(modelUsed);
        callback(short);
      }, function(e){ at.textContent=errorText+': '+e.message; lastErrorTime=Date.now(); stopAutoFill(); }, true);
    });
  }

  // Track manual input values continuously so they're available at submit time
  var lastManualInput = '';
  function getQuestionScope() {
    var q = findQuestionWrapper();
    if (!q || q.closest('#sparx-solver-box')) return null;
    return q;
  }
  function isAnswerInput(el) {
    if (el.closest('#sparx-solver-box')) return false;
    var t = (el.type || '').toLowerCase();
    if (t === 'password' || t === 'hidden' || t === 'email' || t === 'tel' || t === 'search' || t === 'checkbox' || t === 'radio' || t === 'file') return false;
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (ac && /username|email|password|tel|one-time-code/.test(ac)) return false;
    var name = (el.getAttribute('name') || '').toLowerCase();
    if (name && /username|email|password|login|search/.test(name)) return false;
    return true;
  }
  // Collect manually-entered answer values from the page. The Sparx answer area is
  // typically a SIBLING of the question wrapper (under _AnswerContent / _Answer_),
  // not inside it — so we search the whole document but rely on isAnswerInput() to
  // exclude login/search fields. The caller is responsible for gating on
  // getQuestionScope() to confirm we're actually on a question page.
  function collectAnswerParts() {
    var parts = [];
    var seen = new Set();
    function add(v) { if (v && !seen.has(v)) { seen.add(v); parts.push(v); } }
    document.querySelectorAll('input').forEach(function(inp) {
      if (!isAnswerInput(inp)) return;
      var v = (inp.value || '').trim();
      if (v) add(v);
    });
    document.querySelectorAll('select').forEach(function(sel) {
      if (sel.closest('#sparx-solver-box')) return;
      var o = sel.options[sel.selectedIndex];
      if (o && o.value) add(o.textContent.trim());
    });
    return parts;
  }
  document.addEventListener('input', function(e) {
    try {
      if (autoFilling) return; // Don't track auto-fill typing as manual
      if (e.target.closest('#sparx-solver-box')) return;
      if (!isAnswerInput(e.target)) return; // ignore login/search-style inputs
      if (!getQuestionScope()) return; // not on a question page — don't capture
      var parts = collectAnswerParts();
      if (parts.length) lastManualInput = parts.join(' | ');
    } catch(e) {}
  }, true);
  document.addEventListener('change', function(e) {
    try {
      if (autoFilling) return; // Don't track auto-fill changes as manual
      if (e.target.closest('#sparx-solver-box')) return;
      if (e.target.tagName === 'INPUT' && !isAnswerInput(e.target)) return;
      if (!getQuestionScope()) return;
      var parts = collectAnswerParts();
      if (parts.length) lastManualInput = parts.join(' | ');
    } catch(e) {}
  }, true);

  // Manual-save: patch.js intercepts the gRPC-Web call to Sparx's ActivityAction
  // endpoint and forwards the protobuf string fields via the `sparx-solver-submit`
  // CustomEvent. We pick the user's answer out of those strings by filtering
  // metadata (item IDs, UUIDs, timestamps) and picking the most answer-shaped
  // remaining value. Reading the answer off the wire is more reliable than DOM
  // scraping and has zero per-click overhead.
  var _lastNetSave = { code: null, ans: null, t: 0 };

  function looksLikeMetadata(s) {
    if (!s) return true;
    // Item / question / card ID: short uppercase letters (ANK, PYTH, FRAC, …)
    if (/^[A-Z]{1,8}$/.test(s)) return s.length >= 2; // single letters could be MCQ answers
    // UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
    // ISO timestamp
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return true;
    // Long opaque base64-ish blobs
    if (s.length > 60 && /^[A-Za-z0-9+/=_-]+$/.test(s)) return true;
    return false;
  }

  function pickAnswerFromStrings(strings) {
    if (!strings || !strings.length) return null;
    var candidates = strings.filter(function(s){ return !looksLikeMetadata(s); });
    if (!candidates.length) return null;
    // For multi-input questions Sparx typically sends each value as its own
    // string field — join them so we save "5 | 12 | 7" style.
    if (candidates.length > 1) return candidates.join(' | ');
    return candidates[0];
  }

  // Network-side save (from patch.js — works for card / tile / slot answers
  // where the wire payload is the ground truth).
  window.addEventListener('sparx-solver-submit', function(ev) {
    try {
      var detail = ev.detail || {};
      var ans = pickAnswerFromStrings(detail.strings);
      if (!ans) return;
      var codeEl = document.querySelector('[class*=_Selected_]');
      var code = codeEl ? codeEl.innerText.trim() : currentCode;
      if (!code || code === '?') return;
      saveAnswer(code, ans);
    } catch(e) {}
  });

  // Click-side save (window+mousedown, capture) — Sparx can't intercept this
  // because mousedown at window capture fires before React's own listeners.
  // This is the simple path: when Submit is clicked, read whatever's in the
  // input boxes and save that. Belt-and-suspenders with the network path —
  // saveAnswer() dedups so only one wins per submit.
  window.addEventListener('mousedown', function(e) {
    try {
      if (!getQuestionScope()) return;
      var btn = e.target && e.target.closest ? e.target.closest('[class*=_ButtonPrimary_], button') : null;
      if (!btn) return;
      var txt = (btn.innerText || '').trim().toLowerCase();
      // Only fire on real submit-like buttons
      if (!/\b(submit|check answer)\b/i.test(txt)) return;

      // Read the live input values (typed or pad-clicked, both have .value)
      var parts = [];
      document.querySelectorAll('input').forEach(function(inp) {
        if (!isAnswerInput(inp)) return;
        var v = (inp.value || '').trim();
        if (v) parts.push(v);
      });
      // Fall back to slot contents (card-style multi-slot questions)
      if (!parts.length) {
        document.querySelectorAll('[class*=_InlineSlot] [class*=_CardContent], [class*=_CardSlot] [class*=_CardContent], [class*=_Slot_] [class*=_CardContent]').forEach(function(el) {
          if (el.closest('#sparx-solver-box')) return;
          if (el.className.indexOf('_Empty') !== -1 || el.className.indexOf('_Placeholder') !== -1) return;
          var v = getOptionTextReadable(el);
          if (v) parts.push(v);
        });
      }
      if (!parts.length) return;
      var ans = parts.join(' | ');

      var codeEl = document.querySelector('[class*=_Selected_]');
      var code = codeEl ? codeEl.innerText.trim() : currentCode;
      if (!code || code === '?') return;

      saveAnswer(code, ans);
    } catch(e) {}
  }, true);

  // Shared save path — used by both the network-side and click-side handlers.
  // 2-second dedup so the two paths don't both save (whichever fires first wins).
  function saveAnswer(code, ans) {
    var now = Date.now();
    if (_lastNetSave.code === code && _lastNetSave.ans === ans && (now - _lastNetSave.t) < 2000) return;
    _lastNetSave = { code: code, ans: ans, t: now };
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].code === code) history.splice(i, 1);
    }
    history.unshift({ code: code, ans: ans, manual: true });
    if (history.length > 40) history.pop();
    lastManualInput = '';
    saveHistory();
    renderHist();
  }

  document.addEventListener('keydown', function(e) {
    // Ignore synthetic keyboard events dispatched by our own code
    if (isSyntheticKey) return;
    var parts=[];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (!['Control','Alt','Shift','Meta'].includes(e.key)) parts.push(e.key.toUpperCase());
    if (parts.join('+')===sparxKeybind) { box.classList.toggle('open'); if (box.classList.contains('open')) scan(); e.preventDefault(); }
  });

  function isTimesTablePage() {
    var headings = document.querySelectorAll('h1, h2, h3, [class*=_Title_], [class*=_Header_], [class*=_Heading_]');
    for (var i = 0; i < headings.length; i++) {
      if (/times\s*tables?/i.test(headings[i].innerText)) return true;
    }
    if (/times.?tables?/i.test(location.href)) return true;
    return false;
  }

  function isSummaryPage() {
    // If a question is visible, it's definitely not a summary page
    var q = findQuestionWrapper();
    if (q && !q.closest('#sparx-solver-box')) return false;
    return !!(
      document.querySelector('[class*=_TaskComplete_]') ||
      document.querySelector('[class*=_PackageComplete_]') ||
      document.querySelector('[class*=_CompletionScreen_]') ||
      document.querySelector('[class*=_Summary_]') ||
      document.querySelector('[class*=_Results_]')
    );
  }

  var bookworkDone=false; var bookworkChipSeen=false;

  function getBookworkBlocks() {
    // Try multiple selectors for the answer option blocks
    var selectors = [
      '[class*=_AnswerBlock]', '[class*=_answerBlock]', '[class*=_Answer_][class*=_Block]',
      '[class*=_BookworkAnswer]', '[class*=_Option_]', '.answer-block'
    ];
    for (var s = 0; s < selectors.length; s++) {
      var blocks = document.querySelectorAll(selectors[s]);
      var filtered = Array.from(blocks).filter(function(b) { return !b.closest('#sparx-solver-box'); });
      if (filtered.length > 1) return filtered;
    }
    // Fallback: look for clickable containers that look like answer choices
    var wrapper = document.querySelector('[class*=_Bookwork_]');
    if (wrapper) {
      var parent = wrapper.closest('[class*=_Question]') || wrapper.parentElement;
      if (parent) {
        var candidates = parent.querySelectorAll('[class*=_Card], [role="button"], [tabindex]');
        var filtered = Array.from(candidates).filter(function(c) {
          return c.innerText.trim().length > 0 && !c.closest('#sparx-solver-box');
        });
        if (filtered.length > 1) return filtered;
      }
    }
    return [];
  }

  function getBlockText(block) {
    // Try KaTeX annotation first for clean math
    var ann = block.querySelector('.katex-mathml annotation');
    if (ann && ann.textContent.trim()) return stripLatex(ann.textContent).trim();
    // Try aria-label
    var aria = block.getAttribute('aria-label') || '';
    if (aria.trim()) return aria.trim();
    // Fall back to innerText
    return block.innerText.trim();
  }

  function cleanForMatch(s) {
    return s.toLowerCase().replace(/\s+/g,'').replace(/[^a-z0-9.\/\+\-=]/g,'');
  }

  function checkForBookwork() {
    if (isSummaryPage()) return;
    var chip = document.querySelector('[class*=_Bookwork_]');
    if (!chip) { bookworkChipSeen=false; return; }
    if (!bookworkChipSeen) { bookworkChipSeen=true; bookworkDone=false; }
    if (bookworkDone) return;
    var blocks = getBookworkBlocks();
    if (!blocks.length) return;
    bookworkDone = true;
    var code = chip.innerText.trim().replace(/Bookwork/i,'').replace(/code/i,'').replace(/:/g,'').replace(/\s+/g,' ').trim();

    // Find saved answer for this code
    var saved = null;
    for (var i=0; i<history.length; i++) {
      if (history[i].code === code) { saved = history[i].ans; break; }
    }

    // Also check part-specific codes (e.g. "1D a)")
    if (!saved) {
      for (var i=0; i<history.length; i++) {
        if (history[i].code && history[i].code.indexOf(code) === 0) { saved = history[i].ans; break; }
      }
    }

    if (!saved) {
      // No saved answer — update panel to warn user
      var at = document.getElementById('sparx-answer-text');
      if (at) at.textContent = 'Bookwork check: ' + code + ' — no saved answer found!';
      bookworkDone = false;
      return;
    }

    var savedClean = cleanForMatch(saved);

    // Score each block
    var bestBlock=null; var bestScore=-1;
    blocks.forEach(function(block) {
      var blockText = getBlockText(block);
      var blockClean = cleanForMatch(blockText);
      var score=0;
      if (blockClean===savedClean) score=100;
      else if (blockClean.length>0 && savedClean.length>0) {
        // Check numeric equivalence (e.g. "5" matches "5.0")
        var blockNum = parseFloat(blockClean);
        var savedNum = parseFloat(savedClean);
        if (!isNaN(blockNum) && !isNaN(savedNum) && blockNum === savedNum) score=95;
        // Substring containment
        else if (savedClean.indexOf(blockClean)!==-1 && blockClean.length>0) score=50;
        else if (blockClean.indexOf(savedClean)!==-1 && savedClean.length>0) score=40;
        // Number-only comparison
        else {
          var blockNums = blockClean.replace(/[^0-9.\-\/]/g,'');
          var savedNums = savedClean.replace(/[^0-9.\-\/]/g,'');
          if (blockNums.length>0 && blockNums === savedNums) score=60;
        }
      }
      if (score>bestScore) { bestScore=score; bestBlock=block; }
    });

    if (bestBlock && bestScore > 0) {
      setTimeout(function() {
        sparxClick(bestBlock);
        setTimeout(function() {
          var submitBtn = document.querySelector('[class*=_ButtonPrimary_]');
          if (submitBtn) sparxClick(submitBtn);
          bookworkDone=false;
        }, 300);
      }, 300);
    } else {
      // Show what we had vs what options exist
      var optTexts = blocks.map(function(b) { return getBlockText(b); }).join(', ');
      var at = document.getElementById('sparx-answer-text');
      if (at) at.textContent = 'Bookwork ' + code + ': saved "' + saved + '" but no match in [' + optTexts + ']';
      bookworkDone = false;
    }
  }

  var lastQuestionText = '';
  var lastDetectedCode = '';

  setInterval(function() {
    try {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        bookworkDone = false;
        bookworkChipSeen = false;
        lastDetectedCode = '';
      }

      // Only detect new questions when the bookwork code changes
      if (!autoFilling) {
        var codeEl = document.querySelector('[class*=_Selected_]');
        var newCode = codeEl ? codeEl.innerText.trim() : '';

        if (newCode && newCode !== lastDetectedCode) {
          lastDetectedCode = newCode;
          currentCode = newCode;
          scan();
        }
      }

      checkForBookwork();
    } catch(e) {}
  }, 300);

  toggleBtn.addEventListener('click', function() { box.classList.toggle('open'); if (box.classList.contains('open')) scan(); });

  // Use event delegation on the box to avoid Sparx swallowing clicks
  box.addEventListener('click', function(e) {
    var target = e.target;
    // Click-to-expand question text
    if (target.id === 'sparx-q-display') { e.stopPropagation(); target.classList.toggle('expanded'); return; }
    if (target.id === 'sparx-scan-btn') { e.stopPropagation(); scan(); }
    else if (target.id === 'sparx-solve-btn') { e.stopPropagation(); solve(); }
    else if (target.id === 'sparx-autofill-btn') { e.stopPropagation(); startAutoFill(); }
    else if (target.id === 'sparx-hist-toggle') {
      e.stopPropagation();
      var h=document.getElementById('sparx-history');
      h.classList.toggle('open'); target.textContent=h.classList.contains('open')?'Hide history':'Show history';
      var clearBtn=document.getElementById('sparx-hist-clear');
      if(clearBtn) clearBtn.style.display=h.classList.contains('open')&&history.length?'block':'none';
    }
    else if (target.id === 'sparx-hist-clear') {
      e.stopPropagation();
      history=[]; saveHistory(); renderHist();
      target.style.display='none';
    }
  }, true);

  function scan() {
    if (autoFilling) return;
    var d=document.getElementById('sparx-q-display');
    if (isTimesTablePage()) {
      d.textContent='Do your times tables, kids!'; d.classList.add('has-text');
      document.getElementById('sparx-solve-btn').disabled=true;
      document.getElementById('sparx-autofill-btn').disabled=true;
      document.getElementById('sparx-answer-box').classList.remove('visible');
      return;
    }
    currentImageB64=null; currentGraphB64=null; hasRealImage=false; currentTranscript=''; inputBoxCount=0; cardChoices=[]; tileChoices=[];
    var codeEl=document.querySelector('[class*=_Selected_]');
    currentCode = codeEl ? codeEl.innerText.trim() : '?';
    var exact=findQuestionWrapper();
    if (exact&&!exact.closest('#sparx-solver-box')) {
      currentQuestion = extractCleanQuestion(exact);
      lastQuestionText = currentQuestion.substring(0,200);
      hasRealImage = hasQuestionMedia(exact);
      inputBoxCount = getNumericInputs().length;
      d.textContent=hasRealImage ? 'Rendering question...' : currentQuestion; d.classList.add('has-text');
      if (hasRealImage) {
        fetchTranscript(function(transcript) { currentTranscript = transcript; });
        var graphImg = findQuestionImage(exact);
        if (graphImg && graphImg.src) {
          fetchImageAsB64(graphImg.src, function(b64) { if (b64) currentGraphB64 = b64; });
        }
      }
      function finishScan() {
        var qText = currentQuestion+(hasRealImage?' [image]':'')+(currentGraphB64?' [graph]':'')+(currentTranscript?' [transcript]':'');
        d.textContent=qText;
        d.classList.add('has-text');
        d.classList.remove('expanded');
        if (qText.length < 100) d.classList.add('short-text');
        else d.classList.remove('short-text');
        document.getElementById('sparx-solve-btn').disabled=false;
        document.getElementById('sparx-autofill-btn').disabled=false;
        document.getElementById('sparx-answer-box').classList.remove('visible');
        document.getElementById('sparx-answer-text').innerHTML='';
      }
      if (!hasRealImage) {
        currentImageB64=null;
        finishScan();
        return;
      }
      var scanScale = hasRealImage ? 2 : 1.2;
      html2canvas(exact,{backgroundColor:'#ffffff',scale:scanScale,useCORS:true,logging:false})
      .then(function(canvas){
        var trimmed = trimCanvas(canvas);
        currentImageB64=trimmed.toDataURL('image/png').split(',')[1];
        finishScan();
      }).catch(function(){
        d.textContent=currentQuestion;
        document.getElementById('sparx-solve-btn').disabled=false;
        document.getElementById('sparx-autofill-btn').disabled=false;
      });
    } else {
      d.textContent='No question found. Click inside the question on the page, then scan again.';
    }
  }

  function fetchTranscript(callback) {
    var track = document.querySelector('track[kind="subtitles"]');
    if (!track) { callback(''); return; }
    var src = track.getAttribute('src');
    if (!src) { callback(''); return; }
    fetch(src)
      .then(function(r) { return r.text(); })
      .then(function(vtt) {
        var text = vtt.split('\n')
          .filter(function(l){ return l.trim() && !l.startsWith('WEBVTT') && !l.match(/^\d+$/) && !l.match(/[\d:]+\s*-->/); })
          .join(' ').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim()
          .split(' ').slice(0,400).join(' ');
        callback(text);
      })
      .catch(function(){ callback(''); });
  }

  function fetchImageAsB64(url, callback) {
    fetch(url)
      .then(function(r){ return r.blob(); })
      .then(function(blob){
        var reader = new FileReader();
        reader.onloadend = function(){ callback(reader.result.split(',')[1]); };
        reader.readAsDataURL(blob);
      })
      .catch(function(){ callback(null); });
  }

  function saveDevInfo(modelUsed) {
    var devInfo = {model:modelUsed, hasImage:hasRealImage, code:currentCode};
    var mediaInfo = extractMediaInfo();
    if (mediaInfo) devInfo.mediaInfo = mediaInfo;
    chrome.storage.local.set({sparxDevInfo: devInfo});
  }

  function done(btn){btn.disabled=false;btn.textContent='Solve with AI';}

  function solve() {
    if (isTimesTablePage() || !currentQuestion) return;
    var btn=document.getElementById('sparx-solve-btn'); var ab=document.getElementById('sparx-answer-box'); var at=document.getElementById('sparx-answer-text');
    btn.disabled=true; btn.textContent=loadingText; ab.classList.add('visible'); at.className='sparx-answer-text loading'; at.textContent=loadingText;

    function doSolve() {
      chrome.storage.local.get(['sparxApiKey','sparxModel'],function(data){
        if (!data.sparxApiKey){at.className='sparx-answer-text';at.textContent='No API key! Click the Sparx Solver icon in your toolbar.';done(btn);return;}
        var model=data.sparxModel||'groq';
        if (hasRealImage&&model==='groq'){at.className='sparx-answer-text';at.textContent='Image questions require Anthropic or Gemini.';done(btn);return;}

        callAI(data.sparxApiKey, model, function(a, modelUsed) {
          at.className='sparx-answer-text';
          renderMarkdown(a,at);
          currentAnswer=extractShortAnswer(a);
          for(var i=history.length-1;i>=0;i--){if(history[i].code===currentCode)history.splice(i,1);}
          history.unshift({code:currentCode,ans:currentAnswer,full:a});
          if(history.length>40)history.pop();
          // Save each part as separate history entries
          savePartAnswers(a);
          saveHistory();renderHist();saveDevInfo(modelUsed);done(btn);
        }, function(e){at.className='sparx-answer-text';at.textContent=errorText+': '+e.message;done(btn);});
      });
    }

    // Take a fresh screenshot before solving (don't rely on scan's async capture)
    var exact=findQuestionWrapper();
    if (exact && !exact.closest('#sparx-solver-box') && hasRealImage) {
      var graphImg = findQuestionImage(exact);
      if (graphImg && graphImg.src) {
        fetchImageAsB64(graphImg.src, function(b64) { if (b64) currentGraphB64 = b64; });
      }
      html2canvas(exact,{backgroundColor:'#ffffff',scale:2,useCORS:true,logging:false})
      .then(function(canvas){
        var trimmed = trimCanvas(canvas);
        currentImageB64 = trimmed.toDataURL('image/png').split(',')[1];
        doSolve();
      }).catch(function(){ doSolve(); });
    } else {
      if (!hasRealImage) currentImageB64 = null;
      doSolve();
    }
  }

  function renderHist() {
    var h=document.getElementById('sparx-history');
    if(!history.length){h.innerHTML='';return;}
    var html='';
    history.forEach(function(x,i){
      var tag=x.manual?'<span style="color:#4caf7a;font-size:10px;margin-left:4px;">✎</span>':'';
      var hasMore=!!(x.full&&x.full!==x.ans);
      html+='<div class="sparx-hist-item">'
        +'<div class="sparx-label">'+esc(x.code)+tag+'</div>'
        +'<div class="sparx-hist-md" data-short="'+esc(x.ans||'')+'" data-full="'+esc(x.full||x.ans||'')+'" data-expanded="0"></div>'
        +(hasMore?'<span class="sparx-hist-more">more</span>':'')
        +'</div>';
    });
    h.innerHTML=html;
    h.querySelectorAll('.sparx-hist-md').forEach(function(el){
      renderMarkdown(el.dataset.short, el);
    });
    h.querySelectorAll('.sparx-hist-more').forEach(function(btn){
      btn.addEventListener('click', function(){
        var md=btn.previousElementSibling;
        if(md.dataset.expanded==='0'){
          renderMarkdown(md.dataset.full, md);
          md.dataset.expanded='1';
          btn.textContent='less';
        } else {
          renderMarkdown(md.dataset.short, md);
          md.dataset.expanded='0';
          btn.textContent='more';
        }
      });
    });
  }

  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
})();

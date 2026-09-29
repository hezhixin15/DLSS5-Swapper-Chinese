'use strict';
// The first-run guide.
//
// Shown only when the persisted outcome is still 'pending' and only for a
// language tutorial-copy.js actually carries. Closing it any other way than
// Skip or Finish - Esc, or the window going away - writes nothing, so the guide
// comes back on the next launch. That asymmetry is deliberate: a guide shown
// twice costs a few seconds, a guide never shown costs the reader the manual.
(function () {
  const root = document.getElementById('tutorial');
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const stepLabel = $('tutorialStep');
  const dots = $('tutorialDots');
  const title = $('tutorialTitle');
  const body = $('tutorialBody');
  const skip = $('tutorialSkip');
  const back = $('tutorialBack');
  const next = $('tutorialNext');

  let pages = null;
  let labels = null;
  let index = 0;
  let open = false;
  let lastFocus = null;

  function text(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  }

  function drawBlock(spec) {
    if (spec.p) return text('p', null, spec.p);
    if (spec.note) return text('p', 'tutorial-note', spec.note);
    if (spec.list) {
      const ul = document.createElement('ul');
      ul.className = 'tutorial-list';
      for (const item of spec.list) ul.append(text('li', null, item));
      return ul;
    }
    if (spec.groups) {
      const wrap = document.createElement('div');
      wrap.className = 'tutorial-groups';
      for (const group of spec.groups) {
        const section = document.createElement('section');
        section.append(text('h3', null, group.heading));
        const ul = document.createElement('ul');
        ul.className = 'tutorial-list';
        for (const item of group.items) ul.append(text('li', null, item));
        section.append(ul);
        wrap.append(section);
      }
      return wrap;
    }
    return document.createTextNode('');
  }

  function render() {
    const page = pages[index];
    const last = index === pages.length - 1;
    stepLabel.textContent = labels.step(index + 1, pages.length);
    dots.textContent = '';
    for (let i = 0; i < pages.length; i += 1) {
      const dot = document.createElement('i');
      if (i === index) dot.className = 'on';
      dots.append(dot);
    }
    title.textContent = page.title;
    body.textContent = '';
    for (const spec of page.blocks) body.append(drawBlock(spec));
    back.hidden = index === 0;
    back.textContent = labels.back;
    skip.textContent = labels.skip;
    next.textContent = last ? labels.finish : labels.next;
  }

  function show(code) {
    // Resolved before anything is stored, so a language without copy leaves the
    // module exactly as it was instead of half-open with no pages to draw.
    const translated = window.tutorialCopy.pages(code);
    const translatedLabels = window.tutorialCopy.labels(code);
    if (!translated || !translatedLabels) return false;
    pages = translated;
    labels = translatedLabels;
    index = 0;
    open = true;
    lastFocus = document.activeElement;
    root.setAttribute('aria-label', labels.aria);
    root.classList.remove('hidden');
    render();
    // Only on opening: redrawing must not pull focus off the button the reader
    // just used.
    next.focus();
    return true;
  }

  function openAt(code, outcome) {
    if (outcome !== 'pending') return false;
    return show(code);
  }

  function close() {
    if (!open) return;
    open = false;
    root.classList.add('hidden');
    // Focus is handed back so the keyboard does not land at the top of the
    // window, which is where the browser would otherwise drop it.
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
  }

  // Only these two outcomes are ever written. Everything else leaves the stored
  // value alone, which is what keeps an unfinished guide coming back.
  async function decide(outcome) {
    try { await window.lab.setTutorial(outcome); } catch { /* stays pending */ }
    close();
  }

  skip.addEventListener('click', () => decide('skipped'));
  next.addEventListener('click', () => {
    if (index === pages.length - 1) return decide('done');
    index += 1;
    render();
  });
  back.addEventListener('click', () => {
    if (index === 0) return;
    index -= 1;
    render();
  });

  document.addEventListener('keydown', (event) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      return close();
    }
    if (event.key !== 'Tab') return;
    // The guide covers the app, so Tab has nowhere else to go. Every press is
    // handled here rather than left to the browser's tab order, which would
    // walk out of the card and into the window behind it.
    const stops = [skip, back, next].filter((node) => !node.hidden);
    const at = stops.indexOf(document.activeElement);
    const step = event.shiftKey ? -1 : 1;
    event.preventDefault();
    (stops[at + step] || (event.shiftKey ? stops.at(-1) : stops[0])).focus();
  }, true);

  window.tutorialUi = {
    maybeShow: openAt,
    // The settings entry reads the guide again on demand, so the stored outcome
    // is deliberately ignored: a reader who already finished it can still ask
    // for it back, and closing this way writes nothing new.
    reopen: show,
    applyLanguage: (code) => {
      if (!open) return;
      const translated = window.tutorialCopy.pages(code);
      const translatedLabels = window.tutorialCopy.labels(code);
      if (!translated || !translatedLabels) return close();
      pages = translated;
      labels = translatedLabels;
      root.setAttribute('aria-label', labels.aria);
      render();
    }
  };
})();
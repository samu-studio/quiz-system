'use strict';
// Konfig-Feld-Editoren: mcq / wordflags (fw) / truefalse (tf) / pairs (zu) / cases (dq) / estq (sq).

// ---------------------------------------------------------------------------
// Fragen-Editor (Feldtyp 'mcq') – strukturierter Editor fuer Multiple-Choice.
// Quelle der Wahrheit ist stets die DOM; syncMcqFromDom liest sie in ein Array.
// So gehen beim Tippen keine Fokus-/Cursorpositionen durch Re-Render verloren –
// neu gerendert wird nur bei strukturellen Aenderungen (Frage/Antwort +/-).
// ---------------------------------------------------------------------------
function mcqBlankQuestion() { return { q: '', answers: ['', ''], correct: 0 }; }

function buildMcqEditor(container) {
  container.classList.add('mcq-editor');
  container._mcq = [mcqBlankQuestion()];
  renderMcqEditor(container);
}

function setMcqData(container, arr) {
  const src = Array.isArray(arr) ? arr : [];
  container._mcq = src.map((q) => ({
    q: typeof q.q === 'string' ? q.q : '',
    answers: Array.isArray(q.answers) ? q.answers.map((a) => String(a)) : ['', ''],
    correct: Number.isInteger(q.correct) ? q.correct : 0
  }));
  if (container._mcq.length === 0) container._mcq = [mcqBlankQuestion()];
  renderMcqEditor(container);
}

// Aktuellen DOM-Stand in container._mcq zuruecklesen.
function syncMcqFromDom(container) {
  const arr = [];
  container.querySelectorAll('.mcq-card').forEach((card) => {
    const q = card.querySelector('.mcq-q').value;
    const answers = [];
    let correct = 0;
    card.querySelectorAll('.mcq-answer').forEach((row, i) => {
      answers.push(row.querySelector('.mcq-a').value);
      if (row.querySelector('.mcq-correct').checked) correct = i;
    });
    arr.push({ q, answers, correct });
  });
  container._mcq = arr;
}

// Bereinigter Stand fuer das Speichern (Trimmen, leere Antworten raus, richtige
// Antwort neu bestimmen). Der Server validiert zusaetzlich (normQuestion).
function getMcqData(container) {
  syncMcqFromDom(container);
  return container._mcq.map((q) => {
    const correctText = q.answers[q.correct];
    const answers = q.answers.map((a) => a.trim()).filter(Boolean);
    let correct = answers.indexOf((correctText || '').trim());
    if (correct < 0) correct = 0;
    return { q: q.q.trim(), answers, correct };
  }).filter((q) => q.q && q.answers.length >= 2);
}

function renderMcqEditor(container) {
  const data = container._mcq;
  container.innerHTML = '';
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  data.forEach((q, qi) => {
    const card = document.createElement('div');
    card.className = 'mcq-card';

    const head = document.createElement('div');
    head.className = 'mcq-card-head';
    head.innerHTML = '<span class="mcq-qnum">Frage ' + (qi + 1) + '</span>';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-ghost small danger-text';
    del.textContent = '✕ Frage';
    del.addEventListener('click', () => {
      syncMcqFromDom(container);
      container._mcq.splice(qi, 1);
      if (container._mcq.length === 0) container._mcq = [mcqBlankQuestion()];
      renderMcqEditor(container);
    });
    head.appendChild(del);
    card.appendChild(head);

    const qInput = document.createElement('input');
    qInput.type = 'text';
    qInput.className = 'mcq-q';
    qInput.maxLength = 200;
    qInput.placeholder = 'Fragetext …';
    qInput.value = q.q;
    card.appendChild(qInput);

    const ansWrap = document.createElement('div');
    ansWrap.className = 'mcq-answers';
    q.answers.forEach((a, ai) => {
      const row = document.createElement('div');
      row.className = 'mcq-answer';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.className = 'mcq-correct';
      radio.name = container.id + '-q' + qi;   // pro Frage eindeutige Gruppe
      radio.checked = ai === q.correct;
      radio.title = 'Als richtige Antwort markieren';
      row.appendChild(radio);

      const aInput = document.createElement('input');
      aInput.type = 'text';
      aInput.className = 'mcq-a';
      aInput.maxLength = 120;
      aInput.placeholder = 'Antwort ' + LETTERS[ai];
      aInput.value = a;
      row.appendChild(aInput);

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'mcq-rm';
      rm.textContent = '✕';
      rm.title = 'Antwort entfernen';
      rm.disabled = q.answers.length <= 2;
      rm.addEventListener('click', () => {
        syncMcqFromDom(container);
        const qq = container._mcq[qi];
        qq.answers.splice(ai, 1);
        if (qq.correct >= qq.answers.length) qq.correct = 0;
        renderMcqEditor(container);
      });
      row.appendChild(rm);

      ansWrap.appendChild(row);
    });
    card.appendChild(ansWrap);

    const addA = document.createElement('button');
    addA.type = 'button';
    addA.className = 'btn btn-ghost small';
    addA.textContent = '+ Antwort';
    addA.disabled = q.answers.length >= 6;
    addA.addEventListener('click', () => {
      syncMcqFromDom(container);
      if (container._mcq[qi].answers.length < 6) container._mcq[qi].answers.push('');
      renderMcqEditor(container);
    });
    card.appendChild(addA);

    container.appendChild(card);
  });

  const addQ = document.createElement('button');
  addQ.type = 'button';
  addQ.className = 'btn btn-primary small mcq-addq';
  addQ.textContent = '+ Frage hinzufügen';
  addQ.addEventListener('click', () => {
    syncMcqFromDom(container);
    container._mcq.push(mcqBlankQuestion());
    renderMcqEditor(container);
  });
  container.appendChild(addQ);
}

// ---------------------------------------------------------------------------
// Wörter-Editor (Feldtyp 'wordflags') – je Zeile ein Wort mit einem Haken links,
// der es als „passt NICHT in die Kategorie" (Falle) markiert. Wie beim mcq-Editor
// ist die DOM die Quelle der Wahrheit (syncWfFromDom), damit beim Tippen kein
// Fokus verloren geht; neu gerendert wird nur bei strukturellen Änderungen.
// Enter fügt darunter eine neue Zeile ein, mehrzeiliges Einfügen splittet auf.
// ---------------------------------------------------------------------------
function wfBlank() { return { text: '', wrong: false }; }

function buildWfEditor(container) {
  container.classList.add('wf-editor');
  container._wf = [wfBlank()];
  container._focus = null;
  renderWfEditor(container);
}

function setWfData(container, arr) {
  const src = Array.isArray(arr) ? arr : [];
  container._wf = src.map((it) => (typeof it === 'string'
    ? { text: it, wrong: false }
    : { text: it && it.text != null ? String(it.text) : '', wrong: !!(it && it.wrong) }));
  if (container._wf.length === 0) container._wf = [wfBlank()];
  container._focus = null;
  renderWfEditor(container);
}

// Aktuellen DOM-Stand in container._wf zurücklesen.
function syncWfFromDom(container) {
  const arr = [];
  container.querySelectorAll('.wf-row').forEach((row) => {
    arr.push({ text: row.querySelector('.wf-text').value, wrong: row.querySelector('.wf-wrong').checked });
  });
  container._wf = arr;
}

// Bereinigter Stand fürs Speichern (Trimmen, leere Zeilen raus).
function getWfData(container) {
  syncWfFromDom(container);
  return container._wf
    .map((it) => ({ text: String(it.text).trim().slice(0, 60), wrong: !!it.wrong }))
    .filter((it) => it.text);
}

function renderWfEditor(container) {
  const data = container._wf;
  const focusIndex = container._focus;
  container._focus = null;
  container.innerHTML = '';

  data.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'wf-row' + (it.wrong ? ' is-wrong' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'wf-wrong';
    cb.checked = !!it.wrong;
    cb.title = 'Haken = Wort passt NICHT in die Kategorie (Falle)';
    cb.addEventListener('change', () => {
      syncWfFromDom(container);
      row.classList.toggle('is-wrong', cb.checked);
    });
    row.appendChild(cb);

    const txt = document.createElement('input');
    txt.type = 'text';
    txt.className = 'wf-text';
    txt.maxLength = 60;
    txt.placeholder = 'Wort …';
    txt.value = it.text;
    txt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        syncWfFromDom(container);
        container._wf.splice(i + 1, 0, wfBlank());
        container._focus = i + 1;
        renderWfEditor(container);
      } else if (e.key === 'Backspace' && txt.value === '' && container._wf.length > 1) {
        e.preventDefault();
        syncWfFromDom(container);
        container._wf.splice(i, 1);
        container._focus = Math.max(0, i - 1);
        renderWfEditor(container);
      }
    });
    // Mehrzeiliges Einfügen -> in mehrere Zeilen aufsplitten.
    txt.addEventListener('paste', (e) => {
      const cd = e.clipboardData || window.clipboardData;
      const text = cd ? cd.getData('text') : '';
      if (!text || !/[\r\n]/.test(text)) return;
      e.preventDefault();
      const parts = text.split(/[\r\n]+/).map((p) => p.trim()).filter(Boolean);
      if (!parts.length) return;
      syncWfFromDom(container);
      container._wf[i].text = (container._wf[i].text || '') + parts.shift();
      const ins = parts.map((p) => ({ text: p, wrong: false }));
      container._wf.splice(i + 1, 0, ...ins);
      container._focus = i + ins.length;
      renderWfEditor(container);
    });
    row.appendChild(txt);

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'wf-rm';
    rm.textContent = '✕';
    rm.title = 'Wort entfernen';
    rm.addEventListener('click', () => {
      syncWfFromDom(container);
      container._wf.splice(i, 1);
      if (container._wf.length === 0) container._wf = [wfBlank()];
      renderWfEditor(container);
    });
    row.appendChild(rm);

    container.appendChild(row);
    if (focusIndex === i) setTimeout(() => txt.focus(), 0);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-primary small wf-add';
  add.textContent = '+ Wort hinzufügen';
  add.addEventListener('click', () => {
    syncWfFromDom(container);
    container._wf.push(wfBlank());
    container._focus = container._wf.length - 1;
    renderWfEditor(container);
  });
  container.appendChild(add);

  const legend = document.createElement('p');
  legend.className = 'muted small wf-legend';
  legend.textContent = 'Haken = Wort passt NICHT in die Kategorie – darauf soll gebuzzert werden.';
  container.appendChild(legend);
}

// ---------------------------------------------------------------------------
// Aussagen-Editor (Feldtyp 'truefalse') – je Zeile eine Aussage mit einem Haken
// rechts, der sie als wahr (angehakt) oder falsch (nicht angehakt) markiert.
// Baugleich zum Wörter-Editor (DOM als Quelle der Wahrheit, Enter/Backspace/
// Mehrzeilen-Einfügen), nur mit vertauschter Haken-Bedeutung + eigenem Layout.
// ---------------------------------------------------------------------------
function tfBlank() { return { text: '', wahr: true }; }

function buildTfEditor(container) {
  container.classList.add('tf-editor');
  container._tf = [tfBlank()];
  container._focus = null;
  renderTfEditor(container);
}

function setTfData(container, arr) {
  const src = Array.isArray(arr) ? arr : [];
  container._tf = src.map((it) => (typeof it === 'string'
    ? { text: it, wahr: true }
    : { text: it && it.text != null ? String(it.text) : '', wahr: !!(it && it.wahr) }));
  if (container._tf.length === 0) container._tf = [tfBlank()];
  container._focus = null;
  renderTfEditor(container);
}

// Aktuellen DOM-Stand in container._tf zurücklesen.
function syncTfFromDom(container) {
  const arr = [];
  container.querySelectorAll('.tf-row').forEach((row) => {
    arr.push({ text: row.querySelector('.tf-text').value, wahr: row.querySelector('.tf-wahr').checked });
  });
  container._tf = arr;
}

// Bereinigter Stand fürs Speichern (Trimmen, leere Zeilen raus).
function getTfData(container) {
  syncTfFromDom(container);
  return container._tf
    .map((it) => ({ text: String(it.text).trim().slice(0, 140), wahr: !!it.wahr }))
    .filter((it) => it.text);
}

function renderTfEditor(container) {
  const data = container._tf;
  const focusIndex = container._focus;
  container._focus = null;
  container.innerHTML = '';

  data.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'tf-row' + (it.wahr ? ' is-wahr' : ' is-falsch');

    const txt = document.createElement('input');
    txt.type = 'text';
    txt.className = 'tf-text';
    txt.maxLength = 140;
    txt.placeholder = 'Aussage …';
    txt.value = it.text;
    txt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        syncTfFromDom(container);
        container._tf.splice(i + 1, 0, tfBlank());
        container._focus = i + 1;
        renderTfEditor(container);
      } else if (e.key === 'Backspace' && txt.value === '' && container._tf.length > 1) {
        e.preventDefault();
        syncTfFromDom(container);
        container._tf.splice(i, 1);
        container._focus = Math.max(0, i - 1);
        renderTfEditor(container);
      }
    });
    // Mehrzeiliges Einfügen -> in mehrere Zeilen aufsplitten.
    txt.addEventListener('paste', (e) => {
      const cd = e.clipboardData || window.clipboardData;
      const text = cd ? cd.getData('text') : '';
      if (!text || !/[\r\n]/.test(text)) return;
      e.preventDefault();
      const parts = text.split(/[\r\n]+/).map((p) => p.trim()).filter(Boolean);
      if (!parts.length) return;
      syncTfFromDom(container);
      container._tf[i].text = (container._tf[i].text || '') + parts.shift();
      const ins = parts.map((p) => ({ text: p, wahr: true }));
      container._tf.splice(i + 1, 0, ...ins);
      container._focus = i + ins.length;
      renderTfEditor(container);
    });
    row.appendChild(txt);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'tf-wahr';
    cb.checked = !!it.wahr;
    cb.title = 'Haken = Aussage ist WAHR, kein Haken = FALSCH';
    cb.addEventListener('change', () => {
      syncTfFromDom(container);
      row.className = 'tf-row' + (cb.checked ? ' is-wahr' : ' is-falsch');
    });
    row.appendChild(cb);

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'wf-rm';
    rm.textContent = '✕';
    rm.title = 'Aussage entfernen';
    rm.addEventListener('click', () => {
      syncTfFromDom(container);
      container._tf.splice(i, 1);
      if (container._tf.length === 0) container._tf = [tfBlank()];
      renderTfEditor(container);
    });
    row.appendChild(rm);

    container.appendChild(row);
    if (focusIndex === i) setTimeout(() => txt.focus(), 0);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-primary small wf-add';
  add.textContent = '+ Aussage hinzufügen';
  add.addEventListener('click', () => {
    syncTfFromDom(container);
    container._tf.push(tfBlank());
    container._focus = container._tf.length - 1;
    renderTfEditor(container);
  });
  container.appendChild(add);

  const legend = document.createElement('p');
  legend.className = 'muted small wf-legend';
  legend.textContent = 'Haken = Aussage ist wahr, kein Haken = falsch.';
  container.appendChild(legend);
}

// ---------------------------------------------------------------------------
// Zuordnungs-Editor (Feldtyp 'pairs') – je Zeile ein linkes und ein rechtes Feld.
// Beide gefüllt = echtes Paar. Nur links = „keine Verbindung" (Slot leer lassen
// ist richtig). Nur rechts = Ablenker-Kärtchen (gehört zu keinem Linken). Wie die
// anderen Struktur-Editoren ist die DOM die Quelle der Wahrheit (syncPairsFromDom).
// ---------------------------------------------------------------------------
function pairBlank() { return { links: '', rechts: '' }; }

function buildPairsEditor(container) {
  container.classList.add('pairs-editor');
  container._pairs = [pairBlank()];
  container._focus = null;
  renderPairsEditor(container);
}

function setPairsData(container, arr) {
  const src = Array.isArray(arr) ? arr : [];
  container._pairs = src.map((it) => ({
    links: it && it.links != null ? String(it.links) : '',
    rechts: it && it.rechts != null ? String(it.rechts) : ''
  }));
  if (container._pairs.length === 0) container._pairs = [pairBlank()];
  container._focus = null;
  renderPairsEditor(container);
}

// Aktuellen DOM-Stand in container._pairs zurücklesen.
function syncPairsFromDom(container) {
  const arr = [];
  container.querySelectorAll('.pair-row').forEach((row) => {
    arr.push({
      links: row.querySelector('.pair-l').value,
      rechts: row.querySelector('.pair-r').value
    });
  });
  container._pairs = arr;
}

// Bereinigter Stand fürs Speichern (Trimmen, komplett leere Zeilen raus).
function getPairsData(container) {
  syncPairsFromDom(container);
  return container._pairs
    .map((it) => ({ links: String(it.links).trim().slice(0, 80), rechts: String(it.rechts).trim().slice(0, 80) }))
    .filter((it) => it.links || it.rechts);
}

function renderPairsEditor(container) {
  const data = container._pairs;
  const focusInfo = container._focus;   // { index, side } | null
  container._focus = null;
  container.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'pair-head';
  head.innerHTML = '<span>Links (z. B. Person)</span><span>Rechts (z. B. Erfindung)</span>';
  container.appendChild(head);

  data.forEach((it, i) => {
    const row = document.createElement('div');
    const onlyL = it.links.trim() && !it.rechts.trim();
    const onlyR = !it.links.trim() && it.rechts.trim();
    row.className = 'pair-row' + (onlyL ? ' only-left' : '') + (onlyR ? ' only-right' : '');

    const restyle = () => {
      const l = lInp.value.trim(), r = rInp.value.trim();
      row.classList.toggle('only-left', !!l && !r);
      row.classList.toggle('only-right', !l && !!r);
    };

    const lInp = document.createElement('input');
    lInp.type = 'text'; lInp.className = 'pair-l'; lInp.maxLength = 80;
    lInp.placeholder = 'linkes Element …'; lInp.value = it.links;
    lInp.addEventListener('input', restyle);

    const arrow = document.createElement('span');
    arrow.className = 'pair-arrow'; arrow.textContent = '→';

    const rInp = document.createElement('input');
    rInp.type = 'text'; rInp.className = 'pair-r'; rInp.maxLength = 80;
    rInp.placeholder = 'rechtes Element …'; rInp.value = it.rechts;
    rInp.addEventListener('input', restyle);

    // Enter in einem Feld fügt darunter eine neue Zeile ein.
    [lInp, rInp].forEach((inp, side) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          syncPairsFromDom(container);
          container._pairs.splice(i + 1, 0, pairBlank());
          container._focus = { index: i + 1, side: 0 };
          renderPairsEditor(container);
        }
      });
    });

    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'pair-rm'; rm.textContent = '✕';
    rm.title = 'Zeile entfernen';
    rm.addEventListener('click', () => {
      syncPairsFromDom(container);
      container._pairs.splice(i, 1);
      if (container._pairs.length === 0) container._pairs = [pairBlank()];
      renderPairsEditor(container);
    });

    row.appendChild(lInp);
    row.appendChild(arrow);
    row.appendChild(rInp);
    row.appendChild(rm);
    container.appendChild(row);

    if (focusInfo && focusInfo.index === i) {
      const target = focusInfo.side === 1 ? rInp : lInp;
      setTimeout(() => target.focus(), 0);
    }
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-primary small pairs-add';
  add.textContent = '+ Zuordnung hinzufügen';
  add.addEventListener('click', () => {
    syncPairsFromDom(container);
    container._pairs.push(pairBlank());
    container._focus = { index: container._pairs.length - 1, side: 0 };
    renderPairsEditor(container);
  });
  container.appendChild(add);

  const legend = document.createElement('p');
  legend.className = 'muted small pairs-legend';
  legend.innerHTML = 'Beide Felder gefüllt = Paar. <b>Nur links</b> = „keine Verbindung" (Slot leer lassen ist richtig). <b>Nur rechts</b> = Ablenker-Kärtchen (gehört zu keinem Linken).';
  container.appendChild(legend);
}

// ---------------------------------------------------------------------------
// Fälle-Editor (Feldtyp 'cases', Detektivquiz) – je Fall eine Lösung und die
// Hinweise (ein Hinweis pro Zeile, Reihenfolge = Aufdeck-Reihenfolge). Wie die
// anderen Struktur-Editoren ist die DOM die Quelle der Wahrheit (syncCasesFromDom),
// damit beim Tippen kein Fokus verloren geht; neu gerendert wird nur bei
// strukturellen Änderungen (Fall +/-).
// ---------------------------------------------------------------------------
function caseBlank() { return { loesung: '', hinweise: [''], bild: '' }; }

function buildCasesEditor(container) {
  container.classList.add('cases-editor');
  container._cases = [caseBlank()];
  container._focus = null;
  renderCasesEditor(container);
}

function setCasesData(container, arr) {
  const src = Array.isArray(arr) ? arr : [];
  container._cases = src.map((c) => ({
    loesung: c && c.loesung != null ? String(c.loesung) : '',
    hinweise: Array.isArray(c.hinweise) && c.hinweise.length ? c.hinweise.map((h) => String(h)) : [''],
    bild: c && typeof c.bild === 'string' ? c.bild : ''
  }));
  if (container._cases.length === 0) container._cases = [caseBlank()];
  container._focus = null;
  renderCasesEditor(container);
}

// Aktuellen DOM-Stand in container._cases zurücklesen.
function syncCasesFromDom(container) {
  const arr = [];
  container.querySelectorAll('.dqc-card').forEach((card) => {
    arr.push({
      loesung: card.querySelector('.dqc-loesung').value,
      hinweise: card.querySelector('.dqc-hinweise').value.split('\n'),
      bild: getBildwahlData(card.querySelector('.bildwahl-editor'))
    });
  });
  container._cases = arr;
}

// Bereinigter Stand fürs Speichern (Trimmen, leere Hinweise/Fälle raus).
function getCasesData(container) {
  syncCasesFromDom(container);
  return container._cases
    .map((c) => ({
      loesung: String(c.loesung).trim().slice(0, 120),
      hinweise: c.hinweise.map((h) => String(h).trim()).filter(Boolean).slice(0, 15),
      bild: c.bild || ''
    }))
    .filter((c) => c.loesung && c.hinweise.length);
}

function renderCasesEditor(container) {
  const data = container._cases;
  const focusIndex = container._focus;
  container._focus = null;
  container.innerHTML = '';

  data.forEach((c, ci) => {
    const card = document.createElement('div');
    card.className = 'dqc-card';

    const head = document.createElement('div');
    head.className = 'dqc-card-head';
    head.innerHTML = '<span class="dqc-num">Fall ' + (ci + 1) + '</span>';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'dqc-rm';
    rm.textContent = '✕';
    rm.title = 'Fall entfernen';
    rm.addEventListener('click', () => {
      syncCasesFromDom(container);
      container._cases.splice(ci, 1);
      if (container._cases.length === 0) container._cases = [caseBlank()];
      renderCasesEditor(container);
    });
    head.appendChild(rm);
    card.appendChild(head);

    const solLabel = document.createElement('div');
    solLabel.className = 'muted small dqc-cap';
    solLabel.textContent = 'Lösung';
    card.appendChild(solLabel);
    const sol = document.createElement('input');
    sol.type = 'text';
    sol.className = 'dqc-loesung';
    sol.maxLength = 120;
    sol.placeholder = 'z. B. Marie Curie';
    sol.value = c.loesung;
    card.appendChild(sol);

    const hLabel = document.createElement('div');
    hLabel.className = 'muted small dqc-cap';
    hLabel.textContent = 'Hinweise (ein Hinweis pro Zeile – erst allgemein, dann konkreter)';
    card.appendChild(hLabel);
    const hin = document.createElement('textarea');
    hin.className = 'dqc-hinweise';
    hin.rows = Math.max(3, c.hinweise.length);
    hin.placeholder = 'Ich lebte im 20. Jahrhundert.\nIch war Wissenschaftlerin.\nIch erforschte die Radioaktivität.';
    hin.value = c.hinweise.join('\n');
    card.appendChild(hin);

    // Optionales Lösungsbild: erscheint auf dem Bildschirm über dem Lösungstext.
    const imgBox = document.createElement('details');
    imgBox.className = 'dqc-bild';
    if (c.bild) imgBox.open = true;
    const imgSum = document.createElement('summary');
    imgSum.className = 'muted small dqc-cap';
    imgSum.textContent = 'Lösungsbild (optional, nur auf dem Bildschirm)' + (c.bild ? ' – ' + c.bild : '');
    imgBox.appendChild(imgSum);
    const imgEd = document.createElement('div');
    buildBildwahlEditor(imgEd);
    setBildwahlData(imgEd, c.bild);
    imgEd.addEventListener('change', () => {
      const b = getBildwahlData(imgEd);
      imgSum.textContent = 'Lösungsbild (optional, nur auf dem Bildschirm)' + (b ? ' – ' + b : '');
    });
    imgBox.appendChild(imgEd);
    card.appendChild(imgBox);

    container.appendChild(card);
    if (focusIndex === ci) setTimeout(() => sol.focus(), 0);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-primary small dqc-add';
  add.textContent = '+ Fall hinzufügen';
  add.addEventListener('click', () => {
    syncCasesFromDom(container);
    container._cases.push(caseBlank());
    container._focus = container._cases.length - 1;
    renderCasesEditor(container);
  });
  container.appendChild(add);

  const legend = document.createElement('p');
  legend.className = 'muted small dqc-legend';
  legend.textContent = 'Der Master deckt die Hinweise nacheinander auf – je früher gelöst wird, desto mehr Punkte.';
  container.appendChild(legend);
}

// ---------------------------------------------------------------------------
// Fragen-Editor (Feldtyp 'roq', Reihenfolge-Quiz) – je Frage der Fragetext und
// die Elemente (eines pro Zeile), **in der richtigen Reihenfolge** eingegeben –
// der Server mischt sie beim Anzeigen. Wie die anderen Struktur-Editoren ist
// die DOM die Quelle der Wahrheit (syncRoqFromDom); mindestens 2 Elemente noetig.
// ---------------------------------------------------------------------------
function roqBlank() { return { frage: '', items: ['', ''] }; }

function buildRoqEditor(container) {
  container.classList.add('roq-editor');
  container._roq = [roqBlank()];
  container._focus = null;
  renderRoqEditor(container);
}

function setRoqData(container, arr) {
  const src = Array.isArray(arr) ? arr : [];
  container._roq = src.map((q) => ({
    frage: q && q.frage != null ? String(q.frage) : '',
    items: Array.isArray(q.items) && q.items.length ? q.items.map((s) => String(s)) : ['', '']
  }));
  if (container._roq.length === 0) container._roq = [roqBlank()];
  container._focus = null;
  renderRoqEditor(container);
}

// Aktuellen DOM-Stand in container._roq zurücklesen.
function syncRoqFromDom(container) {
  const arr = [];
  container.querySelectorAll('.roq-card').forEach((card) => {
    arr.push({
      frage: card.querySelector('.roq-frage').value,
      items: card.querySelector('.roq-items').value.split('\n')
    });
  });
  container._roq = arr;
}

// Bereinigter Stand fürs Speichern (Trimmen, leere Elemente/Fragen raus).
function getRoqData(container) {
  syncRoqFromDom(container);
  return container._roq
    .map((q) => ({
      frage: String(q.frage).trim().slice(0, 200),
      items: q.items.map((s) => String(s).trim()).filter(Boolean).slice(0, 20)
    }))
    .filter((q) => q.frage && q.items.length >= 2);
}

function renderRoqEditor(container) {
  const data = container._roq;
  const focusIndex = container._focus;
  container._focus = null;
  container.innerHTML = '';

  data.forEach((q, qi) => {
    const card = document.createElement('div');
    card.className = 'roq-card';

    const head = document.createElement('div');
    head.className = 'roq-card-head';
    head.innerHTML = '<span class="roq-num">Frage ' + (qi + 1) + '</span>';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'roq-rm';
    rm.textContent = '✕';
    rm.title = 'Frage entfernen';
    rm.addEventListener('click', () => {
      syncRoqFromDom(container);
      container._roq.splice(qi, 1);
      if (container._roq.length === 0) container._roq = [roqBlank()];
      renderRoqEditor(container);
    });
    head.appendChild(rm);
    card.appendChild(head);

    const frageLabel = document.createElement('div');
    frageLabel.className = 'muted small roq-cap';
    frageLabel.textContent = 'Frage';
    card.appendChild(frageLabel);
    const frage = document.createElement('input');
    frage.type = 'text';
    frage.className = 'roq-frage';
    frage.maxLength = 200;
    frage.placeholder = 'z. B. Von klein nach groß';
    frage.value = q.frage;
    card.appendChild(frage);

    const itemsLabel = document.createElement('div');
    itemsLabel.className = 'muted small roq-cap';
    itemsLabel.textContent = 'Elemente in der richtigen Reihenfolge (eines pro Zeile, mind. 2)';
    card.appendChild(itemsLabel);
    const items = document.createElement('textarea');
    items.className = 'roq-items';
    items.rows = Math.max(3, q.items.length);
    items.placeholder = 'Maus\nKatze\nHund\nPferd';
    items.value = q.items.join('\n');
    card.appendChild(items);

    container.appendChild(card);
    if (focusIndex === qi) setTimeout(() => frage.focus(), 0);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-primary small roq-add';
  add.textContent = '+ Frage hinzufügen';
  add.addEventListener('click', () => {
    syncRoqFromDom(container);
    container._roq.push(roqBlank());
    container._focus = container._roq.length - 1;
    renderRoqEditor(container);
  });
  container.appendChild(add);

  const legend = document.createElement('p');
  legend.className = 'muted small roq-legend';
  legend.textContent = 'Die Elemente werden den Spielern gemischt angezeigt – sie ziehen sie per Drag & Drop in die richtige Reihenfolge.';
  container.appendChild(legend);
}

// ---------------------------------------------------------------------------
// Schätzfragen-Editor (Feldtyp 'estq', Schätzquiz) – je Frage der Fragetext, die
// korrekte Zahl (Lösung), eine Einheit und optional Min/Max/Schritt. Sind Min UND
// Max gesetzt, geben die Spieler per Slider ein, sonst per Zahlenfeld. Wie die
// anderen Struktur-Editoren ist die DOM die Quelle der Wahrheit (syncEstqFromDom).
// Zahlen bleiben im Editor als Text (leer erlaubt, Komma wird beim Speichern zu Punkt).
// ---------------------------------------------------------------------------
function estqBlank() { return { q: '', loesung: '', einheit: '', min: '', max: '', step: '' }; }

function buildEstqEditor(container) {
  container.classList.add('estq-editor');
  container._estq = [estqBlank()];
  container._focus = null;
  renderEstqEditor(container);
}

function setEstqData(container, arr) {
  const src = Array.isArray(arr) ? arr : [];
  const str = (v) => (v == null || !Number.isFinite(Number(v))) ? '' : String(v);
  container._estq = src.map((q) => ({
    q: q && q.q != null ? String(q.q) : '',
    loesung: str(q && q.loesung),
    einheit: q && q.einheit != null ? String(q.einheit) : '',
    min: str(q && q.min),
    max: str(q && q.max),
    step: str(q && q.step)
  }));
  if (container._estq.length === 0) container._estq = [estqBlank()];
  container._focus = null;
  renderEstqEditor(container);
}

// Aktuellen DOM-Stand in container._estq zurücklesen.
function syncEstqFromDom(container) {
  const arr = [];
  container.querySelectorAll('.estq-card').forEach((card) => {
    arr.push({
      q: card.querySelector('.estq-q').value,
      loesung: card.querySelector('.estq-loesung').value,
      einheit: card.querySelector('.estq-einheit').value,
      min: card.querySelector('.estq-min').value,
      max: card.querySelector('.estq-max').value,
      step: card.querySelector('.estq-step').value
    });
  });
  container._estq = arr;
}

// Bereinigter Stand fürs Speichern: Zahlen parsen (Komma -> Punkt), leere -> null.
// Fragen ohne Text oder ohne gültige Lösung fallen raus (der Server validiert erneut).
function getEstqData(container) {
  syncEstqFromDom(container);
  const num = (v) => {
    const t = String(v).trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  return container._estq
    .map((q) => ({
      q: String(q.q).trim().slice(0, 200),
      loesung: num(q.loesung),
      einheit: String(q.einheit).trim().slice(0, 20),
      min: num(q.min),
      max: num(q.max),
      step: num(q.step)
    }))
    .filter((q) => q.q && q.loesung !== null);
}

function renderEstqEditor(container) {
  const data = container._estq;
  const focusIndex = container._focus;
  container._focus = null;
  container.innerHTML = '';

  // Kleiner Helfer: beschriftetes Eingabefeld in einer Zelle.
  const cell = (labelText, cls, value, ph) => {
    const c = document.createElement('div');
    c.className = 'estq-cell';
    const lab = document.createElement('span');
    lab.className = 'estq-clabel';
    lab.textContent = labelText;
    c.appendChild(lab);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = cls;
    inp.value = value;
    if (ph) inp.placeholder = ph;
    c.appendChild(inp);
    return c;
  };

  data.forEach((q, qi) => {
    const card = document.createElement('div');
    card.className = 'estq-card';

    const head = document.createElement('div');
    head.className = 'estq-card-head';
    head.innerHTML = '<span class="estq-num">Frage ' + (qi + 1) + '</span>';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'estq-rm';
    rm.textContent = '✕';
    rm.title = 'Frage entfernen';
    rm.addEventListener('click', () => {
      syncEstqFromDom(container);
      container._estq.splice(qi, 1);
      if (container._estq.length === 0) container._estq = [estqBlank()];
      renderEstqEditor(container);
    });
    head.appendChild(rm);
    card.appendChild(head);

    const qInput = document.createElement('input');
    qInput.type = 'text';
    qInput.className = 'estq-q';
    qInput.maxLength = 200;
    qInput.placeholder = 'Fragetext … (z. B. Wie viele Einwohner hat Deutschland?)';
    qInput.value = q.q;
    card.appendChild(qInput);

    const row1 = document.createElement('div');
    row1.className = 'estq-row';
    row1.appendChild(cell('Lösung (Zahl)', 'estq-loesung', q.loesung, 'z. B. 83.5'));
    row1.appendChild(cell('Einheit', 'estq-einheit', q.einheit, 'z. B. Mio.'));
    card.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'estq-row';
    row2.appendChild(cell('Slider-Min', 'estq-min', q.min, 'leer = kein Slider'));
    row2.appendChild(cell('Slider-Max', 'estq-max', q.max, 'leer = kein Slider'));
    row2.appendChild(cell('Schritt', 'estq-step', q.step, 'optional'));
    card.appendChild(row2);

    container.appendChild(card);
    if (focusIndex === qi) setTimeout(() => qInput.focus(), 0);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-primary small estq-add';
  add.textContent = '+ Frage hinzufügen';
  add.addEventListener('click', () => {
    syncEstqFromDom(container);
    container._estq.push(estqBlank());
    container._focus = container._estq.length - 1;
    renderEstqEditor(container);
  });
  container.appendChild(add);

  const legend = document.createElement('p');
  legend.className = 'muted small estq-legend';
  legend.innerHTML = '<b>Min &amp; Max leer</b> → Spieler tippen eine Zahl ein. <b>Beide gesetzt</b> → Eingabe per Schieberegler (Schritt optional).';
  container.appendChild(legend);
}

// ---------------------------------------------------------------------------
// Audioquiz-Editor (Feldtyp 'audioq') – je Runde die Lösung, eine Audiodatei
// (Auswahl aus den hochgeladenen Dateien + Upload direkt hier) und die Ausschnitt-
// Längen in Sekunden (Komma-getrennt, aufsteigend; 0 = ganzer Clip). Wie die anderen
// Struktur-Editoren ist die DOM die Quelle der Wahrheit (syncAudioqFromDom); die
// Sekunden bleiben als Text (Komma -> Punkt erst beim Speichern). Der Upload läuft
// über die bestehende WS (Data-URL -> public/audio/), danach frischt onAudioListChanged
// die Dateiauswahl auf. Optional „Erweitert": je Stufe ein eigener Abschnitt
// von..bis Sekunden (Zeilen .aqc-ab-row) statt der Längen ab Clip-Anfang.
// ---------------------------------------------------------------------------
function audioqBlank() { return { loesung: '', audio: '', stufen: '2, 5, 0', erweitert: false, abschnitte: [] }; }

// Abschnitte als Text-Paare für den Editor (bis 0 = leer = bis Clip-Ende).
function audioqAbText(arr) {
  return (Array.isArray(arr) ? arr : []).map((a) => ({
    von: a && a.von != null ? String(a.von) : '',
    bis: a && Number(a.bis) > 0 ? String(a.bis) : ''
  }));
}
// Vorbelegung beim ersten Einschalten: die Standard-Längen als Abschnitte ab 0.
function audioqAbFromStufen(stufenText) {
  return String(stufenText).split(/[,;\n]+/)
    .map((x) => Number(x.trim().replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => ({ von: '0', bis: n > 0 ? String(n) : '' }));
}
function audioqNum(v) { return Number(String(v).trim().replace(',', '.')); }

// Aktuell verfügbare Audiodateien (vom Server, nur Master) – für die Dropdowns.
function audioqFiles() {
  return (typeof latestAdmin !== 'undefined' && latestAdmin && Array.isArray(latestAdmin.audios))
    ? latestAdmin.audios : [];
}

function buildAudioqEditor(container) {
  container.classList.add('audioq-editor');
  container._aq = [audioqBlank()];
  container._focus = null;
  container._pendingUpload = null;   // Zeilenindex, dem eine frisch hochgeladene Datei zugewiesen wird
  renderAudioqEditor(container);
}

function setAudioqData(container, arr) {
  const src = Array.isArray(arr) ? arr : [];
  container._aq = src.map((r) => ({
    loesung: r && r.loesung != null ? String(r.loesung) : '',
    audio: r && r.audio != null ? String(r.audio) : '',
    stufen: Array.isArray(r && r.stufen) ? r.stufen.join(', ') : (r && r.stufen != null ? String(r.stufen) : ''),
    erweitert: !!(r && r.erweitert),
    abschnitte: audioqAbText(r && r.abschnitte)
  }));
  if (container._aq.length === 0) container._aq = [audioqBlank()];
  container._focus = null;
  renderAudioqEditor(container);
}

// Aktuellen DOM-Stand in container._aq zurücklesen.
function syncAudioqFromDom(container) {
  const arr = [];
  container.querySelectorAll('.aqc-card').forEach((card) => {
    arr.push({
      loesung: card.querySelector('.aqc-loesung').value,
      audio: card.querySelector('.aqc-audio').value,
      stufen: card.querySelector('.aqc-stufen').value,
      erweitert: card.querySelector('.aqc-erw').checked,
      abschnitte: Array.from(card.querySelectorAll('.aqc-ab-row')).map((row) => ({
        von: row.querySelector('.aqc-von').value,
        bis: row.querySelector('.aqc-bis').value
      }))
    });
  });
  container._aq = arr;
}

// Bereinigter Stand fürs Speichern: Sekunden parsen (Komma -> Punkt), leere raus.
// Runden ohne Lösung fallen weg (der Server validiert erneut, normAudioRound).
function getAudioqData(container) {
  syncAudioqFromDom(container);
  return container._aq
    .map((r) => ({
      loesung: String(r.loesung).trim().slice(0, 120),
      audio: String(r.audio).trim(),
      stufen: String(r.stufen)
        .split(/[,;\n]+/)
        .map((s) => Number(s.trim().replace(',', '.')))
        .filter((n) => Number.isFinite(n) && n >= 0)
        .slice(0, 12),
      erweitert: !!r.erweitert,
      abschnitte: r.abschnitte
        .filter((a) => String(a.von).trim() !== '' || String(a.bis).trim() !== '')
        .map((a) => ({ von: audioqNum(a.von) || 0, bis: String(a.bis).trim() === '' ? 0 : audioqNum(a.bis) }))
        .filter((a) => a.von >= 0 && Number.isFinite(a.bis) && (a.bis === 0 || a.bis > a.von))
        .slice(0, 12)
    }))
    .filter((r) => r.loesung);
}

// Vom handleAdminResult nach einem erfolgreichen Audio-Upload aufgerufen: die neue
// Datei der wartenden Zeile zuweisen und die Dropdowns neu aufbauen.
function audioqApplyNewFile(container, name) {
  syncAudioqFromDom(container);
  const idx = container._pendingUpload;
  container._pendingUpload = null;
  if (name && idx != null && container._aq[idx]) container._aq[idx].audio = name;
  renderAudioqEditor(container);
}

function renderAudioqEditor(container) {
  const data = container._aq;
  const focusIndex = container._focus;
  container._focus = null;
  container.innerHTML = '';
  const files = audioqFiles();

  data.forEach((r, ri) => {
    const card = document.createElement('div');
    card.className = 'aqc-card';

    const head = document.createElement('div');
    head.className = 'aqc-card-head';
    head.innerHTML = '<span class="aqc-num">Runde ' + (ri + 1) + '</span>';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'aqc-rm';
    rm.textContent = '✕';
    rm.title = 'Runde entfernen';
    rm.addEventListener('click', () => {
      syncAudioqFromDom(container);
      container._aq.splice(ri, 1);
      if (container._aq.length === 0) container._aq = [audioqBlank()];
      renderAudioqEditor(container);
    });
    // Umsortieren: Runde mit dem Nachbarn tauschen.
    const move = (to) => {
      syncAudioqFromDom(container);
      const [r0] = container._aq.splice(ri, 1);
      container._aq.splice(to, 0, r0);
      renderAudioqEditor(container);
    };
    const ctrls = document.createElement('div');
    ctrls.className = 'pl-step-ctrls';
    const mvUp = document.createElement('button');
    mvUp.type = 'button';
    mvUp.className = 'btn btn-ghost small'; mvUp.textContent = '▲'; mvUp.title = 'Nach oben';
    mvUp.disabled = ri === 0;
    mvUp.addEventListener('click', () => move(ri - 1));
    const mvDown = document.createElement('button');
    mvDown.type = 'button';
    mvDown.className = 'btn btn-ghost small'; mvDown.textContent = '▼'; mvDown.title = 'Nach unten';
    mvDown.disabled = ri === data.length - 1;
    mvDown.addEventListener('click', () => move(ri + 1));
    ctrls.appendChild(mvUp); ctrls.appendChild(mvDown); ctrls.appendChild(rm);
    head.appendChild(ctrls);
    card.appendChild(head);

    const solLabel = document.createElement('div');
    solLabel.className = 'muted small aqc-cap';
    solLabel.textContent = 'Lösung';
    card.appendChild(solLabel);
    const sol = document.createElement('input');
    sol.type = 'text';
    sol.className = 'aqc-loesung';
    sol.maxLength = 120;
    sol.placeholder = 'z. B. Kuckuck';
    sol.value = r.loesung;
    card.appendChild(sol);

    // Audiodatei: Dropdown (aus hochgeladenen Dateien) + Upload-Button.
    const audLabel = document.createElement('div');
    audLabel.className = 'muted small aqc-cap';
    audLabel.textContent = 'Audiodatei (läuft nur auf dem Bildschirm)';
    card.appendChild(audLabel);

    const audRow = document.createElement('div');
    audRow.className = 'aqc-audio-row';
    const sel = document.createElement('select');
    sel.className = 'aqc-audio';
    const none = document.createElement('option');
    none.value = ''; none.textContent = '– keine Datei –';
    sel.appendChild(none);
    const opts = files.slice();
    // Aktuell gewählte Datei behalten, auch wenn sie (noch) nicht gelistet ist.
    if (r.audio && opts.indexOf(r.audio) < 0) opts.push(r.audio);
    opts.forEach((f) => {
      const o = document.createElement('option');
      o.value = f; o.textContent = f;
      if (f === r.audio) o.selected = true;
      sel.appendChild(o);
    });
    audRow.appendChild(sel);

    // Vorhören (nur im Editor, lokal am Master-Gerät – hat nichts mit dem Spiel zu tun).
    const prev = document.createElement('audio');
    prev.className = 'aqc-preview';
    prev.controls = true;
    prev.preload = 'none';
    const setPrev = () => {
      const v = sel.value;
      if (v) { prev.src = '/audio/' + encodeURIComponent(v); prev.classList.remove('hidden'); }
      else { prev.removeAttribute('src'); prev.classList.add('hidden'); }
    };
    sel.addEventListener('change', () => { syncAudioqFromDom(container); setPrev(); });

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn btn-ghost small aqc-upload';
    up.textContent = '⬆ Hochladen';
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'audio/*';
    file.className = 'hidden';
    up.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 30 * 1024 * 1024) { alert('Audio zu groß (max 30 MB).'); file.value = ''; return; }
      syncAudioqFromDom(container);
      container._pendingUpload = ri;          // dieser Zeile die neue Datei zuweisen
      up.textContent = '… lädt';
      const reader = new FileReader();
      reader.onload = () => {
        sendAdmin({ type: 'admin', action: 'uploadAudio', name: f.name, data: String(reader.result) });
      };
      reader.readAsDataURL(f);
      file.value = '';
    });
    audRow.appendChild(up);
    audRow.appendChild(file);
    card.appendChild(audRow);
    setPrev();
    card.appendChild(prev);

    // Ausschnitt-Längen
    const stLabel = document.createElement('div');
    stLabel.className = 'muted small aqc-cap';
    stLabel.textContent = 'Ausschnitt-Längen in Sekunden (aufsteigend, Komma-getrennt · 0 = ganzer Clip)';
    card.appendChild(stLabel);
    const st = document.createElement('input');
    st.type = 'text';
    st.className = 'aqc-stufen';
    st.maxLength = 100;
    st.placeholder = 'z. B. 2, 5, 0';
    st.value = r.stufen;
    card.appendChild(st);

    // Erweitert: je Stufe eigener Abschnitt von..bis (statt immer ab 0).
    const erwLabel = document.createElement('label');
    erwLabel.className = 'aqc-erw-label small';
    const erw = document.createElement('input');
    erw.type = 'checkbox';
    erw.className = 'aqc-erw';
    erw.checked = !!r.erweitert;
    erwLabel.appendChild(erw);
    erwLabel.appendChild(document.createTextNode(' Erweitert: Start- und Endpunkt je Ausschnitt'));
    card.appendChild(erwLabel);

    const abBox = document.createElement('div');
    abBox.className = 'aqc-ab';
    const abCap = document.createElement('div');
    abCap.className = 'muted small aqc-cap';
    abCap.textContent = 'Ausschnitte in Sekunden (von – bis · bis leer = bis Clip-Ende)';
    abBox.appendChild(abCap);
    r.abschnitte.forEach((a, ai) => {
      const row = document.createElement('div');
      row.className = 'aqc-ab-row';
      const num = document.createElement('span');
      num.className = 'aqc-ab-num';
      num.textContent = (ai + 1) + '.';
      const von = document.createElement('input');
      von.type = 'text'; von.inputMode = 'decimal';
      von.className = 'aqc-von'; von.placeholder = 'von'; von.maxLength = 8;
      von.value = a.von;
      const dash = document.createElement('span');
      dash.textContent = '–';
      const bis = document.createElement('input');
      bis.type = 'text'; bis.inputMode = 'decimal';
      bis.className = 'aqc-bis'; bis.placeholder = 'Ende'; bis.maxLength = 8;
      bis.value = a.bis;
      const rmAb = document.createElement('button');
      rmAb.type = 'button';
      rmAb.className = 'aqc-rm';
      rmAb.textContent = '✕';
      rmAb.title = 'Ausschnitt entfernen';
      rmAb.addEventListener('click', () => {
        syncAudioqFromDom(container);
        container._aq[ri].abschnitte.splice(ai, 1);
        renderAudioqEditor(container);
      });
      row.appendChild(num); row.appendChild(von); row.appendChild(dash); row.appendChild(bis); row.appendChild(rmAb);
      abBox.appendChild(row);
    });
    const addAb = document.createElement('button');
    addAb.type = 'button';
    addAb.className = 'btn btn-ghost small aqc-ab-add';
    addAb.textContent = '+ Ausschnitt';
    addAb.disabled = r.abschnitte.length >= 12;
    addAb.addEventListener('click', () => {
      syncAudioqFromDom(container);
      const list = container._aq[ri].abschnitte;
      // Neuer Abschnitt startet dort, wo der letzte aufhört.
      const last = list[list.length - 1];
      list.push({ von: last && last.bis ? last.bis : '', bis: '' });
      renderAudioqEditor(container);
    });
    abBox.appendChild(addAb);
    card.appendChild(abBox);

    const showMode = () => {
      st.classList.toggle('hidden', erw.checked);
      stLabel.classList.toggle('hidden', erw.checked);
      abBox.classList.toggle('hidden', !erw.checked);
    };
    erw.addEventListener('change', () => {
      syncAudioqFromDom(container);
      const cur = container._aq[ri];
      // Beim ersten Einschalten die Standard-Längen als Abschnitte übernehmen.
      if (cur.erweitert && cur.abschnitte.length === 0) {
        cur.abschnitte = audioqAbFromStufen(cur.stufen);
        if (cur.abschnitte.length === 0) cur.abschnitte = [{ von: '0', bis: '' }];
        renderAudioqEditor(container);
        return;
      }
      showMode();
    });
    showMode();

    container.appendChild(card);
    if (focusIndex === ri) setTimeout(() => sol.focus(), 0);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-primary small aqc-add';
  add.textContent = '+ Runde hinzufügen';
  add.addEventListener('click', () => {
    syncAudioqFromDom(container);
    container._aq.push(audioqBlank());
    container._focus = container._aq.length - 1;
    renderAudioqEditor(container);
  });
  container.appendChild(add);

  const legend = document.createElement('p');
  legend.className = 'muted small aqc-legend';
  legend.innerHTML = 'Der Master gibt Stufe für Stufe längere Ausschnitte frei – <b>je früher gelöst, desto mehr Punkte</b>. Die Sekunden zählen ab Clip-Anfang; <b>0</b> spielt den ganzen Clip. Mit <b>Erweitert</b> spielt jede Stufe einen eigenen Abschnitt (von – bis). Der Ton läuft nur auf dem Bildschirm.';
  container.appendChild(legend);
}


// ---------------------------------------------------------------------------
// Bildwahl (Bildanzeige): ein Bild aus public/backgrounds/ auswählen (Kacheln wie
// im Design-Tab) oder neu hochladen. Wert ist ein einzelner Dateiname ('' = keins),
// Quelle der Wahrheit ist container._bild (nur Klicks ändern ihn, kein Tippen).
// ---------------------------------------------------------------------------
function bildwahlFiles() {
  return (latestAdmin && Array.isArray(latestAdmin.backgrounds)) ? latestAdmin.backgrounds : [];
}

function buildBildwahlEditor(container) {
  container.classList.add('bildwahl-editor');
  container._bild = '';
  container._pendingUpload = false;   // true = die nächste hochgeladene Datei gleich auswählen
  renderBildwahlEditor(container);
}

function setBildwahlData(container, name) {
  container._bild = typeof name === 'string' ? name : '';
  renderBildwahlEditor(container);
}

function getBildwahlData(container) {
  return container._bild || '';
}

// Nach einem Upload/Löschen (onBildwahlListChanged in config.js) neu aufbauen; ein
// frisch hochgeladenes Bild wird direkt ausgewählt, wenn der Upload von hier kam.
function bildwahlApplyNewFile(container, name) {
  if (container._pendingUpload && name) container._bild = name;
  container._pendingUpload = false;
  renderBildwahlEditor(container);
}

function renderBildwahlEditor(container) {
  container.innerHTML = '';
  const files = bildwahlFiles();
  const wrap = document.createElement('div');
  wrap.className = 'bg-thumbs';

  const pick = (name) => {
    container._bild = name;
    renderBildwahlEditor(container);
    container.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const none = document.createElement('div');
  none.className = 'bg-thumb none-thumb' + (container._bild ? '' : ' active');
  none.textContent = 'Kein Bild';
  none.addEventListener('click', () => pick(''));
  wrap.appendChild(none);

  const opts = files.slice();
  // Aktuell gewähltes Bild behalten, auch wenn es (noch) nicht gelistet ist.
  if (container._bild && opts.indexOf(container._bild) < 0) opts.push(container._bild);
  opts.forEach((name) => {
    const t = document.createElement('div');
    t.className = 'bg-thumb' + (container._bild === name ? ' active' : '');
    t.style.backgroundImage = 'url("/backgrounds/' + encodeURIComponent(name) + '")';
    t.title = name;
    t.addEventListener('click', () => pick(name));
    wrap.appendChild(t);
  });
  container.appendChild(wrap);

  const row = document.createElement('div');
  row.className = 'bildwahl-row';
  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'btn btn-ghost small';
  up.textContent = container._pendingUpload ? '… lädt' : '⬆ Bild hochladen';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.className = 'hidden';
  up.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { alert('Bild zu groß (max 12 MB).'); file.value = ''; return; }
    container._pendingUpload = true;
    up.textContent = '… lädt';
    const reader = new FileReader();
    reader.onload = () => {
      sendAdmin({ type: 'admin', action: 'uploadBg', name: f.name, data: String(reader.result) });
    };
    reader.readAsDataURL(f);
    file.value = '';
  });
  row.appendChild(up);
  row.appendChild(file);
  const hint = document.createElement('span');
  hint.className = 'muted small';
  hint.textContent = container._bild ? 'Gewählt: ' + container._bild : 'Bilder liegen in public/backgrounds/ (gleicher Ordner wie die Design-Hintergründe).';
  row.appendChild(hint);
  container.appendChild(row);
}

/**
 * Grid Rush — UI Controller
 * Manages grid interaction, constraint entry, solving, and visualization
 */

(function () {
  // ── State ──────────────────────────────────────────────────────
  const state = {
    activeVariants: new Set(['classic']),
    evenodd: { even: [], odd: [] },
    cages: [],           // { cells, sum, color }
    thermos: [],         // [ [[r,c],...] ]
    arrows: [],          // [ { circle:[r,c], arrow:[[r,c],...] } ]
    kropkiDots: [],      // [ { cells:[[r,c],[r,c]], type:'black'|'white' } ]
    answerData: null,   // Parsed answer.json: { answers: [...] }

    // Interaction modes
    mode: 'input',       // 'input' | 'markEven' | 'markOdd' | 'selectCage' | 'thermo' | 'arrow' | 'kropki'
    selectedCells: [],
    currentThermo: null, // [[r,c],...] in progress
    currentArrow: null,  // { circle, arrow: [...] }
    kropkiPending: null, // first cell selected
  };

  const CAGE_COLORS = [
    '#e8d44d33','#4dffd233','#ff6b6b33','#c77dff33',
    '#43e97b33','#fa709a33','#4facfe33','#f5af1933',
  ];
  let cageColorIdx = 0;

  // ── Init ────────────────────────────────────────────────────────
  function init() {
    buildGrid();
    bindVariantChips();
    bindControls();
    bindNavTabs();
    updateModeIndicator('Input');
  }

  // ── Grid ────────────────────────────────────────────────────────
  function buildGrid() {
    const gridEl = document.getElementById('sudokuGrid');
    gridEl.innerHTML = '';
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = r;
        cell.dataset.col = c;

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.maxLength = 1;
        inp.autocomplete = 'off';
        inp.dataset.row = r;
        inp.dataset.col = c;

        inp.addEventListener('input', e => {
          const v = e.target.value;
          if (!/^[1-9]$/.test(v)) e.target.value = '';
        });
        inp.addEventListener('focus', () => handleCellFocus(r, c));
        inp.addEventListener('keydown', handleKeyNav);

        cell.appendChild(inp);
        cell.addEventListener('mousedown', e => {
          if (e.target !== inp) handleCellClick(r, c);
        });

        // Apply thick box borders via inline style
        const borderRight = (c === 2 || c === 5) ? '2.5px solid #4a5570' : '';
        const borderBottom = (r === 2 || r === 5) ? '2.5px solid #4a5570' : '';
        if (borderRight) cell.style.borderRight = borderRight;
        if (borderBottom) cell.style.borderBottom = borderBottom;

        gridEl.appendChild(cell);
      }
    }
  }

  function getCell(r, c) {
    return document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
  }
  function getCellInput(r, c) {
    return document.querySelector(`input[data-row="${r}"][data-col="${c}"]`);
  }
  function getGridValues() {
    const grid = [];
    for (let r = 0; r < 9; r++) {
      grid.push([]);
      for (let c = 0; c < 9; c++) {
        const v = parseInt(getCellInput(r, c)?.value || '0') || 0;
        grid[r].push(v);
      }
    }
    return grid;
  }

  function handleKeyNav(e) {
    const r = parseInt(e.target.dataset.row);
    const c = parseInt(e.target.dataset.col);
    const moves = { ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dr, dc] = moves[e.key];
      const nr = Math.max(0, Math.min(8, r+dr));
      const nc = Math.max(0, Math.min(8, c+dc));
      getCellInput(nr, nc)?.focus();
    }
  }

  function handleCellFocus(r, c) {
    if (state.mode === 'input') {
      highlightPeers(r, c);
    } else {
      handleCellClick(r, c);
    }
  }

  function handleCellClick(r, c) {
    switch (state.mode) {
      case 'markEven': toggleEvenOdd(r, c, 'even'); break;
      case 'markOdd':  toggleEvenOdd(r, c, 'odd');  break;
      case 'selectCage': toggleCageSelect(r, c); break;
      case 'thermo':   addThermoCell(r, c); break;
      case 'arrow':    addArrowCell(r, c);  break;
      case 'kropki':   addKropkiCell(r, c); break;
      default: break;
    }
  }

  function highlightPeers(r, c) {
    document.querySelectorAll('.cell').forEach(el => el.classList.remove('selected', 'highlighted'));
    getCell(r, c)?.classList.add('selected');
    for (let i = 0; i < 9; i++) {
      if (i !== c) getCell(r, i)?.classList.add('highlighted');
      if (i !== r) getCell(i, c)?.classList.add('highlighted');
    }
    const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
      const nr=br+dr, nc=bc+dc;
      if (nr!==r || nc!==c) getCell(nr, nc)?.classList.add('highlighted');
    }
  }

  function clearHighlights() {
    document.querySelectorAll('.cell').forEach(el => el.classList.remove('selected', 'highlighted'));
  }

  // ── Even / Odd ──────────────────────────────────────────────────
  function toggleEvenOdd(r, c, type) {
    const opp = type === 'even' ? 'odd' : 'even';
    state.evenodd[opp] = state.evenodd[opp].filter(([er,ec]) => !(er===r&&ec===c));
    const idx = state.evenodd[type].findIndex(([er,ec]) => er===r&&ec===c);
    if (idx !== -1) {
      state.evenodd[type].splice(idx, 1);
      getCell(r, c)?.classList.remove(`mark-${type}`);
    } else {
      state.evenodd[type].push([r, c]);
      getCell(r, c)?.classList.remove(`mark-${opp}`);
      getCell(r, c)?.classList.add(`mark-${type}`);
    }
    renderEOPreview();
  }

  function renderEOPreview() {
    const el = document.getElementById('eoPreview');
    el.innerHTML = '';
    for (const [r,c] of state.evenodd.even) {
      el.appendChild(makeConstraintItem(`Even (${r+1},${c+1})`, () => toggleEvenOdd(r,c,'even')));
    }
    for (const [r,c] of state.evenodd.odd) {
      el.appendChild(makeConstraintItem(`Odd (${r+1},${c+1})`, () => toggleEvenOdd(r,c,'odd')));
    }
  }

  // ── Killer Cages ────────────────────────────────────────────────
  function toggleCageSelect(r, c) {
    const key = `${r},${c}`;
    const idx = state.selectedCells.findIndex(([sr,sc])=>sr===r&&sc===c);
    if (idx !== -1) {
      state.selectedCells.splice(idx, 1);
      getCell(r, c)?.classList.remove('selected');
    } else {
      state.selectedCells.push([r, c]);
      getCell(r, c)?.classList.add('selected');
    }
  }

  function addCage() {
    const sum = parseInt(document.getElementById('cageSum').value);
    if (isNaN(sum) || sum < 1 || sum > 405) { alert('Enter a valid cage sum (1–405)'); return; }
    if (state.selectedCells.length === 0) { alert('Select at least one cell'); return; }

    const color = CAGE_COLORS[cageColorIdx++ % CAGE_COLORS.length];
    const cage = { cells: [...state.selectedCells], sum, color };
    state.cages.push(cage);

    // Apply cage styling
    for (const [r,c] of cage.cells) {
      const cell = getCell(r, c);
      cell?.classList.remove('selected');
      cell?.classList.add('in-cage');
      cell.style.background = color;
    }
    // Put sum label on first cell
    const [fr,fc] = cage.cells[0];
    const firstCell = getCell(fr, fc);
    const label = document.createElement('span');
    label.className = 'cage-label';
    label.textContent = sum;
    firstCell.appendChild(label);

    state.selectedCells = [];
    document.getElementById('cageSum').value = '';
    renderCageList();
    drawSVGOverlay();
  }

  function renderCageList() {
    const el = document.getElementById('cageList');
    el.innerHTML = '';
    state.cages.forEach((cage, i) => {
      const label = `Cage ${i+1}: sum=${cage.sum}, cells=${cage.cells.map(([r,c])=>`(${r+1},${c+1})`).join(' ')}`;
      el.appendChild(makeConstraintItem(label, () => {
        // Remove cage styling
        for (const [r,c] of cage.cells) {
          const cell = getCell(r, c);
          cell?.classList.remove('in-cage');
          cell.style.background = '';
          cell.querySelector('.cage-label')?.remove();
        }
        state.cages.splice(i, 1);
        renderCageList();
        drawSVGOverlay();
      }));
    });
  }

  // ── Thermo ──────────────────────────────────────────────────────
  function startThermo() {
    state.currentThermo = [];
    setMode('thermo');
    updateModeIndicator('Thermo — Click cells');
  }

  function addThermoCell(r, c) {
    if (!state.currentThermo) return;
    state.currentThermo.push([r, c]);
    getCell(r, c)?.classList.add('selected');
    drawSVGOverlay();
  }

  function finishThermo() {
    if (!state.currentThermo || state.currentThermo.length < 2) {
      alert('A thermometer needs at least 2 cells'); return;
    }
    state.thermos.push([...state.currentThermo]);
    clearHighlights();
    state.currentThermo = null;
    setMode('input');
    renderThermoList();
    drawSVGOverlay();
  }

  function renderThermoList() {
    const el = document.getElementById('thermoList');
    el.innerHTML = '';
    state.thermos.forEach((t, i) => {
      const label = `Thermo ${i+1}: ${t.map(([r,c])=>`(${r+1},${c+1})`).join('→')}`;
      el.appendChild(makeConstraintItem(label, () => {
        state.thermos.splice(i, 1);
        renderThermoList();
        drawSVGOverlay();
      }));
    });
  }

  // ── Arrow ────────────────────────────────────────────────────────
  function startArrow() {
    state.currentArrow = { circle: null, arrow: [] };
    setMode('arrow');
    updateModeIndicator('Arrow — Click circle first');
  }

  function addArrowCell(r, c) {
    if (!state.currentArrow) return;
    if (!state.currentArrow.circle) {
      state.currentArrow.circle = [r, c];
      getCell(r, c)?.classList.add('selected');
      updateModeIndicator('Arrow — Click arrow cells');
    } else {
      state.currentArrow.arrow.push([r, c]);
      getCell(r, c)?.classList.add('selected');
    }
    drawSVGOverlay();
  }

  function finishArrow() {
    if (!state.currentArrow?.circle || state.currentArrow.arrow.length === 0) {
      alert('Arrow needs a circle and at least one arrow cell'); return;
    }
    state.arrows.push({ ...state.currentArrow });
    clearHighlights();
    state.currentArrow = null;
    setMode('input');
    renderArrowList();
    drawSVGOverlay();
  }

  function renderArrowList() {
    const el = document.getElementById('arrowList');
    el.innerHTML = '';
    state.arrows.forEach((a, i) => {
      const label = `Arrow ${i+1}: ⊙(${a.circle[0]+1},${a.circle[1]+1}) → ${a.arrow.map(([r,c])=>`(${r+1},${c+1})`).join('-')}`;
      el.appendChild(makeConstraintItem(label, () => {
        state.arrows.splice(i, 1);
        renderArrowList();
        drawSVGOverlay();
      }));
    });
  }

  // ── Kropki ───────────────────────────────────────────────────────
  function startKropki() {
    state.kropkiPending = null;
    setMode('kropki');
    updateModeIndicator('Kropki — Click first cell');
  }

  function addKropkiCell(r, c) {
    if (!state.kropkiPending) {
      state.kropkiPending = [r, c];
      getCell(r, c)?.classList.add('selected');
      updateModeIndicator('Kropki — Click second cell');
    } else {
      const [r1,c1] = state.kropkiPending;
      const dist = Math.abs(r-r1) + Math.abs(c-c1);
      if (dist !== 1) { alert('Kropki cells must be adjacent'); return; }
      document.getElementById('kropkiTypeRow').style.display = 'flex';
      state.kropkiPending = [state.kropkiPending, [r, c]];
      getCell(r, c)?.classList.add('selected');
    }
  }

  function addKropkiDot(type) {
    if (!Array.isArray(state.kropkiPending?.[0])) return;
    const [cell1, cell2] = state.kropkiPending;
    state.kropkiDots.push({ cells: [cell1, cell2], type });
    clearHighlights();
    state.kropkiPending = null;
    document.getElementById('kropkiTypeRow').style.display = 'none';
    setMode('input');
    renderKropkiList();
    drawSVGOverlay();
  }

  function renderKropkiList() {
    const el = document.getElementById('kropkiList');
    el.innerHTML = '';
    state.kropkiDots.forEach((dot, i) => {
      const icon = dot.type === 'black' ? '⚫' : '⚪';
      const label = `${icon} (${dot.cells[0][0]+1},${dot.cells[0][1]+1})↔(${dot.cells[1][0]+1},${dot.cells[1][1]+1})`;
      el.appendChild(makeConstraintItem(label, () => {
        state.kropkiDots.splice(i, 1);
        renderKropkiList();
        drawSVGOverlay();
      }));
    });
  }

  // ── SVG Overlay ──────────────────────────────────────────────────
  const CS = 60; // cell size in SVG coords

  function cellCenter(r, c) {
    return [c * CS + CS / 2, r * CS + CS / 2];
  }

  function drawSVGOverlay() {
    const svg = document.getElementById('constraintSvg');
    svg.innerHTML = '';

    // Thermo
    for (const thermo of state.thermos) {
      drawThermo(svg, thermo, false);
    }
    if (state.currentThermo && state.currentThermo.length > 0) {
      drawThermo(svg, state.currentThermo, true);
    }

    // Arrow
    for (const arrow of state.arrows) {
      drawArrow(svg, arrow, false);
    }
    if (state.currentArrow?.circle) {
      drawArrow(svg, state.currentArrow, true);
    }

    // Kropki
    for (const dot of state.kropkiDots) {
      drawKropkiDot(svg, dot);
    }
  }

  function drawThermo(svg, cells, inProgress) {
    if (cells.length < 1) return;
    const opacity = inProgress ? 0.6 : 1;
    const color = inProgress ? '#aaa' : '#c0c0c0';

    if (cells.length >= 2) {
      const points = cells.map(([r,c]) => cellCenter(r,c));
      const polyline = document.createElementNS('http://www.w3.org/2000/svg','polyline');
      polyline.setAttribute('points', points.map(p=>p.join(',')).join(' '));
      polyline.setAttribute('stroke', color);
      polyline.setAttribute('stroke-width', '16');
      polyline.setAttribute('stroke-linecap', 'round');
      polyline.setAttribute('stroke-linejoin', 'round');
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('opacity', opacity);
      svg.appendChild(polyline);
    }

    // Bulb
    const [bx, by] = cellCenter(cells[0][0], cells[0][1]);
    const bulb = document.createElementNS('http://www.w3.org/2000/svg','circle');
    bulb.setAttribute('cx', bx);
    bulb.setAttribute('cy', by);
    bulb.setAttribute('r', '20');
    bulb.setAttribute('fill', color);
    bulb.setAttribute('opacity', opacity);
    svg.appendChild(bulb);
  }

  function drawArrow(svg, arrow, inProgress) {
    const opacity = inProgress ? 0.6 : 1;
    const color = '#e8d44d';

    // Circle
    const [cx, cy] = cellCenter(arrow.circle[0], arrow.circle[1]);
    const circ = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circ.setAttribute('cx', cx); circ.setAttribute('cy', cy);
    circ.setAttribute('r', '22');
    circ.setAttribute('stroke', color); circ.setAttribute('stroke-width', '2.5');
    circ.setAttribute('fill', 'none'); circ.setAttribute('opacity', opacity);
    svg.appendChild(circ);

    // Arrow line
    if (arrow.arrow && arrow.arrow.length > 0) {
      const allPts = [arrow.circle, ...arrow.arrow];
      const pts = allPts.map(([r,c]) => cellCenter(r,c));
      const poly = document.createElementNS('http://www.w3.org/2000/svg','polyline');
      poly.setAttribute('points', pts.map(p=>p.join(',')).join(' '));
      poly.setAttribute('stroke', color); poly.setAttribute('stroke-width', '2.5');
      poly.setAttribute('stroke-linecap', 'round'); poly.setAttribute('stroke-linejoin', 'round');
      poly.setAttribute('fill', 'none'); poly.setAttribute('opacity', opacity);
      svg.appendChild(poly);

      // Arrowhead at last point
      const last = pts[pts.length-1];
      const prev = pts[pts.length-2];
      const angle = Math.atan2(last[1]-prev[1], last[0]-prev[0]);
      const ah = makeArrowhead(last[0], last[1], angle, color, opacity);
      svg.appendChild(ah);
    }
  }

  function makeArrowhead(x, y, angle, color, opacity) {
    const size = 10;
    const a1 = angle + Math.PI * 0.8;
    const a2 = angle - Math.PI * 0.8;
    const pts = [
      [x, y],
      [x + size * Math.cos(a1), y + size * Math.sin(a1)],
      [x + size * Math.cos(a2), y + size * Math.sin(a2)],
    ];
    const poly = document.createElementNS('http://www.w3.org/2000/svg','polygon');
    poly.setAttribute('points', pts.map(p=>p.join(',')).join(' '));
    poly.setAttribute('fill', color);
    poly.setAttribute('opacity', opacity);
    return poly;
  }

  function drawKropkiDot(svg, dot) {
    const [r1,c1] = dot.cells[0], [r2,c2] = dot.cells[1];
    const [x1,y1] = cellCenter(r1,c1);
    const [x2,y2] = cellCenter(r2,c2);
    const mx = (x1+x2)/2, my = (y1+y2)/2;
    const fill = dot.type === 'black' ? '#1a1a1a' : '#f0f0f0';
    const stroke = dot.type === 'black' ? '#888' : '#555';
    const circ = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circ.setAttribute('cx', mx); circ.setAttribute('cy', my);
    circ.setAttribute('r', '8');
    circ.setAttribute('fill', fill);
    circ.setAttribute('stroke', stroke);
    circ.setAttribute('stroke-width', '1.5');
    svg.appendChild(circ);
  }

  // ── Solve ────────────────────────────────────────────────────────
  function solve() {
    const btn = document.getElementById('btnSolve');
    btn.disabled = true;
    setStatus('solving', '⏳ Solving...');
    document.getElementById('stepsLog').innerHTML = '';

    setTimeout(() => {
      try {
        const puzzle = buildPuzzle();
        const result = window.GridRushSolver.solve(puzzle);

        if (result.success) {
          applySolution(result.grid, puzzle.grid);
          renderSteps(result.steps);
          const errs = window.GridRushSolver.verify(result.grid, puzzle.variants);
          if (errs.length === 0) {
            setStatus('success', '✔ Solved! All constraints satisfied.');
          } else {
            setStatus('error', `⚠ Solution found but ${errs.length} verify error(s). Check steps.`);
          }
        } else {
          renderSteps(result.steps);
          setStatus('error', `✘ ${result.error}`);
        }
      } catch (e) {
        console.error(e);
        setStatus('error', `Error: ${e.message}`);
      }
      btn.disabled = false;
    }, 30);
  }

  function buildPuzzle() {
    const grid = getGridValues();
    const variants = {};

    if (state.activeVariants.has('evenodd') && (state.evenodd.even.length || state.evenodd.odd.length)) {
      variants.evenodd = { even: state.evenodd.even, odd: state.evenodd.odd };
    }
    if (state.activeVariants.has('killer') && state.cages.length) {
      variants.killer = { cages: state.cages.map(c => ({ cells: c.cells, sum: c.sum })) };
    }
    if (state.activeVariants.has('thermo') && state.thermos.length) {
      variants.thermo = { thermos: state.thermos };
    }
    if (state.activeVariants.has('arrow') && state.arrows.length) {
      variants.arrow = { arrows: state.arrows };
    }
    if (state.activeVariants.has('kropki') && state.kropkiDots.length) {
      variants.kropki = { dots: state.kropkiDots };
    }

    return { grid, variants };
  }

  function applySolution(solvedGrid, originalGrid) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const inp = getCellInput(r, c);
        if (!inp) continue;
        if (originalGrid[r][c] === 0) {
          inp.value = solvedGrid[r][c];
          const cell = getCell(r, c);
          cell.classList.add('solved');
          // Stagger animation
          cell.style.animationDelay = `${(r * 9 + c) * 10}ms`;
        } else {
          getCell(r, c)?.classList.add('given');
        }
      }
    }
  }

  function renderSteps(steps) {
    const log = document.getElementById('stepsLog');
    log.innerHTML = '';
    const typeMap = {
      phase:   'phase-header',
      info:    'step-item',
      set:     'step-set',
      eliminate: 'step-eliminate',
      backtrack: 'step-backtrack',
      success: 'step-success',
      fail:    'step-fail',
    };
    for (const s of steps) {
      const div = document.createElement('div');
      div.className = `step-item ${typeMap[s.type] || ''}`;
      div.textContent = s.msg;
      log.appendChild(div);
    }
    log.scrollTop = log.scrollHeight;
  }

  // ── Reset ─────────────────────────────────────────────────────────
  function resetAll() {
    if (!confirm('Reset everything? This clears the grid and all constraints.')) return;
    // Grid
    document.querySelectorAll('.cell input').forEach(inp => inp.value = '');
    document.querySelectorAll('.cell').forEach(cell => {
      cell.classList.remove('given','solved','selected','highlighted','in-cage','mark-even','mark-odd');
      cell.style.background = '';
      cell.style.animationDelay = '';
      cell.querySelector('.cage-label')?.remove();
    });

    // State
    state.evenodd = { even: [], odd: [] };
    state.cages = [];
    state.thermos = [];
    state.arrows = [];
    state.kropkiDots = [];
    state.selectedCells = [];
    state.currentThermo = null;
    state.currentArrow = null;
    state.kropkiPending = null;
    cageColorIdx = 0;
    setMode('input');

    // UI
    ['eoPreview','cageList','thermoList','arrowList','kropkiList'].forEach(id => {
      document.getElementById(id).innerHTML = '';
    });
    document.getElementById('stepsLog').innerHTML = '<p class="empty-msg">Solve a puzzle to see step-by-step reasoning here.</p>';
    document.getElementById('statusMsg').textContent = '';
    document.getElementById('statusMsg').className = 'status-msg';
    document.getElementById('kropkiTypeRow').style.display = 'none';

    drawSVGOverlay();
  }

  function clearGrid() {
    document.querySelectorAll('.cell input').forEach(inp => inp.value = '');
    document.querySelectorAll('.cell').forEach(cell => {
      cell.classList.remove('given','solved');
      cell.style.animationDelay = '';
    });
    setStatus('info', 'Grid cleared.');
  }

  function clearConstraints() {
    state.evenodd = { even: [], odd: [] };
    state.cages = [];
    state.thermos = [];
    state.arrows = [];
    state.kropkiDots = [];
    document.querySelectorAll('.cell').forEach(cell => {
      cell.classList.remove('in-cage','mark-even','mark-odd');
      cell.style.background = '';
      cell.querySelector('.cage-label')?.remove();
    });
    ['eoPreview','cageList','thermoList','arrowList','kropkiList'].forEach(id => {
      document.getElementById(id).innerHTML = '';
    });
    drawSVGOverlay();
    setStatus('info', 'Constraints cleared.');
  }

  // ── Load Example ─────────────────────────────────────────────────
  function loadExample() {
    resetAll();

    // Classic sudoku example (hard)
    const example = {
      grid: [
        [0,0,0, 2,6,0, 7,0,1],
        [6,8,0, 0,7,0, 0,9,0],
        [1,9,0, 0,0,4, 5,0,0],
        [8,2,0, 1,0,0, 0,4,0],
        [0,0,4, 6,0,2, 9,0,0],
        [0,5,0, 0,0,3, 0,2,8],
        [0,0,9, 3,0,0, 0,7,4],
        [0,4,0, 0,5,0, 0,3,6],
        [7,0,3, 0,1,8, 0,0,0],
      ],
      variants: {}
    };

    importPuzzle(example);
    setStatus('info', 'Classic example loaded. Click ▶ Solve!');
  }

  // ── JSON Import/Export ───────────────────────────────────────────
  function exportJSON() {
    const puzzle = buildPuzzle();
    document.getElementById('jsonArea').value = JSON.stringify(puzzle, null, 2);
    setStatus('info', 'Puzzle exported to JSON panel.');
  }

  function importJSON() {
    const raw = document.getElementById('jsonArea').value.trim();
    if (!raw) { alert('Paste JSON first'); return; }
    let puzzle;
    try { puzzle = JSON.parse(raw); }
    catch (e) { alert('Invalid JSON: ' + e.message); return; }
    if (!puzzle.grid) { alert('JSON must have a "grid" field'); return; }
    resetAll();
    importPuzzle(puzzle);
    setStatus('success', 'Puzzle imported successfully.');
  }

  function importPuzzle(puzzle) {
    const grid = puzzle.grid;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const v = grid[r]?.[c] || 0;
        if (v !== 0) {
          const inp = getCellInput(r, c);
          if (inp) inp.value = v;
          getCell(r, c)?.classList.add('given');
        }
      }
    }

    const v = puzzle.variants || {};

    if (v.evenodd) {
      for (const [r,c] of (v.evenodd.even||[])) { state.activeVariants.add('evenodd'); toggleEvenOdd(r,c,'even'); }
      for (const [r,c] of (v.evenodd.odd||[]))  { state.activeVariants.add('evenodd'); toggleEvenOdd(r,c,'odd');  }
      renderEOPreview();
    }

    if (v.killer?.cages) {
      state.activeVariants.add('killer');
      for (const cage of v.killer.cages) {
        state.selectedCells = [...cage.cells];
        document.getElementById('cageSum').value = cage.sum;
        addCage();
      }
    }

    if (v.thermo?.thermos) {
      state.activeVariants.add('thermo');
      for (const t of v.thermo.thermos) { state.thermos.push(t); }
      renderThermoList();
    }

    if (v.arrow?.arrows) {
      state.activeVariants.add('arrow');
      for (const a of v.arrow.arrows) { state.arrows.push(a); }
      renderArrowList();
    }

    if (v.kropki?.dots) {
      state.activeVariants.add('kropki');
      for (const d of v.kropki.dots) { state.kropkiDots.push(d); }
      renderKropkiList();
    }

    syncVariantChips();
    updateVariantPanels();
    drawSVGOverlay();
  }

  // ── Mode Management ───────────────────────────────────────────────
  function setMode(mode) {
    state.mode = mode;
    clearHighlights();
    if (mode === 'input') updateModeIndicator('Input');
    // Deactivate cage select button if leaving
    if (mode !== 'selectCage') {
      document.getElementById('btnSelectCage')?.classList.remove('active');
    }
    if (mode !== 'markEven') document.getElementById('btnMarkEven')?.classList.remove('active');
    if (mode !== 'markOdd')  document.getElementById('btnMarkOdd')?.classList.remove('active');
  }

  function updateModeIndicator(text) {
    document.getElementById('modeIndicator').textContent = `Mode: ${text}`;
  }

  // ── Variant Chips ─────────────────────────────────────────────────
  function bindVariantChips() {
    document.querySelectorAll('.chip[data-v]').forEach(chip => {
      chip.addEventListener('click', () => {
        const v = chip.dataset.v;
        if (v === 'classic') return; // always active
        if (state.activeVariants.has(v)) {
          state.activeVariants.delete(v);
          chip.classList.remove('active');
        } else {
          state.activeVariants.add(v);
          chip.classList.add('active');
        }
        updateVariantPanels();
      });
    });
  }

  function syncVariantChips() {
    document.querySelectorAll('.chip[data-v]').forEach(chip => {
      chip.classList.toggle('active', state.activeVariants.has(chip.dataset.v));
    });
  }

  function updateVariantPanels() {
    const map = { evenodd:'sec-evenodd', killer:'sec-killer', thermo:'sec-thermo', arrow:'sec-arrow', kropki:'sec-kropki' };
    for (const [v, id] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) el.style.display = state.activeVariants.has(v) ? '' : 'none';
    }
  }

  // ── Controls ──────────────────────────────────────────────────────
  function bindControls() {
    document.getElementById('btnSolve').addEventListener('click', solve);
    document.getElementById('btnReset').addEventListener('click', resetAll);
    document.getElementById('btnClearGrid').addEventListener('click', clearGrid);
    document.getElementById('btnClearConstraints').addEventListener('click', clearConstraints);
    document.getElementById('btnLoadExample').addEventListener('click', loadExample);
    document.getElementById('btnExportJson').addEventListener('click', exportJSON);
    document.getElementById('btnImportJson').addEventListener('click', importJSON);

    // ── Load solution (answer.json) ──────────────────────────────
    const answerFileInput = document.getElementById('answerFileInput');
    const btnShowAnswer = document.getElementById('btnShowAnswer');
    const answerPuzzleSelect = document.getElementById('answerPuzzleSelect');

    if (answerFileInput && btnShowAnswer && answerPuzzleSelect) {
      answerFileInput.addEventListener('change', loadAnswerJSONFile);
      btnShowAnswer.addEventListener('click', () => showSelectedAnswer());
      answerPuzzleSelect.addEventListener('change', () => showSelectedAnswer());
    }

    // Even/Odd
    document.getElementById('btnMarkEven').addEventListener('click', () => {
      if (state.mode === 'markEven') { setMode('input'); document.getElementById('btnMarkEven').classList.remove('active'); }
      else { setMode('markEven'); document.getElementById('btnMarkEven').classList.add('active'); document.getElementById('btnMarkOdd').classList.remove('active'); updateModeIndicator('Mark Even — Click cells'); }
    });
    document.getElementById('btnMarkOdd').addEventListener('click', () => {
      if (state.mode === 'markOdd') { setMode('input'); document.getElementById('btnMarkOdd').classList.remove('active'); }
      else { setMode('markOdd'); document.getElementById('btnMarkOdd').classList.add('active'); document.getElementById('btnMarkEven').classList.remove('active'); updateModeIndicator('Mark Odd — Click cells'); }
    });
    document.getElementById('btnClearEO').addEventListener('click', () => {
      state.evenodd = { even: [], odd: [] };
      document.querySelectorAll('.cell.mark-even').forEach(c => c.classList.remove('mark-even'));
      document.querySelectorAll('.cell.mark-odd').forEach(c => c.classList.remove('mark-odd'));
      document.getElementById('eoPreview').innerHTML = '';
    });

    // Killer
    document.getElementById('btnSelectCage').addEventListener('click', () => {
      if (state.mode === 'selectCage') { setMode('input'); document.getElementById('btnSelectCage').classList.remove('active'); }
      else { setMode('selectCage'); document.getElementById('btnSelectCage').classList.add('active'); updateModeIndicator('Select Cage — Click cells'); }
    });
    document.getElementById('btnAddCage').addEventListener('click', addCage);

    // Thermo
    document.getElementById('btnAddThermo').addEventListener('click', startThermo);
    document.getElementById('btnFinishThermo').addEventListener('click', finishThermo);

    // Arrow
    document.getElementById('btnAddArrow').addEventListener('click', startArrow);
    document.getElementById('btnFinishArrow').addEventListener('click', finishArrow);

    // Kropki
    document.getElementById('btnKropkiMode').addEventListener('click', startKropki);
    document.getElementById('btnKBlack').addEventListener('click', () => addKropkiDot('black'));
    document.getElementById('btnKWhite').addEventListener('click', () => addKropkiDot('white'));
  }

  function loadAnswerJSONFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        const answers = parsed?.answers;
        if (!Array.isArray(answers)) throw new Error('answer.json must contain an "answers" array.');
        state.answerData = parsed;
        populateAnswerSelect(answers);
        setStatus('success', `Loaded ${answers.length} answer(s).`);
        // Auto-show first puzzle
        showSelectedAnswer();
      } catch (err) {
        console.error(err);
        state.answerData = null;
        setStatus('error', 'Failed to parse answer.json. Check file format.');
      }
    };
    reader.onerror = () => setStatus('error', 'Failed to read selected file.');
    reader.readAsText(file);
  }

  function populateAnswerSelect(answers) {
    const sel = document.getElementById('answerPuzzleSelect');
    if (!sel) return;
    sel.innerHTML = '';
    for (const a of answers) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = `${a.id}${a.name ? ' — ' + a.name : ''}`;
      sel.appendChild(opt);
    }
    sel.selectedIndex = 0;
  }

  function showSelectedAnswer() {
    const sel = document.getElementById('answerPuzzleSelect');
    if (!sel) return;
    const answers = state.answerData?.answers;
    if (!Array.isArray(answers) || answers.length === 0) {
      return;
    }

    const id = sel.value;
    const ans = answers.find(a => String(a.id) === String(id));
    if (!ans) {
      setStatus('error', 'Selected puzzle id not found in answer.json.');
      return;
    }

    const rows = ans?.grid?.rows;
    if (!Array.isArray(rows) || rows.length !== 9) {
      setStatus('error', 'answer.json grid.rows missing or invalid.');
      return;
    }

    displaySolvedGrid(rows);
    setStatus('success', `Showing solution for ${ans.id}${ans.name ? ' — ' + ans.name : ''}.`);
  }

  function displaySolvedGrid(rows) {
    // We only have the solution grid in answer.json, so clear any constraint overlays
    // to avoid showing stale constraint visuals.
    clearConstraints();

    // Clear digits + old highlights/labels; keep variant chips as-is.
    document.querySelectorAll('.cell').forEach(cell => {
      cell.classList.remove('given', 'solved', 'selected', 'highlighted', 'in-cage', 'mark-even', 'mark-odd');
      cell.style.background = '';
      cell.style.animationDelay = '';
      cell.querySelector('.cage-label')?.remove();
    });
    document.querySelectorAll('.cell input').forEach(inp => inp.value = '');

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const v = rows[r]?.[c] || 0;
        const inp = getCellInput(r, c);
        const cell = getCell(r, c);
        if (!inp || !cell) continue;
        if (v === 0) continue;
        inp.value = v;
        cell.classList.add('solved');
        // Stagger for nicer UX
        cell.style.animationDelay = `${(r * 9 + c) * 10}ms`;
      }
    }

    // Remove any previously drawn constraint overlays
    drawSVGOverlay();
  }

  // ── Nav Tabs ─────────────────────────────────────────────────────
  function bindNavTabs() {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
      });
    });
  }

  // ── Utilities ─────────────────────────────────────────────────────
  function setStatus(type, msg) {
    const el = document.getElementById('statusMsg');
    el.className = `status-msg ${type}`;
    el.textContent = msg;
  }

  function makeConstraintItem(text, onDelete) {
    const div = document.createElement('div');
    div.className = 'constraint-item';
    const span = document.createElement('span');
    span.textContent = text;
    const btn = document.createElement('button');
    btn.className = 'del-btn';
    btn.textContent = '×';
    btn.addEventListener('click', onDelete);
    div.appendChild(span);
    div.appendChild(btn);
    return div;
  }

  // ── Boot ─────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();

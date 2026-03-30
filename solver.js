/**
 * Grid Rush — Variant Sudoku Solver Engine
 * Core solving logic: constraint propagation + backtracking
 * Supports: Classic, Even/Odd, Killer, Thermo, Arrow, Kropki
 */

class SudokuSolver {
  constructor() {
    this.steps = [];
    this.maxSteps = 500;   // cap logged steps for performance
    this.stepCount = 0;
  }

  // ── Public API ──────────────────────────────────────────────────
  solve(puzzle) {
    this.steps = [];
    this.stepCount = 0;

    // Deep copy grid
    const grid = puzzle.grid.map(r => [...r]);
    const variants = puzzle.variants || {};

    this._log('phase', '▶ STARTING SOLVER');
    this._log('info', `Active variants: ${this._activeVariants(variants).join(', ') || 'Classic only'}`);

    // Pre-validate constraints exist
    const preErr = this._prevalidate(grid, variants);
    if (preErr) {
      this._log('fail', `Pre-validation failed: ${preErr}`);
      return { success: false, error: preErr, steps: this.steps };
    }

    // Build candidates from given cells
    let candidates = this._buildCandidates(grid, variants);
    if (!candidates) {
      this._log('fail', 'Immediate contradiction: no valid candidates for a cell.');
      return { success: false, error: 'Contradiction in initial candidates.', steps: this.steps };
    }

    // Constraint propagation pass
    this._log('phase', '① CONSTRAINT PROPAGATION');
    const propagated = this._propagate(grid, candidates, variants);
    if (!propagated) {
      this._log('fail', 'Contradiction during propagation — puzzle may be invalid.');
      return { success: false, error: 'Contradiction detected during propagation.', steps: this.steps };
    }

    this._log('phase', '② BACKTRACKING SEARCH');
    const result = this._backtrack(grid, candidates, variants);

    if (result) {
      this._log('success', '✔ Solution found!');
      return { success: true, grid: result, steps: this.steps };
    } else {
      this._log('fail', '✘ No solution exists for this puzzle.');
      return { success: false, error: 'No solution found.', steps: this.steps };
    }
  }

  // Verify a completed grid satisfies all constraints
  verify(grid, variants) {
    const errs = [];

    // Classic
    for (let i = 0; i < 9; i++) {
      if (!this._allUnique(grid[i])) errs.push(`Row ${i+1} has duplicates`);
      const col = grid.map(r => r[i]);
      if (!this._allUnique(col)) errs.push(`Col ${i+1} has duplicates`);
    }
    for (let br = 0; br < 3; br++) for (let bc = 0; bc < 3; bc++) {
      const box = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
        box.push(grid[br*3+r][bc*3+c]);
      if (!this._allUnique(box)) errs.push(`Box (${br+1},${bc+1}) has duplicates`);
    }

    const v = variants || {};
    if (v.evenodd) {
      for (const [r,c] of (v.evenodd.even||[])) {
        if (grid[r][c] % 2 !== 0) errs.push(`Even violation at (${r+1},${c+1})`);
      }
      for (const [r,c] of (v.evenodd.odd||[])) {
        if (grid[r][c] % 2 === 0) errs.push(`Odd violation at (${r+1},${c+1})`);
      }
    }
    if (v.killer) {
      for (const cage of (v.killer.cages||[])) {
        const vals = cage.cells.map(([r,c]) => grid[r][c]);
        if (!this._allUnique(vals)) errs.push(`Killer cage (sum=${cage.sum}) has duplicates`);
        if (vals.reduce((a,b)=>a+b,0) !== cage.sum) errs.push(`Killer cage sum mismatch (expected ${cage.sum})`);
      }
    }
    if (v.thermo) {
      for (const thermo of (v.thermo.thermos||[])) {
        for (let i = 1; i < thermo.length; i++) {
          const prev = grid[thermo[i-1][0]][thermo[i-1][1]];
          const curr = grid[thermo[i][0]][thermo[i][1]];
          if (curr <= prev) errs.push(`Thermo violation at step ${i}`);
        }
      }
    }
    if (v.arrow) {
      for (const arrow of (v.arrow.arrows||[])) {
        const circVal = grid[arrow.circle[0]][arrow.circle[1]];
        const arrowSum = arrow.arrow.reduce((s,[r,c]) => s + grid[r][c], 0);
        if (arrowSum !== circVal) errs.push(`Arrow sum mismatch (circle=${circVal}, sum=${arrowSum})`);
      }
    }
    if (v.kropki) {
      for (const dot of (v.kropki.dots||[])) {
        const a = grid[dot.cells[0][0]][dot.cells[0][1]];
        const b = grid[dot.cells[1][0]][dot.cells[1][1]];
        if (dot.type === 'black' && !(a === 2*b || b === 2*a)) errs.push(`Kropki black dot violation at (${dot.cells[0]},${dot.cells[1]})`);
        if (dot.type === 'white' && Math.abs(a-b) !== 1) errs.push(`Kropki white dot violation`);
      }
    }
    return errs;
  }

  // ── Candidate building ──────────────────────────────────────────
  _buildCandidates(grid, variants) {
    const cands = [];
    for (let r = 0; r < 9; r++) {
      cands.push([]);
      for (let c = 0; c < 9; c++) {
        if (grid[r][c] !== 0) {
          cands[r].push(new Set([grid[r][c]]));
        } else {
          let possible = new Set([1,2,3,4,5,6,7,8,9]);

          // Even/Odd
          const v = variants;
          if (v.evenodd) {
            if ((v.evenodd.even||[]).some(([er,ec])=>er===r&&ec===c))
              possible = new Set([...possible].filter(x=>x%2===0));
            if ((v.evenodd.odd||[]).some(([or,oc])=>or===r&&oc===c))
              possible = new Set([...possible].filter(x=>x%2===1));
          }

          // Thermo min/max hints
          if (v.thermo) {
            for (const thermo of (v.thermo.thermos||[])) {
              const idx = thermo.findIndex(([tr,tc])=>tr===r&&tc===c);
              if (idx !== -1) {
                const minVal = idx + 1;
                const maxVal = 9 - (thermo.length - 1 - idx);
                possible = new Set([...possible].filter(x => x >= minVal && x <= maxVal));
              }
            }
          }

          if (possible.size === 0) return null;
          cands[r].push(possible);
        }
      }
    }
    return cands;
  }

  // ── Constraint propagation ──────────────────────────────────────
  _propagate(grid, candidates, variants) {
    let changed = true;
    let passes = 0;
    while (changed && passes < 50) {
      changed = false;
      passes++;

      // Classic naked singles
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (grid[r][c] !== 0) continue;
          const cand = candidates[r][c];
          if (cand.size === 0) return false;
          if (cand.size === 1) {
            const val = [...cand][0];
            grid[r][c] = val;
            this._logSet(r, c, val, 'Naked single');
            changed = true;
            if (!this._eliminateFromPeers(grid, candidates, r, c, val)) return false;
          }
        }
      }

      // Eliminate based on row/col/box
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (grid[r][c] !== 0) continue;
          const before = candidates[r][c].size;
          this._removeSeenValues(grid, candidates, r, c);
          if (candidates[r][c].size === 0) return false;
          if (candidates[r][c].size < before) changed = true;
        }
      }

      // Killer cage elimination
      if (variants.killer) {
        for (const cage of (variants.killer.cages||[])) {
          if (!this._applyCageConstraint(grid, candidates, cage)) return false;
          changed = true; // conservative
        }
      }

      // Thermo propagation
      if (variants.thermo) {
        for (const thermo of (variants.thermo.thermos||[])) {
          if (!this._applyThermoConstraint(grid, candidates, thermo)) return false;
          changed = true;
        }
      }

      // Arrow propagation
      if (variants.arrow) {
        for (const arrow of (variants.arrow.arrows||[])) {
          if (!this._applyArrowConstraint(grid, candidates, arrow)) return false;
        }
      }
    }
    return true;
  }

  _removeSeenValues(grid, candidates, r, c) {
    for (let cc = 0; cc < 9; cc++) {
      if (cc !== c && grid[r][cc] !== 0) candidates[r][c].delete(grid[r][cc]);
    }
    for (let rr = 0; rr < 9; rr++) {
      if (rr !== r && grid[rr][c] !== 0) candidates[r][c].delete(grid[rr][c]);
    }
    const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
      const nr = br+dr, nc = bc+dc;
      if ((nr !== r || nc !== c) && grid[nr][nc] !== 0) candidates[r][c].delete(grid[nr][nc]);
    }
  }

  _eliminateFromPeers(grid, candidates, r, c, val) {
    const peers = this._getPeers(r, c);
    for (const [pr, pc] of peers) {
      if (grid[pr][pc] === 0) {
        candidates[pr][pc].delete(val);
        if (candidates[pr][pc].size === 0) return false;
      }
    }
    return true;
  }

  _getPeers(r, c) {
    const peers = [];
    for (let i = 0; i < 9; i++) {
      if (i !== c) peers.push([r, i]);
      if (i !== r) peers.push([i, c]);
    }
    const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
      const nr = br+dr, nc = bc+dc;
      if (nr !== r || nc !== c) peers.push([nr, nc]);
    }
    return peers;
  }

  _applyCageConstraint(grid, candidates, cage) {
    const emptyCells = cage.cells.filter(([r,c]) => grid[r][c] === 0);
    const filledSum  = cage.cells.filter(([r,c]) => grid[r][c] !== 0)
                                 .reduce((s,[r,c]) => s + grid[r][c], 0);
    const remaining  = cage.sum - filledSum;

    if (emptyCells.length === 0) {
      return filledSum === cage.sum;
    }

    // For single remaining cell: pin it
    if (emptyCells.length === 1) {
      const [r,c] = emptyCells[0];
      if (remaining < 1 || remaining > 9) return false;
      const ok = candidates[r][c].has(remaining);
      if (ok) {
        candidates[r][c] = new Set([remaining]);
        this._logSet(r, c, remaining, `Killer cage forces`);
      }
      return ok;
    }

    // Prune values that can't participate in valid combinations
    for (const [r,c] of emptyCells) {
      const otherCells = emptyCells.filter(([er,ec]) => er !== r || ec !== c);
      const validVals = new Set();
      for (const v of candidates[r][c]) {
        const otherFilled = otherCells.filter(([or,oc]) => grid[or][oc] !== 0);
        const otherEmpty  = otherCells.filter(([or,oc]) => grid[or][oc] === 0);
        const needed = remaining - v - otherFilled.reduce((s,[or,oc])=>s+grid[or][oc],0);
        if (needed >= otherEmpty.length && needed <= otherEmpty.length * 9) validVals.add(v);
      }
      candidates[r][c] = new Set([...candidates[r][c]].filter(x => validVals.has(x)));
      if (candidates[r][c].size === 0) return false;
    }
    return true;
  }

  _applyThermoConstraint(grid, candidates, thermo) {
    // Forward pass: each cell's min > previous cell's min candidate
    let minSoFar = 0;
    for (const [r,c] of thermo) {
      if (grid[r][c] !== 0) {
        if (grid[r][c] <= minSoFar) return false;
        minSoFar = grid[r][c];
      } else {
        candidates[r][c] = new Set([...candidates[r][c]].filter(v => v > minSoFar));
        if (candidates[r][c].size === 0) return false;
        minSoFar = Math.min(...candidates[r][c]);
      }
    }
    // Backward pass
    let maxSoFar = 10;
    for (let i = thermo.length - 1; i >= 0; i--) {
      const [r,c] = thermo[i];
      if (grid[r][c] !== 0) {
        if (grid[r][c] >= maxSoFar) return false;
        maxSoFar = grid[r][c];
      } else {
        candidates[r][c] = new Set([...candidates[r][c]].filter(v => v < maxSoFar));
        if (candidates[r][c].size === 0) return false;
        maxSoFar = Math.max(...candidates[r][c]);
      }
    }
    return true;
  }

  _applyArrowConstraint(grid, candidates, arrow) {
    const [cr, cc] = arrow.circle;
    const arrowCells = arrow.arrow;
    const circVal = grid[cr][cc];

    if (circVal !== 0) {
      // Circle known: arrow cells must sum to circVal
      const filledSum = arrowCells.filter(([r,c])=>grid[r][c]!==0).reduce((s,[r,c])=>s+grid[r][c],0);
      const emptyArrow = arrowCells.filter(([r,c])=>grid[r][c]===0);
      const rem = circVal - filledSum;
      if (emptyArrow.length === 1) {
        const [r,c] = emptyArrow[0];
        if (rem < 1 || rem > 9 || !candidates[r][c].has(rem)) return false;
        candidates[r][c] = new Set([rem]);
        this._logSet(r, c, rem, `Arrow forces (circle=${circVal})`);
      }
    }
    return true;
  }

  // ── Backtracking ────────────────────────────────────────────────
  _backtrack(grid, candidates, variants) {
    // Find most constrained empty cell (MRV heuristic)
    let minSize = 10, target = null;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (grid[r][c] === 0) {
          if (candidates[r][c].size < minSize) {
            minSize = candidates[r][c].size;
            target = [r, c];
          }
        }
      }
    }

    if (target === null) {
      // All cells filled — verify
      const errs = this.verify(grid, variants);
      if (errs.length === 0) return grid;
      this._log('backtrack', `Near-solution failed verification: ${errs[0]}`);
      return null;
    }

    const [r, c] = target;
    const vals = [...candidates[r][c]].sort((a,b)=>a-b);

    if (vals.length === 0) return null;

    this._log('backtrack', `Trying cell (${r+1},${c+1}) with ${vals.length} option(s): [${vals.join(',')}]`);

    for (const val of vals) {
      if (!this._isValid(grid, candidates, r, c, val, variants)) continue;

      // Snapshot
      const gridSnap = grid.map(row => [...row]);
      const candSnap = candidates.map(row => row.map(s => new Set(s)));

      grid[r][c] = val;
      candidates[r][c] = new Set([val]);
      this._logSet(r, c, val, 'Try');

      if (this._eliminateFromPeers(grid, candidates, r, c, val)) {
        const propagated = this._propagate(grid, candidates, variants);
        if (propagated) {
          const result = this._backtrack(grid, candidates, variants);
          if (result) return result;
        }
      }

      // Restore
      for (let i = 0; i < 9; i++) grid[i] = [...gridSnap[i]];
      for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) candidates[i][j] = new Set(candSnap[i][j]);
    }

    return null;
  }

  _isValid(grid, candidates, r, c, val, variants) {
    // Row / col / box
    for (let i = 0; i < 9; i++) {
      if (grid[r][i] === val && i !== c) return false;
      if (grid[i][c] === val && i !== r) return false;
    }
    const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
      const nr=br+dr, nc=bc+dc;
      if ((nr!==r||nc!==c) && grid[nr][nc]===val) return false;
    }

    // Even/Odd
    if (variants.evenodd) {
      if ((variants.evenodd.even||[]).some(([er,ec])=>er===r&&ec===c) && val%2!==0) return false;
      if ((variants.evenodd.odd||[]).some(([or,oc])=>or===r&&oc===c) && val%2!==1) return false;
    }

    // Killer: don't duplicate within cage; partial sum can't exceed total
    if (variants.killer) {
      for (const cage of (variants.killer.cages||[])) {
        const inCage = cage.cells.some(([cr,cc])=>cr===r&&cc===c);
        if (!inCage) continue;
        const otherVals = cage.cells.filter(([cr,cc])=>!(cr===r&&cc===c)&&grid[cr][cc]!==0).map(([cr,cc])=>grid[cr][cc]);
        if (otherVals.includes(val)) return false;
        const partialSum = otherVals.reduce((s,v)=>s+v,0) + val;
        const emptyLeft = cage.cells.filter(([cr,cc])=>!(cr===r&&cc===c)&&grid[cr][cc]===0).length;
        if (partialSum > cage.sum) return false;
        if (emptyLeft === 0 && partialSum !== cage.sum) return false;
        // Minimum possible sum with remaining cells
        if (partialSum + emptyLeft > cage.sum) return false;
      }
    }

    // Thermo
    if (variants.thermo) {
      for (const thermo of (variants.thermo.thermos||[])) {
        const idx = thermo.findIndex(([tr,tc])=>tr===r&&tc===c);
        if (idx === -1) continue;
        if (idx > 0) {
          const prev = grid[thermo[idx-1][0]][thermo[idx-1][1]];
          if (prev !== 0 && val <= prev) return false;
        }
        if (idx < thermo.length-1) {
          const next = grid[thermo[idx+1][0]][thermo[idx+1][1]];
          if (next !== 0 && val >= next) return false;
        }
      }
    }

    // Arrow
    if (variants.arrow) {
      for (const arrow of (variants.arrow.arrows||[])) {
        const isCircle = arrow.circle[0]===r && arrow.circle[1]===c;
        const arrowIdx = arrow.arrow.findIndex(([ar,ac])=>ar===r&&ac===c);
        if (!isCircle && arrowIdx === -1) continue;

        const circVal = isCircle ? val : grid[arrow.circle[0]][arrow.circle[1]];
        const tmpGrid = grid.map(row=>[...row]);
        tmpGrid[r][c] = val;

        if (circVal !== 0) {
          const arrowVals = arrow.arrow.map(([ar,ac])=>tmpGrid[ar][ac]);
          const filled = arrowVals.filter(v=>v!==0);
          const empty  = arrowVals.filter(v=>v===0).length;
          const sum    = filled.reduce((s,v)=>s+v,0);
          if (sum > circVal) return false;
          if (empty === 0 && sum !== circVal) return false;
          if (sum + empty > circVal) return false; // min 1 each
        }
      }
    }

    // Kropki
    if (variants.kropki) {
      for (const dot of (variants.kropki.dots||[])) {
        const isA = dot.cells[0][0]===r && dot.cells[0][1]===c;
        const isB = dot.cells[1][0]===r && dot.cells[1][1]===c;
        if (!isA && !isB) continue;
        const other = isA ? grid[dot.cells[1][0]][dot.cells[1][1]] : grid[dot.cells[0][0]][dot.cells[0][1]];
        if (other === 0) continue; // deferred
        if (dot.type === 'black' && !(val===2*other || other===2*val)) return false;
        if (dot.type === 'white' && Math.abs(val-other) !== 1) return false;
      }
    }

    return true;
  }

  // ── Helpers ─────────────────────────────────────────────────────
  _prevalidate(grid, variants) {
    // Check grid size
    if (grid.length !== 9) return 'Grid must have 9 rows';
    for (const row of grid) if (row.length !== 9) return 'Each row must have 9 columns';

    // Killer: ensure cells are valid coords and no cell in 2 cages
    if (variants.killer) {
      const seen = new Set();
      for (const cage of (variants.killer.cages||[])) {
        if (!cage.cells || cage.cells.length === 0) return 'Empty killer cage';
        if (!cage.sum || cage.sum < 1) return 'Killer cage missing sum';
        for (const [r,c] of cage.cells) {
          const key = `${r},${c}`;
          if (seen.has(key)) return `Cell (${r+1},${c+1}) appears in multiple cages`;
          seen.add(key);
        }
      }
    }

    // Thermo: must have ≥ 2 cells
    if (variants.thermo) {
      for (const t of (variants.thermo.thermos||[])) {
        if (t.length < 2) return 'Thermometer must have at least 2 cells';
        if (t.length > 9) return 'Thermometer cannot have more than 9 cells';
      }
    }

    // Arrow: circle and arrow cells required
    if (variants.arrow) {
      for (const a of (variants.arrow.arrows||[])) {
        if (!a.circle || a.circle.length !== 2) return 'Arrow missing circle cell';
        if (!a.arrow || a.arrow.length === 0) return 'Arrow missing arrow cells';
      }
    }

    // Kropki: cells must be adjacent
    if (variants.kropki) {
      for (const dot of (variants.kropki.dots||[])) {
        if (!dot.cells || dot.cells.length !== 2) return 'Kropki dot needs exactly 2 cells';
        const [r1,c1] = dot.cells[0], [r2,c2] = dot.cells[1];
        const dist = Math.abs(r1-r2) + Math.abs(c1-c2);
        if (dist !== 1) return `Kropki dot cells (${r1+1},${c1+1}) and (${r2+1},${c2+1}) must be adjacent`;
        if (!['black','white'].includes(dot.type)) return 'Kropki dot type must be "black" or "white"';
      }
    }

    return null;
  }

  _allUnique(arr) {
    const s = arr.filter(v => v !== 0);
    return s.length === new Set(s).size;
  }

  _activeVariants(variants) {
    const names = { evenodd:'Even/Odd', killer:'Killer', thermo:'Thermo', arrow:'Arrow', kropki:'Kropki' };
    return Object.keys(names).filter(k => variants[k]).map(k => names[k]);
  }

  _log(type, msg) {
    if (this.stepCount++ < this.maxSteps) this.steps.push({ type, msg });
  }
  _logSet(r, c, val, reason) {
    this._log('set', `${reason}: R${r+1}C${c+1} = ${val}`);
  }
}

// Export singleton
window.GridRushSolver = new SudokuSolver();

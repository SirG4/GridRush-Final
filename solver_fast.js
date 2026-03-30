/**
 * Fast Variant Sudoku Solver (Node)
 * - Bitmask candidates
 * - Precomputed constraint lookups
 * - Undo stack for backtracking
 *
 * Expects puzzle format compatible with `solver.js` internal schema:
 * { grid: number[9][9], variants?: { evenodd, killer, thermo, arrow, kropki } }
 */

const ALL = 0x3FE; // bits 1..9 set (1<<1 ... 1<<9)
const DIGIT_MASK_EVEN = (1 << 2) | (1 << 4) | (1 << 6) | (1 << 8);
const DIGIT_MASK_ODD = (1 << 1) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 9);

// popcount for masks up to 1024
const POPCNT = new Uint8Array(1024);
for (let m = 0; m < POPCNT.length; m++) {
  let x = m;
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  POPCNT[m] = c;
}

const BIT_TO_DIGIT = new Int8Array(1024);
for (let d = 1; d <= 9; d++) BIT_TO_DIGIT[1 << d] = d;

// masks for thermo filtering
const GREATER_THAN = new Uint16Array(10); // v -> digits > v
const LESS_THAN = new Uint16Array(10); // v -> digits < v
for (let v = 0; v <= 9; v++) {
  let g = 0;
  let l = 0;
  for (let d = 1; d <= 9; d++) {
    if (d > v) g |= 1 << d;
    if (d < v) l |= 1 << d;
  }
  GREATER_THAN[v] = g;
  LESS_THAN[v] = l;
}

// Precompute min/max achievable sum using k distinct digits from a given available-mask.
// minSumFromAvail[mask*10+k] = sum of k smallest digits in mask (or -1 if impossible)
// maxSumFromAvail[mask*10+k] = sum of k largest digits in mask (or -1 if impossible)
const MIN_SUM_FROM_AVAIL = new Int16Array(1024 * 10);
const MAX_SUM_FROM_AVAIL = new Int16Array(1024 * 10);
for (let mask = 0; mask < 1024; mask++) {
  const digits = [];
  for (let d = 1; d <= 9; d++) if (mask & (1 << d)) digits.push(d);
  const base = mask * 10;
  for (let k = 0; k <= 9; k++) {
    if (k === 0) {
      MIN_SUM_FROM_AVAIL[base + k] = 0;
      MAX_SUM_FROM_AVAIL[base + k] = 0;
      continue;
    }
    if (digits.length < k) {
      MIN_SUM_FROM_AVAIL[base + k] = -1;
      MAX_SUM_FROM_AVAIL[base + k] = -1;
      continue;
    }
    let min = 0;
    let max = 0;
    for (let i = 0; i < k; i++) min += digits[i];
    for (let i = digits.length - k; i < digits.length; i++) max += digits[i];
    MIN_SUM_FROM_AVAIL[base + k] = min;
    MAX_SUM_FROM_AVAIL[base + k] = max;
  }
}

function solvePuzzle(puzzle) {
  const grid2d = puzzle.grid;
  const variants = puzzle.variants || {};

  // Flatten givens
  const grid = new Int8Array(81);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = grid2d[r][c] | 0;
      grid[r * 9 + c] = v;
    }
  }

  // Classic masks
  const rowMask = new Uint16Array(9);
  const colMask = new Uint16Array(9);
  const boxMask = new Uint16Array(9);

  // Even/Odd requirement: 0 = none, 1 = even, 2 = odd
  const parityReq = new Uint8Array(81);
  if (variants.evenodd) {
    for (const [r, c] of (variants.evenodd.even || [])) parityReq[r * 9 + c] = 1;
    for (const [r, c] of (variants.evenodd.odd || [])) parityReq[r * 9 + c] = 2;
  }

  // Thermo adjacency
  const thermoPred = Array.from({ length: 81 }, () => []);
  const thermoSucc = Array.from({ length: 81 }, () => []);
  if (variants.thermo) {
    for (const thermo of (variants.thermo.thermos || [])) {
      // thermo is bulb -> tip: each next must be > previous
      for (let i = 1; i < thermo.length; i++) {
        const [pr, pc] = thermo[i - 1];
        const [cr, cc] = thermo[i];
        const p = pr * 9 + pc;
        const cidx = cr * 9 + cc;
        thermoPred[cidx].push(p);
        thermoSucc[p].push(cidx);
      }
    }
  }

  // Killer cages
  const cagesInCell = Array.from({ length: 81 }, () => []);
  const cagesCells = [];
  const cagesTarget = [];
  const cageUsedMask = [];
  const cageFilledSum = [];
  const cageEmptyCount = [];
  if (variants.killer) {
    const cages = variants.killer.cages || [];
    for (let i = 0; i < cages.length; i++) {
      const cage = cages[i];
      const cells2 = [];
      for (const [r, c] of cage.cells) cells2.push(r * 9 + c);
      const cells = Int16Array.from(cells2);
      cagesCells.push(cells);
      cagesTarget.push(cage.sum | 0);
      cageUsedMask.push(0);
      cageFilledSum.push(0);
      cageEmptyCount.push(cells.length);
      for (let j = 0; j < cells.length; j++) cagesInCell[cells[j]].push(i);
    }
  }
  const cageCount = cagesCells.length;

  // Arrow constraints
  const arrowsInCircle = Array.from({ length: 81 }, () => []);
  const arrowsInCell = Array.from({ length: 81 }, () => []);
  const arrowsCircle = [];
  const arrowsCells = [];
  const arrowFilledSum = [];
  const arrowEmptyCount = [];
  if (variants.arrow) {
    const arrows = variants.arrow.arrows || [];
    for (let i = 0; i < arrows.length; i++) {
      const a = arrows[i];
      const circle = a.circle[0] * 9 + a.circle[1];
      arrowsCircle.push(circle);
      const acells2 = [];
      for (const [r, c] of a.arrow) acells2.push(r * 9 + c);
      const acells = Int16Array.from(acells2);
      arrowsCells.push(acells);
      arrowFilledSum.push(0);
      arrowEmptyCount.push(acells.length);
      arrowsInCircle[circle].push(i);
      for (let j = 0; j < acells.length; j++) arrowsInCell[acells[j]].push(i);
    }
  }
  const arrowCount = arrowsCircle.length;

  // Kropki dots
  // For each cell: arrays of { other, type } but stored parallel for speed.
  const kropkiOthers = Array.from({ length: 81 }, () => []);
  const kropkiTypes = Array.from({ length: 81 }, () => []); // 0 black, 1 white
  if (variants.kropki) {
    for (const dot of (variants.kropki.dots || [])) {
      const [a, b] = dot.cells;
      const aidx = a[0] * 9 + a[1];
      const bidx = b[0] * 9 + b[1];
      const type = dot.type === 'black' ? 0 : 1;
      kropkiOthers[aidx].push(bidx);
      kropkiTypes[aidx].push(type);
      kropkiOthers[bidx].push(aidx);
      kropkiTypes[bidx].push(type);
    }
  }

  // Initialize classic masks + variant dynamic states and validate givens.
  function boxIndex(r, c) {
    return ((r / 3) | 0) * 3 + ((c / 3) | 0);
  }

  // Classic placement validation on givens
  for (let idx = 0; idx < 81; idx++) {
    const v = grid[idx];
    if (v === 0) continue;
    if (v < 1 || v > 9) return null;
    const r = (idx / 9) | 0;
    const c = idx - r * 9;
    const b = boxIndex(r, c);
    const bit = 1 << v;
    if (rowMask[r] & bit) return null;
    if (colMask[c] & bit) return null;
    if (boxMask[b] & bit) return null;
    // even/odd check
    if (parityReq[idx] === 1 && (v & 1)) return null; // even requested but v odd
    if (parityReq[idx] === 2 && !(v & 1)) return null; // odd requested but v even
    rowMask[r] |= bit;
    colMask[c] |= bit;
    boxMask[b] |= bit;
  }

  // Validate thermo adjacency for givens
  for (let idx = 0; idx < 81; idx++) {
    const v = grid[idx];
    if (v === 0) continue;
    // predecessors must be smaller
    const preds = thermoPred[idx];
    for (let i = 0; i < preds.length; i++) {
      const p = preds[i];
      const pv = grid[p];
      if (pv !== 0 && v <= pv) return null;
    }
    // successors must be larger
    const succ = thermoSucc[idx];
    for (let i = 0; i < succ.length; i++) {
      const s = succ[i];
      const sv = grid[s];
      if (sv !== 0 && v >= sv) return null;
    }
  }

  // Killer init
  for (let cid = 0; cid < cageCount; cid++) {
    const cells = cagesCells[cid];
    let used = 0;
    let sum = 0;
    let empty = cells.length;
    for (let j = 0; j < cells.length; j++) {
      const cellIdx = cells[j];
      const v = grid[cellIdx];
      if (v === 0) continue;
      empty--;
      const bit = 1 << v;
      if (used & bit) return null;
      used |= bit;
      sum += v;
    }
    if (sum > cagesTarget[cid]) return null;
    cageUsedMask[cid] = used;
    cageFilledSum[cid] = sum;
    cageEmptyCount[cid] = empty;

    const remainingSum = cagesTarget[cid] - sum;
    const availMask = ALL ^ used;
    const min = MIN_SUM_FROM_AVAIL[availMask * 10 + empty];
    const max = MAX_SUM_FROM_AVAIL[availMask * 10 + empty];
    if (min === -1 || remainingSum < min || remainingSum > max) return null;
  }

  // Arrow init
  for (let aid = 0; aid < arrowCount; aid++) {
    const acells = arrowsCells[aid];
    let sum = 0;
    let empty = acells.length;
    for (let j = 0; j < acells.length; j++) {
      const cellIdx = acells[j];
      const v = grid[cellIdx];
      if (v === 0) continue;
      empty--;
      sum += v;
    }
    arrowFilledSum[aid] = sum;
    arrowEmptyCount[aid] = empty;

    const circleIdx = arrowsCircle[aid];
    const circleVal = grid[circleIdx];
    if (circleVal !== 0) {
      if (empty === 0) {
        if (sum !== circleVal) return null;
      } else {
        const minTotal = sum + empty * 1;
        const maxTotal = sum + empty * 9;
        if (circleVal < minTotal || circleVal > maxTotal) return null;
      }
    }
  }

  // Kropki init
  if (variants.kropki) {
    for (let idx = 0; idx < 81; idx++) {
      const v = grid[idx];
      if (v === 0) continue;
      const others = kropkiOthers[idx];
      const types = kropkiTypes[idx];
      for (let i = 0; i < others.length; i++) {
        const oidx = others[i];
        const ov = grid[oidx];
        if (ov === 0) continue;
        const t = types[i];
        if (t === 0) {
          if (!(v === 2 * ov || ov === 2 * v)) return null;
        } else {
          if (Math.abs(v - ov) !== 1) return null;
        }
      }
    }
  }

  // Returns basic mask from classic+evenodd+thermo only (fast).
  function basicMask(idx) {
    if (grid[idx] !== 0) return 0;
    const r = (idx / 9) | 0;
    const c = idx - r * 9;
    const b = boxIndex(r, c);
    let m = ALL & ~(rowMask[r] | colMask[c] | boxMask[b]);

    const pr = parityReq[idx];
    if (pr === 1) m &= DIGIT_MASK_EVEN;
    else if (pr === 2) m &= DIGIT_MASK_ODD;

    const preds = thermoPred[idx];
    for (let i = 0; i < preds.length; i++) {
      const pv = grid[preds[i]];
      if (pv !== 0) m &= GREATER_THAN[pv];
    }
    const succ = thermoSucc[idx];
    for (let i = 0; i < succ.length; i++) {
      const sv = grid[succ[i]];
      if (sv !== 0) m &= LESS_THAN[sv];
    }

    return m;
  }

  // Full candidate check including killer/arrow/kropki.
  function isValidPlacement(idx, digit) {
    const bit = 1 << digit;
    const r = (idx / 9) | 0;
    const c = idx - r * 9;
    const b = boxIndex(r, c);
    // classic duplication check (should already be covered by candidate masks)
    if (rowMask[r] & bit) return false;
    if (colMask[c] & bit) return false;
    if (boxMask[b] & bit) return false;

    // even/odd check
    const pr = parityReq[idx];
    if (pr === 1 && (digit & 1)) return false;
    if (pr === 2 && !(digit & 1)) return false;

    // thermo adjacency check
    const preds = thermoPred[idx];
    for (let i = 0; i < preds.length; i++) {
      const pv = grid[preds[i]];
      if (pv !== 0 && digit <= pv) return false;
    }
    const succ = thermoSucc[idx];
    for (let i = 0; i < succ.length; i++) {
      const sv = grid[succ[i]];
      if (sv !== 0 && digit >= sv) return false;
    }

    // killer cages
    for (let i = 0; i < cagesInCell[idx].length; i++) {
      const cid = cagesInCell[idx][i];
      if (cageUsedMask[cid] & bit) return false;

      const newFilledSum = cageFilledSum[cid] + digit;
      if (newFilledSum > cagesTarget[cid]) return false;

      const emptyAfter = cageEmptyCount[cid] - 1;
      if (emptyAfter < 0) return false;

      if (emptyAfter === 0 && newFilledSum !== cagesTarget[cid]) return false;

      const remainingSum = cagesTarget[cid] - newFilledSum;
      const used2 = cageUsedMask[cid] | bit;
      const availMask = ALL ^ used2;
      const min = MIN_SUM_FROM_AVAIL[availMask * 10 + emptyAfter];
      const max = MAX_SUM_FROM_AVAIL[availMask * 10 + emptyAfter];
      if (min === -1 || remainingSum < min || remainingSum > max) return false;
    }

    // arrow constraints
    // idx is an arrow cell
    const asArrow = arrowsInCell[idx];
    for (let i = 0; i < asArrow.length; i++) {
      const aid = asArrow[i];
      const circleVal = grid[arrowsCircle[aid]];
      const newFilledSum = arrowFilledSum[aid] + digit;
      const emptyAfter = arrowEmptyCount[aid] - 1;
      if (emptyAfter < 0) return false;

      if (circleVal !== 0) {
        if (emptyAfter === 0) {
          if (newFilledSum !== circleVal) return false;
        } else {
          const minTotal = newFilledSum + emptyAfter * 1;
          const maxTotal = newFilledSum + emptyAfter * 9;
          if (circleVal < minTotal || circleVal > maxTotal) return false;
        }
      }
    }
    // idx is the circle cell
    const asCircle = arrowsInCircle[idx];
    for (let i = 0; i < asCircle.length; i++) {
      const aid = asCircle[i];
      const empty = arrowEmptyCount[aid];
      const sum = arrowFilledSum[aid];
      if (empty === 0) {
        if (sum !== digit) return false;
      } else {
        const minTotal = sum + empty * 1;
        const maxTotal = sum + empty * 9;
        if (digit < minTotal || digit > maxTotal) return false;
      }
    }

    // kropki
    const others = kropkiOthers[idx];
    const types = kropkiTypes[idx];
    for (let i = 0; i < others.length; i++) {
      const oidx = others[i];
      const ov = grid[oidx];
      if (ov === 0) continue;
      const t = types[i];
      if (t === 0) {
        if (!(digit === 2 * ov || ov === 2 * digit)) return false;
      } else {
        if (Math.abs(digit - ov) !== 1) return false;
      }
    }

    return true;
  }

  function candidateMask(idx) {
    let m = basicMask(idx);
    if (m === 0) return 0;
    let res = 0;
    let x = m;
    while (x) {
      const bit = x & -x;
      const d = BIT_TO_DIGIT[bit];
      if (d !== 0 && isValidPlacement(idx, d)) res |= bit;
      x ^= bit;
    }
    return res;
  }

  // Stack-based assignment/undo
  const assignStack = [];
  function place(idx, digit) {
    const bit = 1 << digit;
    grid[idx] = digit;
    assignStack.push(idx, digit);
    const r = (idx / 9) | 0;
    const c = idx - r * 9;
    const b = boxIndex(r, c);
    rowMask[r] |= bit;
    colMask[c] |= bit;
    boxMask[b] |= bit;

    // killer state update
    const inC = cagesInCell[idx];
    for (let i = 0; i < inC.length; i++) {
      const cid = inC[i];
      cageUsedMask[cid] |= bit;
      cageFilledSum[cid] += digit;
      cageEmptyCount[cid]--;
    }

    // arrow state update for arrow cells only
    const inA = arrowsInCell[idx];
    for (let i = 0; i < inA.length; i++) {
      const aid = inA[i];
      arrowFilledSum[aid] += digit;
      arrowEmptyCount[aid]--;
    }
  }

  function undo(toSize) {
    while (assignStack.length > toSize) {
      const digit = assignStack.pop();
      const idx = assignStack.pop();
      const bit = 1 << digit;
      grid[idx] = 0;

      const r = (idx / 9) | 0;
      const c = idx - r * 9;
      const b = boxIndex(r, c);
      rowMask[r] &= ~bit;
      colMask[c] &= ~bit;
      boxMask[b] &= ~bit;

      const inC = cagesInCell[idx];
      for (let i = 0; i < inC.length; i++) {
        const cid = inC[i];
        cageUsedMask[cid] &= ~bit;
        cageFilledSum[cid] -= digit;
        cageEmptyCount[cid]++;
      }
      const inA = arrowsInCell[idx];
      for (let i = 0; i < inA.length; i++) {
        const aid = inA[i];
        arrowFilledSum[aid] -= digit;
        arrowEmptyCount[aid]++;
      }
    }
  }

  function findEmptyInCage(cid) {
    const cells = cagesCells[cid];
    for (let i = 0; i < cells.length; i++) if (grid[cells[i]] === 0) return cells[i];
    return -1;
  }

  function findEmptyInArrow(aid) {
    const cells = arrowsCells[aid];
    for (let i = 0; i < cells.length; i++) if (grid[cells[i]] === 0) return cells[i];
    return -1;
  }

  function propagate() {
    let changed = true;
    while (changed) {
      changed = false;

      // Killer forced: exactly one empty cell -> required digit pinned
      for (let cid = 0; cid < cageCount; cid++) {
        if (cageEmptyCount[cid] !== 1) continue;
        const required = cagesTarget[cid] - cageFilledSum[cid];
        if (required < 1 || required > 9) return false;
        const emptyCell = findEmptyInCage(cid);
        if (emptyCell < 0) return false;
        const m = basicMask(emptyCell);
        if (!(m & (1 << required))) return false;
        if (!isValidPlacement(emptyCell, required)) return false;
        if (grid[emptyCell] === 0) {
          place(emptyCell, required);
          changed = true;
        }
      }

      // Arrow forced: if circle assigned and exactly one arrow empty -> pin that digit
      for (let aid = 0; aid < arrowCount; aid++) {
        if (arrowEmptyCount[aid] !== 1) continue;
        const circleVal = grid[arrowsCircle[aid]];
        if (circleVal === 0) continue;
        const required = circleVal - arrowFilledSum[aid];
        if (required < 1 || required > 9) return false;
        const emptyCell = findEmptyInArrow(aid);
        if (emptyCell < 0) return false;
        const m = basicMask(emptyCell);
        if (!(m & (1 << required))) return false;
        if (!isValidPlacement(emptyCell, required)) return false;
        if (grid[emptyCell] === 0) {
          place(emptyCell, required);
          changed = true;
        }
      }

      // Naked singles under basic (classic+evenodd+thermo) filtering.
      for (let idx = 0; idx < 81; idx++) {
        if (grid[idx] !== 0) continue;
        const m = basicMask(idx);
        if (m === 0) return false;
        if (POPCNT[m] === 1) {
          const bit = m & -m;
          const digit = BIT_TO_DIGIT[bit];
          if (!isValidPlacement(idx, digit)) return false;
          place(idx, digit);
          changed = true;
        }
      }
    }
    return true;
  }

  // Initial propagation from givens (killer/arrow forced + thermo/even basics)
  if (!propagate()) return null;

  function dfs() {
    // Find MRV cell
    let bestIdx = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let idx = 0; idx < 81; idx++) {
      if (grid[idx] !== 0) continue;
      const m = candidateMask(idx);
      const cnt = POPCNT[m];
      if (cnt === 0) return false;
      if (cnt < bestCount) {
        bestCount = cnt;
        bestIdx = idx;
        bestMask = m;
        if (cnt === 1) break;
      }
    }
    if (bestIdx === -1) return true; // solved

    // Try candidates in ascending order (bit order gives ascending digits, cheap).
    let x = bestMask;
    while (x) {
      const bit = x & -x;
      const digit = BIT_TO_DIGIT[bit];
      x ^= bit;

      if (!isValidPlacement(bestIdx, digit)) continue;
      const snap = assignStack.length;
      place(bestIdx, digit);
      if (propagate() && dfs()) return true;
      undo(snap);
    }
    return false;
  }

  if (!dfs()) return null;

  // Convert back to 2D
  const out = Array.from({ length: 9 }, () => Array(9).fill(0));
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) out[r][c] = grid[r * 9 + c];
  }
  return out;
}

module.exports = { solvePuzzle };


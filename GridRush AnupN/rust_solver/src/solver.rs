use crate::constraints::*;
use crate::precompute::{KillerTable, PEERS, UNITS};

// ── Constants ────────────────────────────────────────────────────────────────
const ALL:       u16 = 0x1FF; // bits 0-8 → digits 1-9
const EVEN_MASK: u16 = 0x0AA; // digits 2,4,6,8  (bits 1,3,5,7)
const ODD_MASK:  u16 = 0x155; // digits 1,3,5,7,9 (bits 0,2,4,6,8)

// ── Helpers ──────────────────────────────────────────────────────────────────

#[inline(always)]
fn min_digit(mask: u16) -> i32 { mask.trailing_zeros() as i32 + 1 }

#[inline(always)]
fn max_digit(mask: u16) -> i32 { (16 - mask.leading_zeros()) as i32 }

// ── Board ────────────────────────────────────────────────────────────────────

/// Mutable solver state: cell domains + inline undo log (no heap allocation).
///
/// Worst-case undo entries = 81 cells × 81 backtrack levels = 6 561.
pub struct Board {
    pub cells:       [u16; 81],
    pub dirty:       u128, // bits 0-80: cell i changed
    undo_top:        usize,
    undo_stack:      [(u8, u16); 6561],
}

impl Board {
    fn new() -> Self {
        Board {
            cells: [ALL; 81],
            dirty: !0,
            undo_top: 0,
            undo_stack: [(0, 0); 6561],
        }
    }

    #[inline]
    fn snapshot(&self) -> (usize, u128) {
        (self.undo_top, self.dirty)
    }

    #[inline]
    fn restore(&mut self, snap: (usize, u128)) {
        let (top, dirty) = snap;
        while self.undo_top > top {
            self.undo_top -= 1;
            let (i, old) = self.undo_stack[self.undo_top];
            self.cells[i as usize] = old;
        }
        self.dirty = dirty;
    }

    /// Force cell `idx` to exactly the single candidate `bit`.
    fn assign(&mut self, idx: usize, bit: u16) -> bool {
        let cur = self.cells[idx];
        if cur == bit { return true; }
        if cur & bit == 0 { return false; }
        self.eliminate(idx, cur & !bit)
    }

    /// Remove `bits_to_remove` from `start`, then propagate arc-consistency.
    fn eliminate(&mut self, start: usize, bits_to_remove: u16) -> bool {
        if bits_to_remove == 0 { return true; }

        let mut stack     = [0u8; 128];
        let mut to_remove = [0u16; 81];
        let mut top       = 0usize;

        stack[top] = start as u8; top += 1;
        to_remove[start] = bits_to_remove;

        while top > 0 {
            top -= 1;
            let i = stack[top] as usize;
            let removing = to_remove[i];
            to_remove[i] = 0;

            let cur = self.cells[i];
            let nv  = cur & !removing;
            if nv == cur { continue; }
            if nv == 0   { return false; }

            // Record undo entry.
            self.undo_stack[self.undo_top] = (i as u8, cur);
            self.undo_top += 1;
            self.cells[i] = nv;
            self.dirty |= 1u128 << i;

            if nv.count_ones() == 1 {
                for &peer in &PEERS[i] {
                    if self.cells[peer] & nv != 0 {
                        if to_remove[peer] == 0 {
                            if top < 128 {
                                stack[top] = peer as u8; top += 1;
                            } else {
                                // Fallback (shouldn't happen with 81 cells).
                                return false; 
                            }
                        }
                        to_remove[peer] |= nv;
                    }
                }
            }
        }
        true
    }

    /// MRV heuristic: fewest candidates first.
    fn pick_cell(&self) -> Option<usize> {
        let mut best  = None;
        let mut min_b = 10u32;
        for i in 0..81 {
            let b = self.cells[i].count_ones();
            if b <= 1 { continue; }
            if b < min_b {
                min_b = b;
                best  = Some(i);
                if b == 2 { break; } // Good enough
            }
        }
        best
    }
}

// ── Constraint propagation ────────────────────────────────────────────────────

/// Run variant constraints incrementally based on `board.dirty`.
fn propagate_constraints(
    board: &mut Board,
    c: &Constraints,
    cage_combos: &[Vec<u16>],
) -> bool {
    let dirty = board.dirty;
    if dirty == 0 { return true; }
    board.dirty = 0;

    // Even / Odd constraints
    if let Some(eo) = &c.even_odd {
        // Apply EVEN mask to cells that must be even
        for &idx in &eo.even {
            if (dirty >> idx) & 1 != 0 {
                if !board.eliminate(idx, !EVEN_MASK & 0x1FF) { return false; }
            }
        }
        // Apply ODD mask to cells that must be odd
        for &idx in &eo.odd {
            if (dirty >> idx) & 1 != 0 {
                if !board.eliminate(idx, !ODD_MASK & 0x1FF) { return false; }
            }
        }
    }

    // Thermo: Only check chains that have a dirty cell.
    for ThermoChain(chain) in &c.thermo {
        let mut chain_dirty = false;
        for &idx in chain {
            if (dirty >> idx) & 1 != 0 {
                chain_dirty = true;
                break;
            }
        }
        if !chain_dirty { continue; }

        for w in chain.windows(2) {
            let (lo, hi) = (w[0], w[1]);
            let min_lo = min_digit(board.cells[lo]);
            let bad_hi = board.cells[hi] & ((1u16 << min_lo) - 1);
            if bad_hi != 0 && !board.eliminate(hi, bad_hi) { return false; }

            let max_hi = max_digit(board.cells[hi]);
            let bad_lo = board.cells[lo] & !((1u16 << (max_hi - 1)) - 1) & ALL;
            if bad_lo != 0 && !board.eliminate(lo, bad_lo) { return false; }
        }
    }

    // Killer: Only check cages that have a dirty cell.
    for (cage_idx, cage) in c.killer.iter().enumerate() {
        let mut cage_dirty = false;
        for &idx in &cage.cells {
            if (dirty >> idx) & 1 != 0 {
                cage_dirty = true;
                break;
            }
        }
        if !cage_dirty { continue; }

        let idxs   = &cage.cells;
        let mut combined = 0u16;
        let mut must_be  = 0u16;
        for &i in idxs {
            let m = board.cells[i];
            combined |= m;
            if m.count_ones() == 1 { must_be |= m; }
        }

        let mut allowed = 0u16;
        for &combo in &cage_combos[cage_idx] {
            if (combo & combined == combo) && (combo & must_be == must_be) {
                allowed |= combo;
            }
        }
        if allowed == 0 { return false; }
        for &i in idxs {
            let bad = board.cells[i] & !allowed;
            if bad != 0 && !board.eliminate(i, bad) { return false; }
        }
    }

    // Arrow: Only check arrows with dirty cells.
    for arrow in &c.arrow {
        let mut arrow_dirty = (dirty >> arrow.circle) & 1 != 0;
        if !arrow_dirty {
            for &idx in &arrow.cells {
                if (dirty >> idx) & 1 != 0 {
                    arrow_dirty = true;
                    break;
                }
            }
        }
        if !arrow_dirty { continue; }

        let ci = arrow.circle;
        let cells = &arrow.cells;
        let mut min_sum = 0;
        let mut max_sum = 0;
        for &i in cells {
            min_sum += min_digit(board.cells[i]);
            max_sum += max_digit(board.cells[i]);
        }
        if min_sum > 9 { return false; }

        let bad_circle = (board.cells[ci] & ((1u16 << (min_sum - 1)) - 1))
                       | (board.cells[ci] & !((1u16 << max_sum.min(9)) - 1) & ALL);
        if bad_circle != 0 && !board.eliminate(ci, bad_circle) { return false; }

        let c_min = min_digit(board.cells[ci]);
        let c_max = max_digit(board.cells[ci]);

        for &ai in cells {
            let o_min = min_sum - min_digit(board.cells[ai]);
            let o_max = max_sum - max_digit(board.cells[ai]);
            let a_max = (c_max - o_min).min(9);
            let a_min = (c_min - o_max).max(1);
            if a_min > a_max { return false; }
            let allowed = ((1u16 << a_max) - 1) & !((1u16 << (a_min - 1)) - 1);
            let bad = board.cells[ai] & !allowed;
            if bad != 0 && !board.eliminate(ai, bad) { return false; }
        }
    }

    // Kropki: Only check dots with dirty cells.
    for dot in &c.kropki {
        if ((dirty >> dot.a) & 1 == 0) && ((dirty >> dot.b) & 1 == 0) { continue; }
        
        let (i1, i2) = (dot.a, dot.b);
        let (m1, m2) = (board.cells[i1], board.cells[i2]);
        let (a1, a2) = if !dot.black {
            (((m2 << 1) | (m2 >> 1)) & ALL, ((m1 << 1) | (m1 >> 1)) & ALL)
        } else {
            let mut x1 = 0u16;
            if m2 & 0x001 != 0 { x1 |= 0x002; }
            if m2 & 0x002 != 0 { x1 |= 0x009; }
            if m2 & 0x004 != 0 { x1 |= 0x020; }
            if m2 & 0x008 != 0 { x1 |= 0x082; }
            if m2 & 0x020 != 0 { x1 |= 0x004; }
            if m2 & 0x080 != 0 { x1 |= 0x008; }
            let mut x2 = 0u16;
            if m1 & 0x001 != 0 { x2 |= 0x002; }
            if m1 & 0x002 != 0 { x2 |= 0x009; }
            if m1 & 0x004 != 0 { x2 |= 0x020; }
            if m1 & 0x008 != 0 { x2 |= 0x082; }
            if m1 & 0x020 != 0 { x2 |= 0x004; }
            if m1 & 0x080 != 0 { x2 |= 0x008; }
            (x1, x2)
        };
        let (b1, b2) = (m1 & !a1, m2 & !a2);
        if b1 != 0 && !board.eliminate(i1, b1) { return false; }
        if b2 != 0 && !board.eliminate(i2, b2) { return false; }
    }
    true
}

/// Hidden singles: if a digit has only one possible cell in a unit, assign it.
fn hidden_singles(board: &mut Board) -> bool {
    for unit in UNITS.iter() {
        for d in 0..9 {
            let bit = 1u16 << d;
            let mut count = 0u8;
            let mut last  = 0usize;
            for &i in unit {
                if board.cells[i] & bit != 0 {
                    count += 1;
                    last   = i;
                    if count > 1 { break; }
                }
            }
            if count == 0 { return false; }
            if count == 1 && board.cells[last].count_ones() > 1 {
                if !board.assign(last, bit) { return false; }
            }
        }
    }
    true
}

/// Naked pairs: two cells in a unit share exactly the same 2 candidates →
/// eliminate those digits from all other cells in that unit.
fn naked_pairs(board: &mut Board) -> bool {
    // Check all units for now; could be optimized to only dirty units.
    for unit in UNITS.iter() {
        for i in 0..8 {
            let idx1 = unit[i];
            let m1   = board.cells[idx1];
            if m1.count_ones() != 2 { continue; }
            for j in i + 1..9 {
                let idx2 = unit[j];
                if board.cells[idx2] != m1 { continue; }
                for &idx3 in unit {
                    if idx3 == idx1 || idx3 == idx2 { continue; }
                    let bad = board.cells[idx3] & m1;
                    if bad != 0 && !board.eliminate(idx3, bad) { return false; }
                }
            }
        }
    }
    true
}

/// Locked candidates: if all cells in a box that contain digit d lie
/// in a single row/col, eliminate d from the rest of that row/col.
fn pointing_claiming(board: &mut Board) -> bool {
    // Only check boxes 18-26.
    for box_idx in 18..27 {
        // If no cell in this box changed, skip.
        let mut box_dirty = false;
        for &idx in &UNITS[box_idx] {
            if (board.dirty >> idx) & 1 != 0 {
                box_dirty = true;
                break;
            }
        }
        if !box_dirty { continue; }

        let u = &UNITS[box_idx];
        for d in 0..9 {
            let bit  = 1u16 << d;
            let mut rows = 0u16;
            let mut cols = 0u16;
            let mut count = 0;
            for &idx in u {
                if board.cells[idx] & bit != 0 {
                    rows |= 1 << (idx / 9);
                    cols |= 1 << (idx % 9);
                    count += 1;
                }
            }
            if count == 0 { return false; }

            if rows.count_ones() == 1 {
                let r = rows.trailing_zeros() as usize;
                for c in 0..9 {
                    let idx = r * 9 + c;
                    if !u.contains(&idx) && board.cells[idx] & bit != 0 {
                        if !board.eliminate(idx, bit) { return false; }
                    }
                }
            }
            if cols.count_ones() == 1 {
                let c = cols.trailing_zeros() as usize;
                for r in 0..9 {
                    let idx = r * 9 + c;
                    if !u.contains(&idx) && board.cells[idx] & bit != 0 {
                        if !board.eliminate(idx, bit) { return false; }
                    }
                }
            }
        }
    }
    true
}

/// Run constraints + logical pruning to fixpoint.
fn propagate_all(board: &mut Board, c: &Constraints, cage_combos: &[Vec<u16>]) -> bool {
    loop {
        let snap = board.snapshot();
        if !propagate_constraints(board, c, cage_combos) { return false; }
        if !hidden_singles(board)                        { return false; }
        
        // If snapshot hasn't changed (excluding dirty masks), check expensive ones.
        if board.undo_top == snap.0 {
            if !naked_pairs(board)       { return false; }
            if !pointing_claiming(board) { return false; }
            if board.undo_top == snap.0  { break; }
        }
    }
    true
}

// ── Solver ────────────────────────────────────────────────────────────────────

pub struct Solver<'a> {
    board:       Board,
    constraints: &'a Constraints,
    /// Prefiltered combo list per killer cage (computed once at init).
    cage_combos: Vec<Vec<u16>>,
    solutions:   Vec<String>,
    failed:      bool,
}

impl<'a> Solver<'a> {
    pub fn new(grid: [u8; 81], constraints: &'a Constraints, kt: &KillerTable) -> Self {
        let mut board  = Board::new();
        let mut failed = false;
        for i in 0..81 {
            let v = grid[i];
            if v != 0 && !board.assign(i, 1u16 << (v - 1)) {
                failed = true; break;
            }
        }

        // Precompute valid combo sets per cage.
        let cage_combos: Vec<Vec<u16>> = constraints.killer.iter().map(|cage| {
            let len    = cage.cells.len();
            let target = cage.sum;
            if target == 0 || target > 45 || len > 9 { return vec![]; }
            let combined: u16 = cage.cells.iter().fold(0u16, |a, &i| a | board.cells[i]);
            kt[len][target].iter().copied()
                .filter(|&combo| combo & combined == combo)
                .collect()
        }).collect();

        // Initial assignment sets dirty bits. We want propagate_all to run variant
        // constraints on the first call.
        Solver { board, constraints, cage_combos, solutions: Vec::new(), failed }
    }

    pub fn solve(&mut self, find_all: bool) -> &[String] {
        self.solutions.clear();
        if !self.failed
            && propagate_all(&mut self.board, self.constraints, &self.cage_combos)
        {
            self.backtrack(find_all);
        }
        &self.solutions
    }

    fn backtrack(&mut self, find_all: bool) {
        let limit = if find_all { 2 } else { 1 };
        if self.solutions.len() >= limit { return; }

        let Some(idx) = self.board.pick_cell() else {
            // All cells are singletons → record solution.
            let s: String = (0..81)
                .map(|i| (b'0' + self.board.cells[i].trailing_zeros() as u8 + 1) as char)
                .collect();
            self.solutions.push(s);
            return;
        };

        let snap = self.board.snapshot();
        let mask = self.board.cells[idx];

        // LCV: sort candidates by how many peer candidates each one removes.
        // Try least-constraining first → smaller search tree on average.
        let mut cands    = [(0u32, 0u16); 9];
        let mut num_cands = 0usize;
        let mut bits     = mask;
        while bits != 0 {
            let bit = bits & bits.wrapping_neg();
            bits &= bits - 1;
            let score: u32 = PEERS[idx].iter()
                .map(|&p| (self.board.cells[p] & bit != 0) as u32)
                .sum();
            cands[num_cands] = (score, bit);
            num_cands += 1;
        }
        cands[..num_cands].sort_unstable();

        for k in 0..num_cands {
            let (_, bit) = cands[k];
            if self.board.assign(idx, bit)
                && propagate_all(&mut self.board, self.constraints, &self.cage_combos)
            {
                self.backtrack(find_all);
            }
            self.board.restore(snap);
            if self.solutions.len() >= limit { return; }
        }
    }
}

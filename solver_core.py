"""
solver_core.py  —  Hyper-optimised Sudoku variant solver
=========================================================
Designed for PyPy3 + multiprocessing + orjson pipeline.
"""

import sys
from collections import defaultdict

# ── Global lookup tables ─────────────────────────────────────────────────────

_ROW  = [i // 9 for i in range(81)]
_COL  = [i %  9 for i in range(81)]
_BOX  = [(i // 9 // 3) * 3 + (i % 9 // 3) for i in range(81)]

def _build_peers():
    peers = [None] * 81
    for i in range(81):
        r, c, b = _ROW[i], _COL[i], _BOX[i]
        p = set()
        for j in range(81):
            if j != i and (_ROW[j] == r or _COL[j] == c or _BOX[j] == b):
                p.add(j)
        peers[i] = tuple(p)          # tuple is faster to iterate in PyPy
    return peers

_PEERS = _build_peers()

# Digit bitmasks: digit d  →  1 << d   (d in 1..9, bit 0 unused)
_BIT = [0] + [1 << d for d in range(1, 10)]   # _BIT[d]
_ALL = sum(_BIT[1:10])                          # 0b1111111110  (bits 1-9 set)

# Even / odd bitmasks
_EVEN_MASK = _BIT[2] | _BIT[4] | _BIT[6] | _BIT[8]
_ODD_MASK  = _BIT[1] | _BIT[3] | _BIT[5] | _BIT[7] | _BIT[9]

# Constraint type flags
_C_THERMO = 1
_C_ARROW  = 2
_C_KILLER = 4
_C_KROPKI = 8
_C_PARITY = 16


# ── Puzzle state container ────────────────────────────────────────────────────

class PuzzleState:
    """
    All mutable state for one solve. Kept in plain Python arrays so PyPy's
    JIT can specialise them as integer arrays.
    """
    __slots__ = (
        'grid',          # flat int array len=81, values 0-9
        'candidates',    # int bitmask per cell (bits 1-9)
        'row_used',      
        'col_used',      
        'box_used',      
        'cell_flags',    # per-cell constraint type bitmask
        'parity_mask',   # per-cell allowed-digit bitmask (0 = no constraint)
        'thermo_data',   
        'thermo_pos',    
        'arrow_data',    
        'arrow_member',  
        'killer_data',   
        'killer_sum',    # current partial sum per cage
        'killer_fill',   # count of filled cells per cage
        'killer_member', 
        'kropki_data',   
        'kropki_member', 
    )

    def __init__(self):
        self.grid         = [0] * 81
        self.candidates   = [_ALL] * 81
        self.row_used     = [0] * 9
        self.col_used     = [0] * 9
        self.box_used     = [0] * 9
        self.cell_flags   = [0] * 81
        self.parity_mask  = [0] * 81
        self.thermo_data  = []
        self.thermo_pos   = defaultdict(list)
        self.arrow_data   = []
        self.arrow_member = defaultdict(list)
        self.killer_data  = []
        self.killer_sum   = []
        self.killer_fill  = []
        self.killer_member= defaultdict(list)
        self.kropki_data  = []
        self.kropki_member= defaultdict(list)


# ── Puzzle builder ────────────────────────────────────────────────────────────

def build_puzzle(puzzle_dict):
    ps = PuzzleState()

    # Load grid
    rows = puzzle_dict['grid']['rows']
    for r in range(9):
        for c in range(9):
            v = rows[r][c]
            idx = r * 9 + c
            if v != 0:
                _place(ps, idx, v)   # updates bitmasks immediately

    constraints = puzzle_dict.get('constraints', {})

    # Even / Odd
    eo = constraints.get('even_odd', {})
    for cell in eo.get('even_cells', []):
        idx = cell['row'] * 9 + cell['col']
        ps.parity_mask[idx] = _EVEN_MASK
        ps.cell_flags[idx] |= _C_PARITY
    for cell in eo.get('odd_cells', []):
        idx = cell['row'] * 9 + cell['col']
        ps.parity_mask[idx] = _ODD_MASK
        ps.cell_flags[idx] |= _C_PARITY

    # Thermo
    for thermo in constraints.get('thermo', {}).get('thermometers', []):
        seq = tuple(cell['row'] * 9 + cell['col'] for cell in thermo['cells'])
        tid = len(ps.thermo_data)
        ps.thermo_data.append(seq)
        for pos, idx in enumerate(seq):
            ps.thermo_pos[idx].append((tid, pos))
            ps.cell_flags[idx] |= _C_THERMO

    # Arrow
    for arrow in constraints.get('arrow', {}).get('arrows', []):
        circle = arrow['circle']['row'] * 9 + arrow['circle']['col']
        stem   = tuple(cell['row'] * 9 + cell['col'] for cell in arrow['arrow_cells'])
        aid    = len(ps.arrow_data)
        ps.arrow_data.append((circle, stem))
        ps.arrow_member[circle].append(aid)
        for idx in stem:
            ps.arrow_member[idx].append(aid)
            ps.cell_flags[idx] |= _C_ARROW
        ps.cell_flags[circle] |= _C_ARROW

    # Killer
    for cage in constraints.get('killer', {}).get('cages', []):
        cells  = tuple(cell['row'] * 9 + cell['col'] for cell in cage['cells'])
        target = cage['sum']
        kid    = len(ps.killer_data)
        ps.killer_data.append((target, cells))
        partial = sum(ps.grid[c] for c in cells)
        filled  = sum(1 for c in cells if ps.grid[c] != 0)
        ps.killer_sum.append(partial)
        ps.killer_fill.append(filled)
        for idx in cells:
            ps.killer_member[idx].append(kid)
            ps.cell_flags[idx] |= _C_KILLER

    # Kropki
    for dot in constraints.get('kropki', {}).get('dots', []):
        a   = dot['cell_a']['row'] * 9 + dot['cell_a']['col']
        b   = dot['cell_b']['row'] * 9 + dot['cell_b']['col']
        typ = dot['type']          # 'black' or 'white'
        kid = len(ps.kropki_data)
        ps.kropki_data.append((a, b, typ))
        ps.kropki_member[a].append(kid)
        ps.kropki_member[b].append(kid)
        ps.cell_flags[a] |= _C_KROPKI
        ps.cell_flags[b] |= _C_KROPKI

    # Apply parity to initial candidates
    for idx in range(81):
        if ps.parity_mask[idx]:
            ps.candidates[idx] &= ps.parity_mask[idx]

    return ps


# ── Incremental placement helpers ────────────────────────────────────────────

def _place(ps, idx, digit):
    ps.grid[idx] = digit
    bit = _BIT[digit]
    ps.row_used[_ROW[idx]] |= bit
    ps.col_used[_COL[idx]] |= bit
    ps.box_used[_BOX[idx]] |= bit
    for peer in _PEERS[idx]:
        ps.candidates[peer] &= ~bit

def _unplace(ps, idx, digit, saved_candidates):
    ps.grid[idx] = 0
    bit = _BIT[digit]
    ps.row_used[_ROW[idx]] &= ~bit
    ps.col_used[_COL[idx]] &= ~bit
    ps.box_used[_BOX[idx]] &= ~bit
    for peer, cand in saved_candidates:
        ps.candidates[peer] = cand
    ps.candidates[idx] = saved_candidates[-1][1]


# ── Constraint checkers ──────────────────────────────────────────────────────

def _check_thermo(ps, idx, digit):
    for (tid, pos) in ps.thermo_pos[idx]:
        seq = ps.thermo_data[tid]
        for i in range(pos):
            v = ps.grid[seq[i]]
            if v != 0 and v >= digit:
                return False
        for i in range(pos + 1, len(seq)):
            v = ps.grid[seq[i]]
            if v != 0 and v <= digit:
                return False
    return True

def _check_arrow(ps, idx, digit):
    old = ps.grid[idx]
    ps.grid[idx] = digit
    ok = True
    for aid in ps.arrow_member[idx]:
        circle_idx, stem = ps.arrow_data[aid]
        circle_val = ps.grid[circle_idx]
        stem_sum   = 0
        stem_fill  = 0
        for si in stem:
            v = ps.grid[si]
            if v:
                stem_sum  += v
                stem_fill += 1
        if circle_val:
            if stem_sum > circle_val:
                ok = False
                break
            if stem_fill == len(stem) and stem_sum != circle_val:
                ok = False
                break
        elif stem_sum > 9:
            ok = False
            break
    ps.grid[idx] = old
    return ok

def _check_killer(ps, idx, digit):
    for kid in ps.killer_member[idx]:
        target, cells = ps.killer_data[kid]
        new_sum  = ps.killer_sum[kid]  + digit
        new_fill = ps.killer_fill[kid] + 1
        if new_sum > target:
            return False
        if new_fill == len(cells) and new_sum != target:
            return False
        for ci in cells:
            if ci != idx and ps.grid[ci] == digit:
                return False
    return True

def _check_kropki(ps, idx, digit):
    for kid in ps.kropki_member[idx]:
        a, b, typ = ps.kropki_data[kid]
        other_idx = b if idx == a else a
        other_val = ps.grid[other_idx]
        if other_val == 0:
            continue
        if typ == 'black':
            if digit != other_val * 2 and other_val != digit * 2:
                return False
        else:
            if abs(digit - other_val) != 1:
                return False
    return True


# ── Candidate computation ────────────────────────────────────────────────────

def _get_valid_candidates(ps, idx):
    cands = ps.candidates[idx]
    if not cands:
        return 0

    flags = ps.cell_flags[idx]
    result = 0
    mask   = cands
    while mask:
        lsb    = mask & (-mask)
        mask  &= mask - 1
        digit  = lsb.bit_length() - 1   # BUG FIX: align bit index with digit

        ok = True
        if flags & _C_THERMO and not _check_thermo(ps, idx, digit):
            ok = False
        elif flags & _C_ARROW  and not _check_arrow(ps, idx, digit):
            ok = False
        elif flags & _C_KILLER and not _check_killer(ps, idx, digit):
            ok = False
        elif flags & _C_KROPKI and not _check_kropki(ps, idx, digit):
            ok = False

        if ok:
            result |= lsb

    return result


# ── MRV cell selector ────────────────────────────────────────────────────────

def _mrv_cell(ps):
    best_idx   = -1
    best_count = 10
    for idx in range(81):
        if ps.grid[idx] != 0:
            continue
        c = bin(ps.candidates[idx]).count('1')
        if c < best_count:
            best_count = c
            best_idx   = idx
            if c == 1:
                break
    return best_idx


# ── Killer incremental update helpers ────────────────────────────────────────

def _killer_place(ps, idx, digit):
    for kid in ps.killer_member[idx]:
        ps.killer_sum[kid]  += digit
        ps.killer_fill[kid] += 1

def _killer_unplace(ps, idx, digit):
    for kid in ps.killer_member[idx]:
        ps.killer_sum[kid]  -= digit
        ps.killer_fill[kid] -= 1


# ── Core backtracking solver ─────────────────────────────────────────────────

def _solve(ps):
    idx = _mrv_cell(ps)
    if idx == -1:
        return True

    valid = _get_valid_candidates(ps, idx)
    if not valid:
        return False

    peers = _PEERS[idx]
    mask = valid
    while mask:
        lsb    = mask & (-mask)
        mask  &= mask - 1
        digit  = lsb.bit_length() - 1   # BUG FIX: align bit index with digit

        saved = [(p, ps.candidates[p]) for p in peers if ps.candidates[p] & lsb]
        saved.append((idx, ps.candidates[idx]))

        _place(ps, idx, digit)
        _killer_place(ps, idx, digit)

        if _solve(ps):
            return True

        _killer_unplace(ps, idx, digit)
        _unplace(ps, idx, digit, saved)

    return False


# ── Public API ───────────────────────────────────────────────────────────────

def solve_puzzle(puzzle_dict):
    ps = build_puzzle(puzzle_dict)

    changed = True
    while changed:
        changed = False
        for idx in range(81):
            if ps.grid[idx] != 0:
                continue
            valid = _get_valid_candidates(ps, idx)
            if not valid:
                return None
            if valid & (valid - 1) == 0:
                digit = valid.bit_length() - 1   # BUG FIX: align bit index with digit
                _place(ps, idx, digit)
                _killer_place(ps, idx, digit)
                changed = True

    if not _solve(ps):
        return None

    return [ps.grid[r*9 : r*9+9] for r in range(9)]


def solve_puzzle_batch(puzzles):
    results = []
    for p in puzzles:
        pid   = p.get('id', '?')
        grid  = p['grid'].get('rows')
        if not grid:
            results.append((pid, None))
            continue
        solved = solve_puzzle(p)
        results.append((pid, solved))
    return results
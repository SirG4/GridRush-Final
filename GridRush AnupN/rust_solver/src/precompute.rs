/// For each of the 81 cells, its 20 unique peers (row ∪ col ∪ box, excluding self).
pub const PEERS: [[usize; 20]; 81] = build_peers();

const fn build_peers() -> [[usize; 20]; 81] {
    let mut peers = [[0usize; 20]; 81];
    let mut i = 0;
    while i < 81 {
        let r = i / 9;
        let c = i % 9;
        let br = (r / 3) * 3;
        let bc = (c / 3) * 3;
        let mut set = [false; 81];
        let mut cc = 0;
        while cc < 9 { set[r * 9 + cc] = true; cc += 1; }
        let mut rr = 0;
        while rr < 9 { set[rr * 9 + c] = true; rr += 1; }
        let mut dr = 0;
        while dr < 3 {
            let mut dc = 0;
            while dc < 3 {
                set[(br + dr) * 9 + (bc + dc)] = true;
                dc += 1;
            }
            dr += 1;
        }
        set[i] = false;
        let mut k = 0;
        let mut j = 0;
        while j < 81 {
            if set[j] { peers[i][k] = j; k += 1; }
            j += 1;
        }
        i += 1;
    }
    peers
}

/// 27 units: rows 0-8, cols 9-17, boxes 18-26.
pub const UNITS: [[usize; 9]; 27] = build_units();

const fn build_units() -> [[usize; 9]; 27] {
    let mut u = [[0usize; 9]; 27];
    let mut r = 0;
    while r < 9 {
        let mut c = 0;
        while c < 9 { u[r][c] = r * 9 + c; c += 1; }
        r += 1;
    }
    let mut c = 0;
    while c < 9 {
        let mut rr = 0;
        while rr < 9 { u[9 + c][rr] = rr * 9 + c; rr += 1; }
        c += 1;
    }
    let mut br = 0;
    while br < 3 {
        let mut bc = 0;
        while bc < 3 {
            let ui = 18 + br * 3 + bc;
            let mut k = 0;
            let mut dr = 0;
            while dr < 3 {
                let mut dc = 0;
                while dc < 3 {
                    u[ui][k] = (br * 3 + dr) * 9 + (bc * 3 + dc);
                    k += 1;
                    dc += 1;
                }
                dr += 1;
            }
            bc += 1;
        }
        br += 1;
    }
    u
}

/// KILLER_TABLE[length][sum] = Vec of 9-bit bitmasks for all valid digit subsets.
/// length 1-9, sum 1-45.
pub type KillerTable = Vec<Vec<Vec<u16>>>;

pub fn build_killer_table() -> KillerTable {
    let mut table: KillerTable = vec![vec![vec![]; 46]; 10];
    fill_killer(&mut table, 0u16, 0usize, 0usize, 1usize);
    table
}

fn fill_killer(table: &mut KillerTable, mask: u16, total: usize, len: usize, start: usize) {
    if len > 0 && total <= 45 {
        table[len][total].push(mask);
    }
    if len == 9 { return; }
    for d in start..=9 {
        fill_killer(table, mask | (1u16 << (d - 1)), total + d, len + 1, d + 1);
    }
}

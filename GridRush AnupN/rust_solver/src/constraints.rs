use serde_json::Value;

fn cell_idx(v: &Value) -> usize {
    let r = v["row"].as_u64().unwrap_or(0) as usize;
    let c = v["col"].as_u64().unwrap_or(0) as usize;
    r * 9 + c
}

#[derive(Default, Clone)]
pub struct EvenOdd {
    pub even: Vec<usize>,
    pub odd:  Vec<usize>,
}

#[derive(Clone)]
pub struct ThermoChain(pub Vec<usize>);

#[derive(Clone)]
pub struct KillerCage {
    pub cells: Vec<usize>,
    pub sum:   usize,
}

#[derive(Clone)]
pub struct ArrowConstraint {
    pub circle: usize,
    pub cells:  Vec<usize>,
}

#[derive(Clone)]
pub struct KropkiDot {
    pub a:     usize,
    pub b:     usize,
    pub black: bool,
}

#[derive(Default, Clone)]
pub struct Constraints {
    pub even_odd: Option<EvenOdd>,
    pub thermo:   Vec<ThermoChain>,
    pub killer:   Vec<KillerCage>,
    pub arrow:    Vec<ArrowConstraint>,
    pub kropki:   Vec<KropkiDot>,
}

pub fn parse_constraints(raw: &Value) -> Constraints {
    let mut c = Constraints::default();

    if let Some(eo) = raw.get("even_odd") {
        let even = eo["even_cells"].as_array()
            .map(|a| a.iter().map(cell_idx).collect())
            .unwrap_or_default();
        let odd = eo["odd_cells"].as_array()
            .map(|a| a.iter().map(cell_idx).collect())
            .unwrap_or_default();
        c.even_odd = Some(EvenOdd { even, odd });
    }

    if let Some(th) = raw.get("thermo") {
        if let Some(arr) = th["thermometers"].as_array() {
            for t in arr {
                let chain: Vec<usize> = if t.is_array() {
                    // Shorthand: [[{row, col}, ...]]
                    t.as_array()
                        .map(|a| a.iter().map(cell_idx).collect())
                        .unwrap_or_default()
                } else {
                    // Original: [{"cells": [{row, col}, ...]}]
                    t["cells"].as_array()
                        .map(|a| a.iter().map(cell_idx).collect())
                        .unwrap_or_default()
                };
                if chain.len() >= 2 { c.thermo.push(ThermoChain(chain)); }
            }
        }
    }

    if let Some(kl) = raw.get("killer") {
        if let Some(arr) = kl["cages"].as_array() {
            for cage in arr {
                let cells: Vec<usize> = cage["cells"].as_array()
                    .map(|a| a.iter().map(cell_idx).collect())
                    .unwrap_or_default();
                let sum = cage["sum"].as_u64().unwrap_or(0) as usize;
                if !cells.is_empty() { c.killer.push(KillerCage { cells, sum }); }
            }
        }
    }

    if let Some(ar) = raw.get("arrow") {
        if let Some(arr) = ar["arrows"].as_array() {
            for a in arr {
                let circle = cell_idx(&a["circle"]);
                let cells: Vec<usize> = a["arrow_cells"].as_array()
                    .map(|v| v.iter().map(cell_idx).collect())
                    .unwrap_or_default();
                if !cells.is_empty() { c.arrow.push(ArrowConstraint { circle, cells }); }
            }
        }
    }

    if let Some(kr) = raw.get("kropki") {
        if let Some(arr) = kr["dots"].as_array() {
            for dot in arr {
                let a     = cell_idx(&dot["cell_a"]);
                let b     = cell_idx(&dot["cell_b"]);
                let black = dot["type"].as_str().unwrap_or("") == "black";
                c.kropki.push(KropkiDot { a, b, black });
            }
        }
    }

    c
}

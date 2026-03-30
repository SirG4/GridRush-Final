mod constraints;
mod precompute;
mod solver;

use constraints::parse_constraints;
use precompute::build_killer_table;
use solver::Solver;
use rayon::prelude::*;
use std::{env, fs, time::Instant};

fn main() {
    let path = env::args().nth(1).unwrap_or_else(|| "questions.json".to_string());

    let data = fs::read_to_string(&path).unwrap_or_else(|e| {
        eprintln!("Error reading '{}': {}", path, e);
        std::process::exit(1);
    });

    let json: serde_json::Value = serde_json::from_str(&data).unwrap_or_else(|e| {
        eprintln!("JSON parse error: {}", e);
        std::process::exit(1);
    });

    let puzzles_val = json["puzzles"].as_array().unwrap_or_else(|| {
        eprintln!("No 'puzzles' array found in input.");
        std::process::exit(1);
    });

    if puzzles_val.is_empty() {
        eprintln!("No puzzles found in input.");
        std::process::exit(1);
    }

    // Build killer combo table once (shared across all puzzles).
    let kt = build_killer_table();

    let results: Vec<_> = puzzles_val.par_iter().map(|puzzle| {
        let pid = puzzle["id"].as_str().unwrap_or("?").to_string();
        let pname = puzzle["name"].as_str().unwrap_or("?").to_string();
        let difficulty = puzzle["difficulty"].as_str().unwrap_or("unknown").to_string();
        let active_constraints = puzzle["active_constraints"].clone();

        let mut grid = [0u8; 81];
        if let Some(rows) = puzzle["grid"]["rows"].as_array() {
            for (r, row) in rows.iter().enumerate() {
                if let Some(cols) = row.as_array() {
                    for (c, cell) in cols.iter().enumerate() {
                        if r < 9 && c < 9 {
                            grid[r * 9 + c] = cell.as_u64().unwrap_or(0) as u8;
                        }
                    }
                }
            }
        }

        let constraints = parse_constraints(&puzzle["constraints"]);
        let t0 = Instant::now();
        let mut solver = Solver::new(grid, &constraints, &kt);
        let solutions = solver.solve(true).to_vec();
        let duration = t0.elapsed();
        (pid, pname, difficulty, active_constraints, solutions, duration)
    }).collect();

    let mut answers = Vec::new();

    for (n, (pid, pname, difficulty, active_constraints, solutions, duration)) in results.into_iter().enumerate() {
        if n > 0 { println!(); }
        let ms = duration.as_secs_f64() * 1000.0;
        println!("=== {}: {} ({:.3} ms) ===", pid, pname, ms);

        let mut answer_obj = serde_json::json!({
            "id": pid,
            "name": pname,
            "difficulty": difficulty,
            "active_constraints": active_constraints,
        });

        if solutions.is_empty() {
            println!("No solution found.");
            answer_obj["grid"] = serde_json::json!({
                "_comment": "No solution found for this puzzle."
            });
        } else if solutions.len() > 1 {
            println!("(Multiple solutions exist)");
            answer_obj["grid"] = serde_json::json!({
                "_comment": "This puzzle has multiple solutions."
            });
        } else {
            let s = &solutions[0];
            let bytes = s.as_bytes();
            let mut rows = Vec::new();
            for r in 0..9 {
                let mut row = Vec::new();
                for c in 0..9 {
                    row.push((bytes[r * 9 + c] - b'0') as u8);
                }
                rows.push(row);
                println!("{}", &s[r * 9..r * 9 + 9]);
            }
            answer_obj["grid"] = serde_json::json!({
                "_comment": "9x9 grid. Use 0 for empty cells.",
                "rows": rows
            });
        }
        answers.push(answer_obj);
    }

    let output = serde_json::json!({ "answers": answers });
    let mut output_str = serde_json::to_string_pretty(&output).unwrap();

    // Post-processing to match answerTemplate.json visual style:
    //   1. Collapse active_constraints arrays onto one line.
    //   2. Collapse sudoku rows onto one line with 3x3 double-space grouping.
    //   3. Insert blank lines between the 3 row bands (after row indices 2 and 5).
    //   4. Insert blank line after "answers": [ opener.
    //   5. Insert blank line between top-level answer objects (after each "},").
    output_str = collapse_arrays(&output_str);
    output_str = insert_band_breaks(&output_str);
    output_str = insert_answer_spacing(&output_str);

    fs::write("answer.json", output_str).expect("Unable to write answer.json");
}

/// Collapses multi-line arrays into single lines where appropriate:
///   - active_constraints: ["a", "b"]  →  "active_constraints": [ "a", "b" ]
///   - 9-element numeric rows          →  [1, 2, 3,  4, 5, 6,  7, 8, 9]
fn collapse_arrays(s: &str) -> String {
    fn fmt_sudoku_row(items: &[&str], trailing_comma: bool) -> String {
        let mut out = format!(
            "[{}, {}, {},  {}, {}, {},  {}, {}, {}]",
            items[0], items[1], items[2],
            items[3], items[4], items[5],
            items[6], items[7], items[8]
        );
        if trailing_comma { out.push(','); }
        out
    }

    fn fmt_short_array(items: &[&str], trailing_comma: bool) -> String {
        let mut out = format!("[{}]", items.join(", "));
        if trailing_comma { out.push(','); }
        out
    }

    let lines: Vec<&str> = s.lines().collect();
    let mut result = String::new();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        let indent = line.len() - line.trim_start().len();
        let indent_str = &line[..indent];

        // Detect a line ending with "[" — potential collapsible array opener.
        if trimmed.ends_with('[') {
            let mut j = i + 1;
            let mut items: Vec<&str> = Vec::new();
            let mut can_collapse = true;

            while j < lines.len() {
                let next = lines[j].trim();
                if next == "]" || next == "]," {
                    break;
                }
                // Nested structures: cannot collapse this level.
                if next.contains('[') || next.contains(']') || next.contains('{') {
                    can_collapse = false;
                    break;
                }
                items.push(next.trim_end_matches(',').trim());
                j += 1;
            }

            let closing = if j < lines.len() { lines[j].trim() } else { "" };
            let has_trailing_comma = closing == "],";

            if can_collapse && !items.is_empty() && j < lines.len() {
                let is_sudoku_row = items.len() == 9
                    && items.iter().all(|p| p.chars().all(|c| c.is_ascii_digit()));
                let is_active_constraints = trimmed.contains("\"active_constraints\"");

                let collapsed = if is_sudoku_row {
                    format!("{}{}", indent_str, fmt_sudoku_row(&items, has_trailing_comma))
                } else if is_active_constraints {
                    let key_part = trimmed.trim_end_matches('[').trim_end();
                    format!("{}{} {}", indent_str, key_part, fmt_short_array(&items, has_trailing_comma))
                } else {
                    let key_part = trimmed.trim_end_matches('[').trim_end();
                    if key_part.is_empty() {
                        format!("{}[ {} ]{}", indent_str, items.join(", "),
                            if has_trailing_comma { "," } else { "" })
                    } else {
                        format!("{}{} [ {} ]{}", indent_str, key_part, items.join(", "),
                            if has_trailing_comma { "," } else { "" })
                    }
                };

                result.push_str(&collapsed);
                result.push('\n');
                i = j + 1;
                continue;
            }
        }

        result.push_str(line);
        result.push('\n');
        i += 1;
    }
    result
}

/// Inserts a blank line after the 3rd and 6th sudoku rows inside every "rows" block,
/// creating the 3x3 band visual separation seen in the template.
///
/// Strategy: scan for the `"rows": [` opener, then count collapsed row lines
/// (lines that start with `[` and contain only digits/spaces/commas) and insert
/// a blank line after indices 2 and 5 (0-based).
fn insert_band_breaks(s: &str) -> String {
    fn is_sudoku_row_line(line: &str) -> bool {
        let t = line.trim();
        if !t.starts_with('[') { return false; }
        let inner = t.trim_start_matches('[').trim_end_matches("],").trim_end_matches(']');
        let parts: Vec<&str> = inner.split(',').map(|p| p.trim()).collect();
        parts.len() == 9 && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit()))
    }

    let lines: Vec<&str> = s.lines().collect();
    let mut result = String::new();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        // Detect the start of a rows block.
        if trimmed == "\"rows\": [" || trimmed == "\"rows\": [ " {
            result.push_str(line);
            result.push('\n');
            i += 1;

            // Collect and emit rows, inserting blank lines after row 2 and row 5.
            let mut row_count = 0;
            while i < lines.len() {
                let row_line = lines[i];
                let row_trimmed = row_line.trim();

                // End of the rows array.
                if row_trimmed == "]" || row_trimmed == "]," {
                    result.push_str(row_line);
                    result.push('\n');
                    i += 1;
                    break;
                }

                if is_sudoku_row_line(row_line) {
                    result.push_str(row_line);
                    result.push('\n');
                    row_count += 1;
                    // Insert blank line after the 3rd row (index 2) and 6th row (index 5).
                    if row_count == 3 || row_count == 6 {
                        result.push('\n');
                    }
                    i += 1;
                } else {
                    // Non-row line inside the block (shouldn't happen after collapse, but pass through).
                    result.push_str(row_line);
                    result.push('\n');
                    i += 1;
                }
            }
            continue;
        }

        result.push_str(line);
        result.push('\n');
        i += 1;
    }
    result
}

/// Inserts:
///   - One blank line after the `"answers": [` opener.
///   - One blank line after each `},` that closes a top-level answer object
///     (identified by being at 4-space indent, i.e. the outermost object level).
fn insert_answer_spacing(s: &str) -> String {
    let lines: Vec<&str> = s.lines().collect();
    let mut result = String::new();

    for line in &lines {
        result.push_str(line);
        result.push('\n');

        // Blank line after the answers array opener.
        if line.trim() == "\"answers\": [" {
            result.push('\n');
            continue;
        }

        // Blank line after a closing brace of a top-level answer object.
        // serde_json pretty-prints top-level array items at 4-space indent,
        // so "    }," is exactly a top-level object close.
        if *line == "    }," {
            result.push('\n');
        }
    }
    result
}
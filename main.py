import os
import time
import orjson
import multiprocessing
from solver_core import solve_puzzle_batch

def chunk_list(data, num_chunks):
    """Splits the puzzles into roughly equal chunks for each CPU core."""
    chunk_size = max(1, len(data) // num_chunks)
    return [data[i:i + chunk_size] for i in range(0, len(data), chunk_size)]

def main():
    start_time = time.perf_counter()

    # 1. Read the input using blazing fast orjson [cite: 56, 60]
    input_path = 'questions.json'
    # Fallback in case the grader puts it one directory up [cite: 58]
    if not os.path.exists(input_path):
        input_path = '../questions.json'

    with open(input_path, 'rb') as f:
        # Assuming the JSON is a list of puzzle dicts or under a specific key.
        # Adjust if the template.json wraps the puzzles in a "puzzles" key.
        data = orjson.loads(f.read())
        
    puzzles = data if isinstance(data, list) else data.get('puzzles', [])

    # 2. Bypass the GIL using all available CPU cores
    num_cores = multiprocessing.cpu_count()
    chunks = chunk_list(puzzles, num_cores)

    # 3. Spin up the multiprocessing pool
    final_results = []
    with multiprocessing.Pool(processes=num_cores) as pool:
        # map returns results in the exact same order they were submitted
        results = pool.map(solve_puzzle_batch, chunks)
        
        # Flatten the list of lists returned by the workers
        for process_result in results:
            final_results.extend(process_result)

    # 4. Extract just the grids for the final answer format [cite: 61]
    # The solver returns (id, solved_grid). We just need the grids.
    rows_output = [res[1] for res in final_results]

    # 5. Write to answer.json exactly as the judges requested [cite: 61]
    output_data = {
        "rows": rows_output
    }

    with open('answer.json', 'wb') as f:
        f.write(orjson.dumps(output_data))

    end_time = time.perf_counter()
    print(f"Total Execution Time: {end_time - start_time:.4f} seconds")

if __name__ == '__main__':
    # Required for Windows multiprocessing to work safely
    multiprocessing.freeze_support() 
    main()
#!/usr/bin/env python3
"""
Pre-compress web assets for embedded serving with gzip compression.
This script compresses .html, .js, and .css files in the src/web directory.
"""

import gzip
import os
import sys
from pathlib import Path

def compress_file(input_path, output_path_gz):
    """Compress a file using gzip with maximum compression."""
    # Use single extension format (.htmlgz instead of .html.gz) for ESP-IDF compatibility
    output_path = str(output_path_gz).replace('.html.gz', '.htmlgz').replace('.js.gz', '.jsgz').replace('.css.gz', '.cssgz')

    with open(input_path, 'rb') as f_in:
        with gzip.open(output_path, 'wb', compresslevel=9) as f_out:
            f_out.writelines(f_in)

    original_size = os.path.getsize(input_path)
    compressed_size = os.path.getsize(output_path)
    savings = 100 - (compressed_size * 100 / original_size)

    return original_size, compressed_size, savings

def main():
    # Get the project root directory (two levels up from scripts/)
    script_dir = Path(__file__).parent
    project_dir = script_dir.parent
    web_dir = project_dir / 'src' / 'web'

    if not web_dir.exists():
        print(f"Error: Web directory not found: {web_dir}")
        sys.exit(1)

    print("Pre-compressing web assets...")
    print("=" * 70)

    # File extensions to compress
    extensions = ['.html', '.js', '.css']

    total_original = 0
    total_compressed = 0
    files_compressed = 0

    # Process each file
    for ext in extensions:
        for file_path in web_dir.glob(f'*{ext}'):
            output_path = file_path.with_suffix(file_path.suffix + '.gz')

            try:
                orig_size, comp_size, savings = compress_file(file_path, output_path)
                total_original += orig_size
                total_compressed += comp_size
                files_compressed += 1

                print(f"{file_path.name:25s} {orig_size:8,d} → {comp_size:8,d} bytes ({savings:5.1f}% saved)")
            except Exception as e:
                print(f"Error compressing {file_path.name}: {e}")
                sys.exit(1)

    print("=" * 70)

    if files_compressed > 0:
        total_savings = 100 - (total_compressed * 100 / total_original)
        print(f"Compressed {files_compressed} files")
        print(f"Total: {total_original:,d} → {total_compressed:,d} bytes ({total_savings:.1f}% saved)")
        print(f"Flash savings: {total_original - total_compressed:,d} bytes")
    else:
        print("No files found to compress")

    return 0

if __name__ == '__main__':
    sys.exit(main())

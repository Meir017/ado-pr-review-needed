"""Move .ts files to subdirectories and rewrite all relative imports."""
import os, re, sys, subprocess, json

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src")

def new_path_of(abs_path, moves):
    return moves.get(os.path.normpath(abs_path), os.path.normpath(abs_path))

def resolve_import(from_file, import_path):
    from_dir = os.path.dirname(from_file)
    ts_path = re.sub(r'\.js$', '.ts', import_path)
    return os.path.normpath(os.path.join(from_dir, ts_path))

def make_relative(from_file, to_file):
    from_dir = os.path.dirname(from_file)
    rel = os.path.relpath(to_file, from_dir).replace('\\', '/')
    rel = re.sub(r'\.ts$', '.js', rel)
    if not rel.startswith('.'):
        rel = './' + rel
    return rel

def run(moves_raw):
    # Normalize all paths
    moves = {}
    for old, new in moves_raw.items():
        moves[os.path.normpath(old)] = os.path.normpath(new)

    # Collect all .ts files
    all_files = []
    for root, dirs, files in os.walk(BASE):
        for f in files:
            if f.endswith('.ts') and not f.endswith('.d.ts'):
                all_files.append(os.path.normpath(os.path.join(root, f)))

    # Step 1: Read content and compute new imports
    updates = {}  # old_abs -> (new_abs, new_content)
    for old_abs in all_files:
        new_abs = new_path_of(old_abs, moves)
        with open(old_abs, 'r', encoding='utf-8') as fh:
            content = fh.read()

        def replace_import(match, _old=old_abs, _new=new_abs):
            import_path = match.group(1)
            target_abs = resolve_import(_old, import_path)
            new_target = new_path_of(target_abs, moves)
            new_rel = make_relative(_new, new_target)
            return match.group(0).replace(import_path, new_rel)

        new_content = re.sub(r'from "(\.\.?/[^"]+\.js)"', replace_import, content)
        if new_content != content or old_abs != new_abs:
            updates[old_abs] = (new_abs, new_content)

    # Step 2: git mv moved files
    repo_root = os.path.dirname(BASE)
    for old_abs in sorted(moves.keys()):
        new_abs = moves[old_abs]
        os.makedirs(os.path.dirname(new_abs), exist_ok=True)
        subprocess.run(['git', 'mv', old_abs, new_abs], cwd=repo_root, check=True)
        print(f"  git mv {os.path.relpath(old_abs, repo_root)} -> {os.path.relpath(new_abs, repo_root)}")

    # Step 3: Write updated content
    for old_abs, (new_abs, new_content) in updates.items():
        with open(new_abs, 'w', encoding='utf-8') as fh:
            fh.write(new_content)
        if old_abs == new_abs:
            print(f"  updated imports in {os.path.relpath(new_abs, repo_root)}")

    print(f"\nMoved {len(moves)} files, updated imports in {len(updates)} files.")

if __name__ == '__main__':
    moves_json = json.loads(sys.argv[1])
    moves_raw = {os.path.join(BASE, k): os.path.join(BASE, v) for k, v in moves_json.items()}
    run(moves_raw)

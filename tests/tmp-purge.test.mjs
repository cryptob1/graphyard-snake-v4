import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

// These host-local audit files are produced by the GY-14 dry run and purge.
// CI has no access to this host's /tmp, so the host audit runs only there.
const manifestPath = '/tmp/GY-14-purge-manifest.json';
const resultPath = '/tmp/GY-14-purge-result.json';

test('integration:tmp-purge-dry-run audits the host purge manifest and inode result',
  { skip: !existsSync(manifestPath) || !existsSync(resultPath) }, () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    const cutoffNs = BigInt(Math.floor(manifest.cutoff * 1e9));
    const seen = new Set();
    let nodeCount = 0;

    assert.equal(manifest.uid, process.getuid(), 'purge belongs to this user');
    assert.ok(manifest.created > manifest.cutoff);
    assert.ok(manifest.created - manifest.cutoff >= 24 * 60 * 60);
    assert.ok(manifest.items.length > 0, 'dry run selected stale entries');

    for (const item of manifest.items) {
      assert.match(item.path, /^\/tmp\/harness-006-[^/]+$/,
        'only top-level test temp directories were selected');
      assert.ok(!seen.has(item.path), 'each directory is selected once');
      seen.add(item.path);
      assert.ok(item.nodes.length > 0);
      assert.equal(item.nodes[0][0], item.path, 'first node is the directory');

      for (const [path, inode, mtimeNs, mode] of item.nodes) {
        assert.ok(path === item.path || path.startsWith(`${item.path}/`),
          'every node stays inside its selected directory');
        assert.ok(Number.isInteger(inode) && inode > 0);
        assert.ok(BigInt(mtimeNs) < cutoffNs, 'no recently modified node selected');
        assert.ok([0o040000, 0o100000].includes(mode & 0o170000),
          'selected nodes are directories or regular files, never symlinks');
        nodeCount++;
      }
    }

    assert.equal(result.removed_directories, manifest.items.length);
    assert.equal(result.removed_nodes, nodeCount);
    assert.equal(result.skipped_changed_directories, 0);
    assert.equal(result.before_free_inodes, manifest.before_free_inodes);
    assert.ok(result.after_free_inodes >= 52_429, 'headroom exceeds 5%');
    assert.ok(result.after_free_inodes > result.before_free_inodes,
      'purge restored inode headroom');
  });

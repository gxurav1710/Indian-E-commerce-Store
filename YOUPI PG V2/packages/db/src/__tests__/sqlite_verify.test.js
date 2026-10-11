import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

test('native node:sqlite operates in memory', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE test (id TEXT PRIMARY KEY, val INT);');
  const insert = db.prepare('INSERT INTO test (id, val) VALUES (?, ?)');
  insert.run('1', 42);

  const select = db.prepare('SELECT * FROM test WHERE id = ?');
  const row = select.get('1');
  assert.equal(row.val, 42);
  db.close();
});

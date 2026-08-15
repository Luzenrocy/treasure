import { describe, expect, it } from 'vitest';
import { getSecurityRule, validateSqlSecurity } from './sqlSecurity';

describe('validateSqlSecurity', () => {
  it('rejects runtime DDL for plugin requests', () => {
    expect(validateSqlSecurity('CREATE TABLE plugin_demo_notes (id INTEGER)', 'execute', 'demo')).toMatchObject({ valid: false });
  });

  it('allows an UPDATE with EXISTS against declared plugin tables', () => {
    expect(validateSqlSecurity(
      'UPDATE plugin_demo_tasks SET status = ? WHERE EXISTS (SELECT 1 FROM plugin_demo_tags)',
      'execute',
      'demo',
    )).toEqual({ valid: true });
  });

  it('rejects unsupported statements; table safety is delegated to Rust AST preparation', () => {
    expect(validateSqlSecurity('PRAGMA table_info(notes)', 'query', 'demo')).toMatchObject({ valid: false });
  });

  it('accepts namespaced CTE and exposes only DML operations in the rule', () => {
    expect(getSecurityRule('demo').allowedOperations).toEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
    expect(validateSqlSecurity(
      'WITH recent AS (SELECT id FROM plugin_demo_notes) SELECT * FROM recent',
      'query', 'demo',
    )).toEqual({ valid: true });
  });

  it('rejects malformed CTEs without a closing parenthesis', () => {
    expect(validateSqlSecurity('WITH broken', 'query', 'demo')).toMatchObject({ valid: false });
  });

  it('rejects a CTE that has no statement after its final parenthesis', () => {
    expect(validateSqlSecurity('WITH x AS ()', 'query', 'demo')).toMatchObject({ valid: false });
  });

  it('allows each runtime DML statement after AST preparation', () => {
    expect(validateSqlSecurity('INSERT INTO plugin_demo_notes (id) VALUES (?)', 'execute', 'demo')).toEqual({ valid: true });
    expect(validateSqlSecurity('DELETE FROM plugin_demo_notes WHERE id = ?', 'execute', 'demo')).toEqual({ valid: true });
  });
});

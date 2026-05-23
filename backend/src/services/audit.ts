import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import logger from '../logger';
import type { AuditEntry } from '../../../shared/types';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  try {
    mkdirSync(dirname(config.auditDbPath), { recursive: true });
    db = new Database(config.auditDbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        timestamp   TEXT NOT NULL,
        event_type  TEXT NOT NULL,
        user_id     TEXT,
        input       TEXT NOT NULL,
        output      TEXT NOT NULL,
        command_type TEXT,
        approved    INTEGER,
        mode        TEXT NOT NULL,
        ip_address  TEXT
      )
    `);
    logger.info('Audit database initialized', { path: config.auditDbPath });
  } catch (err) {
    logger.error('Failed to initialize audit database', { error: (err as Error).message });
    throw err;
  }

  return db;
}

export function logEvent(entry: Omit<AuditEntry, 'id'>): string {
  const id = uuidv4();
  try {
    const database = getDb();
    database.prepare(`
      INSERT INTO audit_log (id, session_id, timestamp, event_type, user_id, input, output, command_type, approved, mode, ip_address)
      VALUES (@id, @sessionId, @timestamp, @eventType, @userId, @input, @output, @commandType, @approved, @mode, @ipAddress)
    `).run({
      id,
      sessionId: entry.sessionId,
      timestamp: entry.timestamp,
      eventType: entry.eventType,
      userId: entry.userId ?? null,
      input: entry.input,
      output: entry.output,
      commandType: entry.commandType ?? null,
      approved: entry.approved === undefined ? null : (entry.approved ? 1 : 0),
      mode: entry.mode,
      ipAddress: entry.ipAddress ?? null,
    });
  } catch (err) {
    logger.error('Failed to write audit log entry', { error: (err as Error).message });
  }
  return id;
}

export function getRecentEntries(limit = 50): AuditEntry[] {
  try {
    const rows = getDb().prepare(
      'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as Array<Record<string, unknown>>;

    return rows.map(r => ({
      id: r.id as string,
      sessionId: r.session_id as string,
      timestamp: r.timestamp as string,
      eventType: r.event_type as AuditEntry['eventType'],
      userId: r.user_id as string | undefined,
      input: r.input as string,
      output: r.output as string,
      commandType: r.command_type as AuditEntry['commandType'],
      approved: r.approved === null ? undefined : Boolean(r.approved),
      mode: r.mode as AuditEntry['mode'],
      ipAddress: r.ip_address as string | undefined,
    }));
  } catch (err) {
    logger.error('Failed to read audit log', { error: (err as Error).message });
    return [];
  }
}

export function getEntryById(id: string): AuditEntry | null {
  try {
    const row = getDb().prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      timestamp: row.timestamp as string,
      eventType: row.event_type as AuditEntry['eventType'],
      userId: row.user_id as string | undefined,
      input: row.input as string,
      output: row.output as string,
      commandType: row.command_type as AuditEntry['commandType'],
      approved: row.approved === null ? undefined : Boolean(row.approved),
      mode: row.mode as AuditEntry['mode'],
      ipAddress: row.ip_address as string | undefined,
    };
  } catch (err) {
    logger.error('Failed to get audit entry', { id, error: (err as Error).message });
    return null;
  }
}

export function getAuditCount(): number {
  try {
    const row = getDb().prepare('SELECT COUNT(*) as count FROM audit_log').get() as { count: number };
    return row.count;
  } catch {
    return -1;
  }
}

export function isDbHealthy(): boolean {
  try {
    getDb().prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

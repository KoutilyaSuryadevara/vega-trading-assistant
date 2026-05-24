import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from '../logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'active' | 'completed' | 'blocked' | 'cancelled';
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  type: 'bug-fix' | 'investigation' | 'deployment' | 'improvement' | 'incident' | 'review';
  agent?: string;
  workflow_id?: string;
  created_at: string;
  updated_at: string;
  notes?: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  affected_components: string[];
  status: 'open' | 'investigating' | 'mitigated' | 'resolved';
  created_at: string;
  resolved_at?: string;
}

export interface WorkflowStep {
  id: string;
  title: string;
  status: 'pending' | 'active' | 'done' | 'failed';
  notes?: string;
}

export interface Workflow {
  id: string;
  title: string;
  steps: WorkflowStep[];
  current_step: number;
  status: 'active' | 'completed' | 'failed' | 'paused';
  created_at: string;
  updated_at: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export class OperationalContextStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.initSchema();
      logger.info('Operational context DB initialized', { path: dbPath });
    } catch (err) {
      logger.error('Failed to init operational context DB', { error: (err as Error).message });
      throw err;
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        description  TEXT,
        status       TEXT NOT NULL DEFAULT 'active',
        priority     TEXT NOT NULL DEFAULT 'P3',
        type         TEXT NOT NULL DEFAULT 'investigation',
        agent        TEXT,
        workflow_id  TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        notes        TEXT
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id                   TEXT PRIMARY KEY,
        title                TEXT NOT NULL,
        severity             TEXT NOT NULL,
        description          TEXT NOT NULL,
        affected_components  TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'open',
        created_at           TEXT NOT NULL,
        resolved_at          TEXT
      );

      CREATE TABLE IF NOT EXISTS workflows (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        steps        TEXT NOT NULL,
        current_step INTEGER NOT NULL DEFAULT 0,
        status       TEXT NOT NULL DEFAULT 'active',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS deployment_state (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  getTasks(filter?: { status?: string; priority?: string }): Task[] {
    let sql = 'SELECT * FROM tasks';
    const params: string[] = [];
    const clauses: string[] = [];

    if (filter?.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.priority) {
      clauses.push('priority = ?');
      params.push(filter.priority);
    }
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(this.rowToTask);
  }

  upsertTask(task: Partial<Task> & { id: string }): Task {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as Record<string, unknown> | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE tasks SET
          title = ?, description = ?, status = ?, priority = ?,
          type = ?, agent = ?, workflow_id = ?, updated_at = ?, notes = ?
        WHERE id = ?
      `).run(
        task.title ?? existing.title,
        task.description ?? existing.description ?? null,
        task.status ?? existing.status,
        task.priority ?? existing.priority,
        task.type ?? existing.type,
        task.agent ?? existing.agent ?? null,
        task.workflow_id ?? existing.workflow_id ?? null,
        now,
        task.notes ?? existing.notes ?? null,
        task.id,
      );
    } else {
      this.db.prepare(`
        INSERT INTO tasks (id, title, description, status, priority, type, agent, workflow_id, created_at, updated_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        task.id,
        task.title ?? 'Untitled Task',
        task.description ?? null,
        task.status ?? 'active',
        task.priority ?? 'P3',
        task.type ?? 'investigation',
        task.agent ?? null,
        task.workflow_id ?? null,
        now,
        now,
        task.notes ?? null,
      );
    }

    return this.rowToTask(
      this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as Record<string, unknown>
    );
  }

  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string | undefined,
      status: row.status as Task['status'],
      priority: row.priority as Task['priority'],
      type: row.type as Task['type'],
      agent: row.agent as string | undefined,
      workflow_id: row.workflow_id as string | undefined,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      notes: row.notes as string | undefined,
    };
  }

  // ── Incidents ──────────────────────────────────────────────────────────────

  getIncidents(status?: string): Incident[] {
    let sql = 'SELECT * FROM incidents';
    const params: string[] = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(this.rowToIncident);
  }

  createIncident(inc: Omit<Incident, 'id' | 'created_at'>): Incident {
    const id = 'INC-' + uuidv4().split('-')[0].toUpperCase();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO incidents (id, title, severity, description, affected_components, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, inc.title, inc.severity, inc.description, JSON.stringify(inc.affected_components), inc.status ?? 'open', now);

    return this.rowToIncident(
      this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as Record<string, unknown>
    );
  }

  resolveIncident(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE incidents SET status = 'resolved', resolved_at = ? WHERE id = ?"
    ).run(now, id);
  }

  private rowToIncident(row: Record<string, unknown>): Incident {
    let components: string[] = [];
    try {
      components = JSON.parse(row.affected_components as string) as string[];
    } catch {
      components = [];
    }
    return {
      id: row.id as string,
      title: row.title as string,
      severity: row.severity as Incident['severity'],
      description: row.description as string,
      affected_components: components,
      status: row.status as Incident['status'],
      created_at: row.created_at as string,
      resolved_at: row.resolved_at as string | undefined,
    };
  }

  // ── Workflows ──────────────────────────────────────────────────────────────

  getWorkflows(status?: string): Workflow[] {
    let sql = 'SELECT * FROM workflows';
    const params: string[] = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(this.rowToWorkflow);
  }

  upsertWorkflow(wf: Partial<Workflow> & { id: string }): Workflow {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(wf.id) as Record<string, unknown> | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE workflows SET title = ?, steps = ?, current_step = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(
        wf.title ?? existing.title,
        JSON.stringify(wf.steps ?? JSON.parse(existing.steps as string)),
        wf.current_step ?? existing.current_step,
        wf.status ?? existing.status,
        now,
        wf.id,
      );
    } else {
      this.db.prepare(`
        INSERT INTO workflows (id, title, steps, current_step, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        wf.id,
        wf.title ?? 'Untitled Workflow',
        JSON.stringify(wf.steps ?? []),
        wf.current_step ?? 0,
        wf.status ?? 'active',
        now,
        now,
      );
    }

    return this.rowToWorkflow(
      this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(wf.id) as Record<string, unknown>
    );
  }

  private rowToWorkflow(row: Record<string, unknown>): Workflow {
    let steps: WorkflowStep[] = [];
    try {
      steps = JSON.parse(row.steps as string) as WorkflowStep[];
    } catch {
      steps = [];
    }
    return {
      id: row.id as string,
      title: row.title as string,
      steps,
      current_step: row.current_step as number,
      status: row.status as Workflow['status'],
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  // ── Deployment State ───────────────────────────────────────────────────────

  getDeploymentState(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM deployment_state').all() as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  setDeploymentState(key: string, value: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO deployment_state (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, now);
  }

  // ── DB access (for sharing with CostGovernor) ─────────────────────────────

  getDb(): Database.Database {
    return this.db;
  }

  // ── Full Context ───────────────────────────────────────────────────────────

  getFullContext(): {
    tasks: Task[];
    incidents: Incident[];
    workflows: Workflow[];
    deploymentState: Record<string, string>;
  } {
    return {
      tasks: this.getTasks(),
      incidents: this.getIncidents(),
      workflows: this.getWorkflows(),
      deploymentState: this.getDeploymentState(),
    };
  }
}

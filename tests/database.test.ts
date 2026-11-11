import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { emptyState } from "../lib/model";
test("migration is repeatable; RLS, owner isolation, CAS revisions and rate limits work", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`,
    );
    const sql = await readFile(
      new URL(
        "../supabase/migrations/202611070001_daylight.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`,
    );
    const first = await db.query<{ revision: number }>(
      `select public.daylight_save_workspace($1::jsonb,0) as revision`,
      [JSON.stringify(emptyState())],
    );
    assert.equal(Number(first.rows[0].revision), 1);
    await assert.rejects(
      db.query(`select public.daylight_save_workspace($1::jsonb,0)`, [
        JSON.stringify(emptyState()),
      ]),
      /revision_conflict/,
    );
    await assert.rejects(
      db.query(`update public.daylight_workspaces set revision=500`),
      /permission denied/,
    );
    const own = await db.query(`select * from public.daylight_workspaces`);
    assert.equal(own.rows.length, 1);
    await db.exec(
      `select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);`,
    );
    const other = await db.query(`select * from public.daylight_workspaces`);
    assert.equal(other.rows.length, 0);
    await assert.rejects(
      db.query(`select * from public.daylight_google_accounts`),
      /permission denied/,
    );
    await db.exec(
      `select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`,
    );
    const second = await db.query<{ revision: number }>(
      `select public.daylight_save_workspace($1::jsonb,1) as revision`,
      [JSON.stringify(emptyState())],
    );
    assert.equal(Number(second.rows[0].revision), 2);
    await assert.rejects(
      db.query(`select public.daylight_save_workspace($1::jsonb,1)`, [
        JSON.stringify(emptyState()),
      ]),
      /revision_conflict/,
    );
    await db.exec("reset role");
    const rates = [];
    for (let i = 0; i < 3; i++) {
      const r = await db.query<{ allowed: boolean }>(
        `select public.daylight_rate_limit('00000000-0000-0000-0000-000000000001','test',2,3600) as allowed`,
      );
      rates.push(r.rows[0].allowed);
    }
    assert.deepEqual(rates, [true, true, false]);
  } finally {
    await db.close();
  }
});

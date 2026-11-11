// Published copy: the private outreach tables (a separate, unpublished experiment) are left out.
import pg from 'pg';
import { RELEASES_SQL } from './releases.mjs';
import { RELEASE_REQUESTS_SQL } from './auto-release.mjs';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10000 });
export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (id integer PRIMARY KEY CHECK(id=1), spend_limit numeric NOT NULL DEFAULT 0, enabled boolean NOT NULL DEFAULT false);
    INSERT INTO settings(id) VALUES(1) ON CONFLICT DO NOTHING;
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS weekly_books boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS runs (id uuid PRIMARY KEY, kind text NOT NULL, status text NOT NULL, input jsonb NOT NULL, result jsonb NOT NULL, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), idempotency_key text UNIQUE NOT NULL);
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS stop_requested boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS calls (id uuid PRIMARY KEY, run_id uuid REFERENCES runs(id), provider text NOT NULL, call_key text UNIQUE NOT NULL, state text NOT NULL, reserved numeric NOT NULL, prompt text NOT NULL, response jsonb, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS packets (id uuid PRIMARY KEY, document jsonb NOT NULL, hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS predictions (id uuid PRIMARY KEY, run_id uuid REFERENCES runs(id), provider text NOT NULL, horizon integer NOT NULL, document jsonb NOT NULL, hash text NOT NULL, sealed_at timestamptz NOT NULL, due_at timestamptz NOT NULL, UNIQUE(run_id,provider,horizon));
    CREATE TABLE IF NOT EXISTS portfolios (run_id uuid REFERENCES runs(id), provider text NOT NULL, document jsonb NOT NULL, hash text NOT NULL, sealed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,provider));
    CREATE TABLE IF NOT EXISTS portfolio_recoveries (run_id uuid REFERENCES runs(id), provider text NOT NULL, document jsonb NOT NULL, hash text NOT NULL, recovered_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,provider));
    CREATE TABLE IF NOT EXISTS daily_jobs (day date PRIMARY KEY, state text NOT NULL, error text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
    CREATE TABLE IF NOT EXISTS price_evidence (day date NOT NULL REFERENCES daily_jobs(day), symbol text NOT NULL, document jsonb NOT NULL, PRIMARY KEY(day,symbol));
    CREATE TABLE IF NOT EXISTS daily_snapshots (run_id uuid REFERENCES runs(id), day date NOT NULL, document jsonb NOT NULL, PRIMARY KEY(run_id,day));
    CREATE TABLE IF NOT EXISTS daily_snapshot_corrections (run_id uuid REFERENCES runs(id), day date NOT NULL, source_day date NOT NULL, document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,day,source_day));
    CREATE TABLE IF NOT EXISTS price_evidence_corrections (day date NOT NULL, source_day date NOT NULL, symbol text NOT NULL, document jsonb NOT NULL, PRIMARY KEY(day,source_day,symbol));
    CREATE TABLE IF NOT EXISTS market_snapshots (day date PRIMARY KEY, document jsonb NOT NULL, hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS market_bootstraps (day date PRIMARY KEY, document jsonb NOT NULL, hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS market_ingests (day date PRIMARY KEY, document jsonb NOT NULL, hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE OR REPLACE FUNCTION alphaelo_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable benchmark evidence'; END; $$;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='prediction_immutable') THEN CREATE TRIGGER prediction_immutable BEFORE UPDATE OR DELETE ON predictions FOR EACH ROW EXECUTE FUNCTION alphaelo_immutable(); END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='packet_immutable') THEN CREATE TRIGGER packet_immutable BEFORE UPDATE OR DELETE ON packets FOR EACH ROW EXECUTE FUNCTION alphaelo_immutable(); END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='portfolio_immutable') THEN CREATE TRIGGER portfolio_immutable BEFORE UPDATE OR DELETE ON portfolios FOR EACH ROW EXECUTE FUNCTION alphaelo_immutable(); END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='price_evidence_immutable') THEN CREATE TRIGGER price_evidence_immutable BEFORE UPDATE OR DELETE ON price_evidence FOR EACH ROW EXECUTE FUNCTION alphaelo_immutable(); END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='snapshot_immutable') THEN CREATE TRIGGER snapshot_immutable BEFORE UPDATE OR DELETE ON daily_snapshots FOR EACH ROW EXECUTE FUNCTION alphaelo_immutable(); END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='snapshot_correction_immutable') THEN CREATE TRIGGER snapshot_correction_immutable BEFORE UPDATE OR DELETE ON daily_snapshot_corrections FOR EACH ROW EXECUTE FUNCTION alphaelo_immutable(); END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='price_correction_immutable') THEN CREATE TRIGGER price_correction_immutable BEFORE UPDATE OR DELETE ON price_evidence_corrections FOR EACH ROW EXECUTE FUNCTION alphaelo_immutable(); END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='market_snapshot_immutable') THEN CREATE TRIGGER market_snapshot_immutable BEFORE UPDATE OR DELETE ON market_snapshots FOR EACH ROW EXECUTE FUNCTION alphaelo_immutable(); END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='market_bootstrap_immutable') THEN CREATE TRIGGER market_bootstrap_immutable BEFORE UPDATE OR DELETE ON market_bootstraps FOR EACH ROW EXECUTE FUNCTION alphaelo_immutable(); END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='market_ingest_immutable') THEN CREATE TRIGGER market_ingest_immutable BEFORE UPDATE OR DELETE ON market_ingests FOR EACH ROW EXECUTE FUNCTION alphaelo_immutable(); END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS sandbox_humans (run_id uuid REFERENCES runs(id), player text NOT NULL, attempts jsonb NOT NULL DEFAULT '[]', final jsonb, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id, player));
    -- Worlds withdrawn from the sandbox list and Elo. The run, its calls and
    -- their cost stay in the database; only the rating ignores them.
    CREATE TABLE IF NOT EXISTS sandbox_voided (run_id uuid PRIMARY KEY REFERENCES runs(id), reason text NOT NULL, voided_at timestamptz NOT NULL DEFAULT now());
    -- Books removed from the Books page, Overview and daily price checks. The
    -- run, its portfolios, calls and cost stay in the database (reversible).
    CREATE TABLE IF NOT EXISTS books_voided (run_id uuid PRIMARY KEY REFERENCES runs(id), reason text NOT NULL, voided_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO books_voided(run_id, reason) SELECT id, 'Removed on request: early investing-v7 book from 18-19 Sep 2026, incomplete and faulty.' FROM runs
      WHERE kind='investing-once' AND id IN ('b9466147-9769-4ecb-a50a-9d13ff0ee531','23dff44a-bdef-4e21-84f0-dd54bbee3ecd') ON CONFLICT DO NOTHING;
    -- The book sealed on 13 Oct 2026 was frozen on a carried-forward market
    -- snapshot from 18 Sep (provider HTTP 402), so it was scored from 18 Sep.
    INSERT INTO books_voided(run_id, reason) SELECT id, 'Removed on request: sealed 13 Oct 2026 on a stale market snapshot from 18 Sep (carried forward after a price-provider failure).' FROM runs
      WHERE kind='investing-once' AND id='15cb4bd5-a761-4545-9cc3-78829ac566b1' ON CONFLICT DO NOTHING;
    -- The first worlds ran before provider calls stopped being cut off at
    -- 5 and 10 minutes (28 Sep 2026), so GPT-5.6 Luna and MiMo were stopped
    -- after 2-3 of their 8 attempts. Withdraw every world started before then.
    INSERT INTO sandbox_voided(run_id, reason) SELECT id, 'Trial run before the provider timeout fix; models were stopped early.' FROM runs WHERE kind='sandbox' AND created_at < '2026-09-28T08:20:00Z' ON CONFLICT DO NOTHING;
    -- Worlds that finished on the 32k output limit (before 28 Sep 2026 13:40
    -- CEST) left GPT-5.6 Luna without code in most attempts. Every world since
    -- records its limit in input.maxOutputTokens.
    -- A 32k world still running (or queued) is stopped rather than finished
    -- at the new limit, so no more money is spent on a world that will not count.
    UPDATE runs SET status='failed', error='Stopped: this world started on the old 32k output limit and is withdrawn from the Elo.', updated_at=now() WHERE kind='sandbox' AND status IN ('queued','running') AND NOT (input ? 'maxOutputTokens');
    INSERT INTO sandbox_voided(run_id, reason) SELECT id, 'Ran on the old 32k output limit; several models ran out before writing code.' FROM runs WHERE kind='sandbox' AND NOT (input ? 'maxOutputTokens') ON CONFLICT DO NOTHING;
    -- Worlds that finished on the 64k limit (28 Sep 2026): MiMo still ran out
    -- of budget in 3 of 7 attempts, so the limit became 100k.
    INSERT INTO sandbox_voided(run_id, reason) SELECT id, 'Ran on the 64k output limit; MiMo ran out of budget before writing code.' FROM runs WHERE kind='sandbox' AND status IN ('complete','failed') AND (input ? 'maxOutputTokens') AND (input->>'maxOutputTokens')::int < 100000 ON CONFLICT DO NOTHING;
  `);
  await pool.query(RELEASES_SQL);
  await pool.query(RELEASE_REQUESTS_SQL);
}
export async function saveRun(run) {
  // A run someone stopped stays paused: its progress is saved, but a worker
  // still finishing an in-flight call cannot flip it back to running.
  await pool.query("UPDATE runs SET status=CASE WHEN stop_requested THEN 'paused' ELSE $2 END,result=$3,error=CASE WHEN stop_requested THEN 'Stopped by hand' ELSE $4 END,updated_at=now() WHERE id=$1", [run.id, run.status, JSON.stringify(run.result), run.error || null]);
}
export async function saveRunInput(run) {
  await pool.query('UPDATE runs SET input=$2,updated_at=now() WHERE id=$1', [run.id, JSON.stringify(run.input)]);
}

import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';
import { z } from 'zod';

export const VERSION = 'alphaelo-v1';
export const HORIZONS = [3, 6, 9, 12, 18, 24];
export const OPENINGS = [[], ['e4', 'e5'], ['d4', 'd5'], ['c4', 'e5'], ['Nf3', 'd5']];
export const MODEL_IDS = ['openai', 'openai6', 'deepseek', 'meta', 'mimo', 'anthropic', 'ember'];
export const MAIA3_ID = 'maia3';
export const MAIA3_UCI_ELO = 1200;
export const CHESS_PLAYER_IDS = [...MODEL_IDS, MAIA3_ID];
export const CHESS_STARTING_ELO = Object.fromEntries([...MODEL_IDS.map(id => [id, 1500]), [MAIA3_ID, MAIA3_UCI_ELO]]);
export const CHESS_RATING_ANCHORS = new Set([MAIA3_ID]);
export const selectedModels = z.array(z.enum(MODEL_IDS)).min(1).max(5).refine(a => new Set(a).size === a.length, 'Models must be unique');
export const selectedChessPlayers = z.array(z.enum(CHESS_PLAYER_IDS)).min(2).max(6)
  .refine(a => new Set(a).size === a.length, 'Players must be unique')
  .refine(a => a.some(id => MODEL_IDS.includes(id)), 'Chess needs at least one language model');
export const chessInput = z.object({ models: selectedChessPlayers, openings: z.number().int().min(1).max(5).default(1), smoke: z.boolean().default(true) }).strict();
export function isUciEngine(id) { return id === MAIA3_ID; }
export const packetInput = z.object({
  title: z.string().min(1).max(160), asOf: z.string().datetime(), source: z.string().min(1).max(1000),
  research: z.string().min(100).max(20000),
  assets: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9._:-]{1,40}$/), name: z.string().min(1).max(120), evidence: z.string().min(1).max(1000) }).strict()).min(1).max(30),
}).strict().refine(p => new Date(p.asOf).getTime() <= Date.now(), 'Research cutoff cannot be in the future')
  .refine(p => new Set(p.assets.map(a => a.id)).size === p.assets.length, 'Asset IDs must be unique');
export const predictionInput = z.object({
  cashWeight: z.number().min(0).max(1), expectedReturn: z.number().min(-1).max(100),
  thesis: z.string().min(1).max(4000), risks: z.string().min(1).max(2000),
  positions: z.array(z.object({ assetId: z.string(), weight: z.number().positive().max(1), thesis: z.string().min(1).max(2000) }).strict()).max(15),
}).strict().refine(p => Math.abs(p.cashWeight + p.positions.reduce((a, b) => a + b.weight, 0) - 1) < 0.00001, 'Weights must total 1')
  .refine(p => new Set(p.positions.map(a => a.assetId)).size === p.positions.length, 'Duplicate assets');

export function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function addMonths(iso, months) {
  const date = new Date(iso), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last)); return date.toISOString();
}
export function tournament(models, openingCount, smoke) {
  const games = [];
  for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) {
    for (let opening = 0; opening < openingCount; opening++) for (const swapped of [false, true]) {
      const chess = new Chess(); OPENINGS[opening].forEach(move => chess.move(move));
      games.push({ white: models[swapped ? j : i], black: models[swapped ? i : j], opening, openingMoves: OPENINGS[opening], moves: [], fen: chess.fen(), status: 'queued', rated: !smoke, maxPlies: smoke ? 12 : 200 });
    }
  }
  return games;
}
export function board(game) { const chess = new Chess(); for (const move of [...game.openingMoves, ...game.moves]) chess.move(move); return chess; }
export function uciMoves(game) {
  const chess = new Chess();
  const moves = [];
  for (const move of [...game.openingMoves, ...game.moves]) {
    const played = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)
      ? chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] })
      : chess.move(move);
    if (!played) throw new Error('Corrupt chess history');
    moves.push(played.from + played.to + (played.promotion || ''));
  }
  return moves;
}
export function parseMove(text, chess) {
  const clean = text.trim();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(clean)) return null;
  try { return chess.move({ from: clean.slice(0, 2), to: clean.slice(2, 4), promotion: clean[4] }); } catch { return null; }
}
export function chessPrompt(chess) {
  return `AlphaElo ${VERSION}. Play chess without external tools. You are ${chess.turn() === 'w' ? 'White' : 'Black'}. FEN: ${chess.fen()}\nLegal moves: ${chess.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || '')).join(' ')}\nReturn exactly one legal UCI move, e.g. e2e4. No explanation, markdown or additional text. An illegal or malformed move forfeits the game.`;
}
export function investmentPrompt(packet, horizon) {
  return `AlphaElo ${VERSION}: paper value-investing benchmark, not trading. Horizon ${horizon} calendar months. Use only the supplied research packet; no live tools or future information. Long-only, unlevered allocations; cash permitted. You may choose any of the supplied priced instruments. Initial paper capital USD 10000. Buy and hold, no rebalancing. Weights including cash must total 1. Return only a JSON object: {"cashWeight":0.2,"expectedReturn":0.1,"thesis":"...","risks":"...","positions":[{"assetId":"exact packet ID","weight":0.8,"thesis":"..."}]}. expectedReturn is a fractional total return. Research packet:\n${JSON.stringify(packet)}`;
}
export function leaderboard(runs) {
  const rows = Object.fromEntries(CHESS_PLAYER_IDS.map(id => [id, { id, elo: CHESS_STARTING_ELO[id], games: 0, points: 0, illegalMoves: 0, freeze: CHESS_RATING_ANCHORS.has(id) }]));
  for (const run of runs) for (const game of run.result?.games || []) {
    if (!game.rated || game.status !== 'complete') continue;
    const white = rows[game.white], black = rows[game.black];
    if (!white || !black) continue;
    const score = game.result === '1-0' ? 1 : game.result === '0-1' ? 0 : 0.5;
    const change = 24 * (score - 1 / (1 + 10 ** ((black.elo - white.elo) / 400)));
    if (!white.freeze) white.elo += change;
    if (!black.freeze) black.elo -= change;
    white.games++; black.games++; white.points += score; black.points += 1 - score;
    if (game.reason === 'illegal_move' && rows[game.offender]) rows[game.offender].illegalMoves++;
  }
  return Object.values(rows).map(({ freeze, ...r }) => ({ ...r, elo: Math.round(r.elo), score: r.games ? r.points / r.games : null, anchor: freeze })).sort((a,b) => b.elo-a.elo);
}


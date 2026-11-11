import { stdout } from 'node:process';
import { createInterface } from 'node:readline';
import { Chess } from 'chess.js';

const chess = new Chess();
let elo = 1500;
const rl = createInterface({ input: process.stdin });
const say = line => stdout.write(`${line}\n`);

function apply(uci) {
  chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

function bestmove() {
  const move = chess.moves({ verbose: true })[0];
  return move ? `${move.from}${move.to}${move.promotion || ''}` : '0000';
}

for await (const raw of rl) {
  const line = raw.trim();
  if (!line) continue;
  if (line === 'uci') {
    say('id name FakeMaia');
    say('id author AlphaElo');
    say(`option name Elo type spin default ${elo} min 0 max 5000`);
    say('option name SelfElo type spin default 1500 min 0 max 5000');
    say('option name OppoElo type spin default 1500 min 0 max 5000');
    say('uciok');
  } else if (line === 'isready') {
    say('readyok');
  } else if (line === 'ucinewgame') {
    chess.reset();
  } else if (line.startsWith('setoption')) {
    const match = line.match(/name\s+Elo\s+value\s+(\d+)/i);
    if (match) elo = Number(match[1]);
  } else if (line.startsWith('position')) {
    chess.reset();
    const idx = line.indexOf(' moves ');
    if (line.includes('startpos') && idx >= 0) {
      for (const move of line.slice(idx + 7).trim().split(/\s+/).filter(Boolean)) apply(move);
    }
  } else if (line.startsWith('go')) {
    say(`info string elo ${elo}`);
    say(`bestmove ${bestmove()}`);
  } else if (line === 'quit') {
    break;
  }
}

/* Joshua's chess engine: negamax + alpha-beta, depth 2, capture quiescence with a node budget.
   Plays a reasonable, beatable game. Uses chess.js for the rules. */

const V = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// piece-square tables from white's perspective, a8..h1 order (index = rank8 first)
const PST = {
 p:[0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
 n:[-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],
 b:[-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20],
 r:[0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0],
 q:[-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],
 k:[-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20],
};
export function evaluate(g){ // from side-to-move perspective
  let s=0; const b=g.board();
  for(let r=0;r<8;r++)for(let f=0;f<8;f++){const p=b[r][f]; if(!p)continue; const i=p.color==='w'? r*8+f : (7-r)*8+f; const v=V[p.type]+PST[p.type][i]; s+= p.color==='w'?v:-v;}
  return g.turn()==='w'?s:-s;
}
function order(ms){ return ms.sort((a,b)=>((b.captured?V[b.captured]*10-V[b.piece]:0)+(b.promotion?800:0))-((a.captured?V[a.captured]*10-V[a.piece]:0)+(a.promotion?800:0))); }
let nodes=0;
const BUDGET=5000;
function qs(g,a,b,d){ nodes++; const st=evaluate(g); if(st>=b)return b; if(a<st)a=st; if(d===0||nodes>BUDGET)return a;
  for(const m of order(g.moves({verbose:true}).filter(m=>m.captured))){ g.move(m); const s=-qs(g,-b,-a,d-1); g.undo(); if(s>=b)return b; if(s>a)a=s;} return a;}
function nega(g,d,a,b){ nodes++;
  if(g.isCheckmate()) return -100000-d; if(g.isDraw()) return 0;
  if(d===0) return qs(g,a,b,2);
  for(const m of order(g.moves({verbose:true}))){ g.move(m); const s=-nega(g,d-1,-b,-a); g.undo(); if(s>=b)return b; if(s>a)a=s;} return a;}
/** Best move for the side to move. Returns { move, score (centipawns, side to move), nodes }. */
export function best(g,depth=2){ nodes=0; let bestM=null, bs=-Infinity; const ms=order(g.moves({verbose:true}).sort(()=>Math.random()-.5));
  for(const m of ms){ g.move(m); const s=-nega(g,depth-1,-Infinity,-bs); g.undo(); if(s>bs){bs=s;bestM=m;} }
  return {move:bestM,score:bs,nodes}; }

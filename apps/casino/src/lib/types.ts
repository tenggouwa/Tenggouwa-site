// 与 apps/server/app/modules/casino/schema.py 对应的前端类型。

export interface Wallet {
  device_id: string;
  balance: number;
  reclaim_count: number;
  total_wagered: number;
  total_payout: number;
  net: number;
  rounds_played: number;
}

export interface PlayResult {
  game: string;
  bet_amount: number;
  payout: number;
  net: number;
  outcome: 'win' | 'lose';
  rng_detail: Record<string, unknown>;
  balance_after: number;
}

export interface DiceRng {
  dice: [number, number, number];
  total: number;
  triple: boolean;
  result: 'big' | 'small' | 'triple';
}

export interface RouletteRng {
  number: number;
  color: 'red' | 'black' | 'green';
  win: boolean;
}

export interface SlotsRng {
  reels: string[];
  win: boolean;
}

export interface BaccaratRng {
  player: { r: string; s: string }[];
  banker: { r: string; s: string }[];
  player_total: number;
  banker_total: number;
  result: 'player' | 'banker' | 'tie';
}

export interface SicBoRng {
  dice: [number, number, number];
  total: number;
  triple: boolean;
}

export interface MoneyWheelRng {
  segment: string;
  index: number;
  win: boolean;
}

export interface PlinkoRng {
  path: ('L' | 'R')[];
  slot: number;
  mult: number;
}

export interface ZhajinhuaState {
  status: 'active' | 'done';
  looked: boolean;
  player: { r: string; s: string }[] | null;
  dealer: { r: string; s: string }[] | null;
  pot: number;
  player_paid: number;
  cur_stake: number;
  call_cost: number;
  round: number;
  can_compare: boolean;
  last_dealer_action: string | null;
  result: 'player' | 'dealer' | 'tie' | null;
  outcome: 'win' | 'lose' | null;
  player_rank: string | null;
  dealer_rank: string | null;
  payout: number;
  net: number;
  balance: number;
}

export interface MinesState {
  status: 'active' | 'done';
  tiles: number;
  mines: number;
  revealed: number[];
  current_mult: number;
  next_mult: number;
  can_cashout: boolean;
  bet: number;
  mine_positions: number[] | null;
  busted: boolean;
  payout: number;
  net: number;
  balance: number;
}

export interface NiuNiuRng {
  player: { r: string; s: string }[];
  banker: { r: string; s: string }[];
  player_niu: number;
  banker_niu: number;
  player_mult: number;
  banker_mult: number;
  result: 'player' | 'banker' | 'tie';
}

export interface VideoPokerState {
  status: 'dealt' | 'done';
  hand: { r: string; s: string }[];
  bet: number;
  held: number[] | null;
  category: string | null;
  category_name: string | null;
  multiplier: number;
  outcome: 'win' | 'lose' | 'push' | null;
  payout: number;
  net: number;
  balance: number;
}

export interface DragonTigerRng {
  dragon: { r: string; s: string };
  tiger: { r: string; s: string };
  result: 'dragon' | 'tiger' | 'tie';
}

export interface KenoRng {
  draw: number[];
  picks: number[];
  hits: number;
}

export interface CrashRng {
  crash: number;
  target: number;
  cashed: boolean;
}

export interface BlackjackState {
  status: 'player_turn' | 'done';
  player: { r: string; s: string }[];
  dealer: { r: string; s: string }[];
  player_total: number;
  dealer_total: number;
  can_double: boolean;
  bet: number;
  doubled: boolean;
  result: 'player' | 'dealer' | 'push' | 'player_blackjack' | null;
  outcome: 'win' | 'lose' | 'push' | null;
  payout: number;
  net: number;
  balance: number;
}

export interface CurvePoint {
  round_index: number;
  balance_after: number;
  net: number;
  game: string;
  created_at: string;
}

export interface CurveResponse {
  device_id: string;
  wallet: Wallet;
  points: CurvePoint[];
}

export interface GameStat {
  game: string;
  rounds: number;
  total_wagered: number;
  total_payout: number;
  observed_rtp: number | null;
  observed_house_edge: number | null;
  theoretical_house_edge: number;
}

export interface StatsSummary {
  games: GameStat[];
  total_rounds: number;
  total_players: number;
  total_wagered: number;
  total_payout: number;
}

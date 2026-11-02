import type { Kind } from './analyze';

// Client for the global leaderboard (server/board.ts). Same origin by
// default; the Pages copy of the game points VITE_API_URL at the Worker.

export interface BoardEntry { id: string; code: string; creature: string; creator: string; kind: Kind; ms: number; score: number; rank: number }
export interface BoardPage { rules: string; season: string; total: number; entries: BoardEntry[] }
export interface Posted { entry: BoardEntry; rank: number; kindRank: number; total: number }

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? './api/board';

async function call<T>(init?: RequestInit, query = ''): Promise<T> {
  const res = await fetch(API + query, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'The leaderboard is unavailable.');
  return body as T;
}

export const board = (kind?: Kind) => call<BoardPage>(undefined, kind ? `?kind=${kind}` : '');
export const postToBoard = (code: string, creature: string, creator: string) =>
  call<Posted>({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, creature, creator }) });

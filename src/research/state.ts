// M1 persistence and pure transitions. Existing finds remain authoritative in their own fields.
import type { GameEvents, ResearchBranch } from '../core/types';
import type { SaveData } from '../game/contracts';
import { LAYOUT } from '../world/layout';
import { isFeatherId, relicById } from '../progression/relics';
import { FEATHER_POINTS, INSCRIPTION_POINTS, LANDMARK_POINTS, RELIC_POINTS, VENTARI_SITES } from './registry';

export interface ResearchState {
  entries: string[];
  /** Recomputed cache, never trusted on load. */
  points: Record<ResearchBranch, number>;
}

type Finds = Pick<SaveData, 'collected' | 'discovered'>;
const SITE_IDS = ['gullrest-shrine', 'wind-counters'];
export const RIDGE_OBSERVATION = 'observation:wind-counters:ridge';

function definition(id: string): { branch: ResearchBranch; points: number; title: string } | null {
  if (id === RIDGE_OBSERVATION) return { branch: 'winds', points: 0, title: 'Highmoor ridge lift' };
  for (const siteId of SITE_IDS) {
    const site = VENTARI_SITES.find((s) => s.id === siteId)!;
    if (id === `survey:${siteId}:site`) return { branch: 'antiquity', points: site.points, title: site.name };
    if (id === `survey:${siteId}:inscription`) return { branch: 'antiquity', points: INSCRIPTION_POINTS, title: site.name };
  }
  return null;
}

export function researchState(raw: unknown, finds: Finds): ResearchState {
  const candidate = raw && typeof raw === 'object' ? (raw as { entries?: unknown }).entries : undefined;
  const entries = Array.isArray(candidate)
    ? [...new Set(candidate.filter((id): id is string => typeof id === 'string' && definition(id) !== null))]
    : [];
  const points = { nature: 0, antiquity: 0, winds: 0 };
  for (const id of entries) {
    const d = definition(id)!;
    points[d.branch] += d.points;
  }
  for (const id of new Set(finds.collected)) {
    if (isFeatherId(id)) points.nature += FEATHER_POINTS;
    else if (relicById(id)) points.antiquity += RELIC_POINTS;
  }
  for (const id of new Set(finds.discovered)) {
    if (LAYOUT.landmarks.some((lm) => lm.id === id)) points.winds += LANDMARK_POINTS;
  }
  return { entries, points };
}

/** Caller persists the returned state and emits the payload only when non-null. */
export function recordResearch(raw: unknown, finds: Finds, entryId: string): {
  state: ResearchState;
  event: GameEvents['researchEntry'] | null;
} {
  const state = researchState(raw, finds);
  const d = definition(entryId);
  if (!d || state.entries.includes(entryId)) return { state, event: null };
  state.entries.push(entryId);
  state.points[d.branch] += d.points;
  return {
    state,
    event: { entryId, branch: d.branch, title: d.title, points: d.points,
      branchTotal: state.points[d.branch], total: state.points.nature + state.points.antiquity + state.points.winds },
  };
}

/** The M1 reward is inscription-gated, not points-gated. */
export function airshipStage(state: Pick<ResearchState, 'entries'> | undefined): 0 | 1 {
  return state?.entries.includes('survey:gullrest-shrine:inscription') ? 1 : 0;
}

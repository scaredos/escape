// Character looks: kit/reference/characters/roster.json (inlined so tsc needs no JSON modules) + 06 §7.1 civilian variety.
export type LookId = 'fugitive_driver' | 'fugitive_brains' | 'fugitive_muscle' | 'fugitive_fixer' | 'soldier_rifleman' | 'soldier_officer'
  | 'soldier_heavy' | 'soldier_marksman' | 'civ_beach' | 'civ_elder';
export type HairStyle = 'short' | 'long' | 'buzz' | 'none';
export type Hat = 'cap' | 'cap_back' | 'helmet' | 'beret' | 'boonie';

export interface Look {
  id: string; group: 'fugitive' | 'soldier' | 'civilian';
  height: number; shoulders: number; hips: number; girth: number; head: number;
  skin: string; hair: string; hairStyle: HairStyle; hat?: Hat; hatColor?: string;
  top: string; sleeve: number; bottom: string; shorts: boolean; shoes: string; bootH: number;
  glasses: boolean; beard: boolean; beardColor?: string;
  vest: boolean; belt: boolean; backpack?: string; kneepads: boolean; patch: boolean; armor: number;
}

export const FACTION = { uniform: '5B6B3A', vest: '4A5530', helmet: '56603C', boots: '2E2A24', patch: 'C9B46A',
  skinTones: ['D4A373', 'C68642', 'E0AC69', '8D5524'] };

type Raw = Partial<Omit<Look, 'hairStyle'>> & { hair_style?: HairStyle; hat_color?: string; beard_color?: string; uniform?: boolean };
const ROSTER: Record<LookId, Raw> = {
  fugitive_driver: { group: 'fugitive', height: 1.78, shoulders: 1.05, skin: 'C68642', hair: '2B1D14', hair_style: 'short', hat: 'cap', hat_color: 'E8833A', top: '5B3A29', sleeve: 0.55, bottom: '2F4A6D', shoes: 'F2F2F2' },
  fugitive_brains: { group: 'fugitive', height: 1.72, shoulders: 0.95, girth: 0.9, skin: 'E0AC69', hair: '4A3020', hair_style: 'short', glasses: true, top: '1D9E75', sleeve: 0.55, bottom: '3D3D3D', shoes: '6B4F3A', backpack: '8C6A43' },
  fugitive_muscle: { group: 'fugitive', height: 1.86, shoulders: 1.2, girth: 1.22, skin: '8D5524', hair: '1A1A1A', hair_style: 'buzz', beard: true, top: 'EDEDED', sleeve: 0.04, bottom: '6B6B47', shoes: '2B2B2B' },
  fugitive_fixer: { group: 'fugitive', height: 1.68, shoulders: 0.9, hips: 1.1, girth: 0.92, skin: 'F1C27D', hair: '6A2E1A', hair_style: 'long', top: 'C0392B', sleeve: 0.55, bottom: '1F1F1F', shoes: '1F1F1F' },
  soldier_rifleman: { group: 'soldier', armor: 0.3, height: 1.80, shoulders: 1.08, girth: 1.05, skin: 'D4A373', hair: '2B1D14', hair_style: 'buzz', hat: 'helmet', uniform: true, vest: true, kneepads: true, patch: true },
  soldier_officer: { group: 'soldier', armor: 0, height: 1.82, shoulders: 1.05, skin: 'E0AC69', hair: '3A2A1E', hair_style: 'short', hat: 'beret', hat_color: '4E5A2E', uniform: true, belt: true, patch: true },
  soldier_heavy: { group: 'soldier', armor: 0.8, height: 1.84, shoulders: 1.18, girth: 1.25, skin: 'C68642', hair: '1A1A1A', hair_style: 'buzz', hat: 'helmet', beard: true, uniform: true, vest: true, kneepads: true, backpack: '4A5530', patch: true },
  soldier_marksman: { group: 'soldier', armor: 0.2, height: 1.76, shoulders: 1.0, girth: 0.95, skin: 'F1C27D', hair: '6A4A2A', hair_style: 'short', hat: 'boonie', hat_color: '5B6B3A', uniform: true, vest: true, patch: true },
  civ_beach: { group: 'civilian', height: 1.74, skin: 'C68642', hair: '2B1D14', hair_style: 'short', top: 'F2C14E', sleeve: 0.12, bottom: '3A6EA5', shorts: true, shoes: '8B5A2B' },
  civ_elder: { group: 'civilian', height: 1.70, girth: 1.1, skin: 'E0AC69', hair: 'C9C9C9', hair_style: 'short', beard: true, beard_color: 'C9C9C9', top: 'D9CBA8', sleeve: 0.55, bottom: '6E5E4A', shoes: '3B2F25' },
};

function fromRaw(id: string, r: Raw): Look {
  const soldier = !!r.uniform;
  return {
    id, group: r.group ?? 'civilian', height: r.height ?? 1.75, shoulders: r.shoulders ?? 1, hips: r.hips ?? 1, girth: r.girth ?? 1, head: 1.1,
    skin: r.skin ?? 'D4A373', hair: r.hair ?? '222222', hairStyle: r.hair_style ?? 'short', hat: r.hat,
    hatColor: r.hat_color ?? (r.hat ? FACTION.helmet : undefined),
    top: soldier ? FACTION.uniform : r.top ?? '777777', sleeve: soldier ? 0.55 : r.sleeve ?? 0.55,
    bottom: soldier ? FACTION.uniform : r.bottom ?? '444444', shorts: !!r.shorts,
    shoes: soldier ? FACTION.boots : r.shoes ?? '222222', bootH: soldier ? 0.14 : 0.10,
    glasses: !!r.glasses, beard: !!r.beard, beardColor: r.beard_color,
    vest: !!r.vest, belt: !!r.belt || soldier, backpack: r.backpack, kneepads: !!r.kneepads, patch: !!r.patch, armor: r.armor ?? 0,
  };
}

export const LOOK_IDS = Object.keys(ROSTER) as LookId[];
export function lookFromRoster(id: LookId): Look { return fromRaw(id, ROSTER[id]); }

/** Deterministic civilian variant (06 §7.1 "Civilian variety"); never uses the olive uniform colours. */
export function civilianVariant(seed: number): Look {
  let a = (seed * 2654435761) >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const hairs = ['1A1A1A', '2B1D14', '4A3020', '3A2A1E', '6A4A2A', 'C9C9C9'];
  const hair = pick(hairs);
  return fromRaw(`civ_${seed}`, {
    group: 'civilian', height: 1.62 + rnd() * 0.26, shoulders: 0.92 + rnd() * 0.18, hips: 0.95 + rnd() * 0.12, girth: 0.9 + rnd() * 0.25,
    skin: pick(FACTION.skinTones), hair, hair_style: pick<HairStyle>(['short', 'short', 'buzz', 'long']),
    top: pick(['F2C14E', 'D9CBA8', 'EDEDED', '1D9E75', '3A6EA5', 'C0392B', '5B3A29', '8C6A43']), sleeve: rnd() < 0.5 ? 0.12 : 0.55,
    bottom: pick(['3A6EA5', '6E5E4A', '3D3D3D', '2F4A6D', '6B6B47']), shorts: rnd() < 0.3,
    shoes: pick(['222222', '3B2F25', '8B5A2B', 'F2F2F2', '6B4F3A']),
    beard: rnd() < 0.2, beard_color: hair, ...(rnd() < 0.15 ? { hat: 'cap' as Hat, hat_color: pick(['E8833A', '2C5F9E', 'F1EEE6', 'B8322A']) } : {}),
  });
}

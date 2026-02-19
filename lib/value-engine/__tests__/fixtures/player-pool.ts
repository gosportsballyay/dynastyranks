/**
 * Synthetic player pool for value engine integration tests.
 *
 * ~100 players with realistic season-level projection stats.
 * Each player gets a fixed consensus value that stays constant
 * across configs — only the league signal changes.
 */

export interface TestPlayer {
  id: string;
  name: string;
  position: string;
  age: number;
  yearsExperience: number;
  /** Season-level stat projections */
  projections: Record<string, number>;
  /** Fixed consensus value (0-10000 scale) */
  consensusValue: number;
}

function qb(
  id: number,
  name: string,
  age: number,
  yrs: number,
  stats: {
    pass_yd: number;
    pass_td: number;
    int: number;
    rush_yd: number;
    rush_td: number;
    pass_att: number;
  },
  consensus: number,
): TestPlayer {
  return {
    id: `QB${id}`,
    name,
    position: "QB",
    age,
    yearsExperience: yrs,
    projections: { ...stats, fum: 3 },
    consensusValue: consensus,
  };
}

function rb(
  id: number,
  name: string,
  age: number,
  yrs: number,
  stats: {
    rush_yd: number;
    rush_td: number;
    rec: number;
    rec_yd: number;
    rec_td: number;
    rush_att: number;
  },
  consensus: number,
): TestPlayer {
  return {
    id: `RB${id}`,
    name,
    position: "RB",
    age,
    yearsExperience: yrs,
    projections: { ...stats, fum: 2 },
    consensusValue: consensus,
  };
}

function wr(
  id: number,
  name: string,
  age: number,
  yrs: number,
  stats: {
    rec: number;
    rec_yd: number;
    rec_td: number;
    rush_yd: number;
    rush_td: number;
  },
  consensus: number,
): TestPlayer {
  return {
    id: `WR${id}`,
    name,
    position: "WR",
    age,
    yearsExperience: yrs,
    projections: { ...stats, fum: 1 },
    consensusValue: consensus,
  };
}

function te(
  id: number,
  name: string,
  age: number,
  yrs: number,
  stats: { rec: number; rec_yd: number; rec_td: number },
  consensus: number,
): TestPlayer {
  return {
    id: `TE${id}`,
    name,
    position: "TE",
    age,
    yearsExperience: yrs,
    projections: { ...stats, fum: 1, rush_yd: 0, rush_td: 0 },
    consensusValue: consensus,
  };
}

function idp(
  id: number,
  name: string,
  pos: string,
  age: number,
  yrs: number,
  stats: {
    tackle_solo: number;
    tackle_assist: number;
    sack: number;
    def_int: number;
    fum_force: number;
    pass_def: number;
  },
  consensus: number,
): TestPlayer {
  return {
    id: `${pos}${id}`,
    name,
    position: pos,
    age,
    yearsExperience: yrs,
    projections: { ...stats, fum_rec: 1, def_td: 0.5 },
    consensusValue: consensus,
  };
}

// === QBs (12) — elite to backup, varying efficiency/rushing ===

export const QBS: TestPlayer[] = [
  qb(1, "Elite Passer", 27, 5,
    { pass_yd: 4800, pass_td: 38, int: 10, rush_yd: 350, rush_td: 3, pass_att: 560 }, 9200),
  qb(2, "Dual Threat QB", 25, 3,
    { pass_yd: 4200, pass_td: 30, int: 12, rush_yd: 700, rush_td: 6, pass_att: 520 }, 8800),
  qb(3, "Pocket Passer", 30, 8,
    { pass_yd: 4500, pass_td: 34, int: 11, rush_yd: 80, rush_td: 1, pass_att: 580 }, 8400),
  qb(4, "Young Gun", 23, 1,
    { pass_yd: 3800, pass_td: 26, int: 14, rush_yd: 400, rush_td: 4, pass_att: 500 }, 7800),
  qb(5, "Efficient QB", 28, 6,
    { pass_yd: 3600, pass_td: 28, int: 7, rush_yd: 150, rush_td: 2, pass_att: 420 }, 7400),
  qb(6, "Volume QB", 29, 7,
    { pass_yd: 4400, pass_td: 28, int: 16, rush_yd: 100, rush_td: 1, pass_att: 620 }, 7000),
  qb(7, "Bridge QB", 31, 9,
    { pass_yd: 3400, pass_td: 22, int: 12, rush_yd: 60, rush_td: 0, pass_att: 500 }, 5500),
  qb(8, "Backup A", 26, 4,
    { pass_yd: 2800, pass_td: 18, int: 10, rush_yd: 200, rush_td: 2, pass_att: 400 }, 4200),
  qb(9, "Backup B", 33, 11,
    { pass_yd: 2600, pass_td: 16, int: 12, rush_yd: 30, rush_td: 0, pass_att: 420 }, 3000),
  qb(10, "Rookie QB", 22, 0,
    { pass_yd: 2400, pass_td: 14, int: 12, rush_yd: 350, rush_td: 3, pass_att: 380 }, 5000),
  qb(11, "Camp Arm A", 27, 5,
    { pass_yd: 1800, pass_td: 10, int: 8, rush_yd: 50, rush_td: 0, pass_att: 300 }, 2000),
  qb(12, "Camp Arm B", 24, 2,
    { pass_yd: 1200, pass_td: 6, int: 6, rush_yd: 100, rush_td: 1, pass_att: 220 }, 1500),
];

// === RBs (25) — bell cow to committee, varying receiving ===

export const RBS: TestPlayer[] = [
  rb(1, "Bell Cow Alpha", 24, 2,
    { rush_yd: 1400, rush_td: 14, rec: 60, rec_yd: 500, rec_td: 3, rush_att: 290 }, 9500),
  rb(2, "Workhorse Back", 25, 3,
    { rush_yd: 1300, rush_td: 12, rec: 45, rec_yd: 380, rec_td: 2, rush_att: 280 }, 9000),
  rb(3, "Receiving RB", 23, 1,
    { rush_yd: 900, rush_td: 8, rec: 80, rec_yd: 700, rec_td: 4, rush_att: 180 }, 8600),
  rb(4, "Young Stud", 22, 0,
    { rush_yd: 1100, rush_td: 10, rec: 50, rec_yd: 420, rec_td: 2, rush_att: 240 }, 8200),
  rb(5, "Power Runner", 26, 4,
    { rush_yd: 1200, rush_td: 11, rec: 25, rec_yd: 180, rec_td: 1, rush_att: 270 }, 7800),
  rb(6, "Scat Back", 24, 2,
    { rush_yd: 700, rush_td: 5, rec: 70, rec_yd: 600, rec_td: 3, rush_att: 140 }, 7400),
  rb(7, "Committee Lead", 27, 5,
    { rush_yd: 950, rush_td: 8, rec: 40, rec_yd: 320, rec_td: 2, rush_att: 200 }, 7000),
  rb(8, "TD Vulture", 28, 6,
    { rush_yd: 800, rush_td: 10, rec: 20, rec_yd: 140, rec_td: 1, rush_att: 180 }, 6200),
  rb(9, "Change of Pace", 25, 3,
    { rush_yd: 650, rush_td: 5, rec: 55, rec_yd: 450, rec_td: 2, rush_att: 130 }, 5800),
  rb(10, "Veteran Grinder", 29, 7,
    { rush_yd: 850, rush_td: 7, rec: 30, rec_yd: 220, rec_td: 1, rush_att: 190 }, 5200),
  rb(11, "Depth Back A", 26, 4,
    { rush_yd: 600, rush_td: 4, rec: 25, rec_yd: 180, rec_td: 1, rush_att: 140 }, 4400),
  rb(12, "Depth Back B", 24, 2,
    { rush_yd: 550, rush_td: 4, rec: 35, rec_yd: 280, rec_td: 1, rush_att: 120 }, 4000),
  rb(13, "Aging Vet", 30, 8,
    { rush_yd: 700, rush_td: 5, rec: 20, rec_yd: 140, rec_td: 0, rush_att: 160 }, 3600),
  rb(14, "Pure Rusher", 25, 3,
    { rush_yd: 900, rush_td: 7, rec: 10, rec_yd: 60, rec_td: 0, rush_att: 210 }, 5000),
  rb(15, "Pass Catching Spec", 23, 1,
    { rush_yd: 400, rush_td: 2, rec: 65, rec_yd: 550, rec_td: 3, rush_att: 80 }, 5400),
  rb(16, "Roster Clogger A", 28, 6,
    { rush_yd: 400, rush_td: 3, rec: 15, rec_yd: 100, rec_td: 0, rush_att: 100 }, 2800),
  rb(17, "Roster Clogger B", 27, 5,
    { rush_yd: 350, rush_td: 2, rec: 20, rec_yd: 150, rec_td: 1, rush_att: 90 }, 2400),
  rb(18, "Handcuff A", 24, 2,
    { rush_yd: 300, rush_td: 2, rec: 15, rec_yd: 120, rec_td: 0, rush_att: 70 }, 2000),
  rb(19, "Handcuff B", 23, 1,
    { rush_yd: 250, rush_td: 1, rec: 10, rec_yd: 80, rec_td: 0, rush_att: 60 }, 1800),
  rb(20, "PS RB A", 22, 0,
    { rush_yd: 200, rush_td: 1, rec: 8, rec_yd: 60, rec_td: 0, rush_att: 50 }, 1500),
  rb(21, "PS RB B", 23, 1,
    { rush_yd: 180, rush_td: 1, rec: 5, rec_yd: 30, rec_td: 0, rush_att: 45 }, 1200),
  rb(22, "PS RB C", 26, 4,
    { rush_yd: 150, rush_td: 0, rec: 5, rec_yd: 30, rec_td: 0, rush_att: 40 }, 1000),
  rb(23, "PS RB D", 24, 2,
    { rush_yd: 120, rush_td: 0, rec: 3, rec_yd: 20, rec_td: 0, rush_att: 30 }, 800),
  rb(24, "PS RB E", 25, 3,
    { rush_yd: 100, rush_td: 0, rec: 2, rec_yd: 10, rec_td: 0, rush_att: 25 }, 600),
  rb(25, "PS RB F", 27, 5,
    { rush_yd: 80, rush_td: 0, rec: 1, rec_yd: 5, rec_td: 0, rush_att: 20 }, 400),
];

// === WRs (25) — alpha to depth, varying target volume ===

export const WRS: TestPlayer[] = [
  wr(1, "Alpha WR1", 25, 3,
    { rec: 110, rec_yd: 1500, rec_td: 12, rush_yd: 50, rush_td: 0 }, 9600),
  wr(2, "Target Hog", 26, 4,
    { rec: 105, rec_yd: 1350, rec_td: 10, rush_yd: 30, rush_td: 0 }, 9200),
  wr(3, "Deep Threat", 24, 2,
    { rec: 70, rec_yd: 1300, rec_td: 11, rush_yd: 40, rush_td: 0 }, 8800),
  wr(4, "Young Star", 23, 1,
    { rec: 90, rec_yd: 1200, rec_td: 9, rush_yd: 80, rush_td: 1 }, 8400),
  wr(5, "Possession WR", 27, 5,
    { rec: 100, rec_yd: 1100, rec_td: 7, rush_yd: 20, rush_td: 0 }, 8000),
  wr(6, "YAC Monster", 24, 2,
    { rec: 85, rec_yd: 1150, rec_td: 8, rush_yd: 100, rush_td: 1 }, 7600),
  wr(7, "Slot Specialist", 28, 6,
    { rec: 95, rec_yd: 1000, rec_td: 6, rush_yd: 30, rush_td: 0 }, 7200),
  wr(8, "Vertical Threat", 25, 3,
    { rec: 60, rec_yd: 1050, rec_td: 9, rush_yd: 10, rush_td: 0 }, 6800),
  wr(9, "High Volume WR", 26, 4,
    { rec: 90, rec_yd: 950, rec_td: 5, rush_yd: 15, rush_td: 0 }, 6400),
  wr(10, "Low Target WR", 27, 5,
    { rec: 50, rec_yd: 850, rec_td: 7, rush_yd: 5, rush_td: 0 }, 6000),
  wr(11, "WR Depth A", 29, 7,
    { rec: 70, rec_yd: 800, rec_td: 5, rush_yd: 20, rush_td: 0 }, 5400),
  wr(12, "WR Depth B", 24, 2,
    { rec: 65, rec_yd: 750, rec_td: 4, rush_yd: 30, rush_td: 0 }, 5000),
  wr(13, "WR Depth C", 26, 4,
    { rec: 60, rec_yd: 700, rec_td: 4, rush_yd: 10, rush_td: 0 }, 4600),
  wr(14, "Gadget WR", 23, 1,
    { rec: 40, rec_yd: 500, rec_td: 3, rush_yd: 200, rush_td: 2 }, 4200),
  wr(15, "Aging Vet WR", 31, 9,
    { rec: 55, rec_yd: 650, rec_td: 3, rush_yd: 5, rush_td: 0 }, 3800),
  wr(16, "WR Bench A", 25, 3,
    { rec: 45, rec_yd: 550, rec_td: 3, rush_yd: 10, rush_td: 0 }, 3200),
  wr(17, "WR Bench B", 27, 5,
    { rec: 40, rec_yd: 480, rec_td: 2, rush_yd: 5, rush_td: 0 }, 2800),
  wr(18, "WR Bench C", 24, 2,
    { rec: 35, rec_yd: 400, rec_td: 2, rush_yd: 15, rush_td: 0 }, 2400),
  wr(19, "WR Bench D", 28, 6,
    { rec: 30, rec_yd: 350, rec_td: 1, rush_yd: 5, rush_td: 0 }, 2000),
  wr(20, "WR Bench E", 23, 1,
    { rec: 25, rec_yd: 300, rec_td: 1, rush_yd: 10, rush_td: 0 }, 1800),
  wr(21, "PS WR A", 22, 0,
    { rec: 20, rec_yd: 250, rec_td: 1, rush_yd: 5, rush_td: 0 }, 1500),
  wr(22, "PS WR B", 24, 2,
    { rec: 15, rec_yd: 180, rec_td: 0, rush_yd: 0, rush_td: 0 }, 1200),
  wr(23, "PS WR C", 25, 3,
    { rec: 12, rec_yd: 140, rec_td: 0, rush_yd: 0, rush_td: 0 }, 1000),
  wr(24, "PS WR D", 23, 1,
    { rec: 10, rec_yd: 110, rec_td: 0, rush_yd: 0, rush_td: 0 }, 800),
  wr(25, "PS WR E", 26, 4,
    { rec: 8, rec_yd: 80, rec_td: 0, rush_yd: 0, rush_td: 0 }, 500),
];

// === TEs (10) — elite to streaming, varying receptions ===

export const TES: TestPlayer[] = [
  te(1, "Elite TE", 26, 4,
    { rec: 95, rec_yd: 1100, rec_td: 10 }, 8500),
  te(2, "High Volume TE", 27, 5,
    { rec: 85, rec_yd: 900, rec_td: 7 }, 7500),
  te(3, "Efficient TE", 25, 3,
    { rec: 55, rec_yd: 800, rec_td: 8 }, 6800),
  te(4, "Solid Starter TE", 28, 6,
    { rec: 65, rec_yd: 750, rec_td: 5 }, 6000),
  te(5, "Young TE", 23, 1,
    { rec: 50, rec_yd: 600, rec_td: 4 }, 5200),
  te(6, "Low Reception TE", 27, 5,
    { rec: 30, rec_yd: 500, rec_td: 5 }, 4500),
  te(7, "TE Depth A", 29, 7,
    { rec: 40, rec_yd: 450, rec_td: 3 }, 3800),
  te(8, "TE Depth B", 26, 4,
    { rec: 35, rec_yd: 380, rec_td: 2 }, 3000),
  te(9, "Streaming TE A", 30, 8,
    { rec: 25, rec_yd: 280, rec_td: 2 }, 2200),
  te(10, "Streaming TE B", 24, 2,
    { rec: 20, rec_yd: 200, rec_td: 1 }, 1600),
];

// === IDP: EDRs (8) ===

export const EDRS: TestPlayer[] = [
  idp(1, "Elite EDR", "EDR", 26, 4,
    { tackle_solo: 45, tackle_assist: 20, sack: 14, def_int: 0, fum_force: 4, pass_def: 2 }, 5000),
  idp(2, "Solid EDR", "EDR", 28, 6,
    { tackle_solo: 40, tackle_assist: 18, sack: 10, def_int: 0, fum_force: 3, pass_def: 1 }, 4200),
  idp(3, "Young EDR", "EDR", 24, 2,
    { tackle_solo: 35, tackle_assist: 15, sack: 8, def_int: 0, fum_force: 2, pass_def: 1 }, 3600),
  idp(4, "Vet EDR", "EDR", 30, 8,
    { tackle_solo: 30, tackle_assist: 12, sack: 7, def_int: 0, fum_force: 2, pass_def: 0 }, 3000),
  idp(5, "EDR Depth A", "EDR", 27, 5,
    { tackle_solo: 25, tackle_assist: 10, sack: 5, def_int: 0, fum_force: 1, pass_def: 0 }, 2400),
  idp(6, "EDR Depth B", "EDR", 25, 3,
    { tackle_solo: 20, tackle_assist: 8, sack: 4, def_int: 0, fum_force: 1, pass_def: 0 }, 2000),
  idp(7, "EDR Bench A", "EDR", 29, 7,
    { tackle_solo: 15, tackle_assist: 6, sack: 3, def_int: 0, fum_force: 0, pass_def: 0 }, 1400),
  idp(8, "EDR Bench B", "EDR", 23, 1,
    { tackle_solo: 10, tackle_assist: 4, sack: 2, def_int: 0, fum_force: 0, pass_def: 0 }, 1000),
];

// === IDP: LBs (8) ===

export const LBS: TestPlayer[] = [
  idp(1, "Elite LB", "LB", 26, 4,
    { tackle_solo: 100, tackle_assist: 45, sack: 4, def_int: 2, fum_force: 2, pass_def: 8 }, 5200),
  idp(2, "Solid LB", "LB", 28, 6,
    { tackle_solo: 85, tackle_assist: 40, sack: 3, def_int: 1, fum_force: 2, pass_def: 6 }, 4600),
  idp(3, "Young LB", "LB", 24, 2,
    { tackle_solo: 75, tackle_assist: 35, sack: 2, def_int: 1, fum_force: 1, pass_def: 5 }, 4000),
  idp(4, "Vet LB", "LB", 30, 8,
    { tackle_solo: 70, tackle_assist: 30, sack: 2, def_int: 1, fum_force: 1, pass_def: 4 }, 3400),
  idp(5, "LB Depth A", "LB", 27, 5,
    { tackle_solo: 55, tackle_assist: 25, sack: 1, def_int: 0, fum_force: 1, pass_def: 3 }, 2800),
  idp(6, "LB Depth B", "LB", 25, 3,
    { tackle_solo: 45, tackle_assist: 20, sack: 1, def_int: 0, fum_force: 0, pass_def: 2 }, 2200),
  idp(7, "LB Bench A", "LB", 29, 7,
    { tackle_solo: 30, tackle_assist: 12, sack: 0, def_int: 0, fum_force: 0, pass_def: 1 }, 1600),
  idp(8, "LB Bench B", "LB", 23, 1,
    { tackle_solo: 20, tackle_assist: 8, sack: 0, def_int: 0, fum_force: 0, pass_def: 0 }, 1200),
];

// === IDP: CBs (6) ===

export const CBS: TestPlayer[] = [
  idp(1, "Elite CB", "CB", 26, 4,
    { tackle_solo: 55, tackle_assist: 10, sack: 0, def_int: 5, fum_force: 1, pass_def: 18 }, 4800),
  idp(2, "Solid CB", "CB", 28, 6,
    { tackle_solo: 48, tackle_assist: 8, sack: 0, def_int: 3, fum_force: 1, pass_def: 14 }, 4000),
  idp(3, "Young CB", "CB", 24, 2,
    { tackle_solo: 42, tackle_assist: 7, sack: 0, def_int: 2, fum_force: 0, pass_def: 10 }, 3200),
  idp(4, "CB Depth A", "CB", 27, 5,
    { tackle_solo: 35, tackle_assist: 6, sack: 0, def_int: 1, fum_force: 0, pass_def: 8 }, 2600),
  idp(5, "CB Depth B", "CB", 30, 8,
    { tackle_solo: 28, tackle_assist: 5, sack: 0, def_int: 1, fum_force: 0, pass_def: 6 }, 2000),
  idp(6, "CB Bench", "CB", 25, 3,
    { tackle_solo: 20, tackle_assist: 3, sack: 0, def_int: 0, fum_force: 0, pass_def: 4 }, 1400),
];

// === IDP: Safeties (6) ===

export const SS: TestPlayer[] = [
  idp(1, "Elite S", "S", 27, 5,
    { tackle_solo: 70, tackle_assist: 20, sack: 1, def_int: 4, fum_force: 2, pass_def: 10 }, 4600),
  idp(2, "Solid S", "S", 26, 4,
    { tackle_solo: 60, tackle_assist: 18, sack: 1, def_int: 3, fum_force: 1, pass_def: 8 }, 3800),
  idp(3, "Young S", "S", 24, 2,
    { tackle_solo: 50, tackle_assist: 15, sack: 0, def_int: 2, fum_force: 1, pass_def: 6 }, 3200),
  idp(4, "S Depth A", "S", 29, 7,
    { tackle_solo: 40, tackle_assist: 12, sack: 0, def_int: 1, fum_force: 0, pass_def: 4 }, 2400),
  idp(5, "S Depth B", "S", 25, 3,
    { tackle_solo: 30, tackle_assist: 10, sack: 0, def_int: 1, fum_force: 0, pass_def: 3 }, 1800),
  idp(6, "S Bench", "S", 28, 6,
    { tackle_solo: 20, tackle_assist: 6, sack: 0, def_int: 0, fum_force: 0, pass_def: 2 }, 1200),
];

/** All players combined */
export const ALL_PLAYERS: TestPlayer[] = [
  ...QBS,
  ...RBS,
  ...WRS,
  ...TES,
  ...EDRS,
  ...LBS,
  ...CBS,
  ...SS,
];

/** Offense-only players for non-IDP leagues */
export const OFFENSE_PLAYERS: TestPlayer[] = [
  ...QBS,
  ...RBS,
  ...WRS,
  ...TES,
];

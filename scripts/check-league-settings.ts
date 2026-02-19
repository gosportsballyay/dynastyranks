/**
 * Check Sleeper league settings (SF, IDP, roster shape)
 * for a set of candidate leagues.
 */

// Candidates: pick different sizes + likely different formats
const candidates = [
  // 6-team
  { id: "1257115661486804993", name: "Boom or Bust", via: "DrParger" },
  // 8-team
  { id: "1194499206747930624", name: "Heads Will Roll", via: "ManaLeak" },
  { id: "1197766086850781184", name: "Duo Devy League", via: "mthofmann88" },
  // 10-team
  { id: "1178824408348856320", name: "Real Man's Football", via: "bhandlez" },
  { id: "1277695347002474496", name: "Full Spectrum League", via: "strategysavage" },
  { id: "1180627995528560640", name: "Decade Dynasty", via: "ManaLeak" },
  // 12-team
  { id: "1180238573755572224", name: "The Yuk", via: "SlightlyJason" },
  { id: "1193234676063137792", name: "DFL", via: "NinerJay" },
  { id: "1181711880187084800", name: "Dynasty-2.48", via: "bhandlez" },
  { id: "1180083397389361152", name: "Contest of Champions", via: "SlightlyJason" },
  // 14-team
  { id: "1184185593402159104", name: "NFL Contraction League", via: "SlightlyJason" },
  { id: "1180235073928445952", name: "Chilly Willy Nut Dust", via: "Illinihoops" },
  // 16-team
  { id: "1187790426106163200", name: "SuperSetSixteen", via: "PADeviLL" },
  { id: "1202328515500834816", name: "The Empire Strikes Back", via: "ManaLeak" },
  // 24-team
  { id: "1221861025108738048", name: "dynoBall Survivor S1:E3", via: "ManaLeak" },
  // 32-team
  { id: "1185414429298802688", name: "Zeus League", via: "PADeviLL" },
  { id: "1269104486865965056", name: "All Trust", via: "strategysavage" },
  { id: "1183485509048496128", name: "Fantasy Football Leagues System", via: "ManaLeak" },
];

interface SleeperSettings {
  settings: Record<string, number>;
  scoring_settings: Record<string, number>;
  roster_positions: string[];
}

async function main() {
  for (const c of candidates) {
    const res = await fetch(
      `https://api.sleeper.app/v1/league/${c.id}`,
    );
    const data = (await res.json()) as SleeperSettings;
    const rp = data.roster_positions || [];

    const hasSF =
      rp.filter((p) => p === "SUPER_FLEX").length > 0;
    const hasIDP =
      rp.filter((p) =>
        ["IDP_FLEX", "DB", "DL", "LB", "CB", "S", "DE", "DT", "EDR", "IL"].includes(p),
      ).length > 0;
    const idpCount = rp.filter((p) =>
      ["IDP_FLEX", "DB", "DL", "LB", "CB", "S", "DE", "DT", "EDR", "IL"].includes(p),
    ).length;
    const starters = rp.filter(
      (p) => p !== "BN" && p !== "IR" && p !== "TAXI",
    ).length;
    const bench = rp.filter((p) => p === "BN").length;
    const taxi = rp.filter((p) => p === "TAXI").length;
    const teams = data.settings?.num_teams ?? "?";
    const tep = (data.scoring_settings?.bonus_rec_te ?? 0) > 0;

    console.log(
      `${String(teams).padStart(2)}t | ${c.name.padEnd(35)} | ` +
        `SF=${hasSF ? "Y" : "N"} IDP=${hasIDP ? idpCount + "slots" : "N"} ` +
        `TEP=${tep ? "Y" : "N"} | ${starters}st/${bench}bn/${taxi}tx | ` +
        `via ${c.via}`,
    );
  }
}

main();

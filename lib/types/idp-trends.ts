export interface IdpTrendsData {
  meta: {
    lastUpdated: string;
    totalLeaguesCrawled: number;
    idpLeaguesFound: number;
    idpPct: number;
    dynastyPct: number;
    season: number;
  };

  highlights: {
    medianIdpStarters: number;
    mostCommonIdpCount: number;
    pctWithIdpFlex: number;
    medianTotalStarters: number;
    avgBenchSlots: number;
    pctSuperFlex: number;
  };

  starterDistribution: Array<{
    idpSlots: number;
    count: number;
    pct: number;
  }>;

  scoringDistributions: Array<{
    stat: string;
    label: string;
    min: number;
    p25: number;
    median: number;
    p75: number;
    max: number;
    mostCommon: number;
    mostCommonPct: number;
  }>;

  topRosterConfigs: Array<{
    config: string;
    idpSlots: number;
    count: number;
    pct: number;
  }>;

  crossTabs: {
    byLeagueSize: Array<{
      teamCount: number;
      leagueCount: number;
      avgIdpStarters: number;
      medianIdpStarters: number;
    }>;
    dynastyVsRedraft: {
      dynasty: {
        count: number;
        avgIdpStarters: number;
        pctWithIdpFlex: number;
      };
      redraft: {
        count: number;
        avgIdpStarters: number;
        pctWithIdpFlex: number;
      };
    };
    superFlexCorrelation: {
      superFlex: { count: number; avgIdpStarters: number };
      nonSuperFlex: { count: number; avgIdpStarters: number };
    };
    tepCorrelation: {
      tep: { count: number; avgIdpStarters: number };
      nonTep: { count: number; avgIdpStarters: number };
    };
  };
}

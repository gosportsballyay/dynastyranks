/**
 * Base Adapter - Common functionality for all provider adapters
 */

import type {
  Provider,
  AdapterConfig,
  RawPayload,
  AdapterSettings,
  ValidationResult,
  IDPStructure,
} from "@/types";
import { sleep, retry } from "@/lib/utils";

export abstract class BaseAdapter {
  abstract readonly provider: Provider;
  protected config: AdapterConfig;
  protected rawPayloads: RawPayload[] = [];

  constructor(config: AdapterConfig) {
    this.config = {
      rateLimitMs: 200, // Default 200ms between requests
      maxRetries: 3,
      ...config,
    };
  }

  /**
   * Make an HTTP request with rate limiting and retry logic
   */
  protected async fetch<T>(
    url: string,
    options?: RequestInit,
    endpoint?: string
  ): Promise<T> {
    // Rate limiting
    if (this.config.rateLimitMs) {
      await sleep(this.config.rateLimitMs);
    }

    const fetchFn = async (): Promise<T> => {
      console.log("Fetching URL:", url);
      const response = await fetch(url, {
        cache: "no-store",
        ...options,
        headers: {
          "Accept": "application/json",
          "User-Agent": "MyDynastyValues/1.0",
          ...options?.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("API Error Response:", errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Store raw payload for audit
      this.rawPayloads.push({
        endpoint: endpoint || url,
        requestParams: { url },
        payload: data,
        status: "success",
        fetchedAt: new Date(),
      });

      return data as T;
    };

    try {
      return await retry(fetchFn, { maxRetries: this.config.maxRetries });
    } catch (error) {
      // Store failed payload
      this.rawPayloads.push({
        endpoint: endpoint || url,
        requestParams: { url },
        payload: null,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        fetchedAt: new Date(),
      });
      throw error;
    }
  }

  /**
   * Get all raw payloads from this session
   */
  getRawPayloads(): RawPayload[] {
    return [...this.rawPayloads];
  }

  /**
   * Clear raw payloads after storing to database
   */
  clearRawPayloads(): void {
    this.rawPayloads = [];
  }

  /**
   * Validate league settings and detect issues
   */
  validateSettings(settings: AdapterSettings): ValidationResult {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Detect IDP usage
    const idpPositions = ["DL", "LB", "DB", "EDR", "IL", "CB", "S", "IDP_FLEX"];
    const hasIdp = Object.keys(settings.rosterPositions).some((pos) =>
      idpPositions.includes(pos)
    );

    if (hasIdp) {
      // Check for IDP scoring
      const idpStats = ["tackle_solo", "tackle_assist", "sack", "int", "pd"];
      const hasIdpScoring = Object.keys(settings.scoringRules).some((stat) =>
        idpStats.includes(stat)
      );

      if (!hasIdpScoring) {
        errors.push(
          "IDP roster positions detected but no IDP scoring rules found"
        );
      }
    }

    // Check for position-specific scoring on non-existent positions
    if (settings.positionScoringOverrides) {
      for (const pos of Object.keys(settings.positionScoringOverrides)) {
        if (!settings.rosterPositions[pos] && !this.isFlexEligible(pos, settings)) {
          warnings.push(
            `Position-specific scoring found for ${pos} but no ${pos} roster slots`
          );
        }
      }
    }

    // Check flex eligibility
    for (const flexRule of settings.flexRules) {
      for (const eligiblePos of flexRule.eligible) {
        if (
          !settings.rosterPositions[eligiblePos] &&
          !this.canBeMapped(eligiblePos, settings)
        ) {
          warnings.push(
            `Flex slot '${flexRule.slot}' allows ${eligiblePos} but no ${eligiblePos} roster slots exist`
          );
        }
      }
    }

    // Detect unusual scoring
    const scoringWarnings = this.detectUnusualScoring(settings.scoringRules);
    warnings.push(...scoringWarnings);

    // Determine IDP structure
    const idpStructure = this.detectIdpStructure(settings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      hasIdp,
      idpStructure,
    };
  }

  /**
   * Check if position is flex-eligible
   */
  private isFlexEligible(position: string, settings: AdapterSettings): boolean {
    return settings.flexRules.some((rule) =>
      rule.eligible.includes(position)
    );
  }

  /**
   * Check if position can be mapped from consolidated position
   */
  private canBeMapped(position: string, settings: AdapterSettings): boolean {
    if (!settings.positionMappings) return false;
    return Object.values(settings.positionMappings).some((mapped) =>
      mapped.includes(position)
    );
  }

  /**
   * Detect unusual scoring rules
   */
  private detectUnusualScoring(scoringRules: Record<string, number>): string[] {
    const warnings: string[] = [];

    // Common defaults for comparison
    const defaults: Record<string, number> = {
      pass_td: 4,
      rush_td: 6,
      rec_td: 6,
      pass_yd: 0.04,
      rush_yd: 0.1,
      rec_yd: 0.1,
      rec: 0, // Non-PPR default
      int: -2,
    };

    // Check for deviations
    if (scoringRules.pass_td && scoringRules.pass_td >= 6) {
      warnings.push(
        `High passing TD points (${scoringRules.pass_td}pts) - QB values will be significantly boosted`
      );
    }

    if (scoringRules.rec && scoringRules.rec >= 1.5) {
      warnings.push(
        `High PPR scoring (${scoringRules.rec}pts/rec) - WR/TE values boosted`
      );
    }

    // TE Premium detection
    const teBonus =
      (scoringRules.te_rec || scoringRules.rec_te || 0) -
      (scoringRules.rec || 0);
    if (teBonus > 0) {
      warnings.push(
        `TE Premium detected (+${teBonus}pts/rec) - TE values will be adjusted`
      );
    }

    return warnings;
  }

  /**
   * Detect IDP structure
   */
  private detectIdpStructure(settings: AdapterSettings): IDPStructure {
    const positions = new Set(Object.keys(settings.rosterPositions));

    const consolidated = positions.has("DL") || positions.has("LB") || positions.has("DB");
    const granular =
      positions.has("EDR") ||
      positions.has("IL") ||
      positions.has("CB") ||
      positions.has("S") ||
      positions.has("DE") ||
      positions.has("DT");

    const hasAnyIdp = consolidated || granular;

    if (!hasAnyIdp) {
      return "none";
    }

    if (consolidated && granular) {
      return "mixed";
    }

    if (consolidated) {
      return "consolidated";
    }

    return "granular";
  }
}

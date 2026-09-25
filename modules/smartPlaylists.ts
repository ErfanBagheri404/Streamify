/**
 * Rule-based smart playlists (issue #39).
 *
 * The rule engine (`matchRule`, `matchRules`) is pure and runs under Node.
 * The resolution layer reads the device's own stores — liked songs, play
 * history, and the all-time replay summary — and evaluates the rules against
 * the merged track pool. Nothing invented: fields mirror data the app already
 * records (plays, recency, liked state, source, artist/title).
 */

export type SmartRuleField =
  | "plays"
  | "lastPlayedDaysAgo"
  | "addedDaysAgo"
  | "isLiked"
  | "source"
  | "artist"
  | "title";

export type SmartRuleOperator =
  | "gte"
  | "lte"
  | "equals"
  | "contains"
  | "notContains";

export interface SmartRule {
  field: SmartRuleField;
  operator: SmartRuleOperator;
  /** Number for plays/days, string for text/source, boolean for isLiked. */
  value: number | string | boolean;
}

export type SmartRuleChain = "and" | "or";

export interface SmartPlaylistDefinition {
  /** Stable id of the smart playlist (not a Playlist.id — resolved on open). */
  id: string;
  name: string;
  rules: SmartRule[];
  chain: SmartRuleChain;
  /** Hard cap so a rule matching the whole library cannot choke the queue. */
  limit: number;
}

/** Built-in quick rules offered in the UI. */
export const SMART_PLAYLIST_PRESETS: SmartPlaylistDefinition[] = [
  {
    id: "smart-on-repeat",
    name: "On Repeat",
    chain: "and",
    limit: 50,
    rules: [{ field: "plays", operator: "gte", value: 5 }],
  },
  {
    id: "smart-forgotten-favorites",
    name: "Forgotten Favorites",
    chain: "and",
    limit: 50,
    rules: [
      { field: "isLiked", operator: "equals", value: true },
      { field: "lastPlayedDaysAgo", operator: "gte", value: 30 },
    ],
  },
  {
    id: "smart-recently-added",
    name: "Fresh Finds",
    chain: "and",
    limit: 50,
    rules: [{ field: "addedDaysAgo", operator: "lte", value: 7 }],
  },
];

/** Attribute view of one track for matching. Missing data fails closed. */
export interface MatchableTrack {
  id: string;
  title: string;
  artist?: string;
  source?: string;
  /** Whole listens from the replay summary (absent = 0). */
  plays: number;
  /** Days since last play (absent = Infinity = never heard recently). */
  lastPlayedDaysAgo?: number;
  /** Days since the track entered the library (absent = Infinity). */
  addedDaysAgo?: number;
  isLiked: boolean;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function matchRule(track: MatchableTrack, rule: SmartRule): boolean {
  switch (rule.field) {
    case "plays": {
      if (typeof rule.value !== "number" || !Number.isFinite(rule.value)) {
        return false;
      }
      if (rule.operator === "gte") return track.plays >= rule.value;
      if (rule.operator === "lte") return track.plays <= rule.value;
      if (rule.operator === "equals") return track.plays === rule.value;
      return false;
    }
    case "lastPlayedDaysAgo": {
      // No last-play timestamp means "never heard" — that MATCHES gte
      // (it is the most forgotten track possible) and fails lte/equals.
      const days = track.lastPlayedDaysAgo;
      if (typeof rule.value !== "number" || !Number.isFinite(rule.value)) {
        return false;
      }
      if (rule.operator === "gte") {
        return days === undefined || days >= rule.value;
      }
      if (rule.operator === "lte") {
        return days !== undefined && days <= rule.value;
      }
      if (rule.operator === "equals") {
        return days !== undefined && Math.floor(days) === Math.floor(rule.value);
      }
      return false;
    }
    case "addedDaysAgo": {
      const days = track.addedDaysAgo;
      if (typeof rule.value !== "number" || !Number.isFinite(rule.value)) {
        return false;
      }
      if (rule.operator === "gte") {
        return days !== undefined && days >= rule.value;
      }
      if (rule.operator === "lte") {
        return days !== undefined && days <= rule.value;
      }
      if (rule.operator === "equals") {
        return days !== undefined && Math.floor(days) === Math.floor(rule.value);
      }
      return false;
    }
    case "isLiked": {
      if (typeof rule.value !== "boolean") return false;
      if (rule.operator !== "equals") return false;
      return track.isLiked === rule.value;
    }
    case "source": {
      const source = textOf(track.source);
      if (typeof rule.value !== "string") return false;
      const needle = rule.value.toLowerCase();
      if (rule.operator === "equals") return source === needle;
      if (rule.operator === "contains") return source.includes(needle);
      if (rule.operator === "notContains") return !source.includes(needle);
      return false;
    }
    case "artist":
    case "title": {
      const haystack = textOf(rule.field === "artist" ? track.artist : track.title);
      if (typeof rule.value !== "string") return false;
      const needle = rule.value.toLowerCase();
      if (rule.operator === "equals") return haystack === needle;
      if (rule.operator === "contains") return haystack.includes(needle);
      if (rule.operator === "notContains") return !haystack.includes(needle);
      return false;
    }
  }
}

export function matchRules(
  track: MatchableTrack,
  rules: SmartRule[],
  chain: SmartRuleChain,
): boolean {
  if (rules.length === 0) return false;
  return chain === "and"
    ? rules.every((rule) => matchRule(track, rule))
    : rules.some((rule) => matchRule(track, rule));
}

/**
 * Apply a definition to a track pool. Sort is by relevance: plays descending,
 * then alphabetical — a "top" list that puts the spiciest match first and is
 * stable for identical inputs.
 */
export function resolveSmartPlaylist(
  definition: SmartPlaylistDefinition,
  pool: MatchableTrack[],
): MatchableTrack[] {
  const limit =
    Number.isFinite(definition.limit) && definition.limit > 0
      ? Math.floor(definition.limit)
      : 50;
  return pool
    .filter((track) => matchRules(track, definition.rules, definition.chain))
    .sort(
      (a, b) =>
        b.plays - a.plays ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

/** Whole days between `epochMs` and `now`; undefined for missing/invalid input. */
export function daysAgoFrom(
  epochMs: number | null | undefined,
  now = Date.now(),
): number | undefined {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs) || epochMs <= 0) {
    return undefined;
  }
  // A stamp in the future (clock change, restored backup) counts as "today"
  // rather than a negative age that would satisfy `lte 0` forever.
  return Math.max(0, Math.floor((now - epochMs) / 86_400_000));
}

/** Fields a definition may use, paired with the operators that suit them. */
export const SMART_FIELD_OPERATORS: Record<SmartRuleField, SmartRuleOperator[]> =
  {
    plays: ["gte", "lte", "equals"],
    lastPlayedDaysAgo: ["gte", "lte"],
    addedDaysAgo: ["lte", "gte"],
    isLiked: ["equals"],
    source: ["equals", "contains", "notContains"],
    artist: ["contains", "equals", "notContains"],
    title: ["contains", "equals", "notContains"],
  };

export const SMART_FIELDS: SmartRuleField[] = [
  "plays",
  "lastPlayedDaysAgo",
  "addedDaysAgo",
  "isLiked",
  "source",
  "artist",
  "title",
];

/**
 * Rebuild a definition from stored JSON, or null when unusable.
 *
 * Stored definitions are user data that may predate a field rename, so every
 * part is validated rather than trusted: an unknown field or an operator the
 * field does not support drops that rule. Dropping every rule yields null, and
 * the caller renders "no rules" rather than an accidental match-all.
 */
export function sanitizeSmartPlaylist(
  raw: unknown,
  fallbackId: string,
): SmartPlaylistDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<SmartPlaylistDefinition>;
  const rules = Array.isArray(source.rules)
    ? source.rules.filter((rule): rule is SmartRule => {
        if (!rule || typeof rule !== "object") return false;
        const { field, operator, value } = rule as SmartRule;
        if (!SMART_FIELDS.includes(field)) return false;
        if (!SMART_FIELD_OPERATORS[field].includes(operator)) return false;
        return (
          typeof value === "number" ||
          typeof value === "string" ||
          typeof value === "boolean"
        );
      })
    : [];
  if (rules.length === 0) return null;

  const chain: SmartRuleChain = source.chain === "or" ? "or" : "and";
  const limit =
    typeof source.limit === "number" && Number.isFinite(source.limit)
      ? Math.max(1, Math.floor(source.limit))
      : 50;
  const name =
    typeof source.name === "string" && source.name.trim()
      ? source.name.trim()
      : "Smart playlist";
  const id =
    typeof source.id === "string" && source.id.trim() ? source.id : fallbackId;

  return { id, name, rules, chain, limit };
}

/**
 * Human-readable summary of the rules, e.g. `plays >= 5 AND liked`.
 *
 * Labels and the join word are supplied by the caller so this module stays free
 * of i18n imports; the caller passes the localized "and"/"or".
 */
export function describeSmartPlaylist(
  definition: SmartPlaylistDefinition,
  label: (
    field: SmartRuleField,
    operator: SmartRuleOperator,
    value: SmartRule["value"],
  ) => string,
  joinWord: string,
): string {
  return definition.rules
    .map((rule) => label(rule.field, rule.operator, rule.value))
    .join(` ${joinWord} `);
}

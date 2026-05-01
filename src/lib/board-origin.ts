export type BoardOrigin =
  | { kind: "draft"; replaceHistoryId?: string }
  | { kind: "stored"; id: string; deleteToken: string }
  | { kind: "locked"; id: string; deleteToken: string };

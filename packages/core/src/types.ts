// All timestamps use ISO 8601 strings (RFC 3339).
// Reason: agents and other language clients work with JSON, not Date objects.
export type IsoDatetime = string;

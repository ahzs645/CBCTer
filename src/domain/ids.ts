export type AppId = string;

export function createAppId(prefix: string): AppId {
  return `${prefix}_${crypto.randomUUID()}`;
}

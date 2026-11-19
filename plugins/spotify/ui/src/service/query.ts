export const query = (fields: [string, string][]) =>
  fields.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

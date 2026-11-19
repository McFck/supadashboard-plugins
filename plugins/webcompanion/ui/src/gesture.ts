export const HOLD_MS = 400;

export const point = ({ clientX, clientY }: PointerEvent) => ({ x: clientX, y: clientY });

export const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

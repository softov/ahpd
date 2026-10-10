export { bag, str } from '@ahpd/sdk';

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

import type { Bag } from '@ahpd/sdk';

export const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

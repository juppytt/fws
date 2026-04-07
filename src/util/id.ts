import { nanoid } from 'nanoid';

export function generateId(length = 16): string {
  return nanoid(length);
}

export function generateEtag(): string {
  return `"${nanoid(12)}"`;
}

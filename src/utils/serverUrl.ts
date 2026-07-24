export function normalizeServerUrl(input: string): string {
  const trimmed = input?.trim() || '';
  if (!trimmed) return '';

  const withoutTrailingSlash = trimmed.replace(/\/$/, '');
  const match = withoutTrailingSlash.match(/^([a-z]+:\/\/)(www\.)/i);

  if (match?.[1]) {
    return withoutTrailingSlash.replace(/^([a-z]+:\/\/)(www\.)/i, '$1');
  }

  return withoutTrailingSlash;
}

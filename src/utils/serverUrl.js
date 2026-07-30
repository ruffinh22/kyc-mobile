function normalizeServerUrl(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';

  const withoutTrailingSlash = trimmed.replace(/\/$/, '');
  if (/^https?:\/\/www\./i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash.replace(/^https?:\/\/www\./i, match => match.replace('www.', ''));
  }

  return withoutTrailingSlash;
}

function ensureHttpBase(input) {
  const normalized = normalizeServerUrl(input);
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `https://${normalized}`;
}

module.exports = { normalizeServerUrl, ensureHttpBase };

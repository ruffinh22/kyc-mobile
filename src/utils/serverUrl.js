function normalizeServerUrl(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';

  const withoutTrailingSlash = trimmed.replace(/\/$/, '');
  if (/^https?:\/\/www\./i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash.replace(/^https?:\/\/www\./i, match => match.replace('www.', ''));
  }

  return withoutTrailingSlash;
}

module.exports = { normalizeServerUrl };

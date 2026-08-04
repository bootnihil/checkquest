export function createSafeDisplayUrl(value: string): string {
  try {
    const url = new URL(value);

    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';

    return url.toString();
  } catch {
    return '[invalid URL]';
  }
}

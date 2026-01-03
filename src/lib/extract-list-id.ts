// ABOUTME: Extract list ID from an X/Twitter list URL.
// ABOUTME: Returns list ID or null if input is invalid.

const LIST_URL_REGEX = /(?:twitter\.com|x\.com)\/i\/lists\/(\d+)/i;
const LIST_ID_REGEX = /^\d{5,}$/;

export function extractListId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const urlMatch = LIST_URL_REGEX.exec(trimmed);
  if (urlMatch) {
    return urlMatch[1];
  }
  if (LIST_ID_REGEX.test(trimmed)) {
    return trimmed;
  }
  return null;
}

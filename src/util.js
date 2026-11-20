export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

const NUMBER = /\d[\d\s\u00a0]*/g;

export function parseSalary(text) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return { salaryText: '', salaryMin: null, salaryMax: null };
  const digits = (raw.match(NUMBER) || []).map(n => Number(n.replace(/[\s\u00a0]/g, ''))).filter(n => n >= 1000);
  if (!digits.length || /hod|\/\s*h\b|hour/i.test(raw)) {
    return { salaryText: raw, salaryMin: null, salaryMax: null };
  }
  digits.sort((a, b) => a - b);
  if (digits.length === 1) {
    return /^\s*(až|do|max)/i.test(raw)
      ? { salaryText: raw, salaryMin: null, salaryMax: digits[0] }
      : { salaryText: raw, salaryMin: digits[0], salaryMax: null };
  }
  return { salaryText: raw, salaryMin: digits[0], salaryMax: digits[digits.length - 1] };
}

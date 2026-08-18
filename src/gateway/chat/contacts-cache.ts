// In-memory phone -> contact name cache, populated by the mobile app once per sync
// (see /device/contacts-sync) so prompt-building code can resolve names without any
// extra API/tool call per SMS or memory.

let contactsByDigits = new Map<string, string>();

function normalizeDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Compare on the last 10 digits so "+15551234567" and "5551234567" both match.
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function setContacts(contacts: { name: string; number: string }[]): void {
  const next = new Map<string, string>();
  for (const { name, number } of contacts) {
    const key = normalizeDigits(number ?? '');
    if (key.length >= 7 && name) next.set(key, name);
  }
  contactsByDigits = next;
}

export function resolveContactName(phone: string): string | undefined {
  const key = normalizeDigits(phone ?? '');
  if (key.length < 7) return undefined;
  return contactsByDigits.get(key);
}

// "John Smith (+15551234567)" if a contact match is found, else the raw phone number.
export function labelWithContact(phone: string, knownName?: string): string {
  const name = knownName || resolveContactName(phone);
  return name ? `${name} (${phone})` : phone;
}

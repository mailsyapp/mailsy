// Display helpers shared between the list rows and the conversation header.
// Kept out of component files so fast refresh stays valid.

// "Ada Lovelace <ada@example.com>" renders as "Ada Lovelace"; the address
// stays for unparseable or bare sender strings.
export function senderNameOf(from: string): string {
  return from.match(/^(.*?)\s*<[^>]+>$/)?.[1].replace(/^"|"$/g, '') ?? from
}

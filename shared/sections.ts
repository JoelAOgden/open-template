export const DEFAULT_SECTION_NAMES = ["Features", "Design", "Architecture", "Testing"] as const;

// Slugs are stable in existing projects, so protection needs no data migration.
export function isDefaultSection(section: { slug: string }): boolean {
  return DEFAULT_SECTION_NAMES.some(name => name.toLowerCase() === section.slug);
}

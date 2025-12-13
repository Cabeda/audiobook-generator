export function slugify(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\u0300-\u036f]/g, '')

  return normalized
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function createBookSlug(
  book: { title?: string; author?: string } | null | undefined
): string {
  if (!book) return ''

  const combined = [book.title, book.author].filter(Boolean).join(' ')
  const slug = slugify(combined)
  return slug || 'book'
}

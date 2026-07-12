/**
 * A question may belong to multiple modules. Frontmatter historically stores
 * them in one string, using either Chinese/ASCII list punctuation.
 */
export function splitModules(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : [value])
    .flatMap(item => item.split(/[、,，;；]/))
    .map(module => module.trim())
    .filter(Boolean);
}

/**
 * Escapes regex metacharacters in a string so it can be safely embedded in a RegExp.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace template variables with actual data. Supports {field_name}.
 */
export function renderMarkdownTemplate(
  template: string,
  data: Record<string, unknown>
): string {
  if (!template) return "";
  let result = template;
  Object.keys(data).forEach((key) => {
    const value = data[key] !== null && data[key] !== undefined ? String(data[key]) : "";
    const regex = new RegExp(`\\{${escapeRegExp(key)}\\}`, "g");
    result = result.replace(regex, value);
  });
  result = result.replace(/\{[^}]+\}/g, "");
  return result;
}

export function getDefaultAttendeeTemplate(): string {
  return `## {first_name} {last_name}

**Company:** {company}
**Position:** {position}
**Email:** {email}`;
}

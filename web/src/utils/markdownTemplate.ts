/**
 * Replace template variables in markdown with actual data
 * Supports: {field_name} for regular text, **{field_name}** for bold, etc.
 */
export const renderMarkdownTemplate = (
  template: string,
  data: Record<string, unknown>
): string => {
  if (!template) return '';
  
  let result = template;
  
  // Replace all {field_name} with actual values
  Object.keys(data).forEach((key) => {
    const value = data[key] !== null && data[key] !== undefined ? String(data[key]) : '';
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, value);
  });
  
  // Remove any remaining unreplaced variables
  result = result.replace(/\{[^}]+\}/g, '');
  
  return result;
};

/**
 * Get available fields from attendee data
 */
export const getAvailableFields = (attendee: Record<string, unknown>): string[] => {
  const fields: string[] = [];
  
  // Standard fields
  const standardFields = ['first_name', 'last_name', 'email', 'company', 'position', 'code'];
  standardFields.forEach(field => {
    if (field in attendee) {
      fields.push(field);
    }
  });
  
  // Custom fields
  if (attendee.custom_fields && typeof attendee.custom_fields === 'object') {
    Object.keys(attendee.custom_fields).forEach(key => {
      fields.push(key);
    });
  }
  
  return fields;
};

/**
 * Get default template for attendee display
 */
export const getDefaultAttendeeTemplate = (): string => {
  return `## {first_name} {last_name}

**Company:** {company}  
**Position:** {position}  
**Email:** {email}`;
};

/**
 * Get example markdown syntax for help
 */
export const getMarkdownHelp = () => {
  return {
    bold: '**{field_name}**',
    italic: '*{field_name}*',
    heading1: '# {field_name}',
    heading2: '## {field_name}',
    heading3: '### {field_name}',
    line: '{field_name}  ',
    lineBreak: 'Text  \nNew line (два пробела перед переносом)',
  };
};


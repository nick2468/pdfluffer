// Chip 7: decides whether the annotation storage holds a change a save would really write.
// Plain data only. PdfJsViewer.ts gathers the facts from PDF.js and calls these functions.
//
// The rule: an entry counts as a change unless it is a PROVEN no-op. A false "clean" loses
// the user's work, so every doubt counts as a change. Each no-op case below mirrors the
// PDF.js worker's own save test for that widget (pdf.worker.mjs 6.3.289: text `:54306`,
// checkbox `:54982`, radio button `:55031`), which skips the widget when the stored value
// equals the file's and the entry carries nothing else.

/** What the loaded file holds for one form widget, from PDF.js's field list. */
export interface FieldInfo {
  type: 'text' | 'checkbox' | 'radiobutton';
  /** The file's value. For a checkbox or radio button, the name of the state that is on. */
  value: string;
  /** For a checkbox or radio button, the name of this widget's own on-state. */
  exportValue: string | null;
}

/** Facts about one annotation editor, read by the viewer. */
export interface EditorFacts {
  /** Set when the editor wraps an annotation that is already in the file. */
  annotationElementId: unknown;
  deleted: unknown;
  inEditMode: unknown;
  /** What `editor.serialize()` returned. PDF.js returns null for an unchanged annotation. */
  serialized: unknown;
}

/** Stands in for an editor that wraps an unchanged annotation already in the file. */
export const UNTOUCHED_ANNOTATION: unique symbol = Symbol('untouched annotation');

/** A plain `{...}` object from any window. Class instances and arrays are not plain. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto !== null && Object.getPrototypeOf(proto) === null;
}

function isOnStateName(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value !== 'Off';
}

/**
 * Builds the widget map from PDF.js's field list: a Map (or plain object) from field name to
 * an array of widget objects. Anything with an unexpected shape is left out, so its storage
 * entry counts as a change. Text fields are left out when the file has XFA, because the
 * worker then writes a text value even when it is unchanged.
 */
export function fieldMapFrom(fieldObjects: unknown, options: { hasXfa: boolean }): Map<string, FieldInfo> {
  const fields = new Map<string, FieldInfo>();
  const duplicates = new Set<string>();
  let groups: Iterable<unknown>;
  // Not `instanceof Map`: the Map comes from the viewer iframe's window, a different realm.
  if (Object.prototype.toString.call(fieldObjects) === '[object Map]') groups = (fieldObjects as Map<unknown, unknown>).values();
  else if (isPlainRecord(fieldObjects)) groups = Object.values(fieldObjects);
  else return fields;

  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const widget of group) {
      if (typeof widget !== 'object' || widget === null) continue;
      const { id, type, value, exportValues } = widget as Record<string, unknown>;
      if (typeof id !== 'string') continue;
      let info: FieldInfo | null = null;
      if ((type === 'checkbox' || type === 'radiobutton') && typeof value === 'string' && isOnStateName(exportValues)) {
        info = { type, value, exportValue: exportValues };
      } else if (type === 'text' && typeof value === 'string' && !options.hasXfa) {
        info = { type, value, exportValue: null };
      }
      if (!info) continue;
      if (fields.has(id) || duplicates.has(id)) {
        fields.delete(id);
        duplicates.add(id);
        continue;
      }
      fields.set(id, info);
    }
  }
  return fields;
}

/**
 * True only for an editor that wraps an annotation already in the file, is not being edited,
 * is not deleted, and serialises to nothing. PDF.js leaves such an editor out of a save.
 */
export function isUntouchedAnnotation(facts: EditorFacts): boolean {
  return typeof facts.annotationElementId === 'string' && facts.annotationElementId !== ''
      && facts.deleted === false
      && facts.inEditMode === false
      && facts.serialized === null;
}

/** True only when saving this storage entry would leave the file as it is. */
export function isNoOpEntry(entry: unknown, field: FieldInfo | undefined): boolean {
  if (entry === UNTOUCHED_ANNOTATION) return true;
  if (!field || !isPlainRecord(entry)) return false;
  const keys = Object.keys(entry);
  if (keys.length !== 1 || keys[0] !== 'value') return false;
  const value = entry.value;
  switch (field.type) {
    case 'checkbox':
    case 'radiobutton':
      if (typeof value !== 'boolean' || !isOnStateName(field.exportValue)) return false;
      return value === (field.value === field.exportValue);
    case 'text':
      return typeof value === 'string' && value === field.value;
    default:
      return false;
  }
}

/** True when at least one storage entry is not a proven no-op. */
export function hasEffectiveChange(entries: Iterable<[string, unknown]>, fields: Map<string, FieldInfo>): boolean {
  for (const [id, entry] of entries) {
    if (!isNoOpEntry(entry, fields.get(id))) return true;
  }
  return false;
}

import { describe, expect, it } from 'vitest';
import {
  fieldMapFrom,
  hasEffectiveChange,
  isNoOpEntry,
  isUntouchedAnnotation,
  UNTOUCHED_ANNOTATION,
  type EditorFacts,
  type FieldInfo,
} from './effectiveChange';

// The field shapes PDF.js gave for samples/form-basic.pdf, saved with Post chosen
// (PDF.js 6.3.289, logged in the harness on 2026-09-19). Trimmed to the keys the rule reads.
const FORM_BASIC = new Map<string, unknown[]>([
  ['fullName', [
    { id: '8R', name: 'fullName', type: '', kidIds: ['9R'] },
    { id: '9R', value: 'Harness Tester', defaultValue: '', type: 'text' },
  ]],
  ['subscribe', [
    { id: '14R', type: '', kidIds: ['15R'] },
    { id: '15R', value: 'Yes', defaultValue: 'Off', exportValues: 'Yes', type: 'checkbox' },
  ]],
  ['country', [
    { id: '21R', value: 'New Zealand', items: [], type: 'combobox' },
  ]],
  ['contactBy', [
    { id: '23R', type: '', kidIds: ['24R', '29R', '34R'] },
    { id: '24R', value: 'Post', defaultValue: 'Off', exportValues: 'Phone', type: 'radiobutton' },
    { id: '29R', value: 'Post', defaultValue: 'Off', exportValues: 'Email', type: 'radiobutton' },
    { id: '34R', value: 'Post', defaultValue: 'Off', exportValues: 'Post', type: 'radiobutton' },
  ]],
]);

const fields = fieldMapFrom(FORM_BASIC, { hasXfa: false });
const radioOff: FieldInfo = { type: 'radiobutton', value: 'Post', exportValue: 'Phone' };
const radioOn: FieldInfo = { type: 'radiobutton', value: 'Post', exportValue: 'Post' };
const boxOn: FieldInfo = { type: 'checkbox', value: 'Yes', exportValue: 'Yes' };
const boxOff: FieldInfo = { type: 'checkbox', value: 'Off', exportValue: 'Yes' };
const text: FieldInfo = { type: 'text', value: 'Harness Tester', exportValue: null };

const untouched: EditorFacts = { annotationElementId: '52R', deleted: false, inEditMode: false, serialized: null };

describe('fieldMapFrom', () => {
  it('reads text, checkbox and radio button widgets by id', () => {
    expect(fields.get('9R')).toEqual(text);
    expect(fields.get('15R')).toEqual(boxOn);
    expect(fields.get('24R')).toEqual(radioOff);
    expect(fields.get('29R')).toEqual({ type: 'radiobutton', value: 'Post', exportValue: 'Email' });
    expect(fields.get('34R')).toEqual(radioOn);
  });

  it('leaves out parent fields, dropdowns and anything it does not know', () => {
    expect(fields.has('8R')).toBe(false);
    expect(fields.has('23R')).toBe(false);
    expect(fields.has('21R')).toBe(false);
    expect(fields.size).toBe(5);
  });

  it('accepts a Map from another realm, as the viewer iframe gives', () => {
    // A real Map whose prototype is a copy of Map.prototype, as an iframe's Map looks from here.
    const proto = Object.create(null) as object;
    for (const key of Reflect.ownKeys(Map.prototype)) {
      Object.defineProperty(proto, key, Object.getOwnPropertyDescriptor(Map.prototype, key)!);
    }
    const foreign = Object.setPrototypeOf(new Map(FORM_BASIC), proto) as unknown;
    expect(foreign instanceof Map).toBe(false);
    expect(fieldMapFrom(foreign, { hasXfa: false })).toEqual(fields);
  });

  it('accepts a plain object as well as a Map', () => {
    expect(fieldMapFrom(Object.fromEntries(FORM_BASIC), { hasXfa: false })).toEqual(fields);
  });

  it('leaves out text fields when the file has XFA, but keeps buttons', () => {
    const xfa = fieldMapFrom(FORM_BASIC, { hasXfa: true });
    expect(xfa.has('9R')).toBe(false);
    expect(xfa.get('24R')).toEqual(radioOff);
  });

  it('leaves out a button with no usable on-state name', () => {
    const map = fieldMapFrom(new Map([['b', [
      { id: '1R', value: 'Off', exportValues: null, type: 'checkbox' },
      { id: '2R', value: 'Off', exportValues: 'Off', type: 'checkbox' },
      { id: '3R', value: 'Off', exportValues: '', type: 'radiobutton' },
      { id: '4R', value: ['A'], exportValues: 'A', type: 'radiobutton' },
    ]]]), { hasXfa: false });
    expect(map.size).toBe(0);
  });

  it('drops an id that appears twice', () => {
    const map = fieldMapFrom(new Map([
      ['a', [{ id: '1R', value: 'x', type: 'text' }]],
      ['b', [{ id: '1R', value: 'y', type: 'text' }]],
      ['c', [{ id: '1R', value: 'z', type: 'text' }]],
    ]), { hasXfa: false });
    expect(map.has('1R')).toBe(false);
  });

  it('gives an empty map for anything that is not a Map or plain object', () => {
    for (const input of [null, undefined, 'x', 3, [['a', []]]]) {
      expect(fieldMapFrom(input, { hasXfa: false }).size).toBe(0);
    }
  });
});

describe('isNoOpEntry: proven no-ops', () => {
  it('a radio button written off by rendering, where the file has it off (case 1)', () => {
    expect(isNoOpEntry({ value: false }, radioOff)).toBe(true);
  });

  it('a radio button stored on, where the file has it on', () => {
    expect(isNoOpEntry({ value: true }, radioOn)).toBe(true);
  });

  it('a checkbox stored as the file has it, on or off', () => {
    expect(isNoOpEntry({ value: true }, boxOn)).toBe(true);
    expect(isNoOpEntry({ value: false }, boxOff)).toBe(true);
  });

  it('a text value equal to the file', () => {
    expect(isNoOpEntry({ value: 'Harness Tester' }, text)).toBe(true);
  });

  it('an unchanged annotation editor (case 2)', () => {
    expect(isNoOpEntry(UNTOUCHED_ANNOTATION, undefined)).toBe(true);
  });
});

describe('isNoOpEntry: everything else counts as a change', () => {
  it('a changed text value', () => {
    expect(isNoOpEntry({ value: 'Harness Tester!' }, text)).toBe(false);
    expect(isNoOpEntry({ value: '' }, text)).toBe(false);
  });

  it('a newly checked box', () => {
    expect(isNoOpEntry({ value: true }, boxOff)).toBe(false);
  });

  it('an unchecked box that the file has checked', () => {
    expect(isNoOpEntry({ value: false }, boxOn)).toBe(false);
  });

  it('a newly selected radio button', () => {
    expect(isNoOpEntry({ value: true }, radioOff)).toBe(false);
  });

  it('a radio button turned off that the file has on', () => {
    expect(isNoOpEntry({ value: false }, radioOn)).toBe(false);
  });

  it('an id not found in the file', () => {
    expect(isNoOpEntry({ value: false }, undefined)).toBe(false);
  });

  it('an extra key beside value', () => {
    expect(isNoOpEntry({ value: false, rotation: 90 }, radioOff)).toBe(false);
    expect(isNoOpEntry({ value: 'Harness Tester', formattedValue: 'x' }, text)).toBe(false);
    expect(isNoOpEntry({ value: true, noView: true }, boxOn)).toBe(false);
  });

  it('an entry with no value key, or no keys', () => {
    expect(isNoOpEntry({}, radioOff)).toBe(false);
    expect(isNoOpEntry({ rotation: 0 }, radioOff)).toBe(false);
  });

  it('a value of the wrong type for the widget', () => {
    expect(isNoOpEntry({ value: 'Off' }, radioOff)).toBe(false);
    expect(isNoOpEntry({ value: 0 }, boxOff)).toBe(false);
    expect(isNoOpEntry({ value: null }, boxOff)).toBe(false);
    expect(isNoOpEntry({ value: ['Harness Tester'] }, text)).toBe(false);
  });

  it('a non-object', () => {
    for (const entry of [null, undefined, false, 'x', 1, [{ value: false }]]) {
      expect(isNoOpEntry(entry, radioOff)).toBe(false);
    }
  });

  it('an editor-like object, even one that looks like a form value', () => {
    class FakeEditor { value = false; serialize() { return null; } }
    expect(isNoOpEntry(new FakeEditor(), radioOff)).toBe(false);
    expect(isNoOpEntry({ annotationType: 3, value: 'x', pageIndex: 0, rect: [0, 0, 1, 1] }, text)).toBe(false);
  });

  it('a field whose on-state name is unusable', () => {
    expect(isNoOpEntry({ value: false }, { type: 'checkbox', value: 'Off', exportValue: null })).toBe(false);
    expect(isNoOpEntry({ value: true }, { type: 'checkbox', value: 'Off', exportValue: 'Off' })).toBe(false);
  });

  it('a field type the rule does not know', () => {
    const odd = { type: 'combobox', value: 'Australia', exportValue: null } as unknown as FieldInfo;
    expect(isNoOpEntry({ value: 'Australia' }, odd)).toBe(false);
  });
});

describe('isUntouchedAnnotation', () => {
  it('accepts an unchanged editor for an annotation already in the file', () => {
    expect(isUntouchedAnnotation(untouched)).toBe(true);
  });

  it('refuses a new editor, which is not yet in the file', () => {
    expect(isUntouchedAnnotation({ ...untouched, annotationElementId: null })).toBe(false);
    expect(isUntouchedAnnotation({ ...untouched, annotationElementId: '' })).toBe(false);
  });

  it('refuses a deleted, edited or serialising editor', () => {
    expect(isUntouchedAnnotation({ ...untouched, deleted: true })).toBe(false);
    expect(isUntouchedAnnotation({ ...untouched, inEditMode: true })).toBe(false);
    expect(isUntouchedAnnotation({ ...untouched, serialized: { id: '52R', deleted: true } })).toBe(false);
    expect(isUntouchedAnnotation({ ...untouched, serialized: undefined })).toBe(false);
  });

  it('refuses facts it could not read', () => {
    expect(isUntouchedAnnotation({ ...untouched, deleted: undefined })).toBe(false);
    expect(isUntouchedAnnotation({ ...untouched, inEditMode: undefined })).toBe(false);
  });
});

describe('hasEffectiveChange', () => {
  it('is false for the render-written radio entries of case 1', () => {
    expect(hasEffectiveChange([['24R', { value: false }], ['29R', { value: false }]], fields)).toBe(false);
  });

  it('is false for nothing at all', () => {
    expect(hasEffectiveChange([], fields)).toBe(false);
  });

  it('is false for unchanged annotation editors (case 2)', () => {
    const entries: [string, unknown][] = [
      ['pdfjs_internal_editor_0', UNTOUCHED_ANNOTATION],
      ['pdfjs_internal_editor_1', UNTOUCHED_ANNOTATION],
    ];
    expect(hasEffectiveChange(entries, fields)).toBe(false);
  });

  it('is true when a real choice sits among the no-ops', () => {
    const entries: [string, unknown][] = [
      ['24R', { value: false }],
      ['29R', { value: true }],
      ['34R', { value: false }],
    ];
    expect(hasEffectiveChange(entries, fields)).toBe(true);
  });

  it('is true for any real editor among the no-ops', () => {
    const entries: [string, unknown][] = [
      ['24R', { value: false }],
      ['pdfjs_internal_editor_2', { annotationType: 3, value: 'Hi', pageIndex: 0 }],
    ];
    expect(hasEffectiveChange(entries, fields)).toBe(true);
  });

  it('is true for every entry once the baseline is gone', () => {
    expect(hasEffectiveChange([['24R', { value: false }]], new Map())).toBe(true);
  });
});

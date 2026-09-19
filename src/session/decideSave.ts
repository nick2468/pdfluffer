// The save decision (spec 12.3). The caller treats pendingEngineChanges as rewrite mode.

export type SaveStep = 'nothing-to-save' | 'guard-signature' | 'ask-first-save' | 'write';
export function decideSave(input: {
  dirty: boolean; mode: 'none' | 'append' | 'rewrite';
  hasDigitalSignature: boolean; rewriteAcknowledged: boolean; saveConfirmed: boolean;
}): SaveStep {
  if (!input.dirty) return 'nothing-to-save';
  if (input.mode === 'rewrite' && input.hasDigitalSignature && !input.rewriteAcknowledged) {
    return 'guard-signature';
  }
  if (!input.saveConfirmed) return 'ask-first-save';
  return 'write';
}

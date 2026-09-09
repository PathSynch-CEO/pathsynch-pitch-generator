'use strict';

async function writeBrandGrantAtomically(db, overridesRef, grantRef, overrides, grant) {
  if (!db?.runTransaction || !overridesRef || !grantRef || !overrides || !grant) {
    throw new Error('BRAND_GRANT_WRITE_INVALID');
  }
  return db.runTransaction(async tx => {
    const existingGrant = await tx.get(grantRef);
    if (existingGrant.exists) throw Object.assign(new Error('BRANDING_GRANT_ALREADY_EXISTS'), { code: 'BRANDING_GRANT_ALREADY_EXISTS' });
    tx.set(overridesRef, overrides, { merge: false });
    tx.create(grantRef, grant);
  });
}

module.exports = { writeBrandGrantAtomically };

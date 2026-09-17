'use strict';

const crypto = require('node:crypto');

const INTENT = 'CANCEL_AND_RECONCILE';

const ENTRIES = Object.freeze([
    ['SYNCH-P2-0001_INITIAL', 'SYNCH-P2-0001', 'ec1ec980afa94bd3cce245caeaab5f53c52af694ca87933f18c6e3fbaee61461', '8f88deb3a0a752312887f7a374fc6a6b1448a277f6f401c8487a615844621ae8', '921f01618473ec7a12fdc987745a2bc9bd6098e6c3b3ea9374cceb4d427ed925', 'ec240f1fe5126a7df47366f8138cfe67af00933ce3c43292331e4ef783546b4f'],
    ['SYNCH-P2-0001_REPLACEMENT', 'SYNCH-P2-0001', '8be8bfab526d55b92f4d6b1614b570751514e11f7fe0816f3f12f4cce5d8fa53', '9d458e4dfcdd98048f1b55ea622f19291ff19aac02a5cc5a61b4c14fc508c4e1', '15d944ada205d935c529c3b75a25e5223d8c6a0c8cea49202f2dcd5381f9c1d6', '79e737c314d553957fc711ef4dddfd4cf120782449df130f783c35e05553c305'],
    ['SYNCH-P2-0002_INITIAL', 'SYNCH-P2-0002', '75689cd2da44a1a249d9c3da4c425faac57e0348125a6de82fc0a08964414a0a', '0f27e11ce74e2c498cc256ab277cea88b68d781e648f7042d4d75b915c0c9dc2', '5f48be77535bf42a6567741920021e949de2164e4d4c75ae03065c10a671c1e0', 'ba548ae6f791d898a1ec72e2c4f56b54cac8d39234dadc56c493349ed3fc4a8f'],
    ['SYNCH-P2-0002_REPLACEMENT', 'SYNCH-P2-0002', '28e202464d660616d2a4c94b29318de73588007803b5df277c5cd1da173d3a0a', '4b0c51820f11f43856b223ef9220f1c3a852593e81dcf057adc738437d96ffac', 'd5c588318d843c3fdca2e607d453c7eb3792dc839467be50957a27773ac0775a', '5b0994fbc0ab0052b2d6e104b0dcdb8c022ea409e4f1b173920ce7bc586669b8'],
    ['SYNCH-P2-0003_ACCEPTANCE_1', 'SYNCH-P2-0003', 'cc27d8a6dc2a3e07af8b94a7c40744ccfc262ac7e6e5921f5f9ff908f4ddb852', 'af6cbefc9deed5777352b4c4cd4ae28ed952e0d66ff77b2879d0ecb75c56cd3d', '9cec28c58aac5e4627a55b6538851da24da3787b19a082b0ddcaba886fef2503', 'd11e56be5b145f6eb3540f473bf22c62abe96f7f8d1d87b8c130d8dff8b86a7a'],
    ['SYNCH-P2-0003_ACCEPTANCE_2', 'SYNCH-P2-0003', '1b57d7eafffdf84bff49d5bffebf9e261d79a70ae534f293fb78f83e2cb7c221', '4c84934a851b3b556b85a1cb585f5d135d6f69ce4e50201de73b7d088bbd90f3', 'ad34c5aad2692c2362df7d5c7cc051a0a46274c348128ac691ca216f18defed4', 'fe16dc87f8a0b9e7e6b73a2e0883fa60ff24e3287ba2d81a85d676253d75cde2'],
    ['SYNCH-P2-0003_ACCEPTANCE_3', 'SYNCH-P2-0003', 'e2162c6e20aa622ee28edd2a704d6534a18a5d60624bd7dfde101c178c4c5d40', '5ce5e9a6ad7651f2621bc287500cc26730f5c435e3b0a4694d4e2fd1d36eea0f', '2a62e9063221a0f9a33a5d2b6faccf2f542928d22600783193660220f6520165', 'e3f8537998720a4a131c21ef0eeafdafb4825d4f82802f3c6f45d12822b2d1d7']
].map(([reference, workPackage, idempotencyDigest, operationDigest, sessionDigest, identityDigest]) => Object.freeze({
    reference,
    work_package: workPackage,
    idempotency_key_digest: idempotencyDigest,
    operation_document_id_digest: operationDigest,
    session_id_digest: sessionDigest,
    workspace_id_digest: 'f31bff5e09cb9c701cd6ba9c8e7bff1773baf25515ee5e050da3a77ebe4edeaa',
    synthetic_identity_digest: identityDigest,
    provider_configuration_digest: '16024cab1d3c6a76dd592ef85ec97e0dc053b7089fba32b8d42e8fa4979990ca',
    intent: INTENT,
    communication_policy: 'SEND_CONTROLLED_SYNTHETIC_CANCELLATION'
})));

const BY_REFERENCE = new Map(ENTRIES.map((entry) => [entry.reference, entry]));

function opaqueIdentifierDigest(value) {
    if (typeof value !== 'string') throw new TypeError('Opaque identifier must be a string');
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeEmailAddress(value) {
    return String(value || '').trim().toLowerCase();
}

function emailAddressDigest(value) {
    return crypto.createHash('sha256').update(normalizeEmailAddress(value), 'utf8').digest('hex');
}

function resolveRecoveryAllowlistEntry(reference) {
    const normalized = String(reference || '').trim().toUpperCase();
    return BY_REFERENCE.get(normalized) || null;
}

function listRecoveryAllowlistEntries() {
    return ENTRIES.slice();
}

function operationDocumentId(entry) {
    return `op_${entry.idempotency_key_digest}`;
}

module.exports = {
    INTENT,
    emailAddressDigest,
    normalizeEmailAddress,
    opaqueIdentifierDigest,
    operationDocumentId,
    resolveRecoveryAllowlistEntry,
    listRecoveryAllowlistEntries
};

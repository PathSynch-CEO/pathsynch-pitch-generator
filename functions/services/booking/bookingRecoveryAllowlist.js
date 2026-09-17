'use strict';

const crypto = require('node:crypto');

const INTENT = 'CANCEL_AND_RECONCILE';

const ENTRIES = Object.freeze([
    ['SYNCH-P2-0001_INITIAL', 'SYNCH-P2-0001', 'ec1ec980afa94bd3cce245caeaab5f53c52af694ca87933f18c6e3fbaee61461', '8f88deb3a0a752312887f7a374fc6a6b1448a277f6f401c8487a615844621ae8', 'c1f4a2c532b072b0c8cbb81e0f6b51c0e6eb2d66058c92a77b0d9289945c2b4e', 'ec240f1fe5126a7df47366f8138cfe67af00933ce3c43292331e4ef783546b4f'],
    ['SYNCH-P2-0001_REPLACEMENT', 'SYNCH-P2-0001', '8be8bfab526d55b92f4d6b1614b570751514e11f7fe0816f3f12f4cce5d8fa53', '9d458e4dfcdd98048f1b55ea622f19291ff19aac02a5cc5a61b4c14fc508c4e1', '267ac8910f586cca54526043dc68f1cf2aac1ccbbac1c873aae18dbef89ce76e', '79e737c314d553957fc711ef4dddfd4cf120782449df130f783c35e05553c305'],
    ['SYNCH-P2-0002_INITIAL', 'SYNCH-P2-0002', '75689cd2da44a1a249d9c3da4c425faac57e0348125a6de82fc0a08964414a0a', '0f27e11ce74e2c498cc256ab277cea88b68d781e648f7042d4d75b915c0c9dc2', 'b221b183515d631a33f9d19eddd3b6b0434f14228b9d8d8599d26c3d5b4271c7', 'ba548ae6f791d898a1ec72e2c4f56b54cac8d39234dadc56c493349ed3fc4a8f'],
    ['SYNCH-P2-0002_REPLACEMENT', 'SYNCH-P2-0002', '28e202464d660616d2a4c94b29318de73588007803b5df277c5cd1da173d3a0a', '4b0c51820f11f43856b223ef9220f1c3a852593e81dcf057adc738437d96ffac', 'c5bc705068432a1b822f2775a6a5574efe77e072048a7ad88507061d5f2a90ae', '5b0994fbc0ab0052b2d6e104b0dcdb8c022ea409e4f1b173920ce7bc586669b8'],
    ['SYNCH-P2-0003_ACCEPTANCE_1', 'SYNCH-P2-0003', 'cc27d8a6dc2a3e07af8b94a7c40744ccfc262ac7e6e5921f5f9ff908f4ddb852', 'af6cbefc9deed5777352b4c4cd4ae28ed952e0d66ff77b2879d0ecb75c56cd3d', '7306ba647d6a9ec34e31de0d5669095ae6496da3f89a44d2b3ad74ebaaa15448', 'd11e56be5b145f6eb3540f473bf22c62abe96f7f8d1d87b8c130d8dff8b86a7a'],
    ['SYNCH-P2-0003_ACCEPTANCE_2', 'SYNCH-P2-0003', '1b57d7eafffdf84bff49d5bffebf9e261d79a70ae534f293fb78f83e2cb7c221', '4c84934a851b3b556b85a1cb585f5d135d6f69ce4e50201de73b7d088bbd90f3', '6b95be05420e49e8c3c12c07af45c88fc0b40534736198d0a84035362badfb87', 'fe16dc87f8a0b9e7e6b73a2e0883fa60ff24e3287ba2d81a85d676253d75cde2'],
    ['SYNCH-P2-0003_ACCEPTANCE_3', 'SYNCH-P2-0003', 'e2162c6e20aa622ee28edd2a704d6534a18a5d60624bd7dfde101c178c4c5d40', '5ce5e9a6ad7651f2621bc287500cc26730f5c435e3b0a4694d4e2fd1d36eea0f', 'f38404d80e9e2f97b165084de801ec3791daef4e050e13a2b505606b31bc4ea3', 'e3f8537998720a4a131c21ef0eeafdafb4825d4f82802f3c6f45d12822b2d1d7']
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

function digest(value) {
    return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
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
    digest,
    operationDocumentId,
    resolveRecoveryAllowlistEntry,
    listRecoveryAllowlistEntries
};

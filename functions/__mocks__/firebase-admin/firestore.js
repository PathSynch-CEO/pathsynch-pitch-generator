'use strict';

const FieldValue = {
    serverTimestamp: () => ({ _serverTimestamp: true, toDate: () => new Date() }),
    increment: (value) => ({ _increment: value }),
    arrayUnion: (...elements) => ({ _arrayUnion: elements }),
    arrayRemove: (...elements) => ({ _arrayRemove: elements }),
    delete: () => ({ _delete: true })
};

module.exports = { FieldValue };

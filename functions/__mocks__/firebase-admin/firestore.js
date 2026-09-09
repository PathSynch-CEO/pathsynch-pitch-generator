'use strict';

const FieldValue = {
    serverTimestamp: () => ({ _serverTimestamp: true, toDate: () => new Date() }),
    increment: (value) => ({ _increment: value }),
    arrayUnion: (...elements) => ({ _arrayUnion: elements }),
    arrayRemove: (...elements) => ({ _arrayRemove: elements }),
    delete: () => ({ _delete: true })
};

class Timestamp {
    constructor(date) { this.date = new Date(date); }
    toDate() { return new Date(this.date); }
    toMillis() { return this.date.getTime(); }
    static now() { return new Timestamp(new Date()); }
    static fromDate(date) { return new Timestamp(date); }
    static fromMillis(value) { return new Timestamp(value); }
}
module.exports = { FieldValue, Timestamp };
